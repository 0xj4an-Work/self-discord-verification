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

async function createSelfVerificationQr(sessionId, discordUser) {
  if (!SELF_ENDPOINT) {
    throw new Error("SELF_ENDPOINT must be configured");
  }

  const hexUserId = BigInt(discordUser.id).toString(16).padStart(40, "0");
  const userId = `0x${hexUserId.slice(0, 40)}`;

  const selfApp = new SelfAppBuilder({
    version: 2,
    appName: SELF_APP_NAME,
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
  const filename = `self-qr-${sessionId}.png`;
  const filePath = path.join(qrOutputDir, filename);

  await QRCode.toFile(filePath, universalLink, {
    width: 512,
    errorCorrectionLevel: "H",
  });

  logEvent("qr.created", "Created Self QR code", {
    sessionId,
    userId: discordUser.id,
    filePath,
  });

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
        "✅ Your Self verification succeeded. You now have access to the restricted channels.",
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

  try {
    await interaction.reply({
      content:
        "Generating your Self verification QR… I’ll DM it to you shortly.",
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

  let qr;
  try {
    qr = await createSelfVerificationQr(sessionId, user);
  } catch (error) {
    logEvent("verification.qr_error", "Failed to create Self QR", {
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await interaction.editReply({
        content:
          "I couldn't create a verification QR right now. Please try again later.",
      });
    } catch (editError) {
      logEvent(
        "discord.interaction_edit_error",
        "Failed to edit interaction reply after QR error",
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
    qrPath: qr.filePath,
  });

  try {
    const dm = await user.createDM();
    const attachment = new AttachmentBuilder(qr.filePath, {
      name: qr.filename,
    });

    await dm.send({
      content:
        "Scan this QR code with the Self app (staging/mock passports) to verify your age/identity.",
      files: [attachment],
    });
  } catch (dmError) {
    logEvent("verification.dm_error", "Failed to DM user with QR", {
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
        "I've sent you a DM with a Self verification QR code. Complete verification in the Self app and I’ll automatically grant you access.",
    });
  } catch (editError) {
    logEvent(
      "discord.interaction_edit_error",
      "Failed to edit interaction reply after sending QR DM",
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
