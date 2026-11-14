#!/usr/bin/env bash
set -euo pipefail

# StreamDash Linux Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash
#    or: ./install.sh [--install | --update | --uninstall] [--method deb|rpm|appimage|binary] [--yes]

REPO="Tenkayro/StreamDash"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
ICON_FALLBACK_URL="https://raw.githubusercontent.com/${REPO}/main/src-tauri/icons/128x128.png"

APP_NAME="StreamDash"
BIN_NAME="streamdash"
APPIMAGE_PATH="${HOME}/.local/share/StreamDash/StreamDash.AppImage"
BIN_INSTALL_DIR="${HOME}/.local/share/StreamDash/bin"
BIN_FILE="${BIN_INSTALL_DIR}/streamdash"
BIN_LINK="${HOME}/.local/bin/streamdash"
DESKTOP_FILE="${HOME}/.local/share/applications/streamdash.desktop"
ICON_FILE="${HOME}/.local/share/icons/hicolor/128x128/apps/streamdash.png"
STATE_DIR="${HOME}/.local/share/streamdash-installer"
STATE_FILE="${STATE_DIR}/state"
USER_SYSTEMD_UNIT="${HOME}/.config/systemd/user/streamdash.service"
SYSTEM_SYSTEMD_UNIT="/etc/systemd/system/streamdash.service"
USER_SERVER_ENV="${HOME}/.config/streamdash/server.env"
SYSTEM_SERVER_ENV="/etc/streamdash/server.env"

AUTO_YES=0
ACTION=""
FORCED_METHOD=""
SERVER_PORT=""
SERVER_PIN=""
TMP_DIR=""

# ── Colors & Formatting ────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_PURPLE=$'\033[38;5;141m'
  C_BLUE=$'\033[38;5;75m'
  C_GREEN=$'\033[38;5;78m'
  C_YELLOW=$'\033[38;5;221m'
  C_RED=$'\033[38;5;203m'
else
  C_RESET="" C_BOLD="" C_DIM="" C_PURPLE="" C_BLUE="" C_GREEN="" C_YELLOW="" C_RED=""
fi

cleanup() {
  if [ -n "${TMP_DIR}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

step()  { printf "  ${C_BLUE}•${C_RESET} %s\n" "$1"; }
ok()    { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$1"; }
warn()  { printf "  ${C_YELLOW}!${C_RESET} %s\n" "$1"; }
err()   { printf "  ${C_RED}✗${C_RESET} %s\n" "$1" >&2; }
die()   { err "$1"; exit 1; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

prompt_read() {
  local prompt="$1"
  local default_val="${2:-}"
  local reply=""
  if [ -t 0 ]; then
    printf "%s" "$prompt"
    IFS= read -r reply || true
  elif [ -r /dev/tty ]; then
    printf "%s" "$prompt" >/dev/tty
    IFS= read -r reply </dev/tty || true
  else
    reply="$default_val"
  fi
  printf "%s" "${reply:-$default_val}"
}

confirm() {
  local question="$1"
  local default="${2:-y}"
  if [ "$AUTO_YES" -eq 1 ]; then
    return 0
  fi
  local hint="[Y/n]"
  [ "$default" = "n" ] && hint="[y/N]"
  local ans
  ans="$(prompt_read "  ${C_BOLD}${question}${C_RESET} ${C_DIM}${hint}${C_RESET} " "$default")"
  case "${ans,,}" in
    y|yes) return 0 ;;
    *)     return 1 ;;
  esac
}

# ── Argument Parsing ───────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --install)   ACTION="install" ;;
    --server|--headless) ACTION="server" ;;
    --update)    ACTION="update" ;;
    --uninstall) ACTION="uninstall" ;;
    --yes|-y)    AUTO_YES=1 ;;
    --method)
      shift
      FORCED_METHOD="${1:-}"
      ;;
    --port)
      shift
      SERVER_PORT="${1:-}"
      ;;
    --pin|--token)
      shift
      SERVER_PIN="${1:-}"
      ;;
    --help|-h)
      cat <<EOF
StreamDash Linux Installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --server
  ./install.sh [OPTIONS]

Options:
  --install            Install StreamDash non-interactively
  --server             Run the interactive Headless Server setup wizard (systemd + xvfb)
  --update             Update StreamDash to the latest release
  --uninstall          Uninstall StreamDash
  --method <type>      Force package type: deb, rpm, appimage, or binary
  --port <port>        Web Host port for --server setup (default: 48950)
  --pin <pin>          Access PIN/token for --server setup
  -y, --yes            Skip confirmation prompts
  -h, --help           Show this help message
EOF
      exit 0
      ;;
    *)
      die "Unknown option: $1 (use --help for usage)"
      ;;
  esac
  shift
done

# ── System & Distro Detection ──────────────────────────────────────────────────
ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
  die "Unsupported CPU architecture: ${ARCH}. StreamDash Linux builds currently support x86_64."
fi

DISTRO_ID="linux"
DISTRO_NAME="Linux"
DISTRO_LIKE=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-linux}"
  DISTRO_NAME="${PRETTY_NAME:-${NAME:-Linux}}"
  DISTRO_LIKE="${ID_LIKE:-}"
fi

detect_recommended_method() {
  if [ -n "$FORCED_METHOD" ]; then
    case "${FORCED_METHOD,,}" in
      deb|rpm|appimage|binary) printf "%s" "${FORCED_METHOD,,}"; return ;;
      *) die "Invalid method '${FORCED_METHOD}'. Choose deb, rpm, appimage, or binary." ;;
    esac
  fi

  # Immutable Fedora/openSUSE variants work best with AppImage or raw binary
  if has_cmd rpm-ostree || has_cmd transactional-update; then
    if [ ! -e /dev/fuse ] || { [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; }; then
      printf "binary"
    else
      printf "appimage"
    fi
    return
  fi

  local combined=" ${DISTRO_ID,,} ${DISTRO_LIKE,,} "
  if [[ "$combined" =~ [[:space:]](ubuntu|debian|linuxmint|pop|elementary|zorin|kali|mx|neon)[[:space:]] ]] && has_cmd dpkg && has_cmd apt-get; then
    printf "deb"
  elif [[ "$combined" =~ [[:space:]](fedora|rhel|centos|almalinux|rocky|nobara|opensuse|opensuse-tumbleweed|opensuse-leap|suse)[[:space:]] ]] && (has_cmd dnf || has_cmd zypper || has_cmd rpm); then
    printf "rpm"
  elif has_cmd apt-get && has_cmd dpkg; then
    printf "deb"
  elif has_cmd dnf || has_cmd zypper; then
    printf "rpm"
  elif [ ! -e /dev/fuse ] || { [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; }; then
    printf "binary"
  else
    printf "appimage"
  fi
}

# ── Installed State Detection ──────────────────────────────────────────────────
INSTALLED_METHOD=""
INSTALLED_VERSION=""

read_state_version() {
  if [ -r "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE" || true
    printf "%s" "${STATE_VERSION:-installed}"
  else
    printf "installed"
  fi
}

refresh_installed_state() {
  INSTALLED_METHOD=""
  INSTALLED_VERSION=""

  if has_cmd dpkg-query && dpkg-query -W -f='${Status}\n' streamdash 2>/dev/null | grep -q "install ok installed"; then
    INSTALLED_METHOD="deb"
    INSTALLED_VERSION="$(dpkg-query -W -f='${Version}' streamdash 2>/dev/null || true)"
  elif has_cmd rpm && rpm -q streamdash >/dev/null 2>&1; then
    INSTALLED_METHOD="rpm"
    INSTALLED_VERSION="$(rpm -q --qf '%{VERSION}' streamdash 2>/dev/null || true)"
  elif [ -n "${STREAMDASH_ACTIVE_APPIMAGE:-}" ] && [ -f "${STREAMDASH_ACTIVE_APPIMAGE}" ]; then
    INSTALLED_METHOD="appimage"
    INSTALLED_VERSION="$(read_state_version)"
  elif [ -f "$APPIMAGE_PATH" ]; then
    INSTALLED_METHOD="appimage"
    INSTALLED_VERSION="$(read_state_version)"
  elif [ -x "$BIN_FILE" ]; then
    INSTALLED_METHOD="binary"
    INSTALLED_VERSION="$(read_state_version)"
  elif [ -n "${STREAMDASH_ACTIVE_EXE:-}" ] && [ -f "${STREAMDASH_ACTIVE_EXE}" ]; then
    INSTALLED_METHOD="binary"
    INSTALLED_VERSION="$(read_state_version)"
  fi
}

# ── GitHub Release Lookup ──────────────────────────────────────────────────────
LATEST_TAG=""
LATEST_VERSION=""
URL_DEB=""
URL_RPM=""
URL_APPIMAGE=""
URL_TAR=""

fetch_latest_release() {
  local json=""
  if has_cmd curl; then
    json="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: streamdash-installer" "$API_URL" 2>/dev/null || true)"
  elif has_cmd wget; then
    json="$(wget -qO- --header="Accept: application/vnd.github+json" "$API_URL" 2>/dev/null || true)"
  else
    die "Neither curl nor wget is installed. Please install curl first."
  fi

  [ -n "$json" ] || die "Could not reach GitHub Releases API (${API_URL})."

  if has_cmd python3; then
    eval "$(python3 -c '
import json, shlex, sys
data = json.loads(sys.stdin.read())
tag = data.get("tag_name") or ""
ver = tag.lstrip("vV")
assets = data.get("assets") or []
deb = next((a.get("browser_download_url", "") for a in assets if (a.get("name") or "").endswith(".deb")), "")
rpm = next((a.get("browser_download_url", "") for a in assets if (a.get("name") or "").endswith(".rpm")), "")
app = next((a.get("browser_download_url", "") for a in assets if (a.get("name") or "").endswith(".AppImage")), "")
tar = next((a.get("browser_download_url", "") for a in assets if (a.get("name") or "").endswith(".tar.gz") and "linux" in (a.get("name") or "").lower()), "")
print(f"LATEST_TAG={shlex.quote(tag)}")
print(f"LATEST_VERSION={shlex.quote(ver)}")
print(f"URL_DEB={shlex.quote(deb)}")
print(f"URL_RPM={shlex.quote(rpm)}")
print(f"URL_APPIMAGE={shlex.quote(app)}")
print(f"URL_TAR={shlex.quote(tar)}")
' <<< "$json")"
  else
    LATEST_TAG="$(printf "%s" "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    LATEST_VERSION="${LATEST_TAG#v}"
    LATEST_VERSION="${LATEST_VERSION#V}"
    URL_DEB="$(printf "%s" "$json" | grep -oE 'https://[^"]+\.deb' | head -n1 || true)"
    URL_RPM="$(printf "%s" "$json" | grep -oE 'https://[^"]+\.rpm' | head -n1 || true)"
    URL_APPIMAGE="$(printf "%s" "$json" | grep -oE 'https://[^"]+\.AppImage' | head -n1 || true)"
    URL_TAR="$(printf "%s" "$json" | grep -oE 'https://[^"]*linux[^"]*\.tar\.gz' | head -n1 || true)"
  fi

  [ -n "$LATEST_TAG" ] || die "Could not determine the latest StreamDash release tag."
}

download_file() {
  local url="$1"
  local dest="$2"
  if has_cmd curl; then
    curl -fL --progress-bar "$url" -o "$dest"
  else
    wget -q --show-progress "$url" -O "$dest"
  fi
}

run_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif has_cmd sudo && sudo -n true 2>/dev/null; then
    sudo "$@"
  elif [ ! -t 0 ] && has_cmd pkexec && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    pkexec "$@"
  elif has_cmd sudo && [ -r /dev/tty ]; then
    if [ -t 0 ]; then
      sudo "$@"
    else
      sudo "$@" </dev/tty
    fi
  elif has_cmd pkexec && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    pkexec "$@"
  elif has_cmd sudo; then
    sudo "$@"
  else
    die "Administrator privileges (sudo/pkexec) are required for system package installation. Try --method appimage or --method binary instead."
  fi
}

# ── Installers ─────────────────────────────────────────────────────────────────
install_deb() {
  [ -n "$URL_DEB" ] || die "No .deb asset found in release ${LATEST_TAG}. Try --method appimage."
  TMP_DIR="$(mktemp -d)"
  local deb_file="${TMP_DIR}/streamdash.deb"

  step "Downloading Debian/Ubuntu package (${LATEST_TAG})..."
  download_file "$URL_DEB" "$deb_file"
  ok "Downloaded $(basename "$URL_DEB")"

  step "Installing .deb package (requires sudo)..."
  if run_sudo apt-get update -qq && run_sudo apt-get install -y "$deb_file"; then
    ok "Installed StreamDash ${LATEST_TAG} via apt"
  else
    warn "apt-get install failed, trying dpkg + dependency fix..."
    run_sudo dpkg -i "$deb_file" || true
    run_sudo apt-get install -f -y
    ok "Installed StreamDash ${LATEST_TAG} via dpkg"
  fi

  mkdir -p "$STATE_DIR"
  printf "STATE_METHOD=deb\nSTATE_VERSION=%s\n" "$LATEST_VERSION" > "$STATE_FILE"
}

install_rpm() {
  [ -n "$URL_RPM" ] || die "No .rpm asset found in release ${LATEST_TAG}. Try --method appimage."
  TMP_DIR="$(mktemp -d)"
  local rpm_file="${TMP_DIR}/streamdash.rpm"

  step "Downloading RPM package (${LATEST_TAG})..."
  download_file "$URL_RPM" "$rpm_file"
  ok "Downloaded $(basename "$URL_RPM")"

  step "Installing .rpm package (requires sudo)..."
  if has_cmd dnf; then
    run_sudo dnf install -y "$rpm_file"
  elif has_cmd zypper; then
    run_sudo zypper --non-interactive install --allow-unsigned-rpm "$rpm_file"
  elif has_cmd rpm; then
    run_sudo rpm -Uvh --replacepkgs "$rpm_file"
  else
    die "No RPM package manager (dnf/zypper/rpm) found."
  fi
  ok "Installed StreamDash ${LATEST_TAG} (.rpm)"

  mkdir -p "$STATE_DIR"
  printf "STATE_METHOD=rpm\nSTATE_VERSION=%s\n" "$LATEST_VERSION" > "$STATE_FILE"
}

install_desktop_entry() {
  mkdir -p "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"

  if has_cmd curl; then
    curl -fsSL "$ICON_FALLBACK_URL" -o "$ICON_FILE" 2>/dev/null || true
  elif has_cmd wget; then
    wget -qO "$ICON_FILE" "$ICON_FALLBACK_URL" 2>/dev/null || true
  fi

  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=StreamDash
Comment=Twitch & OBS Desktop Command Center
Exec=${BIN_LINK} %U
Icon=streamdash
Terminal=false
Type=Application
Categories=AudioVideo;Network;Utility;
StartupWMClass=streamdash
EOF
  chmod +x "$DESKTOP_FILE"

  has_cmd update-desktop-database && update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
  has_cmd gtk-update-icon-cache && gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true
  ok "Created desktop shortcut (${DESKTOP_FILE})"
}

install_appimage() {
  [ -n "$URL_APPIMAGE" ] || die "No .AppImage asset found in release ${LATEST_TAG}."
  TMP_DIR="$(mktemp -d)"
  local tmp_app="${TMP_DIR}/StreamDash.AppImage"
  local target_app="$APPIMAGE_PATH"

  if [ -n "${STREAMDASH_ACTIVE_APPIMAGE:-}" ] && [ -w "$(dirname "${STREAMDASH_ACTIVE_APPIMAGE}")" ]; then
    target_app="${STREAMDASH_ACTIVE_APPIMAGE}"
  fi

  step "Downloading universal AppImage (${LATEST_TAG})..."
  download_file "$URL_APPIMAGE" "$tmp_app"
  chmod +x "$tmp_app"
  ok "Downloaded $(basename "$URL_APPIMAGE")"

  step "Installing binary and desktop launcher..."
  mkdir -p "$(dirname "$target_app")" "$(dirname "$BIN_LINK")" "$STATE_DIR"
  mv -f "$tmp_app" "$target_app"
  chmod +x "$target_app"
  ln -sf "$target_app" "$BIN_LINK"

  install_desktop_entry

  printf "STATE_METHOD=appimage\nSTATE_VERSION=%s\n" "$LATEST_VERSION" > "$STATE_FILE"
  ok "Installed StreamDash ${LATEST_TAG} to ${target_app}"

  if [[ ":${PATH}:" != *":${HOME}/.local/bin:"* ]]; then
    warn "~/.local/bin is not in your PATH. Add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell profile, or launch from your app menu."
  fi
}

install_binary() {
  [ -n "$URL_TAR" ] || die "No raw Linux .tar.gz asset found in release ${LATEST_TAG}. Try --method appimage."
  TMP_DIR="$(mktemp -d)"
  local tar_file="${TMP_DIR}/streamdash.tar.gz"
  local extract_dir="${TMP_DIR}/extract"
  local target_bin="$BIN_FILE"

  if [ ! -x "$BIN_FILE" ] && [ -n "${STREAMDASH_ACTIVE_EXE:-}" ] && [ -w "$(dirname "${STREAMDASH_ACTIVE_EXE}")" ]; then
    target_bin="${STREAMDASH_ACTIVE_EXE}"
  fi

  step "Downloading raw Linux binary (${LATEST_TAG})..."
  download_file "$URL_TAR" "$tar_file"
  ok "Downloaded $(basename "$URL_TAR")"

  mkdir -p "$extract_dir"
  tar -xzf "$tar_file" -C "$extract_dir"
  local extracted_bin
  extracted_bin="$(find "$extract_dir" -type f -name "$BIN_NAME" | head -n1 || true)"
  [ -n "$extracted_bin" ] || die "Archive did not contain ${BIN_NAME} binary."

  step "Installing raw binary to ${target_bin}..."
  mkdir -p "$(dirname "$target_bin")" "$(dirname "$BIN_LINK")" "$STATE_DIR"
  mv -f "$extracted_bin" "$target_bin"
  chmod 755 "$target_bin"
  if [ "$target_bin" != "$BIN_LINK" ]; then
    ln -sf "$target_bin" "$BIN_LINK"
  fi

  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    install_desktop_entry
  fi

  if has_cmd ldd; then
    local missing_libs
    missing_libs="$(ldd "$target_bin" 2>/dev/null | grep "not found" || true)"
    if [ -n "$missing_libs" ]; then
      warn "Missing shared libraries detected (install WebKitGTK 4.1 / GTK3 runtime packages for your distro):"
      printf "%s\n" "$missing_libs"
    fi
  fi

  printf "STATE_METHOD=binary\nSTATE_VERSION=%s\n" "$LATEST_VERSION" > "$STATE_FILE"
  ok "Installed StreamDash ${LATEST_TAG} to ${target_bin}"

  if [[ ":${PATH}:" != *":${HOME}/.local/bin:"* ]]; then
    warn "~/.local/bin is not in your PATH. Add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell profile, or run ${target_bin}."
  fi
}

generate_random_pin() {
  if has_cmd python3; then
    python3 -c 'import secrets; alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; print("".join(secrets.choice(alphabet) for _ in range(8)))'
  elif has_cmd tr; then
    tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom 2>/dev/null | head -c 8 || printf "SD489500"
  else
    printf "SD489500"
  fi
}

detect_primary_ip() {
  local ip=""
  if has_cmd ip; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
  fi
  if [ -z "$ip" ] && has_cmd hostname; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf "%s" "${ip:-<SERVER-IP>}"
}

restart_server_services_if_present() {
  if ! has_cmd systemctl || [ ! -d /run/systemd/system ]; then
    return 0
  fi
  if [ -f "$SYSTEM_SYSTEMD_UNIT" ]; then
    step "Restarting system service (streamdash.service)..."
    run_sudo systemctl restart streamdash.service && ok "Restarted streamdash.service" || warn "Could not restart system service automatically."
  elif [ -f "$USER_SYSTEMD_UNIT" ]; then
    step "Restarting user service (streamdash.service)..."
    systemctl --user restart streamdash.service >/dev/null 2>&1 && ok "Restarted user streamdash.service" || warn "Could not restart user service automatically (run: systemctl --user restart streamdash)."
  fi
}

remove_server_services() {
  if [ -f "$USER_SYSTEMD_UNIT" ]; then
    step "Removing user systemd service..."
    systemctl --user disable --now streamdash.service >/dev/null 2>&1 || true
    rm -f "$USER_SYSTEMD_UNIT"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    ok "Removed ${USER_SYSTEMD_UNIT}"
  fi
  if [ -f "$SYSTEM_SYSTEMD_UNIT" ]; then
    step "Removing system systemd service (requires sudo)..."
    run_sudo systemctl disable --now streamdash.service >/dev/null 2>&1 || true
    run_sudo rm -f "$SYSTEM_SYSTEMD_UNIT"
    run_sudo systemctl daemon-reload >/dev/null 2>&1 || true
    ok "Removed ${SYSTEM_SYSTEMD_UNIT}"
  fi
}

install_server_dependencies() {
  step "[1/4] Checking server runtime libraries & virtual display (xvfb)..."

  local need_pkgs=0
  if ! has_cmd xvfb-run; then
    need_pkgs=1
  elif has_cmd ldconfig && ! ldconfig -p 2>/dev/null | grep -q "webkit2gtk-4\.1"; then
    need_pkgs=1
  fi

  if [ "$need_pkgs" -eq 0 ]; then
    ok "xvfb-run and WebKitGTK 4.1 runtime look ready."
    return 0
  fi

  local pkg_mgr=""
  local pkgs=()
  local combined=" ${DISTRO_ID,,} ${DISTRO_LIKE,,} "

  if has_cmd apt-get; then
    pkg_mgr="apt"
    local indicator_pkg="libayatana-appindicator3-1"
    if ! apt-cache show libayatana-appindicator3-1 >/dev/null 2>&1; then
      indicator_pkg="libappindicator3-1"
    fi
    pkgs=(xvfb libwebkit2gtk-4.1-0 libgtk-3-0 librsvg2-2 "$indicator_pkg")
  elif has_cmd dnf && [[ "$combined" =~ [[:space:]](fedora|rhel|centos|almalinux|rocky|nobara)[[:space:]] ]]; then
    pkg_mgr="dnf"
    pkgs=(xorg-x11-server-Xvfb webkit2gtk4.1 gtk3 librsvg2 libappindicator-gtk3)
  elif has_cmd zypper; then
    pkg_mgr="zypper"
    pkgs=(xvfb-run libwebkit2gtk-4_1-0 gtk3 librsvg-2-2 libappindicator3-1)
  elif has_cmd pacman; then
    pkg_mgr="pacman"
    pkgs=(xorg-server-xvfb webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3)
  fi

  if [ -z "$pkg_mgr" ]; then
    warn "Unsupported package manager for automatic dependency install."
    warn "Please install xvfb, GTK3, WebKitGTK 4.1, and librsvg2 manually."
    return 0
  fi

  printf "  ${C_DIM}Packages:${C_RESET} %s\n" "${pkgs[*]}"
  if ! confirm "Install required server runtime packages via ${pkg_mgr}?" "y"; then
    warn "Skipped runtime package installation."
    return 0
  fi

  case "$pkg_mgr" in
    apt)    run_sudo apt-get update -qq && run_sudo apt-get install -y "${pkgs[@]}" ;;
    dnf)    run_sudo dnf install -y "${pkgs[@]}" ;;
    zypper) run_sudo zypper --non-interactive install "${pkgs[@]}" ;;
    pacman) run_sudo pacman -S --needed --noconfirm "${pkgs[@]}" ;;
  esac
  ok "Server runtime dependencies installed."
}

configure_server_firewall() {
  local port="$1"
  if has_cmd ufw && run_sudo ufw status 2>/dev/null | grep -q "Status: active"; then
    if confirm "Open TCP port ${port} in UFW firewall?" "n"; then
      run_sudo ufw allow "${port}/tcp" >/dev/null
      ok "Opened ${port}/tcp in UFW"
      if confirm "Also open UDP port 48951 for local Android LAN discovery?" "n"; then
        run_sudo ufw allow 48951/udp >/dev/null
        ok "Opened 48951/udp in UFW"
      fi
    fi
  elif has_cmd firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
    if confirm "Open TCP port ${port} in firewalld?" "n"; then
      run_sudo firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null
      if confirm "Also open UDP port 48951 for local Android LAN discovery?" "n"; then
        run_sudo firewall-cmd --permanent --add-port=48951/udp >/dev/null
      fi
      run_sudo firewall-cmd --reload >/dev/null
      ok "Updated firewalld rules"
    fi
  fi
}

setup_headless_server() {
  printf "\n"
  printf "  ${C_PURPLE}${C_BOLD}StreamDash${C_RESET} ${C_DIM}· Headless Server Setup Wizard${C_RESET}\n"
  printf "  ${C_DIM}────────────────────────────────────────────${C_RESET}\n"
  printf "  ${C_DIM}System:${C_RESET}   %s (%s)\n" "$DISTRO_NAME" "$ARCH"
  printf "  ${C_DIM}Release:${C_RESET}  ${C_BOLD}%s${C_RESET}\n" "${LATEST_TAG:-unknown}"
  printf "  ${C_DIM}────────────────────────────────────────────${C_RESET}\n\n"

  install_server_dependencies

  printf "\n"
  step "[2/4] Installing StreamDash headless binary..."
  install_binary

  printf "\n"
  step "[3/4] Configuring Headless Web Host..."

  local env_file="$USER_SERVER_ENV"
  local use_system_service=0
  if [ "$(id -u)" -eq 0 ]; then
    use_system_service=1
    env_file="$SYSTEM_SERVER_ENV"
  fi

  local default_port="48950"
  local default_pin=""
  if [ -r "$env_file" ]; then
    # shellcheck disable=SC1090
    . "$env_file" || true
    [ -n "${STREAMDASH_PORT:-}" ] && default_port="$STREAMDASH_PORT"
    [ -n "${STREAMDASH_PIN:-}" ] && default_pin="$STREAMDASH_PIN"
  fi
  [ -n "$SERVER_PORT" ] && default_port="$SERVER_PORT"
  if [ -n "$SERVER_PIN" ]; then
    default_pin="$SERVER_PIN"
  elif [ -z "$default_pin" ]; then
    default_pin="$(generate_random_pin)"
  fi

  local chosen_port="$default_port"
  local chosen_pin="$default_pin"
  if [ "$AUTO_YES" -eq 0 ]; then
    while true; do
      chosen_port="$(prompt_read "  ${C_BOLD}Web Host port${C_RESET} ${C_DIM}[${default_port}]${C_RESET}: " "$default_port")"
      if [[ "$chosen_port" =~ ^[0-9]+$ ]] && [ "$chosen_port" -ge 1024 ] && [ "$chosen_port" -le 65535 ]; then
        break
      fi
      warn "Please enter a valid port between 1024 and 65535."
    done

    while true; do
      chosen_pin="$(prompt_read "  ${C_BOLD}Access PIN / Token${C_RESET} ${C_DIM}[${default_pin}]${C_RESET}: " "$default_pin")"
      chosen_pin="${chosen_pin#"${chosen_pin%%[![:space:]]*}"}"
      chosen_pin="${chosen_pin%"${chosen_pin##*[![:space:]]}"}"
      if [ -n "$chosen_pin" ]; then
        break
      fi
      warn "Access PIN cannot be empty."
    done
  fi

  if [ "$use_system_service" -eq 1 ]; then
    mkdir -p "$(dirname "$env_file")"
  else
    mkdir -p "$(dirname "$env_file")"
  fi
  cat > "$env_file" <<EOF
STREAMDASH_PORT=${chosen_port}
STREAMDASH_PIN=${chosen_pin}
EOF
  chmod 600 "$env_file"
  ok "Saved server config to ${env_file}"

  if [ "$AUTO_YES" -eq 0 ]; then
    configure_server_firewall "$chosen_port"
  fi

  printf "\n"
  step "[4/4] Setting up systemd background service..."

  local xvfb_bin
  xvfb_bin="$(command -v xvfb-run || printf '/usr/bin/xvfb-run')"
  local service_active=0
  local service_kind="none"

  if has_cmd systemctl && [ -d /run/systemd/system ]; then
    if confirm "Install & enable systemd auto-start service?" "y"; then
      if [ "$use_system_service" -eq 1 ]; then
        cat > "$SYSTEM_SYSTEMD_UNIT" <<EOF
[Unit]
Description=StreamDash Headless Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${SYSTEM_SERVER_ENV}
ExecStart=${xvfb_bin} -a ${BIN_FILE} --headless --port \${STREAMDASH_PORT} --pin \${STREAMDASH_PIN}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
        systemctl enable --now streamdash.service
        systemctl restart streamdash.service
        service_active=1
        service_kind="system"
        ok "Enabled & started system service (streamdash.service)"
      else
        mkdir -p "$(dirname "$USER_SYSTEMD_UNIT")"
        cat > "$USER_SYSTEMD_UNIT" <<EOF
[Unit]
Description=StreamDash Headless Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/streamdash/server.env
ExecStart=${xvfb_bin} -a %h/.local/bin/streamdash --headless --port \${STREAMDASH_PORT} --pin \${STREAMDASH_PIN}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
        if has_cmd loginctl; then
          loginctl enable-linger "$USER" >/dev/null 2>&1 || run_sudo loginctl enable-linger "$USER" >/dev/null 2>&1 || true
        fi
        if systemctl --user daemon-reload >/dev/null 2>&1; then
          systemctl --user enable --now streamdash.service
          systemctl --user restart streamdash.service
          service_active=1
          service_kind="user"
          ok "Enabled & started user service (streamdash.service)"
        else
          warn "User systemd bus is not active in this session."
          warn "Start manually or enable user session: systemctl --user enable --now streamdash.service"
        fi
      fi
    fi
  else
    warn "systemd is not running in this environment — skipping service setup."
  fi

  local server_ip
  server_ip="$(detect_primary_ip)"

  printf "\n"
  printf "  ${C_GREEN}✓${C_RESET} ${C_BOLD}StreamDash Headless Server Setup Complete!${C_RESET}\n"
  printf "  ${C_DIM}────────────────────────────────────────────────────────${C_RESET}\n"
  printf "  ${C_DIM}Web URL:${C_RESET}      ${C_BOLD}http://%s:%s${C_RESET}\n" "$server_ip" "$chosen_port"
  printf "  ${C_DIM}Access PIN:${C_RESET}   ${C_BOLD}%s${C_RESET}\n" "$chosen_pin"
  printf "  ${C_DIM}Config File:${C_RESET}  %s\n" "$env_file"
  if [ "$service_kind" = "system" ]; then
    printf "  ${C_DIM}Status:${C_RESET}       ${C_GREEN}Running (systemd system service)${C_RESET}\n"
    printf "  ${C_DIM}Manage:${C_RESET}       systemctl status|restart streamdash\n"
    printf "  ${C_DIM}Logs:${C_RESET}         journalctl -u streamdash -f\n"
  elif [ "$service_kind" = "user" ]; then
    printf "  ${C_DIM}Status:${C_RESET}       ${C_GREEN}Running (systemd user service)${C_RESET}\n"
    printf "  ${C_DIM}Manage:${C_RESET}       systemctl --user status|restart streamdash\n"
    printf "  ${C_DIM}Logs:${C_RESET}         journalctl --user -u streamdash -f\n"
  else
    printf "  ${C_DIM}Run manually:${C_RESET} %s -a %s --headless --port %s --pin %s\n" "$xvfb_bin" "$BIN_FILE" "$chosen_port" "$chosen_pin"
  fi
  if [ "$service_active" -eq 0 ] && [ "$service_kind" = "none" ]; then
    printf "  ${C_DIM}SSH Tunnel:${C_RESET}   ssh -L %s:127.0.0.1:%s %s@%s\n" "$chosen_port" "$chosen_port" "${USER:-user}" "$server_ip"
  fi
  printf "  ${C_DIM}Update:${C_RESET}       curl -fsSL https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh | bash -s -- --update --yes\n"
  printf "  ${C_DIM}────────────────────────────────────────────────────────${C_RESET}\n\n"
}

do_install() {
  local method="$1"
  printf "\n"
  case "$method" in
    deb)      install_deb ;;
    rpm)      install_rpm ;;
    appimage) install_appimage ;;
    binary)   install_binary ;;
    *)        die "Unknown package method: $method" ;;
  esac
  printf "\n"
  ok "${C_BOLD}StreamDash ${LATEST_TAG} is ready!${C_RESET} Launch it from your application menu or run ${C_BOLD}streamdash${C_RESET}."
}

do_update() {
  refresh_installed_state
  local target_method="${FORCED_METHOD:-${INSTALLED_METHOD:-$(detect_recommended_method)}}"

  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ]; then
    printf "\n"
    ok "StreamDash is already up to date (${LATEST_TAG})."
    if ! confirm "Reinstall ${LATEST_TAG} anyway?" "n"; then
      return 0
    fi
  fi

  do_install "$target_method"
  restart_server_services_if_present
}

do_uninstall() {
  refresh_installed_state
  printf "\n"
  if [ -z "$INSTALLED_METHOD" ]; then
    warn "No StreamDash installation was detected."
    return 0
  fi

  if ! confirm "Uninstall StreamDash (${INSTALLED_METHOD})?" "y"; then
    step "Uninstall cancelled."
    return 0
  fi

  remove_server_services

  case "$INSTALLED_METHOD" in
    deb)
      step "Removing .deb package (requires sudo)..."
      run_sudo apt-get remove -y streamdash
      ok "Removed StreamDash (.deb)"
      ;;
    rpm)
      step "Removing .rpm package (requires sudo)..."
      if has_cmd dnf; then
        run_sudo dnf remove -y streamdash
      elif has_cmd zypper; then
        run_sudo zypper --non-interactive remove streamdash
      else
        run_sudo rpm -e streamdash
      fi
      ok "Removed StreamDash (.rpm)"
      ;;
    appimage)
      step "Removing AppImage and desktop shortcut..."
      rm -f "$APPIMAGE_PATH" "$BIN_LINK" "$DESKTOP_FILE" "$ICON_FILE"
      rmdir "$(dirname "$APPIMAGE_PATH")" 2>/dev/null || true
      has_cmd update-desktop-database && update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
      ok "Removed StreamDash (AppImage)"
      ;;
    binary)
      step "Removing raw binary and shortcut..."
      rm -f "$BIN_FILE" "$BIN_LINK" "$DESKTOP_FILE" "$ICON_FILE"
      rmdir "$BIN_INSTALL_DIR" 2>/dev/null || true
      rmdir "$(dirname "$BIN_INSTALL_DIR")" 2>/dev/null || true
      has_cmd update-desktop-database && update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
      ok "Removed StreamDash (binary)"
      ;;
  esac

  rm -rf "$STATE_DIR"

  if confirm "Keep your StreamDash profiles, settings & local history?" "y"; then
    ok "User data preserved."
  else
    rm -rf "${HOME}/.local/share/com.tenkayro.streamdash" \
           "${HOME}/.config/com.tenkayro.streamdash" \
           "${HOME}/.cache/com.tenkayro.streamdash" \
           "${HOME}/.local/share/dev.streamdash.desktop" \
           "${HOME}/.config/dev.streamdash.desktop" \
           "${HOME}/.cache/dev.streamdash.desktop" \
           "${HOME}/.local/share/StreamDash" \
           "${HOME}/.config/streamdash"
    if [ "$(id -u)" -eq 0 ]; then
      rm -rf "/etc/streamdash"
    fi
    ok "Removed local user data."
  fi
}

# ── Terminal UI ────────────────────────────────────────────────────────────────
print_header() {
  local method="$1"
  local status_text="${C_DIM}Not installed${C_RESET}"
  if [ -n "$INSTALLED_METHOD" ]; then
    status_text="${C_GREEN}Installed${C_RESET} (${INSTALLED_VERSION}, ${INSTALLED_METHOD})"
  fi

  printf "\n"
  printf "  ${C_PURPLE}${C_BOLD}%s${C_RESET} ${C_DIM}· Linux Installer${C_RESET}\n" "$APP_NAME"
  printf "  ${C_DIM}────────────────────────────────────────────${C_RESET}\n"
  printf "  ${C_DIM}System:${C_RESET}   %s (%s)\n" "$DISTRO_NAME" "$ARCH"
  printf "  ${C_DIM}Package:${C_RESET}  ${C_BOLD}%s${C_RESET} ${C_DIM}(auto-detected)${C_RESET}\n" "$method"
  printf "  ${C_DIM}Status:${C_RESET}   %s\n" "$status_text"
  printf "  ${C_DIM}Latest:${C_RESET}   ${C_BOLD}%s${C_RESET}\n" "${LATEST_TAG:-unknown}"
  printf "  ${C_DIM}────────────────────────────────────────────${C_RESET}\n"
}

run_menu() {
  local rec_method="$1"
  print_header "$rec_method"

  local install_label="Install StreamDash Desktop (${rec_method})"
  [ -n "$INSTALLED_METHOD" ] && install_label="Reinstall / Repair Desktop (${rec_method})"

  printf "\n"
  printf "  ${C_BOLD}1)${C_RESET} %s\n" "$install_label"
  printf "  ${C_BOLD}2)${C_RESET} Headless Server Setup Wizard (systemd + xvfb + Web Host)\n"
  printf "  ${C_BOLD}3)${C_RESET} Update to latest (${LATEST_TAG})\n"
  printf "  ${C_BOLD}4)${C_RESET} Switch package format (deb / rpm / appimage / binary)\n"
  printf "  ${C_BOLD}5)${C_RESET} Uninstall StreamDash\n"
  printf "  ${C_BOLD}6)${C_RESET} Quit\n\n"

  local choice
  choice="$(prompt_read "  ${C_BOLD}Select an option [1-6]:${C_RESET} " "1")"

  case "$choice" in
    1) do_install "$rec_method" ;;
    2) setup_headless_server ;;
    3) do_update ;;
    4)
      printf "\n"
      printf "  ${C_BOLD}1)${C_RESET} .deb (Debian / Ubuntu / Mint)\n"
      printf "  ${C_BOLD}2)${C_RESET} .rpm (Fedora / RHEL / openSUSE)\n"
      printf "  ${C_BOLD}3)${C_RESET} .AppImage (Universal GUI · self-contained)\n"
      printf "  ${C_BOLD}4)${C_RESET} Raw binary (.tar.gz · Headless / Server / Universal)\n\n"
      local fmt
      fmt="$(prompt_read "  ${C_BOLD}Choose format [1-4]:${C_RESET} " "3")"
      case "$fmt" in
        1) do_install "deb" ;;
        2) do_install "rpm" ;;
        3) do_install "appimage" ;;
        4) do_install "binary" ;;
        *) die "Invalid selection." ;;
      esac
      ;;
    5) do_uninstall ;;
    6|q|Q) printf "\n  ${C_DIM}Bye.${C_RESET}\n\n" ;;
    *) die "Invalid selection: ${choice}" ;;
  esac
}

# ── Main ───────────────────────────────────────────────────────────────────────
refresh_installed_state
RECOMMENDED_METHOD="$(detect_recommended_method)"

if [ "$ACTION" != "uninstall" ]; then
  fetch_latest_release
fi

case "$ACTION" in
  install)   do_install "$RECOMMENDED_METHOD" ;;
  server)    setup_headless_server ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  "")
    if [ ! -t 0 ] && [ ! -r /dev/tty ]; then
      # Non-interactive pipe without TTY: perform recommended install automatically
      do_install "$RECOMMENDED_METHOD"
    else
      run_menu "$RECOMMENDED_METHOD"
    fi
    ;;
esac
