<div align="center">

<img width="650" alt="StreamDash" src="https://github.com/user-attachments/assets/c610fcaa-52d1-4bf6-b26a-17d8705de253" />

### Your stream. One clean desktop workspace.

A fast, lightweight **Windows, macOS & Linux** desktop app (with a native **Android** companion) for managing, automating, and monitoring your Twitch stream in real time — without juggling a dozen browser tabs.

**Available in 5 languages:** English · Deutsch · Español · Français · Português (Brasil)

[![Release All Platforms](https://github.com/Tenkayro/StreamDash/actions/workflows/release.yml/badge.svg)](https://github.com/Tenkayro/StreamDash/actions/workflows/release.yml)

📚 **[Installation & Updates](docs/install.md)** · 🐧 **[Headless Linux Server](docs/headless-server.md)** · 📱 **[Web Host & Android Companion](docs/companion.md)**

</div>

---

## ✨ Why StreamDash?

**StreamDash** brings everything you need while live into a single, distraction-free desktop experience: customizable widgets, live chat, moderation, OBS controls, giveaways, chat commands, alerts, StreamElements donations, and profile backups.

Keep your focus on your stream — StreamDash handles the rest quietly in the background.

---

## 🚀 Core Features

### 📊 Live Dashboard & Preview
- **Modular Widget Grid** — view followers, subscribers, viewers, bits, donations, goals, and stream status at a glance
- **Browser Sources & Live Preview** — monitor your stream output and embed custom browser panels right inside the dashboard
- **OBS Studio & Spotify Integration** — control OBS scenes, sources, and recording, and display now-playing tracks (including `!song` chat replies)

### 💬 Chat, Bot & Community Tools
- **Real-Time Twitch Chat** — badges, custom colors, emotes, timestamps, and optional dedicated Twitch Bot account support
- **Quick Moderation** — inspect viewer profiles, timeout, ban, and manage moderators directly from chat
- **Custom Commands, Variables & Chat Alerts** — build dynamic replies using central variables/counters and automated announcements
- **Giveaways & Channel Points** — run live chat giveaways with tracked entries and winners, and manage channel point rewards

### 🎬 Stream Control & Analytics
- **Stream Management** — update your stream title, game/category, and add stream markers instantly (even offline)
- **Live Activity & StreamElements** — track follows, subs, raids, cheers, redemptions, and StreamElements donations in one feed
- **Statistics & Goals** — review historical activity charts and track live follower, sub, or donation milestones
- **Native Windows Notifications & System Tray** — stay informed cleanly without cluttering your screen

### 💾 Profiles & Local Backups
- **Multi-Profile Support** — create separate layouts and configurations for different games, events, or Twitch accounts
- **Auto-Switch per Twitch Account** — automatically switch to the matching profile when changing channels
- **Selective JSON Import & Export** — back up or share appearance, dashboard layout, chat/OBS settings, or automation rules anytime

---

## 👑 StreamDash Pro

Want your setup available anywhere without manual file transfers? **StreamDash Pro** is a **one-time purchase** — no recurring subscription.

- ☁️ **Automatic Cloud Profile Sync** — securely sync your profiles, widgets, commands, and settings across setups
- 🔐 **Privacy-First by Design** — OAuth tokens, passwords, and API secrets stay strictly local on your PC and are never uploaded
- 🔄 **Smart Conflict Resolution** — choose whether to keep local changes, restore from the cloud, or merge profiles
- 🔗 **Twitch-Bound License** — tied cleanly to your Twitch account (with in-app support for one-time key resets if you linked the wrong account)
- ✨ **Future Pro Perks Included** — unlocks upcoming Pro features automatically

👉 **[Get StreamDash Pro](https://store.tenkayro.de/b/siOJA)** *(one-time payment via PayPal or card — activate directly inside **Settings → Pro & Cloud**)*

---

## 📦 Download & Install

Quick links below — see **[docs/install.md](docs/install.md)** for full platform & update instructions.

- **Windows (10 & 11 · x64):** [`StreamDash-Setup.msi`](https://github.com/Tenkayro/StreamDash/releases/latest/download/StreamDash-Setup.msi) · [Microsoft Store](https://apps.microsoft.com/detail/9P8MCZJVPTDQ)
- **macOS (Apple Silicon & Intel):** Universal **`.dmg`** from [GitHub Releases](https://github.com/Tenkayro/StreamDash/releases/latest) *(first launch: right-click → Open; signed in-app updates work automatically afterwards)*
- **Linux (x86_64):** Auto-installer (`.deb`, `.rpm`, `.AppImage`, or raw `.tar.gz` binary):
  ```bash
  curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash
  ```
- **Android Companion (8.0+):** [`StreamDash-Android.apk`](https://github.com/Tenkayro/StreamDash/releases/latest/download/StreamDash-Android.apk) — see **[docs/companion.md](docs/companion.md)**

---

## 🌐 Web & Mobile Host / Headless Server

Host the full UI on your LAN or run StreamDash silently on a Linux server — use the interactive server setup wizard or see **[docs/headless-server.md](docs/headless-server.md)**:

```bash
# Interactive Headless Linux Server Setup Wizard (dependencies + binary + systemd)
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --server

# Or run manually in headless mode with custom port & PIN
xvfb-run -a streamdash --headless --port 48950 --pin MYSECRET

# Desktop window + Web Host enabled
streamdash --host
```

| Flag | Description |
| :--- | :--- |
| `--headless` | Keeps the desktop window hidden and starts the Web Host automatically |
| `--host` / `--web-host` | Enables the Web Host on startup while showing the desktop window |
| `--port <PORT>` | Overrides the Web Host port (default: `48950`) |
| `--pin <TOKEN>` / `--token <TOKEN>` | Sets a custom access token/PIN |

---

## 📸 Preview

### Dashboard

![StreamDash Dashboard](docs/screenshots/dashboard.png)

### Stream Management

![StreamDash Stream Management](docs/screenshots/stream.png)

### Live Chat

![StreamDash Live Chat](docs/screenshots/chat.png)

### Giveaways

![StreamDash Giveaways](docs/screenshots/giveaways.png)

### Chat Alerts

![StreamDash Chat Alerts](docs/screenshots/chat-alerts.png)

### Goals & Progress Tracking

![StreamDash Goals](docs/screenshots/goals.png)

---

<div align="center">

**Built for streamers who want everything in one place.**

Windows · macOS · Linux · Android

</div>
