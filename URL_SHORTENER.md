# URL Shortener Implementation

## Problem

The Self.xyz universal verification links are very long (500+ characters) because they contain all the verification data encoded in the URL. Discord mobile has issues with auto-detecting and making very long URLs clickable, even when they're on their own line.

## Solution

Implemented a built-in URL shortener service that creates short, clickable links.

### How It Works

1. **Long URL**: `https://redirect.self.xyz?selfApp=%7B%22sessionId%22...` (500+ chars)
2. **Short URL**: `https://your-domain.com/v/a1b2c3d4` (~50 chars)
3. When users click the short URL, they're redirected to the full Self.xyz link
4. Discord easily detects and makes the short URL clickable

## Implementation

### 1. URL Shortener Module ([urlShortener.mjs](server/src/urlShortener.mjs))

**Shared module containing:**
- `urlShortenerMap` - In-memory storage for URL mappings
- `createShortUrl(longUrl)` - Generates an 8-character short code
- `resolveShortUrl(code)` - Retrieves the long URL for a given short code

**Example:**
```javascript
import { createShortUrl } from "./urlShortener.mjs";

const shortUrl = createShortUrl(verificationData.universalLink);
// Returns: https://your-domain.com/v/a1b2c3d4
```

### 2. Express Server Integration ([index.mjs](server/index.mjs))

**Added:**
- `GET /v/:code` - Redirect endpoint that uses `resolveShortUrl()`

### 3. Discord Bot Integration ([discordBot.mjs](server/src/discordBot.mjs))

Mobile users now receive short URLs instead of long ones:

```
📱 Verification Required

To access exclusive restricted channels in the Self Discord server,
please complete verification using the Self.xyz mobile app.

Tap the link below to verify:

https://your-domain.com/v/a1b2c3d4

Once verified, you'll automatically receive the Self.xyz Verified
role and gain access to exclusive channels!
```

## Benefits

✅ **Clickable links** - Discord always makes short URLs clickable
✅ **Better UX** - Users just tap the link, no copy/paste needed
✅ **No external dependencies** - Built into your existing server
✅ **Fast** - In-memory lookups are instant
✅ **Logged** - All redirects are logged for monitoring

## Technical Details

### Short Code Generation

```javascript
const shortCode = crypto.randomBytes(4).toString('hex'); // 8 characters
```

- Uses cryptographically secure random bytes
- 8 character hex string (16^8 = 4.3 billion combinations)
- Collision risk is negligible for typical usage

### URL Format

```
https://{your-domain}/v/{shortCode}
```

Example: `https://self-discord-verification-production.up.railway.app/v/a1b2c3d4`

### Storage

**Current:** In-memory Map
- Fast
- Simple
- Lost on server restart (but sessions expire anyway)

**For Production (Optional Upgrade):**
- Redis - For distributed systems
- Database - For persistence across restarts
- Add expiration (e.g., 1 hour) to clean up old links

## Endpoints

### `GET /v/:code`

Redirects short URL to full Self.xyz verification link.

**Request:**
```
GET /v/a1b2c3d4
```

**Response:**
```
HTTP 302 Found
Location: https://redirect.self.xyz?selfApp=%7B%22sessionId%22...
```

**Error Response (404):**
```
Link not found or expired
```

## Logging

Short URL redirects are logged:

```json
{
  "event": "shorturl.redirect",
  "message": "Redirecting short URL",
  "data": {
    "code": "a1b2c3d4",
    "longUrl": "https://redirect.self.xyz?selfApp=..."
  }
}
```

## Testing

1. **Deploy** to Railway
2. **Run** `/verify` in Discord
3. **Click** "📱 I'm on Mobile"
4. **Check DM** - You'll see a short URL like:
   ```
   https://your-domain.com/v/a1b2c3d4
   ```
5. **Tap the link** - It should be blue/clickable
6. **Browser opens** and redirects to Self app

## Future Enhancements

### Add Expiration
```javascript
urlShortenerMap.set(shortCode, {
  url: longUrl,
  expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour
});
```

### Add Click Tracking
```javascript
urlShortenerMap.set(shortCode, {
  url: longUrl,
  clicks: 0,
  createdAt: Date.now()
});
```

### Use Redis (Production)
```javascript
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

export async function createShortUrl(longUrl) {
  const shortCode = crypto.randomBytes(4).toString('hex');
  await redis.setex(`short:${shortCode}`, 3600, longUrl); // 1 hour TTL
  return `${baseUrl}/v/${shortCode}`;
}
```

## Security Considerations

✅ **Random codes** - Cryptographically secure, hard to guess
✅ **No user input** - Codes are server-generated, no injection risk
✅ **Read-only** - `/v/:code` only redirects, doesn't modify data
✅ **Logged** - All redirects are tracked

⚠️ **No expiration** - Links never expire (in-memory implementation)
⚠️ **Lost on restart** - Server restart clears all short URLs

For production, consider adding expiration and persistence.

## Comparison: Before vs After

### Before (Long URL)
```
📱 Verification Required

Tap the link below to verify:
https://redirect.self.xyz?selfApp=%7B%22sessionId%22%3A%22449312b6...
(not clickable on mobile)
```

### After (Short URL)
```
📱 Verification Required

Tap the link below to verify:
https://your-domain.com/v/a1b2c3d4
(clickable everywhere!)
```

## Summary

The URL shortener solves the Discord mobile clickability issue by creating short, easily clickable links that redirect to the full Self.xyz verification URLs. This provides a seamless mobile experience without requiring external services or complex user instructions.
