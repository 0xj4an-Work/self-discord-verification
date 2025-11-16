import express from "express";
import bodyParser from "body-parser";

import { PORT, SELF_SCOPE, SELF_ENDPOINT } from "./src/config.mjs";
import { logEvent } from "./src/logger.mjs";
import {
  selfBackendVerifier,
  decodeUserDefinedDataHex,
} from "./src/selfVerifier.mjs";
import {
  startDiscordBot,
  handleDiscordVerificationSuccess,
} from "./src/discordBot.mjs";

const app = express();
app.use(bodyParser.json());

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "Self Express Backend + Discord verifier bot",
    verifyEndpoint: "/api/verify",
    scope: SELF_SCOPE,
    endpoint: SELF_ENDPOINT,
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

    try {
      const parsed = decodeUserDefinedDataHex(result.userData?.userDefinedData);
      if (
        parsed &&
        parsed.kind === "discord-self-verification" &&
        parsed.sessionId
      ) {
        await handleDiscordVerificationSuccess(parsed.sessionId);
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
    logEvent("verification.error", "Exception while verifying Self proof", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(200).json({
      status: "error",
      result: false,
      reason:
        error instanceof Error ? error.message : "Unknown verification error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Self Express Backend listening on http://localhost:${PORT}`);
  console.log(`Expected verify endpoint (SELF_ENDPOINT): ${SELF_ENDPOINT}`);
  startDiscordBot().catch((error) => {
    logEvent("discord.start_error", "Failed to start Discord bot", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
