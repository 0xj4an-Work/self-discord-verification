![Banner](./banner.png)

# Self Discord Verification Bot

Privacy-preserving age verification for Discord servers using Self Protocol's zero-knowledge proof technology.

This project provides a Discord bot that verifies users are 18+ years old using [Self Protocol](https://self.xyz) without exposing their actual age or identity. The bot uses cryptographic attestations and zero-knowledge proofs to confirm minimum age requirements and OFAC compliance, then automatically grants access to age-restricted channels.

## Features

- **Zero-knowledge age verification**: Confirm users are 18+ without revealing their actual birthdate
- **Privacy-preserving**: No personal information or identity data is exposed or stored
- **Automated role assignment**: Users who verify automatically receive the configured role
- **OFAC compliance**: Built-in sanctions list checking
- **No database required**: All state managed in-memory and Discord roles
- **Simple UX**: Single `/verify` command triggers the entire flow
- **Comprehensive logging**: JSON-formatted logs for monitoring and debugging

## How It Works

```text
User runs /verify → Bot generates QR code → User scans with Self app
→ Self app creates zero-knowledge proof → Backend verifies proof
→ Bot assigns role → User gains access to restricted channels
```

The verification process:

1. User runs `/verify` in Discord
2. Bot generates a unique verification QR code and DMs it to the user
3. User scans the QR with the [Self.xyz mobile app](https://self.xyz)
4. Self app generates a zero-knowledge proof confirming user is 18+ and OFAC compliant
5. Backend validates the proof without learning the user's actual age or birthdate
6. Bot automatically assigns the verified role
7. User can now access age-restricted channels

## Architecture

### Components

**Express Backend** ([index.mjs](server/index.mjs))

- Handles webhook requests from Self mobile app
- Verifies zero-knowledge proofs using `@selfxyz/core`
- Validates minimum age (18+) and OFAC compliance
- Exposes `POST /api/verify` endpoint

**Discord Bot** ([discordBot.mjs](server/src/discordBot.mjs))

- Registers and handles `/verify` slash command
- Generates Self verification QR codes
- Manages pending verification sessions (in-memory)
- Assigns roles on successful verification
- Sends DMs with QR codes and status updates

**Self Verifier** ([selfVerifier.mjs](server/src/selfVerifier.mjs))

- Configures `SelfBackendVerifier` in offchain mode
- Decodes user-defined data from proofs
- Validates cryptographic attestations

### Technology Stack

- **Backend**: Node.js, Express.js v5
- **Discord**: Discord.js v14 with slash commands
- **Self Protocol**: @selfxyz/core (verifier), @selfxyz/common (QR generation)
- **Utilities**: ethers.js (hex encoding), qrcode (PNG generation)

### Data Flow

```text
┌─────────────┐      /verify       ┌──────────────┐
│   Discord   │ ───────────────────>│  Discord Bot │
│    User     │                     └──────────────┘
└─────────────┘                            │
      │                                    │ Generate QR + sessionId
      │                                    v
      │                          ┌──────────────────┐
      │<─────────────────────────│  QR Code (DM)    │
      │                          └──────────────────┘
      │
      │ Scan QR
      v
┌──────────────┐
│  Self.xyz    │
│  Mobile App  │
└──────────────┘
      │
      │ Generate proof
      v
┌──────────────────┐     POST      ┌──────────────────┐
│  Express Server  │ <────────────│ Self Protocol    │
│  /api/verify     │               └──────────────────┘
└──────────────────┘
      │
      │ Verify proof + decode sessionId
      v
┌──────────────────┐
│  Discord Bot     │
│  Assign Role     │
└──────────────────┘
      │
      v
┌──────────────────┐
│  User gets role  │
│  & success DM    │
└──────────────────┘
```

### Storage

- **In-memory**: Pending verification sessions (lost on restart)
- **File system**: QR codes (`server/qrcodes/`) and logs (`server/logs/`)
- **No database**: All persistent state is stored in Discord roles

## Prerequisites

### Required

- **Node.js** 18+ (LTS recommended)
- **npm** (included with Node.js)
- **Discord account** with:
  - Server (guild) admin permissions
  - Ability to create Discord applications
- **ngrok account** (free tier works) for HTTPS tunnel
  - Alternative: Any public HTTPS URL (Railway, Heroku, etc.)

### Optional

- **Self.xyz mobile app** for testing (download from App Store/Google Play)

## Installation

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <your-repo-url>
cd self-discord-verification

# Install server dependencies
cd server
npm install
```

### 2. Set Up ngrok (Development Only)

For local development, you need a public HTTPS URL. ngrok provides this for free.

```bash
# Install ngrok
# macOS
brew install ngrok

# Or download from https://ngrok.com/download

# Authenticate with your ngrok token
ngrok config add-authtoken <YOUR_NGROK_TOKEN>

# Start the tunnel (after server is running)
ngrok http 3001
```

**Note**: For production deployment, use a real HTTPS URL from your hosting provider.

### 3. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it (e.g., "Self Verifier"), click **Create**
3. Navigate to the **Bot** tab:
   - Click **Add Bot** → **Yes, do it!**
   - Click **Reset Token** and copy the token → this is `DISCORD_BOT_TOKEN`
   - Enable **Privileged Gateway Intents**:
     - ✅ SERVER MEMBERS INTENT
     - ✅ MESSAGE CONTENT INTENT
   - Click **Save Changes**
4. Go to **General Information** tab:
   - Copy **Application ID** → this is `DISCORD_CLIENT_ID`

### 4. Invite Bot to Server

1. In Developer Portal, go to **OAuth2** → **URL Generator**
2. Select **Scopes**:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select **Bot Permissions**:
   - ✅ View Channels
   - ✅ Send Messages
   - ✅ Send Messages in Threads
   - ✅ Read Message History
   - ✅ Manage Roles (required)
4. Copy the generated URL, open in browser
5. Select your server and authorize

### 5. Configure Discord Server

#### Get Server ID

1. In Discord: **Settings** → **Advanced** → Enable **Developer Mode**
2. Right-click your server icon → **Copy Server ID** → this is `DISCORD_GUILD_ID`

#### Create Verified Role

1. Server Settings → **Roles** → **Create Role**
2. Name it "Self.xyz Verified Role" (or similar)
3. Right-click the role → **Copy Role ID** → this is `DISCORD_VERIFIED_ROLE_ID`
4. **IMPORTANT**: Drag your bot's role **above** this verified role in the role list

#### Create Restricted Channels

1. Create a category (e.g., "18+ Verified")
2. Add channels inside it
3. Right-click category → **Edit Category** → **Permissions**:
   - **@everyone**: ❌ View Channel
   - **Your verified role**: ✅ View Channel
4. Save changes

### 6. Configure Environment Variables

Create `server/.env`:

```bash
# Copy the sample file
cd server
cp ../.sample.env .env
```

Edit `.env` with your values:

```env
# Server Configuration
PORT=3001

# Self Protocol Configuration
SELF_ENDPOINT=https://your-ngrok-id.ngrok-free.app/api/verify

# Discord Bot Configuration
DISCORD_BOT_TOKEN=your-bot-token-from-step-3
DISCORD_CLIENT_ID=your-application-id-from-step-3
DISCORD_GUILD_ID=your-server-id-from-step-5
DISCORD_VERIFIED_ROLE_ID=your-role-id-from-step-5

# Optional Branding
SELF_APP_NAME=Self Discord Verification
SELF_LOGO_URL=https://i.postimg.cc/mrmVf9hm/self.png
```

#### Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Express server port (default: 8080) |
| `SELF_ENDPOINT` | **Yes** | Public HTTPS URL + `/api/verify` (no localhost!) |
| `DISCORD_BOT_TOKEN` | **Yes** | Bot token from Developer Portal |
| `DISCORD_CLIENT_ID` | **Yes** | Application ID from Developer Portal |
| `DISCORD_GUILD_ID` | **Yes** | Your Discord server ID |
| `DISCORD_VERIFIED_ROLE_ID` | **Yes** | Role to assign on verification |
| `SELF_APP_NAME` | No | Name shown in Self app |
| `SELF_LOGO_URL` | No | Logo shown in Self app |

**Critical**: `SELF_ENDPOINT` must be:

- HTTPS (not HTTP)
- Publicly accessible (not localhost/127.0.0.1)
- Include the full path: `https://your-domain.com/api/verify`

## Usage

### Development

1. **Start the server**:

   ```bash
   cd server
   npm run dev
   ```

2. **Start ngrok** (in a separate terminal):

   ```bash
   ngrok http 3001
   ```

3. **Update `.env`** with the ngrok URL (if it changed):

   ```env
   SELF_ENDPOINT=https://abc123.ngrok-free.app/api/verify
   ```

4. **Restart the server** if you changed `.env`

### Production

```bash
cd server
npm start
```

Use your production HTTPS URL in `SELF_ENDPOINT`.

### User Verification Flow

1. User runs `/verify` in any Discord channel
2. Bot replies: "Generating your Self verification QR… I'll DM it to you shortly."
3. Bot sends QR code via DM
4. User scans QR with Self.xyz mobile app
5. User completes verification in the app
6. Bot automatically assigns the verified role
7. Bot sends success DM: "✅ Your Self verification succeeded. [Add your custom message here]"
8. User can now see restricted channels

### Testing the Integration

To verify everything works:

```bash
# Check server is running
curl http://localhost:3001
# Should return: {"status":"ok","message":"Self Express Backend + Discord verifier bot (offchain)"}

# Check Discord bot is online
# Look in Discord - bot should show as online

# Check logs
tail -f server/logs/discord-verifier.log
# Should see: {"event":"discord.ready",...}
```

## API Reference

### POST /api/verify

Webhook endpoint called by Self mobile app after user completes verification.

**Request**:

```json
{
  "attestationId": "string",
  "proof": {
    "pi_a": [...],
    "pi_b": [...],
    "pi_c": [...],
    "protocol": "groth16"
  },
  "publicSignals": [...],
  "userContextData": {...}
}
```

**Response (Success)**:

```json
{
  "status": "success",
  "result": true,
  "credentialSubject": {...},
  "userData": {
    "userDefinedData": "hex-encoded-metadata"
  }
}
```

**Response (Failure)**:

```json
{
  "status": "error",
  "result": false,
  "reason": "Minimum age verification failed",
  "details": {
    "isValid": false,
    "isMinimumAgeValid": false,
    "isOfacValid": true
  }
}
```

**Validation Rules**:

- ✅ Proof must be cryptographically valid
- ✅ User must be 18+ years old
- ✅ User must NOT be on OFAC sanctions list

### GET /

Health check endpoint.

**Response**:

```json
{
  "status": "ok",
  "message": "Self Express Backend + Discord verifier bot (offchain)",
  "verifyEndpoint": "/api/verify",
  "endpoint": "https://your-domain.com/api/verify"
}
```

## Logging

All events are logged to `server/logs/discord-verifier.log` in JSON Lines format.

### Key Events

| Event | Description |
|-------|-------------|
| `discord.ready` | Bot connected and ready |
| `discord.commands_registered` | Slash commands registered |
| `verification.started` | User initiated /verify |
| `verification.succeeded` | Proof validated successfully |
| `verification.failed` | Proof validation failed |
| `verification.role_assigned` | Role assigned to user |
| `qr.created` | QR code generated |

### Viewing Logs

```bash
# Tail logs in real-time
tail -f server/logs/discord-verifier.log

# Parse JSON logs (requires jq)
cat server/logs/discord-verifier.log | jq .

# Filter by event type
cat server/logs/discord-verifier.log | jq 'select(.event == "verification.succeeded")'
```

## Troubleshooting

### Bot doesn't show /verify command

**Symptoms**: Slash command not appearing in Discord

**Solutions**:

- ✅ Check logs for `discord.commands_registered` event
- ✅ Verify `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` are correct
- ✅ Ensure bot has `applications.commands` scope
- ✅ Restart the server after changing `.env`
- ✅ Wait up to 1 hour (Discord cache) or kick/re-invite bot

### Bot can't send DMs

**Symptoms**: "I'll DM it to you shortly" but no DM received

**Solutions**:

- ✅ Enable DMs: Discord Settings → Privacy & Safety → Allow DMs from server members
- ✅ Or: Right-click server → Privacy Settings → Allow direct messages
- ✅ Check logs for `verification.dm_error`

### Role not assigned after verification

**Symptoms**: Verification succeeds but user doesn't get role

**Solutions**:

- ✅ Check `server/logs/discord-verifier.log` for errors:
  - `verification.role_not_found`: Wrong `DISCORD_VERIFIED_ROLE_ID` or role deleted
  - `verification.discord_error`: Bot lacks permissions
- ✅ Ensure bot has `Manage Roles` permission
- ✅ **CRITICAL**: Bot's role must be **above** the verified role in Server Settings → Roles
- ✅ Verify `DISCORD_VERIFIED_ROLE_ID` is correct (right-click role → Copy Role ID)

### Self app shows "Invalid endpoint"

**Symptoms**: QR scans but Self app reports endpoint error

**Solutions**:

- ✅ Verify `SELF_ENDPOINT` is **HTTPS** (not HTTP)
- ✅ Ensure `SELF_ENDPOINT` does NOT contain `localhost` or `127.0.0.1`
- ✅ Check ngrok is running: `ngrok http 3001`
- ✅ Confirm ngrok URL matches `SELF_ENDPOINT` in `.env`
- ✅ Test endpoint: `curl https://your-ngrok-url.ngrok-free.app/`
- ✅ Restart server after changing `.env`

### Verification fails after restart

**Symptoms**: Pending verifications don't work after server restart

**Cause**: Pending verifications are stored in-memory only

**Solutions**:

- ✅ Users must run `/verify` again after server restarts
- ✅ Consider implementing persistent storage for production

### Bot shows offline in Discord

**Symptoms**: Bot appears offline, commands don't work

**Solutions**:

- ✅ Check server is running: `npm run dev`
- ✅ Check logs for `discord.ready` event
- ✅ Verify `DISCORD_BOT_TOKEN` is correct (may need to reset token)
- ✅ Check privileged intents are enabled in Developer Portal

### "Interaction failed" error

**Symptoms**: Discord shows "The application did not respond"

**Solutions**:

- ✅ Check server logs for errors
- ✅ Ensure server is running and responding
- ✅ Verify ngrok tunnel is active (dev) or server is accessible (prod)
- ✅ Check network/firewall settings

## Deployment

### Railway (Recommended)

This project includes Railway configuration ([railway.toml](railway.toml)).

1. **Create Railway project**:

   ```bash
   # Install Railway CLI
   npm i -g @railway/cli

   # Login and deploy
   railway login
   railway init
   railway up
   ```

2. **Configure environment variables** in Railway dashboard:
   - Set all variables from `.env` (except `PORT`)
   - Update `SELF_ENDPOINT` to your Railway URL + `/api/verify`

3. **Deploy**:

   ```bash
   git push
   # Railway auto-deploys on push
   ```

### Other Platforms

The project works on any Node.js hosting platform:

- **Heroku**: Add `Procfile` with `web: npm start`
- **Vercel**: Configure `vercel.json` for serverless functions
- **DigitalOcean App Platform**: Set build command to `npm install`, run command to `npm start`
- **AWS EC2**: Use PM2 for process management

**Requirements**:

- Node.js 18+ runtime
- Public HTTPS URL
- Working directory: `server/`
- Start command: `npm start`

## Security Considerations

### Strengths

- ✅ **Zero-knowledge proofs**: User's actual age/identity never disclosed
- ✅ **Cryptographic attestations**: Strong identity guarantees
- ✅ **OFAC compliance**: Sanctions list checking
- ✅ **Session-based**: Unique sessionId prevents replay attacks
- ✅ **HTTPS required**: All communication encrypted

### Known Limitations

- ⚠️ **In-memory state**: Server restart clears pending verifications
- ⚠️ **No QR cleanup**: QR codes accumulate on disk
- ⚠️ **No session expiry**: Pending verifications never expire
- ⚠️ **No rate limiting**: Users can spam `/verify` command
- ⚠️ **DM dependency**: Users must allow DMs from server

### Recommendations for Production

1. **Add rate limiting**: Prevent `/verify` spam
2. **Implement session expiry**: Clean up old pending verifications
3. **Add QR cleanup**: Delete QR files after verification completes
4. **Use persistent storage**: Redis/database for pending verifications
5. **Add monitoring**: Sentry, Datadog, or similar
6. **Implement webhook authentication**: Verify requests to `/api/verify` come from Self

## Project Structure

```text
self-discord-verification/
├── server/
│   ├── src/
│   │   ├── config.mjs            # Environment configuration
│   │   ├── logger.mjs            # JSON logging utility
│   │   ├── selfVerifier.mjs      # Self Protocol verifier
│   │   └── discordBot.mjs        # Discord bot logic
│   ├── index.mjs                 # Express server entry point
│   ├── package.json              # Dependencies
│   ├── logs/                     # Runtime logs (gitignored)
│   │   └── discord-verifier.log
│   └── qrcodes/                  # Generated QR codes (gitignored)
│       └── self-qr-*.png
├── .sample.env                   # Environment template
├── railway.toml                  # Railway deployment config
├── prettier.config.cjs           # Code formatting
├── banner.png                    # README banner
└── README.md                     # This file
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Use Prettier for code formatting: `npm run format`
- Test with ngrok before submitting
- Update README for new features
- Add logging for important events

## License

[Add your license here]

## Support

- **Self Protocol**: [https://self.xyz](https://self.xyz)
- **Self Docs**: [https://docs.self.xyz](https://docs.self.xyz)
- **Discord.js Guide**: [https://discord.js.org](https://discord.js.org)

## Acknowledgments

- Built with [Self Protocol](https://self.xyz) for zero-knowledge identity verification
- Uses [Discord.js](https://discord.js.org) for Discord bot functionality
- Inspired by the need for privacy-preserving age verification

---

**Note**: This project uses Self Protocol's offchain verification mode. No blockchain transactions or gas fees are required.
