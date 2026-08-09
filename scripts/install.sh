#!/bin/sh
# Forge CLI installer — https://github.com/crucibledx/forge-cli
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/crucibledx/forge-cli/main/scripts/install.sh | sh
#
# Options (env vars):
#   FORGE_VERSION   — specific version to install (default: latest)
#   FORGE_INSTALL   — installation directory (default: /usr/local/bin)

set -eu

REPO="crucibledx/forge-cli"
INSTALL_DIR="${FORGE_INSTALL:-/usr/local/bin}"
BINARY="forge"

# ── Helpers ────────────────────────────────────────────────────────

info()  { printf '\033[1;34m→\033[0m %s\n' "$1"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
err()   { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) err "Unsupported OS: $(uname -s). Download manually from https://github.com/${REPO}/releases" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) err "Unsupported architecture: $(uname -m). Download manually from https://github.com/${REPO}/releases" ;;
  esac
}

get_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
  else
    err "Neither curl nor wget found. Install one and try again."
  fi
}

download() {
  url="$1"; dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  fi
}

# ── Main ───────────────────────────────────────────────────────────

main() {
  OS="$(detect_os)"
  ARCH="$(detect_arch)"
  VERSION="${FORGE_VERSION:-$(get_latest_version)}"

  [ -z "$VERSION" ] && err "Could not determine latest version."

  info "Installing Forge CLI v${VERSION} (${OS}/${ARCH})"

  ASSET="${BINARY}-${OS}-${ARCH}"
  if [ "$OS" = "windows" ]; then
    URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}.zip"
  else
    URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}.tar.gz"
  fi

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  info "Downloading ${URL}"
  if [ "$OS" = "windows" ]; then
    download "$URL" "${TMP}/${ASSET}.zip"
    unzip -qo "${TMP}/${ASSET}.zip" -d "$TMP"
  else
    download "$URL" "${TMP}/${ASSET}.tar.gz"
    tar xzf "${TMP}/${ASSET}.tar.gz" -C "$TMP"
  fi

  info "Installing to ${INSTALL_DIR}/${BINARY}"
  if [ -w "$INSTALL_DIR" ]; then
    mv "${TMP}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
    chmod +x "${INSTALL_DIR}/${BINARY}"
  else
    sudo mv "${TMP}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
    sudo chmod +x "${INSTALL_DIR}/${BINARY}"
  fi

  ok "Forge CLI v${VERSION} installed successfully!"
  echo ""
  echo "  Run 'forge --version' to verify."
  echo "  Get started: forge init"
  echo ""

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo "  ⚠  ${INSTALL_DIR} is not in your PATH. Add it:"
    echo "     export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
  fi
}

main
