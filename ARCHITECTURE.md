# Project Architecture

## Overview

This project implements a Discord bot for age verification using Self.xyz's zero-knowledge proof technology, with platform-specific flows for mobile and desktop users.

## Module Structure

```
server/
├── index.mjs                 # Express server & main entry point
├── src/
│   ├── config.mjs           # Environment configuration
│   ├── logger.mjs           # JSON logging utility
│   ├── selfVerifier.mjs     # Self Protocol verifier
│   ├── discordBot.mjs       # Discord bot logic
│   └── urlShortener.mjs     # URL shortening service (shared)
├── logs/                    # Runtime logs
└── qrcodes/                 # Generated QR codes
```

## Module Dependencies

```
index.mjs
  ├─→ config.mjs
  ├─→ logger.mjs
  ├─→ selfVerifier.mjs
  ├─→ discordBot.mjs
  └─→ urlShortener.mjs (for Express route)

discordBot.mjs
  ├─→ config.mjs
  ├─→ logger.mjs
  └─→ urlShortener.mjs (for creating short URLs)

urlShortener.mjs
  ├─→ config.mjs
  └─→ logger.mjs
```

**Note:** `urlShortener.mjs` is a shared module to avoid circular dependencies between `index.mjs` and `discordBot.mjs`.

## Key Components

### 1. Express Server ([index.mjs](server/index.mjs))

**Responsibilities:**
- HTTP server setup
- Verification webhook endpoint (`POST /api/verify`)
- URL shortener redirect endpoint (`GET /v/:code`)
- Discord bot initialization

**Key Endpoints:**
- `GET /` - Health check
- `GET /v/:code` - URL shortener redirect
- `POST /api/verify` - Self.xyz verification webhook

### 2. Discord Bot ([discordBot.mjs](server/src/discordBot.mjs))

**Responsibilities:**
- Discord.js client management
- Slash command registration (`/verify`)
- Platform selection UI (Mobile/Desktop buttons)
- QR code generation (desktop users)
- Short URL creation (mobile users)
- Role assignment on successful verification

**Key Functions:**
- `handleVerifyCommand()` - Shows platform selection buttons
- `handlePlatformSelection()` - Handles button clicks, sends DMs
- `createSelfVerificationLink()` - Generates verification data
- `handleDiscordVerificationSuccess()` - Assigns roles after verification

### 3. URL Shortener ([urlShortener.mjs](server/src/urlShortener.mjs))

**Responsibilities:**
- Generate short codes from long URLs
- Store URL mappings in memory
- Resolve short codes to long URLs

**Key Functions:**
- `createShortUrl(longUrl)` - Creates short URL
- `resolveShortUrl(code)` - Retrieves long URL

**Why it's separate:**
- Shared between `index.mjs` (redirect route) and `discordBot.mjs` (link generation)
- Avoids circular dependency issues
- Clean separation of concerns

### 4. Self Verifier ([selfVerifier.mjs](server/src/selfVerifier.mjs))

**Responsibilities:**
- Initialize Self Protocol backend verifier
- Decode user-defined data from proofs
- Validate zero-knowledge proofs

**Configuration:**
- Uses `offchain` mode (no blockchain required)
- Validates minimum age (18+)
- Checks OFAC sanctions list

### 5. Configuration ([config.mjs](server/src/config.mjs))

**Responsibilities:**
- Load environment variables
- Export configuration constants
- Validate required settings

**Key Exports:**
- `SELF_ENDPOINT` - Webhook URL
- `DISCORD_BOT_TOKEN` - Bot authentication
- `DISCORD_GUILD_ID` - Target server
- `DISCORD_VERIFIED_ROLE_ID` - Role to assign

### 6. Logger ([logger.mjs](server/src/logger.mjs))

**Responsibilities:**
- JSON-formatted logging
- File-based log storage
- Structured event logging

## Data Flow

### Verification Flow (Mobile)

```
1. User runs /verify
   └─→ discordBot.handleVerifyCommand()
       └─→ Shows platform selection buttons

2. User clicks "📱 I'm on Mobile"
   └─→ discordBot.handlePlatformSelection()
       ├─→ createSelfVerificationLink() (no QR)
       ├─→ urlShortener.createShortUrl()
       └─→ DM user with short URL

3. User taps short URL
   └─→ Browser: GET /v/:code
       └─→ index.mjs redirects to Self.xyz URL
           └─→ Self app opens

4. Self app generates proof
   └─→ POST /api/verify
       └─→ selfVerifier validates proof
           └─→ discordBot.handleDiscordVerificationSuccess()
               └─→ Assigns role
```

### Verification Flow (Desktop)

```
1. User runs /verify
   └─→ discordBot.handleVerifyCommand()
       └─→ Shows platform selection buttons

2. User clicks "🖥️ I'm on Desktop"
   └─→ discordBot.handlePlatformSelection()
       ├─→ createSelfVerificationLink() (with QR)
       └─→ DM user with QR code image

3. User scans QR with phone
   └─→ Self app opens

4. Self app generates proof
   └─→ POST /api/verify
       └─→ selfVerifier validates proof
           └─→ discordBot.handleDiscordVerificationSuccess()
               └─→ Assigns role
```

## State Management

### In-Memory Storage

**Discord Bot:**
- `pendingVerifications` Map - Tracks active verification sessions
- Lost on server restart

**URL Shortener:**
- `urlShortenerMap` Map - Stores URL mappings
- Lost on server restart

**For Production:** Consider using Redis or a database for persistence.

## Security Considerations

### Zero-Knowledge Proofs
- User's actual age never disclosed
- Only validates minimum age requirement (18+)
- OFAC sanctions list checking

### URL Shortener
- Cryptographically secure random codes (4 bytes = 16^8 combinations)
- No user input in code generation (no injection risk)
- All redirects logged for monitoring

### Discord Bot
- Ephemeral messages for privacy
- DM-based verification (private)
- Role-based access control

## Logging

All events logged to `server/logs/discord-verifier.log` in JSON format.

**Key Events:**
- `discord.ready` - Bot connected
- `verification.started` - User initiated verification
- `verification.succeeded` - Proof validated
- `verification.role_assigned` - Role granted
- `shorturl.created` - Short URL generated
- `shorturl.redirect` - Short URL accessed

## Environment Variables

Required:
- `SELF_ENDPOINT` - Public HTTPS webhook URL
- `DISCORD_BOT_TOKEN` - Bot authentication token
- `DISCORD_CLIENT_ID` - Application ID
- `DISCORD_GUILD_ID` - Target Discord server
- `DISCORD_VERIFIED_ROLE_ID` - Role to assign

Optional:
- `PORT` - Server port (default: 8080)
- `SELF_APP_NAME` - Display name in Self app
- `SELF_LOGO_URL` - Logo URL in Self app

## Deployment

**Requirements:**
- Node.js 18+
- Public HTTPS URL
- Discord bot configured with proper permissions
- Self.xyz mobile app for testing

**Platforms:**
- Railway (recommended)
- Heroku
- Vercel
- AWS EC2
- Any Node.js hosting

## Future Enhancements

### URL Shortener
- Add Redis for distributed systems
- Implement expiration (e.g., 1 hour TTL)
- Add click tracking/analytics

### Verification
- Persistent storage for pending verifications
- Session expiration and cleanup
- Rate limiting on `/verify` command

### Monitoring
- Integration with Sentry or Datadog
- Webhook authentication from Self.xyz
- Health check improvements
