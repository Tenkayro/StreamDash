#!/usr/bin/env bash
set -euo pipefail

# StreamDash Linux Installer
# Usage: curl -fsSL https://tenkayro.de/sh/streamdash.sh | bash
#    or: ./install.sh [--install | --update | --uninstall] [--method deb|rpm|appimage] [--yes]

REPO="Tenkayro/StreamDash"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
ICON_FALLBACK_URL="https://raw.githubusercontent.com/${REPO}/main/src-tauri/icons/128x128.png"

APP_NAME="StreamDash"
BIN_NAME="streamdash"
APPIMAGE_PATH="${HOME}/.local/share/StreamDash/StreamDash.AppImage"
BIN_LINK="${HOME}/.local/bin/streamdash"
DESKTOP_FILE="${HOME}/.local/share/applications/streamdash.desktop"
ICON_FILE="${HOME}/.local/share/icons/hicolor/128x128/apps/streamdash.png"
STATE_DIR="${HOME}/.local/share/streamdash-installer"
STATE_FILE="${STATE_DIR}/state"

AUTO_YES=0
ACTION=""
FORCED_METHOD=""
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
    --update)    ACTION="update" ;;
    --uninstall) ACTION="uninstall" ;;
    --yes|-y)    AUTO_YES=1 ;;
    --method)
      shift
      FORCED_METHOD="${1:-}"
      ;;
    --help|-h)
      cat <<EOF
StreamDash Linux Installer

Usage:
  curl -fsSL https://tenkayro.de/sh/streamdash.sh | bash
  ./install.sh [OPTIONS]

Options:
  --install            Install StreamDash non-interactively
  --update             Update StreamDash to the latest release
  --uninstall          Uninstall StreamDash
  --method <type>      Force package type: deb, rpm, or appimage
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
      deb|rpm|appimage) printf "%s" "${FORCED_METHOD,,}"; return ;;
      *) die "Invalid method '${FORCED_METHOD}'. Choose deb, rpm, or appimage." ;;
    esac
  fi

  # Immutable Fedora/openSUSE variants work best with AppImage
  if has_cmd rpm-ostree || has_cmd transactional-update; then
    printf "appimage"
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
  else
    printf "appimage"
  fi
}

# ── Installed State Detection ──────────────────────────────────────────────────
INSTALLED_METHOD=""
INSTALLED_VERSION=""

refresh_installed_state() {
  INSTALLED_METHOD=""
  INSTALLED_VERSION=""

  if has_cmd dpkg-query && dpkg-query -W -f='${Status}\n' streamdash 2>/dev/null | grep -q "install ok installed"; then
    INSTALLED_METHOD="deb"
    INSTALLED_VERSION="$(dpkg-query -W -f='${Version}' streamdash 2>/dev/null || true)"
  elif has_cmd rpm && rpm -q streamdash >/dev/null 2>&1; then
    INSTALLED_METHOD="rpm"
    INSTALLED_VERSION="$(rpm -q --qf '%{VERSION}' streamdash 2>/dev/null || true)"
  elif [ -f "$APPIMAGE_PATH" ]; then
    INSTALLED_METHOD="appimage"
    if [ -r "$STATE_FILE" ]; then
      # shellcheck disable=SC1090
      . "$STATE_FILE" || true
      INSTALLED_VERSION="${STATE_VERSION:-unknown}"
    else
      INSTALLED_VERSION="installed"
    fi
  fi
}

# ── GitHub Release Lookup ──────────────────────────────────────────────────────
LATEST_TAG=""
LATEST_VERSION=""
URL_DEB=""
URL_RPM=""
URL_APPIMAGE=""

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
print(f"LATEST_TAG={shlex.quote(tag)}")
print(f"LATEST_VERSION={shlex.quote(ver)}")
print(f"URL_DEB={shlex.quote(deb)}")
print(f"URL_RPM={shlex.quote(rpm)}")
print(f"URL_APPIMAGE={shlex.quote(app)}")
' <<< "$json")"
  else
    LATEST_TAG="$(printf "%s" "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    LATEST_VERSION="${LATEST_TAG#v}"
    LATEST_VERSION="${LATEST_VERSION#V}"
    URL_DEB="$(printf "%s" "$json" | grep -oE 'https://[^"]+\.deb' | head -n1 || true)"
    URL_RPM="$(printf "%s" "$json" | grep -oE 'https://[^"]+\.rpm' | head -n1 || true)"
    URL_APPIMAGE="$(printf "%s" "$json" | grep -oE 'https://[^"]+\.AppImage' | head -n1 || true)"
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
  elif has_cmd sudo; then
    sudo "$@"
  else
    die "Administrator privileges (sudo) are required for system package installation. Try --method appimage instead."
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

install_appimage() {
  [ -n "$URL_APPIMAGE" ] || die "No .AppImage asset found in release ${LATEST_TAG}."
  TMP_DIR="$(mktemp -d)"
  local tmp_app="${TMP_DIR}/StreamDash.AppImage"

  step "Downloading universal AppImage (${LATEST_TAG})..."
  download_file "$URL_APPIMAGE" "$tmp_app"
  chmod +x "$tmp_app"
  ok "Downloaded $(basename "$URL_APPIMAGE")"

  step "Installing binary and desktop launcher..."
  mkdir -p "$(dirname "$APPIMAGE_PATH")" "$(dirname "$BIN_LINK")" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")" "$STATE_DIR"
  mv -f "$tmp_app" "$APPIMAGE_PATH"
  chmod +x "$APPIMAGE_PATH"
  ln -sf "$APPIMAGE_PATH" "$BIN_LINK"

  # Download official icon for desktop launcher
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

  printf "STATE_METHOD=appimage\nSTATE_VERSION=%s\n" "$LATEST_VERSION" > "$STATE_FILE"
  ok "Installed StreamDash ${LATEST_TAG} to ${APPIMAGE_PATH}"
  ok "Created desktop shortcut (${DESKTOP_FILE})"

  if [[ ":${PATH}:" != *":${HOME}/.local/bin:"* ]]; then
    warn "~/.local/bin is not in your PATH. Add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell profile, or launch from your app menu."
  fi
}

do_install() {
  local method="$1"
  printf "\n"
  case "$method" in
    deb)      install_deb ;;
    rpm)      install_rpm ;;
    appimage) install_appimage ;;
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
  esac

  rm -rf "$STATE_DIR"

  if confirm "Keep your StreamDash profiles, settings & local history?" "y"; then
    ok "User data preserved."
  else
    rm -rf "${HOME}/.local/share/com.tenkayro.streamdash" \
           "${HOME}/.config/com.tenkayro.streamdash" \
           "${HOME}/.cache/com.tenkayro.streamdash" \
           "${HOME}/.local/share/StreamDash"
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

  local install_label="Install StreamDash (${rec_method})"
  [ -n "$INSTALLED_METHOD" ] && install_label="Reinstall / Repair (${rec_method})"

  printf "\n"
  printf "  ${C_BOLD}1)${C_RESET} %s\n" "$install_label"
  printf "  ${C_BOLD}2)${C_RESET} Update to latest (${LATEST_TAG})\n"
  printf "  ${C_BOLD}3)${C_RESET} Switch package format (deb / rpm / appimage)\n"
  printf "  ${C_BOLD}4)${C_RESET} Uninstall StreamDash\n"
  printf "  ${C_BOLD}5)${C_RESET} Quit\n\n"

  local choice
  choice="$(prompt_read "  ${C_BOLD}Select an option [1-5]:${C_RESET} " "1")"

  case "$choice" in
    1) do_install "$rec_method" ;;
    2) do_update ;;
    3)
      printf "\n"
      printf "  ${C_BOLD}1)${C_RESET} .deb (Debian / Ubuntu / Mint)\n"
      printf "  ${C_BOLD}2)${C_RESET} .rpm (Fedora / RHEL / openSUSE)\n"
      printf "  ${C_BOLD}3)${C_RESET} .AppImage (Universal · built-in updates)\n\n"
      local fmt
      fmt="$(prompt_read "  ${C_BOLD}Choose format [1-3]:${C_RESET} " "3")"
      case "$fmt" in
        1) do_install "deb" ;;
        2) do_install "rpm" ;;
        3) do_install "appimage" ;;
        *) die "Invalid selection." ;;
      esac
      ;;
    4) do_uninstall ;;
    5|q|Q) printf "\n  ${C_DIM}Bye.${C_RESET}\n\n" ;;
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
