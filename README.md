![Banner](./banner.png)

# Self Discord Verification Bot

Self verification backend + Discord bot using Self mock passports.

This project exposes a Self-powered backend and a Discord bot that:

- Generates a Self QR code and sends it to users via DM (`/verify` slash command).
- Verifies proofs on an Express backend with mock passports and OFAC checking.
- Automatically assigns a “verified” role so users can see age-gated channels.
- Logs all verification activity and stores QR images on disk.

## 1. Architecture Overview

- **Express backend**
  - Uses `SelfBackendVerifier` from `@selfxyz/core` to verify proofs from the Self app.
  - Configured for **staging / mock passports** with OFAC enabled and a minimum age requirement.
  - Exposes:
    - `POST /api/verify` – main verification endpoint (called by the Self app).

- **Discord bot**
  - Listens for `/verify` in your Discord server.
  - For each user:
    - Builds a Self app configuration (`SelfAppBuilder` from `@selfxyz/common`) including a unique session id and Discord user id.
    - Generates a Self universal link and encodes it as a QR PNG.
    - DMs the QR to the user.
  - When the Self app completes verification:
    - The Self backend decodes the `userDefinedData` from the proof.
    - Matches it to a pending Discord session.
    - Assigns a configurable `Verified` role to the user.
    - Sends them a success DM.

-- **Data & logging**
  - QR images: `server/qrcodes/*.png`
  - Logs: `server/logs/discord-verifier.log` (JSON lines; safe to tail/parse).

## 3. Prerequisites

You’ll need:

- **Node.js** 18+ (Self SDKs recommend Node 22; you may see engine warnings on other versions, but this project runs on Node 18–20 as well).
- **npm** (comes with Node).
- **ngrok** (or any HTTPS tunnelling tool):
  - Required because the Self app must reach your `/api/verify` endpoint over HTTPS with a public URL.
- A **Discord account** with permission to:
  - Create applications in the Discord Developer Portal.
  - Add a bot to your server and manage roles.

## 4. One-time Setup

### 4.1. Install dependencies

```bash
cd server
npm install
```

This installs Express, Discord.js, the Self SDKs, and other dependencies.

### 4.2. Set up ngrok (public HTTPS URL for Self)

1. Go to <https://ngrok.com> and create a free account.
2. Install the ngrok CLI (follow their OS-specific instructions).
3. Get your **ngrok authtoken** from the ngrok dashboard.
4. Configure ngrok locally:

   ```bash
   ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
   ```

5. Once the backend is running (see section 6), expose it:

   ```bash
   ngrok http 3001
   ```

6. ngrok will show something like:

   ```text
   Forwarding  https://40345855ba7b.ngrok-free.app -> http://localhost:3001
   ```

7. Construct your Self endpoint URL:

   ```text
   SELF_ENDPOINT = https://40345855ba7b.ngrok-free.app/api/verify
   ```

   Use this value in your `.env` file (see below).

> **Important:** Self endpoints must be HTTPS and **must not** be `localhost` or `127.0.0.1`. A tunnel like ngrok solves this.

## 5. Discord Bot Setup (Developer Portal)

### 5.1. Create the application and bot

1. Open the Discord Developer Portal: <https://discord.com/developers/applications>.
2. Click **“New Application”**, give it a name (e.g. `Self Verification Bot`), click **Create**.
3. On the application’s **General Information** page:
   - Copy **Application ID** → this will be `DISCORD_CLIENT_ID`.
4. Go to the **Bot** tab:
   - Click **“Add Bot”** → **Yes, do it!**
   - Under **Token**:
     - Click **Reset Token**, copy the bot token.
     - This will be `DISCORD_BOT_TOKEN`.
   - Scroll down to **Privileged Gateway Intents** and enable:
     - `SERVER MEMBERS INTENT`
     - `MESSAGE CONTENT INTENT`
   - Click **Save Changes**.

### 5.2. Invite the bot to your server

1. In the Developer Portal, go to **OAuth2 → URL Generator**.
2. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select at least:
   - `View Channels`
   - `Send Messages`
   - `Send Messages in Threads`
   - `Read Message History`
   - `Manage Roles` (required to assign your `Verified` role)
4. Copy the generated URL and open it in your browser.
5. Choose the server where you want the bot to live, click **Authorize**, and complete the captcha.

### 5.3. Get your server (guild) ID

1. In the Discord client, go to **Settings → Advanced**.
2. Enable **Developer Mode**.
3. Right-click your server icon → **Copy Server ID**.
4. This value is `DISCORD_GUILD_ID`.

### 5.4. Create a “Verified” role and a restricted category

1. In your server, open **Server Settings → Roles**.
2. Click **Create Role**:
   - Name it something like `Verified`.
   - Give it a color if you want.
   - Save changes.
3. To get the role ID:
   - Right-click the `Verified` role → **Copy Role ID**.
   - This value is `DISCORD_VERIFIED_ROLE_ID`.

4. Configure the restricted category:
   - Create a category (e.g. `restricted`).
   - Create one or more channels inside it.
   - Right-click the category → **Edit Category → Permissions**:
     - For `@everyone`: **disable** `View Channel`.
     - For `Verified` role: **enable** `View Channel`.
   - Save changes.

> Make sure the bot’s own role is **above** the `Verified` role in the role list, otherwise it cannot assign that role.

## 6. Environment Configuration (`server/.env`)

Create a file `server/.env` (this file is ignored by git; safe to keep secrets there).

Example:

```env
PORT=3001

# Self verifier configuration
SELF_SCOPE=demo-scope
SELF_ENDPOINT=https://your-ngrok-id.ngrok-free.app/api/verify

# Discord bot configuration
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-discord-application-client-id
DISCORD_GUILD_ID=your-discord-server-id
DISCORD_VERIFIED_ROLE_ID=verified-role-id

# Optional: customize how the Self app appears
SELF_APP_NAME=Self Discord Verification (Mock Passports)
SELF_LOGO_URL=https://i.postimg.cc/mrmVf9hm/self.png
```

Field-by-field:

- `PORT`
  - Local port for Express (default `3001`).
- `SELF_SCOPE`
  - A short ASCII string identifying this verification “scope”, e.g. `demo-scope`.
  - Must be ≤ 31 characters.
- `SELF_ENDPOINT`
  - Public HTTPS URL for `/api/verify`, e.g. `https://40345855ba7b.ngrok-free.app/api/verify`.
  - **Must not** contain `localhost` or `127.0.0.1`.
- `DISCORD_BOT_TOKEN`
  - Bot token from the Developer Portal **Bot** tab.
- `DISCORD_CLIENT_ID`
  - Application ID from the Developer Portal **General Information** page.
- `DISCORD_GUILD_ID`
  - Your Discord server (guild) ID.
- `DISCORD_VERIFIED_ROLE_ID`
  - ID of the role that should be assigned when verification succeeds; used to gate the restricted category.
- `SELF_APP_NAME` / `SELF_LOGO_URL`
  - Optional customizations for how the Self app entry appears inside the Self mobile app.

## 6. Running the Backend + Discord Bot

1. **Start the backend + bot**

   ```bash
   cd server
   npm run dev
   ```

   You should see logs like:

   - `Self Express Backend listening on http://localhost:3001`
   - `discord.commands_registered` (slash commands registered)
   - `discord.ready` (bot logged in)

2. **Expose the backend to Self (ngrok)**

   With the backend running:

   ```bash
   ngrok http 3001
   ```

   Update `SELF_ENDPOINT` if the ngrok URL changes.

3. **Endpoints**

   - `POST /api/verify`
     - Called by the Self app.
     - Uses `SelfBackendVerifier` to validate the proof against your config (age, OFAC, etc.).

## 7. Using the Bot (User Flow)

1. In your Discord server, in any text channel, run:

   ```text
   /verify
   ```

2. The bot:
   - Immediately replies in the channel (ephemeral):
     - “Generating your Self verification QR… I’ll DM it to you shortly.”
   - Generates a unique Self app configuration for you.
   - Creates a QR PNG and saves it to `server/qrcodes/...`.
   - DMs you the QR with the instruction:
     - “Scan this QR code with the Self app (staging/mock passports) to verify your age/identity.”

3. You:
   - Open the Self app (staging) on your phone.
   - Ensure you have a **mock passport** set up.
   - Scan the QR and follow the flow inside the Self app.

4. The backend:
   - Verifies the proof (age, OFAC, etc.) via `SelfBackendVerifier`.
   - Decodes the `userDefinedData` from the proof to find the matching Discord session.
   - Assigns the `Verified` role to your user.
   - Logs the event to `server/logs/discord-verifier.log`.
   - DMs you:

     > ✅ Your Self verification succeeded. You now have access to the restricted channels.

5. You now see the restricted category/channels where you granted `View Channel` to the `Verified` role.

## 9. Troubleshooting

**No `/verify` command in my server**

- Check the logs for `discord.commands_registered`.
- Ensure:
  - `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN` are set correctly.
  - The bot is actually added to that server.
  - You restarted the backend after setting `.env`.

**Bot says it sent a DM, but I don’t see it**

- In Discord:
  - `Settings → Privacy & Safety → Server Privacy Defaults` and enable “Allow direct messages from server members”.
  - Or right-click your server → **Privacy Settings** → enable DMs.
- Try `/verify` again.

**User verifies but doesn’t get the role**

- Check `server/logs/discord-verifier.log` for:
  - `verification.role_not_found` – `DISCORD_VERIFIED_ROLE_ID` might be wrong or the role was deleted.
  - `verification.no_role_configured` – you didn’t set `DISCORD_VERIFIED_ROLE_ID`.
  - `verification.discord_error` – bot lacks `Manage Roles` or its role is below the target role.
- Ensure:
  - Bot has the `Manage Roles` permission.
  - Bot’s role is **above** the `Verified` role in the role list.

**Self app errors about endpoint or scope**

- Confirm:
  - `SELF_SCOPE` is ≤ 31 ASCII characters.
  - `SELF_ENDPOINT` is exactly the ngrok URL + `/api/verify` and does not contain `localhost`.
  - ngrok is running and points to the same port/host where Express is listening.
