import { SelfBackendVerifier, AllIds, DefaultConfigStore } from "@selfxyz/core";

import { SELF_ENDPOINT } from "./config.mjs";
import { logEvent } from "./logger.mjs";

export const selfBackendVerifier = new SelfBackendVerifier(
  "", // Empty scope for offchain verification
  SELF_ENDPOINT,
  false, // offchain mode (mockPassport=false means production)
  AllIds,
  new DefaultConfigStore({
    minimumAge: 18,
  }),
  "hex",
);

export function decodeUserDefinedDataHex(userDefinedDataHex) {
  if (!userDefinedDataHex || typeof userDefinedDataHex !== "string") {
    return null;
  }

  try {
    const asJsonString = Buffer.from(userDefinedDataHex, "hex").toString(
      "utf8",
    );
    return JSON.parse(asJsonString);
  } catch (error) {
    logEvent(
      "verification.userdata_decode_error",
      "Failed to decode userDefinedData from hex JSON",
      {
        raw: userDefinedDataHex,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}
