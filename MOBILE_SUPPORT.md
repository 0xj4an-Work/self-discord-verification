# Mobile & Desktop Support Implementation

## Overview

The Discord bot now supports both mobile and desktop users with platform-specific verification flows.

## How It Works

### Platform Selection Approach (Current Implementation)

Since Discord doesn't reliably expose device information, the bot uses a **two-step interaction** where users select their platform:

1. **Step 1**: User runs `/verify` and sees two buttons: "📱 I'm on Mobile" and "🖥️ I'm on Desktop"
2. **Step 2**: Based on selection:
   - **Mobile users**: Receive a clickable deep link that opens the Self.xyz app directly
   - **Desktop users**: Receive a QR code to scan with their phone

This provides platform-specific experiences while letting users choose their device type.

## Changes Made

### 1. Updated Imports ([discordBot.mjs](server/src/discordBot.mjs):7-19)

Added Discord.js components for interactive buttons:
- `ActionRowBuilder` - Container for interactive components
- `ButtonBuilder` - Creates clickable buttons
- `ButtonStyle` - Defines button appearance

### 2. Refactored QR Generation Function ([discordBot.mjs](server/src/discordBot.mjs):43-99)

**Before**: `createSelfVerificationQr(sessionId, discordUser)`
**After**: `createSelfVerificationLink(sessionId, discordUser, generateQr = true)`

**Key improvements**:
- Always generates the universal deep link
- Optionally generates QR code (via `generateQr` parameter)
- Returns both the link and QR file paths
- Logs different events for mobile vs desktop flows

### 3. Platform Selection Flow ([discordBot.mjs](server/src/discordBot.mjs):198-391)

**New two-step user experience**:

#### Step 1: Platform Selection
When user runs `/verify`, they see:
```
Self.xyz Verification

To verify your age and access restricted channels, please select your device type:

[📱 I'm on Mobile] [🖥️ I'm on Desktop]
```

#### Step 2a: Mobile Flow
If user clicks "📱 I'm on Mobile", they receive a DM with:
```
📱 Verification Required

To access exclusive restricted channels in the Self Discord server,
please complete verification using the Self.xyz mobile app.

Tap the link below to open the Self app:
https://redirect.self.xyz?selfApp=...

Once verified, you'll automatically receive the Self.xyz Verified
role and gain access to exclusive channels!
```

#### Step 2b: Desktop Flow
If user clicks "🖥️ I'm on Desktop", they receive a DM with:
```
🖥️ Verification Required

To access exclusive restricted channels in the Self Discord server,
please complete verification using the Self.xyz mobile app.

Scan the QR code below with the Self.xyz app on your phone:

1️⃣ Open the Self.xyz app on your phone
2️⃣ Scan the QR code below
3️⃣ Complete the verification process

[QR Code Image]
```

### 4. Enhanced Interaction Handler ([discordBot.mjs](server/src/discordBot.mjs):457-479)

Now handles both:
- Slash commands (`/verify`)
- Button interactions (platform selection)

## Technical Details

### Universal Link

The Self.xyz SDK provides a `getUniversalLink()` function that creates a deep link with this format:
```
https://self.app/verify?data=<encoded-verification-data>
```

When tapped on mobile:
- Opens the Self.xyz app directly
- Pre-fills verification parameters
- User just needs to approve

When embedded in QR code:
- Can be scanned by Self app camera
- Same verification flow

### Button Component

```javascript
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setLabel("Open in Self App")
    .setURL(verificationData.universalLink)
    .setStyle(ButtonStyle.Link)
);
```

- Uses Discord's native button components
- `ButtonStyle.Link` creates a URL button (opens in browser/app)
- When tapped, opens the universal link
- Works on both mobile and desktop Discord

## Benefits

### For Users
✅ **Seamless mobile experience** - One tap to verify, no QR scanning needed
✅ **Desktop support** - Still works with QR codes as before
✅ **Flexibility** - Users choose their preferred method
✅ **No device detection needed** - Both options always available

### For Developers
✅ **Simpler logic** - No complex device detection
✅ **More reliable** - Doesn't depend on Discord exposing client info
✅ **Better UX** - Clear instructions for both platforms
✅ **Same backend** - No changes needed to verification endpoint

## Future Enhancements (Optional)

If you want to optimize further, you could:

### 1. Pure Mobile-Only Flow
Skip QR generation for known mobile users:
```javascript
verificationData = await createSelfVerificationLink(sessionId, user, false);
```

### 2. Device Detection (Advanced)
While Discord.js doesn't officially expose device type, you could use heuristics:
- Check interaction timing patterns
- Analyze user agent from webhook (if available)
- Use Discord Gateway presence data

### 3. User Preference Storage
Remember user's previous choice and optimize for that platform next time.

## Testing

### On Mobile Discord:
1. Open Discord mobile app
2. Run `/verify` command
3. Check DM - you should see the button
4. Tap "Open in Self App" button
5. Complete verification in Self app

### On Desktop Discord:
1. Open Discord desktop app
2. Run `/verify` command
3. Check DM - you should see QR code and button
4. Scan QR code with phone's Self app
5. Complete verification in Self app

### Mixed (Desktop Discord + Mobile Phone):
1. Run `/verify` on desktop
2. Open Discord on phone to view DM
3. Tap button to verify on phone
4. Works seamlessly!

## Logging

New log events:
- `link.created` - Deep link generated for mobile user
- `qr.created` - QR code generated (existing)
- Platform tracking in `verification.started` event

Example log:
```json
{
  "event": "verification.started",
  "sessionId": "abc-123",
  "discordUserId": "123456789",
  "guildId": "987654321",
  "platform": "mobile",
  "timestamp": "2025-12-22T10:30:00Z"
}
```

## Compatibility

- ✅ Discord.js v14+
- ✅ Works on iOS Discord
- ✅ Works on Android Discord
- ✅ Works on Desktop Discord (Windows/Mac/Linux)
- ✅ Works on Web Discord
- ✅ Backward compatible with existing verification flow

## Summary

The bot now provides a **hybrid approach** that works optimally for both mobile and desktop users without requiring device detection. Mobile users get a convenient one-tap button, while desktop users can still use QR codes. Best of both worlds!
