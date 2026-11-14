# Headless Linux Server Setup

Run StreamDash silently in the background on a Linux VPS, home server, or mini-PC (`--headless`) and access the full dashboard from any browser or the **Android Companion** app.

---

## 1. Install Runtime Libraries + `xvfb`

Even in `--headless` mode, the Linux binary links GTK3 / WebKitGTK 4.1 and expects a virtual X11 display (`xvfb-run`). No monitor or GPU is needed.

**Debian / Ubuntu:**
```bash
sudo apt update
sudo apt install -y curl xvfb libwebkit2gtk-4.1-0 libgtk-3-0 librsvg2-2 libappindicator3-1
```
*(On newer Debian/Ubuntu where `libappindicator3-1` is missing, use `libayatana-appindicator3-1`.)*

**Fedora / RHEL:**
```bash
sudo dnf install -y curl xorg-x11-server-Xvfb webkit2gtk4.1 gtk3 librsvg2 libappindicator-gtk3
```

**Arch Linux:**
```bash
sudo pacman -S --needed curl xorg-server-xvfb webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3
```

---

## 2. Install the Raw Binary (No FUSE / No Root Required)

```bash
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --install --method binary --yes
```

Installs to `~/.local/share/StreamDash/bin/streamdash` with a symlink at `~/.local/bin/streamdash`.

---

## 3. Start StreamDash Headless

```bash
xvfb-run -a ~/.local/bin/streamdash --headless --port 48950 --pin YOUR_SECRET_PIN
```

### CLI Flags

| Flag | Description |
| :--- | :--- |
| `--headless` | Keeps the desktop window hidden and starts Web Host automatically |
| `--host` / `--web-host` | Enables Web Host on startup while showing the desktop window |
| `--port <PORT>` / `--port=<PORT>` | Web Host TCP port (default: `48950`, minimum: `1024`) |
| `--pin <TOKEN>` / `--token <TOKEN>` | Access PIN/token required by browser & Companion clients |

---

## 4. Keep Running in Background (`systemd` User Service)

1. Create `~/.config/systemd/user/streamdash.service`:

```ini
[Unit]
Description=StreamDash Headless Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/xvfb-run -a %h/.local/bin/streamdash --headless --port 48950 --pin YOUR_SECRET_PIN
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

2. Enable autostart (including when logged out):

```bash
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now streamdash
```

3. Check logs / restart anytime:

```bash
systemctl --user status streamdash
journalctl --user -u streamdash -f
systemctl --user restart streamdash
```

---

## 5. Connecting & Firewall

- **Browser:** Open `http://<SERVER-IP>:48950` and enter your `--pin`.
- **Android Companion:** Enter `<SERVER-IP>`, port `48950`, and your `--pin` (or use LAN discovery if on the same subnet).
- **Firewall ports:**
  - `48950/tcp` (Web Host & SSE stream)
  - `48951/udp` (optional, LAN auto-discovery for Android Companion)

> **Security tip:** Host Mode uses HTTP. For remote VPS access over the internet, connect through **Tailscale**, **WireGuard**, an **SSH tunnel** (`ssh -L 48950:127.0.0.1:48950 user@server`), or a TLS reverse proxy rather than exposing port `48950` publicly.

---

## 6. Update the Server

```bash
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --update --yes
systemctl --user restart streamdash
```
