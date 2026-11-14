# Installation & Updates

All official builds are published on [GitHub Releases](https://github.com/Tenkayro/StreamDash/releases/latest).

---

## Windows (10 & 11 · x64)

- **Installer (Recommended):** Download [`StreamDash-Setup.msi`](https://github.com/Tenkayro/StreamDash/releases/latest/download/StreamDash-Setup.msi) and run it.
- **Microsoft Store:** Install from the [Microsoft Store](https://apps.microsoft.com/detail/9P8MCZJVPTDQ).

**Updates:** Standalone `.msi` installs update directly from the download icon in the top-right title bar. Store installs update via the Microsoft Store.

---

## macOS (Apple Silicon & Intel · Universal)

1. Download the `.dmg` from [GitHub Releases](https://github.com/Tenkayro/StreamDash/releases/latest).
2. Drag **StreamDash** into **Applications**.
3. **First launch:** Right-click **StreamDash** → **Open** *(required once because the build is unsigned)*.

**Updates:** Clicking the update icon in the title bar downloads the signed `.app.tar.gz`, updates the app bundle, and restarts StreamDash automatically *(requires write access to `/Applications`)*.

---

## Linux (x86_64)

### Auto-Installer (Recommended)

Detects your distro (`.deb`, `.rpm`, `.AppImage`, or raw `.tar.gz` binary), sets up shortcuts, and handles updates/uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash
```

### Non-Interactive / Format Selection

```bash
# Raw binary (.tar.gz) — universal, no AppImage/FUSE or root required
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --install --method binary --yes

# Debian / Ubuntu / Mint (.deb)
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --install --method deb --yes

# Fedora / RHEL / openSUSE (.rpm)
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --install --method rpm --yes

# AppImage (desktop · requires FUSE)
curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --install --method appimage --yes
```

### Manual Installation

- **Raw Binary (`StreamDash-linux-x86_64.tar.gz`)** *(great for headless servers, containers, Arch, etc.)*:
  ```bash
  tar -xzf StreamDash-linux-x86_64.tar.gz
  chmod +x streamdash
  ./streamdash
  ```
- **AppImage:** `chmod +x StreamDash_*.AppImage && ./StreamDash_*.AppImage`
- **Debian / Ubuntu / Mint:** `sudo apt install ./StreamDash_*.deb`
- **Fedora / RHEL:** `sudo dnf install ./StreamDash-*.rpm`
- **openSUSE:** `sudo zypper install ./StreamDash-*.rpm`

### Updates & Uninstall on Linux

- **In-App Updater:** Clicking the update icon in the title bar automatically runs [`install.sh`](../install.sh) (`--update --yes`) for your installed package format and restarts StreamDash.
- **CLI Update:**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --update --yes
  ```
- **Uninstall:**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --uninstall
  ```

> Running on a server without a monitor? See **[headless-server.md](headless-server.md)**.
