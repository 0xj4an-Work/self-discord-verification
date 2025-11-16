import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
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
  SelfBackendVerifier,
  AllIds,
  DefaultConfigStore,
} from "@selfxyz/core";

const require = createRequire(import.meta.url);
const { SelfAppBuilder, getUniversalLink } = require("@selfxyz/common");

dotenv.config();

// Paths and basic setup.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
let lastVerificationResult = null;

app.use(bodyParser.json());

// Directories for QR codes and logs.
const qrOutputDir = path.join(__dirname, "qrcodes");
const logsDir = path.join(__dirname, "logs");
fs.mkdirSync(qrOutputDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });
const logFilePath = path.join(logsDir, "discord-verifier.log");

function logEvent(type, message, extra = {}) {
  const timestamp = new Date().toISOString();
  const payload = { timestamp, type, message, ...extra };
  console.log(`[${timestamp}] [${type}] ${message}`, extra);
  fs.appendFile(logFilePath, `${JSON.stringify(payload)}\n`, (err) => {
    if (err) {
      console.error("Failed to write log line:", err);
    }
  });
}

// Self backend verifier configuration (mock passports + OFAC).
const scope = process.env.SELF_SCOPE;
const endpoint = process.env.SELF_ENDPOINT;

const selfBackendVerifier = new SelfBackendVerifier(
  scope,
  endpoint,
  true,
  AllIds,
  new DefaultConfigStore({
    minimumAge: 18,
    excludedCountries: [],
    ofac: true,
  }),
  "hex",
);

// Discord bot configuration.
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_VERIFIED_ROLE_ID = process.env.DISCORD_VERIFIED_ROLE_ID;
const SELF_APP_NAME =
  process.env.SELF_APP_NAME || "Self Discord Verification (Mock Passports)";
const SELF_LOGO_URL =
  process.env.SELF_LOGO_URL || "https://i.postimg.cc/mrmVf9hm/self.png";

const pendingVerifications = new Map(); // sessionId -> { discordUserId, guildId, createdAt, qrPath }
let discordClient = null;

async function createSelfVerificationQr(sessionId, discordUser) {
  if (!scope || !endpoint) {
    throw new Error("SELF_SCOPE and SELF_ENDPOINT must be configured");
  }

  // Derive a deterministic hex userId from the Discord user id.
  const hexUserId = BigInt(discordUser.id).toString(16).padStart(40, "0");
  const userId = `0x${hexUserId.slice(0, 40)}`;

  const selfApp = new SelfAppBuilder({
    version: 2,
    appName: SELF_APP_NAME,
    scope,
    endpoint,
    logoBase64: SELF_LOGO_URL,
    userId,
    endpointType: "staging_https",
    userIdType: "hex",
    userDefinedData: JSON.stringify({
      kind: "discord-self-verification",
      sessionId,
      discordUserId: discordUser.id,
      guildId: DISCORD_GUILD_ID,
    }),
    disclosures: {
      minimumAge: 18,
      excludedCountries: [],
      ofac: true,
      nationality: true,
      gender: true,
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

async function handleDiscordVerificationSuccess(sessionId, verificationResult) {
  const entry = pendingVerifications.get(sessionId);
  if (!entry) {
    logEvent("verification.unknown_session", "Verification for unknown session", {
      sessionId,
    });
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
      logEvent("verification.no_role_configured", "Verified role not configured", {
        guildId: guild.id,
        discordUserId,
      });
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
  if (DISCORD_VERIFIED_ROLE_ID && member.roles.cache.has(DISCORD_VERIFIED_ROLE_ID)) {
    await interaction.reply({
      content: "You are already verified and should see the restricted channels.",
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
          replyError instanceof Error
            ? replyError.message
            : String(replyError),
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
            editError instanceof Error
              ? editError.message
              : String(editError),
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
            editError instanceof Error
              ? editError.message
              : String(editError),
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
    logEvent(
      "discord.commands_error",
      "Failed to register slash commands",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function startDiscordBot() {
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
      logEvent(
        "discord.interaction_error",
        "Error handling interaction",
        {
          commandName: interaction.commandName,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  });

  await registerDiscordCommands();

  try {
    await client.login(DISCORD_BOT_TOKEN);
    discordClient = client;
  } catch (error) {
    logEvent(
      "discord.login_error",
      "Failed to login Discord bot",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

// Express routes.
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "Self Express Backend + Discord verifier bot",
    verifyEndpoint: "/api/verify",
    scope,
    endpoint,
  });
});

app.post("/api/verify", async (req, res) => {
  try {
    const { attestationId, proof, publicSignals, userContextData } = req.body;

    if (!proof || !publicSignals || !attestationId || !userContextData) {
      return res.status(200).json({
        status: "error",
        result: false,
        reason:
          "Proof, publicSignals, attestationId and userContextData are required",
      });
    }

    const result = await selfBackendVerifier.verify(
      attestationId,
      proof,
      publicSignals,
      userContextData,
    );

    const { isValid, isMinimumAgeValid, isOfacValid } = result.isValidDetails;

    lastVerificationResult = result;

    if (!isValid || !isMinimumAgeValid || isOfacValid) {
      let reason = "Verification failed";
      if (!isMinimumAgeValid) {
        reason = "Minimum age verification failed";
      } else if (isOfacValid) {
        reason = "User is in OFAC sanctions list";
      }

      logEvent("verification.failed", "Self verification failed", {
        attestationId: result.attestationId,
        isValid,
        isMinimumAgeValid,
        isOfacValid,
      });

      return res.status(200).json({
        status: "error",
        result: false,
        reason,
        details: result.isValidDetails,
      });
    }

    logEvent("verification.succeeded", "Self verification succeeded", {
      attestationId: result.attestationId,
    });

    // Wire successful verifications into the Discord bot flow using userDefinedData.
    try {
      const userDefinedDataHex = result.userData?.userDefinedData;
      if (userDefinedDataHex && typeof userDefinedDataHex === "string") {
        let parsed;
        try {
          const asJsonString = Buffer.from(
            userDefinedDataHex,
            "hex",
          ).toString("utf8");
          parsed = JSON.parse(asJsonString);
        } catch (decodeError) {
          logEvent(
            "verification.userdata_decode_error",
            "Failed to decode userDefinedData from hex JSON",
            {
              raw: userDefinedDataHex,
              error:
                decodeError instanceof Error
                  ? decodeError.message
                  : String(decodeError),
            },
          );
        }

        if (
          parsed &&
          parsed.kind === "discord-self-verification" &&
          parsed.sessionId
        ) {
          await handleDiscordVerificationSuccess(parsed.sessionId, result);
        }
      }
    } catch (parseError) {
      logEvent(
        "verification.userdata_parse_error",
        "Failed to parse userDefinedData from verification result",
        {
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        },
      );
    }

    return res.status(200).json({
      status: "success",
      result: true,
      credentialSubject: result.discloseOutput,
      userData: result.userData,
    });
  } catch (error) {
    console.error("Verification error:", error);
    logEvent(
      "verification.error",
      "Exception while verifying Self proof",
      { error: error instanceof Error ? error.message : String(error) },
    );

    return res.status(200).json({
      status: "error",
      result: false,
      reason:
        error instanceof Error ? error.message : "Unknown verification error",
    });
  }
});

// Debug endpoint to fetch the last verification result.
app.get("/debug/last-result", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!lastVerificationResult) {
    return res.status(200).json({ status: "empty" });
  }
  res.status(200).json({
    status: "ok",
    verificationResult: lastVerificationResult,
  });
});

app.listen(PORT, () => {
  console.log(`Self Express Backend listening on http://localhost:${PORT}`);
  console.log(`Expected verify endpoint (SELF_ENDPOINT): ${endpoint}`);
  startDiscordBot().catch((error) => {
    logEvent(
      "discord.start_error",
      "Failed to start Discord bot",
      { error: error instanceof Error ? error.message : String(error) },
    );
  });
});
