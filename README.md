# StreamDash

StreamDash is a Windows 10/11 desktop companion for streamers. It combines live Twitch EventSub activity, current Twitch channel statistics, and StreamElements tips in a focused desktop dashboard with local history, goals, charts, native notifications, autostart, and a system tray.

The normal application never generates demo activity. Empty, disconnected, loading, and error states reflect the actual services.

## Screenshots

Screenshots will be added after the first signed release.

## Stack

- Tauri 2 and Rust
- React 19, TypeScript, and Vite
- Tailwind CSS 4 and shadcn-style local UI primitives
- SQLite through `rusqlite`
- Windows Credential Manager through `keyring`
- Twitch Helix API and EventSub WebSocket
- StreamElements Astro WebSocket gateway

## Implemented integrations

Twitch uses the public-client Device Code Grant. The application requests only:

- `moderator:read:followers`
- `channel:read:subscriptions`
- `bits:read`
- `channel:read:redemptions`

EventSub handles follows, subscriptions, resub messages, gift subscriptions, cheers, incoming raids, custom channel-point redemptions, and online/offline changes. Helix provides follower/subscriber totals, current viewers, title, category, and stream start time.

StreamElements connects to `wss://astro.streamelements.com/` and subscribes to the documented `channel.activities` and `channel.tips` topics. Tips are recorded only when their transaction status is `success`.

## Prerequisites on Windows

1. Windows 10 version 1803 or later, or Windows 11.
2. [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**, the Windows SDK, and MSVC selected.
3. [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (normally already present on Windows 10/11).
4. [Node.js LTS](https://nodejs.org/) and npm.
5. [Rust MSVC toolchain](https://rustup.rs/): `rustup default stable-msvc`.
6. VS Code with the rust-analyzer and Tauri extensions is recommended.

## Install and configure

```powershell
git clone <your-repository-url>
cd StreamDash
npm install
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
VITE_TWITCH_CLIENT_ID=the_client_id_from_twitch
```

Only the Twitch Client ID belongs here. It is public by design. Never add a Twitch client secret, StreamElements JWT, or an OAuth access token to `.env`.

### Twitch developer application

The current Twitch registration flow is documented at [Register Your App](https://dev.twitch.tv/docs/authentication/register-app). Twitch requires a verified email and 2FA on the developer account.

1. Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps), select **Applications**, then **Register Your Application**.
2. Use a unique name such as `StreamDash YourName`.
3. Add `http://localhost:1420` as the OAuth Redirect URL. StreamDash's Device Code flow does not redirect to it, but the Twitch registration form requires a redirect URL.
4. Choose the closest desktop/installed application category shown by the console (the category label may vary by account/console version).
5. Create the application and copy its **Client ID** into `VITE_TWITCH_CLIENT_ID` in `.env`.
6. Do **not** generate or configure a client secret. The Windows app follows Twitch's recommendation to use the public Device Code flow and refreshes public-client tokens without a secret.
7. Restart the development server after changing `.env`.

In StreamDash, open **Connections → Connect Twitch**. The system browser opens Twitch's activation page. Enter the displayed code and authorize the four listed scopes. Tokens are stored under the `StreamDash` service in Windows Credential Manager. Public-client access tokens last roughly four hours; refresh tokens expire after 30 days of inactivity, at which point StreamDash asks you to connect again.

### StreamElements

The current official [Astro WebSocket documentation](https://docs.streamelements.com/websockets) supports OAuth2, a channel JWT, or an overlay API key. This self-hosted desktop build uses the channel JWT so it requires no hosted OAuth callback or distributed client secret.

1. Sign in to the [StreamElements dashboard](https://streamelements.com/dashboard).
2. If several platform accounts are linked, switch to the exact Twitch channel you want to monitor.
3. Click the avatar in the upper-right, select the channel, and copy its JWT/token from the channel/account page. StreamElements' page labels can vary, but the official websocket docs describe this same avatar → channel selection path.
4. Open **Connections** in StreamDash, paste the JWT once, and select **Connect**.

The JWT is immediately moved to Windows Credential Manager; it is not written to SQLite, local storage, logs, or UI state after connection. If StreamElements reports `err_unauthorized`, obtain a fresh token while switched to the correct channel.

## Development

Frontend in a browser (native integrations intentionally remain unavailable):

```powershell
npm run dev
```

Full desktop application:

```powershell
npm run tauri dev
```

Quality checks:

```powershell
npm run check
cd src-tauri
cargo check
```

## Production build

```powershell
npm run tauri build
```

On Windows the configured bundles are written under:

- `src-tauri\target\release\streamdash.exe` — unpackaged executable
- `src-tauri\target\release\bundle\nsis\` — NSIS installer
- `src-tauri\target\release\bundle\msi\` — MSI installer

Native notifications identify correctly only for an installed build. The development build may show a PowerShell/terminal identity in Windows notifications.

## Data and security

- OAuth credentials and the StreamElements JWT use Windows Credential Manager.
- Activity and non-sensitive settings use `%APPDATA%\dev.streamdash.desktop\streamdash.db`.
- Event IDs are unique in SQLite, preventing replayed WebSocket messages from creating duplicates.
- History is bounded by the selected maximum (1,000–50,000 events).
- Twitch token validation and refresh happen in Rust; tokens are never returned to React.
- The StreamElements JWT exists in renderer memory only while constructing its authenticated WebSocket subscription and is never rendered or logged.
- `.env` files are gitignored. `.env.example` contains no secret.

## Realtime and recovery behavior

Twitch EventSub message IDs are deduplicated by SQLite. A server-directed reconnect moves to Twitch's supplied reconnect URL without recreating subscriptions. An unexpected disconnect uses capped exponential backoff and recreates subscriptions on the new session, as Twitch requires.

StreamElements graceful reconnect tokens restore subscriptions on the replacement Astro socket. Unexpected disconnects use capped exponential backoff and subscribe again. Both clients stop timers and sockets when disconnected or when StreamDash exits.

## Troubleshooting

- **Connect Twitch says the Client ID is missing:** create `.env`, set `VITE_TWITCH_CLIENT_ID`, and restart `npm run tauri dev`.
- **Twitch statistics are unavailable:** disconnect and connect again so the currently configured scopes are granted. Confirm you authenticated as the broadcaster.
- **Twitch authorization expires:** public-client refresh tokens expire after 30 days of inactivity; reconnect from the Connections page.
- **StreamElements connects but no events arrive:** recopy the JWT after switching to the correct linked channel. The token is account-specific.
- **StreamElements reports unauthorized:** replace the stored token by disconnecting and reconnecting with a new JWT.
- **Windows build cannot find `link.exe`:** install the Visual Studio C++ workload and open a new terminal.
- **Notifications do not appear in development:** test an installed NSIS/MSI build and check Windows notification settings.

## API references verified for this implementation

- [Twitch OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth)
- [Twitch token validation](https://dev.twitch.tv/docs/authentication/validate-tokens)
- [Twitch scopes](https://dev.twitch.tv/docs/authentication/scopes)
- [Twitch EventSub WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events)
- [StreamElements Astro WebSockets](https://docs.streamelements.com/websockets)
- [StreamElements activity topic](https://docs.streamelements.com/websockets/topics/channel-activities)
- [StreamElements tips topic](https://docs.streamelements.com/websockets/topics/channel-tips)
- [Tauri 2 autostart](https://v2.tauri.app/plugin/autostart/)
- [Tauri 2 notifications](https://v2.tauri.app/plugin/notification/)
