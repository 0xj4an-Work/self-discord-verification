import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import QRCode from "qrcode";

import {
  SELF_ENDPOINT,
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  DISCORD_VERIFIED_ROLE_ID,
  SELF_APP_NAME,
  SELF_LOGO_URL,
} from "./config.mjs";
import { logEvent } from "./logger.mjs";

const require = createRequire(import.meta.url);
const { SelfAppBuilder, getUniversalLink } = require("@selfxyz/common");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const qrOutputDir = path.join(rootDir, "qrcodes");
fs.mkdirSync(qrOutputDir, { recursive: true });

const pendingVerifications = new Map();
let discordClient = null;

async function createSelfVerificationLink(sessionId, discordUser, generateQr = true) {
  if (!SELF_ENDPOINT) {
    throw new Error("SELF_ENDPOINT must be configured");
  }

  const hexUserId = BigInt(discordUser.id).toString(16).padStart(40, "0");
  const userId = `0x${hexUserId.slice(0, 40)}`;

  const selfApp = new SelfAppBuilder({
    version: 2,
    appName: SELF_APP_NAME,
    scope: "offchain", // Generic scope for offchain verification (not validated onchain)
    endpoint: SELF_ENDPOINT,
    logoBase64: SELF_LOGO_URL,
    userId,
    endpointType: "https",
    userIdType: "hex",
    userDefinedData: JSON.stringify({
      kind: "discord-self-verification",
      sessionId,
      discordUserId: discordUser.id,
      guildId: DISCORD_GUILD_ID,
    }),
    disclosures: {
      minimumAge: 18,
    },
  }).build();

  const universalLink = getUniversalLink(selfApp);

  let filename = null;
  let filePath = null;

  // Only generate QR code if requested (for desktop users)
  if (generateQr) {
    filename = `self-qr-${sessionId}.png`;
    filePath = path.join(qrOutputDir, filename);

    await QRCode.toFile(filePath, universalLink, {
      width: 512,
      errorCorrectionLevel: "H",
    });

    logEvent("qr.created", "Created Self QR code", {
      sessionId,
      userId: discordUser.id,
      filePath,
    });
  } else {
    logEvent("link.created", "Created Self deep link for mobile", {
      sessionId,
      userId: discordUser.id,
    });
  }

  return { universalLink, filename, filePath };
}

export async function handleDiscordVerificationSuccess(sessionId) {
  const entry = pendingVerifications.get(sessionId);
  if (!entry) {
    logEvent(
      "verification.unknown_session",
      "Verification for unknown session",
      {
        sessionId,
      },
    );
    return;
  }

  pendingVerifications.delete(sessionId);

  if (!discordClient) {
    logEvent(
      "verification.no_discord_client",
      "Discord client not ready when verification completed",
      { sessionId },
    );
    return;
  }

  const { discordUserId, guildId } = entry;

  try {
    const guild = await discordClient.guilds.fetch(guildId || DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordUserId);

    if (!DISCORD_VERIFIED_ROLE_ID) {
      logEvent(
        "verification.no_role_configured",
        "Verified role not configured",
        {
          guildId: guild.id,
          discordUserId,
        },
      );
    } else {
      const role =
        guild.roles.cache.get(DISCORD_VERIFIED_ROLE_ID) ||
        (await guild.roles.fetch(DISCORD_VERIFIED_ROLE_ID));

      if (!role) {
        logEvent(
          "verification.role_not_found",
          "Verified role id not found in guild",
          { guildId: guild.id, roleId: DISCORD_VERIFIED_ROLE_ID },
        );
      } else {
        await member.roles.add(role);
        logEvent("verification.role_assigned", "Assigned verified role", {
          guildId: guild.id,
          discordUserId,
          roleId: role.id,
        });
      }
    }

    try {
      const dm = await member.createDM();
      await dm.send(
        "🎉 **Verification Successful!**\n\n" +
        "✅ Your verification through Self.xyz has been completed successfully!\n\n" +
        "**What's New:**\n" +
        "• You've been granted the **Self.xyz Verified** role\n" +
        "• You now have access to exclusive restricted channels\n" +
        "• Check out the newly unlocked channels in the Self Discord server\n\n" +
        "Welcome to the verified community! 🚀"
      );
    } catch (dmError) {
      logEvent(
        "verification.dm_failed",
        "Failed to DM user after verification",
        {
          discordUserId,
          error: dmError instanceof Error ? dmError.message : String(dmError),
        },
      );
    }
  } catch (error) {
    logEvent(
      "verification.discord_error",
      "Failed to update Discord roles for verified user",
      {
        sessionId,
        discordUserId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Detects if the user is on a mobile device based on the interaction
 * Discord doesn't provide direct device info, but we can use contextual clues
 */
function isMobileUser(interaction) {
  // Check if interaction came from a mobile client
  // Discord.js doesn't expose this directly, but we can check the interaction properties
  // As a fallback, we'll provide both options to users
  return false; // Will be determined by user choice instead
}

async function handleVerifyCommand(interaction) {
  const { user, guild } = interaction;

  if (!guild) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await guild.members.fetch(user.id);
  if (
    DISCORD_VERIFIED_ROLE_ID &&
    member.roles.cache.has(DISCORD_VERIFIED_ROLE_ID)
  ) {
    await interaction.reply({
      content:
        "You are already verified and should see the restricted channels.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sessionId = crypto.randomUUID();

  // Detect if user is on mobile (currently we'll send both options)
  const isMobile = isMobileUser(interaction);

  try {
    await interaction.reply({
      content:
        "Generating your Self verification link… I'll DM it to you shortly.",
      flags: MessageFlags.Ephemeral,
    });
  } catch (replyError) {
    logEvent(
      "discord.interaction_reply_error",
      "Failed to send initial interaction reply",
      {
        error:
          replyError instanceof Error ? replyError.message : String(replyError),
      },
    );
    return;
  }

  let verificationData;
  try {
    // For now, always generate QR but also include the deep link
    verificationData = await createSelfVerificationLink(sessionId, user, true);
  } catch (error) {
    logEvent("verification.link_error", "Failed to create Self verification link", {
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await interaction.editReply({
        content:
          "I couldn't create a verification link right now. Please try again later.",
      });
    } catch (editError) {
      logEvent(
        "discord.interaction_edit_error",
        "Failed to edit interaction reply after link error",
        {
          error:
            editError instanceof Error ? editError.message : String(editError),
        },
      );
    }
    return;
  }

  pendingVerifications.set(sessionId, {
    discordUserId: user.id,
    guildId: guild.id,
    createdAt: Date.now(),
    qrPath: verificationData.filePath,
  });

  try {
    const dm = await user.createDM();

    // Create a button with the deep link for mobile users
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Open in Self App")
        .setURL(verificationData.universalLink)
        .setStyle(ButtonStyle.Link)
    );

    // Send different messages based on whether we have a QR code
    if (verificationData.filePath) {
      const attachment = new AttachmentBuilder(verificationData.filePath, {
        name: verificationData.filename,
      });

      await dm.send({
        content:
          "📱 **Verification Required**\n\n" +
          "To access exclusive restricted channels in the Self Discord server, please complete verification using the Self.xyz mobile app.\n\n" +
          "**On Mobile?**\n" +
          "Tap the button below to open the Self app directly.\n\n" +
          "**On Desktop?**\n" +
          "Scan the QR code below with the Self.xyz app on your phone.\n\n" +
          "Once verified, you'll automatically receive the **Self.xyz Verified** role and gain access to exclusive channels!\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━",
        files: [attachment],
        components: [row],
      });
    } else {
      // Mobile-only flow (no QR code)
      await dm.send({
        content:
          "📱 **Verification Required**\n\n" +
          "To access exclusive restricted channels in the Self Discord server, please complete verification using the Self.xyz mobile app.\n\n" +
          "**Steps:**\n" +
          "1️⃣ Tap the button below to open the Self app\n" +
          "2️⃣ Complete the verification process\n\n" +
          "Once verified, you'll automatically receive the **Self.xyz Verified** role and gain access to exclusive channels!\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━",
        components: [row],
      });
    }
  } catch (dmError) {
    logEvent("verification.dm_error", "Failed to DM user with verification link", {
      discordUserId: user.id,
      error: dmError instanceof Error ? dmError.message : String(dmError),
    });

    try {
      await interaction.editReply({
        content:
          "I couldn't send you a DM. Please enable DMs from this server and try `/verify` again.",
      });
    } catch (editError) {
      logEvent(
        "discord.interaction_edit_error",
        "Failed to edit interaction reply after DM error",
        {
          error:
            editError instanceof Error ? editError.message : String(editError),
        },
      );
    }

    return;
  }

  try {
    await interaction.editReply({
      content:
        "I've sent you a DM with a Self verification link. Complete verification in the Self app and I'll automatically grant you access.",
    });
  } catch (editError) {
    logEvent(
      "discord.interaction_edit_error",
      "Failed to edit interaction reply after sending verification DM",
      {
        error:
          editError instanceof Error ? editError.message : String(editError),
      },
    );
  }

  logEvent("verification.started", "Started verification session", {
    sessionId,
    discordUserId: user.id,
    guildId: guild.id,
    platform: isMobile ? "mobile" : "desktop",
  });
}

async function registerDiscordCommands() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    logEvent(
      "discord.config_missing",
      "Skipping slash command registration, env not fully configured",
      {
        hasToken: !!DISCORD_BOT_TOKEN,
        hasClientId: !!DISCORD_CLIENT_ID,
        hasGuildId: !!DISCORD_GUILD_ID,
      },
    );
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Verify your age/identity using Self."),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands },
    );
    logEvent("discord.commands_registered", "Registered slash commands", {
      guildId: DISCORD_GUILD_ID,
    });
  } catch (error) {
    logEvent("discord.commands_error", "Failed to register slash commands", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startDiscordBot() {
  if (!DISCORD_BOT_TOKEN) {
    logEvent(
      "discord.config_missing",
      "DISCORD_BOT_TOKEN is not set, Discord bot will not start",
    );
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once("ready", () => {
    logEvent("discord.ready", "Discord bot logged in", {
      username: client.user?.username,
      id: client.user?.id,
    });
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === "verify") {
        await handleVerifyCommand(interaction);
      }
    } catch (error) {
      logEvent("discord.interaction_error", "Error handling interaction", {
        commandName: interaction.commandName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await registerDiscordCommands();

  try {
    await client.login(DISCORD_BOT_TOKEN);
    discordClient = client;
  } catch (error) {
    logEvent("discord.login_error", "Failed to login Discord bot", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
