import crypto from "node:crypto";

import { SELF_ENDPOINT } from "./config.mjs";
import { logEvent } from "./logger.mjs";

// In-memory URL shortener storage (for production, use Redis or a database)
const urlShortenerMap = new Map();

function getBaseUrl() {
  if (!SELF_ENDPOINT) return "";
  return SELF_ENDPOINT.replace("/api/verify", "");
}

/**
 * Creates a short URL from a long URL
 * @param {string} longUrl - The full Self.xyz verification URL
 * @returns {string} - The shortened URL
 */
export function createShortUrl(longUrl) {
  const shortCode = crypto.randomBytes(4).toString("hex"); // 8 character code
  urlShortenerMap.set(shortCode, longUrl);

  const baseUrl = getBaseUrl();
  const shortUrl = `${baseUrl}/v/${shortCode}`;

  logEvent("shorturl.created", "Created short URL", {
    shortCode,
    shortUrl,
    longUrlLength: longUrl.length,
  });

  return shortUrl;
}

/**
 * Retrieves the long URL for a given short code
 * @param {string} code - The short code
 * @returns {string|null} - The long URL or null if not found
 */
export function resolveShortUrl(code) {
  return urlShortenerMap.get(code) ?? null;
}

