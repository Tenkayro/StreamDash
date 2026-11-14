# Web Host & Android Companion

Control your stream from any phone, tablet, or local browser by enabling **Host Mode** on your desktop (or `--headless` on a server).

---

## 1. Install the Android App

- Download [`StreamDash-Android.apk`](https://github.com/Tenkayro/StreamDash/releases/latest/download/StreamDash-Android.apk) (Android 8.0+) and install it on your device.

---

## 2. Enable Host Mode

- **Desktop App:** Open **Host** in the sidebar and enable **Web Host**. Set your preferred port (`48950` by default) and PIN/auth settings.
- **Headless Server:** Start with `--headless` — see **[headless-server.md](headless-server.md)**.

---

## 3. Connect Your Device

1. **1-Tap LAN Discovery:**
   - Ensure phone and PC are on the same local network (`48950/tcp` + `48951/udp`).
   - Tap your PC in the discovered devices list.
   - Verify that the **6-digit code** matches on your phone and the Desktop confirmation popup, then click **Allow**.
2. **QR Code Scan:**
   - Scan the QR code shown on the **Host** page inside StreamDash Desktop.
3. **Manual Connection:**
   - Enter IP/hostname, port (`48950`), and your access PIN.

---

## Notes & Troubleshooting

- **Disabling Host Mode:** Turning Host Mode off on Desktop immediately disconnects connected Companion/browser clients back to a clean disconnected/pairing screen.
- **Settings Sync:** Companion notification and haptic preferences stay synced with your Desktop Host (and Cloud Sync when Pro Cloud Sync is enabled).
- **No PC shown in Discovery:** Make sure UDP `48951` and TCP `48950` are allowed in your local firewall, or connect via QR code / manual IP.
