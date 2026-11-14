#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_REPO="arosyihuddin/toolsmith-mcp"
BRANCH="${TOOLSMITH_BRANCH:-main}"
TMP_ROOT="$(mktemp -d)"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

info() { printf '[toolsmith] %s\n' "$*"; }
fail() { printf '[toolsmith] error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "The one-line installer currently supports Linux only."
command -v systemctl >/dev/null 2>&1 || fail "systemd is required."
[[ -d /run/systemd/system ]] || fail "systemd is not running. Toolsmith requires a systemd-based Linux host."

# SSH sessions may not have a systemd user manager. Enable lingering so the
# manager can run without a desktop or an active login session.
USER_ID="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$USER_ID}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

if ! systemctl --user show-environment >/dev/null 2>&1; then
  command -v loginctl >/dev/null 2>&1 || fail "loginctl is required to initialize the systemd user manager."
  command -v sudo >/dev/null 2>&1 || fail "The systemd user manager is unavailable. Ask an administrator to run: loginctl enable-linger '$USER'."
  info "Systemd user manager is unavailable. Enabling lingering for '$USER'..."
  sudo loginctl enable-linger "$USER" || fail "Could not enable lingering for '$USER'. Ensure this account has sudo permission, or ask an administrator to run: loginctl enable-linger '$USER'."
  sudo systemctl start "user@$USER_ID.service" || fail "Could not start the systemd user manager for '$USER'."
  for attempt in {1..10}; do
    systemctl --user show-environment >/dev/null 2>&1 && break
    sleep 1
  done
fi

systemctl --user show-environment >/dev/null 2>&1 || fail "The systemd user manager is still unavailable. Check /run/user/$USER_ID/bus and lingering for '$USER'."

case "$(uname -m)" in
  x86_64|aarch64|arm64) ;;
  *) fail "Unsupported architecture: $(uname -m). Supported: x86_64 and ARM64." ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required. Install curl and retry."
command -v tar >/dev/null 2>&1 || fail "tar is required. Install tar and retry."
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail "sha256sum (or shasum) is required to verify release downloads."

if ! command -v bun >/dev/null 2>&1; then
  info "Bun was not found. Installing Bun for the current user..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || fail "Bun installation failed. Install it from https://bun.sh/."

mkdir -p "$TMP_ROOT/toolsmith"
if [[ "$BRANCH" == "main" ]]; then
  # Official installs use the latest stable GitHub Release artifact,
  # verified against its published SHA-256 checksum. No git needed.
  RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$RELEASE_REPO/releases/latest")"
  TAG="$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//' || true)"
  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] || fail "Could not determine the latest stable release tag."
  VERSION="${TAG#v}"
  info "Downloading Toolsmith $TAG..."
  curl -fsSL "https://github.com/$RELEASE_REPO/releases/download/$TAG/toolsmith-$VERSION.tar.gz" -o "$TMP_ROOT/toolsmith-$VERSION.tar.gz"
  curl -fsSL "https://github.com/$RELEASE_REPO/releases/download/$TAG/SHA256SUMS" -o "$TMP_ROOT/SHA256SUMS"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TMP_ROOT" && sha256sum --check SHA256SUMS)
  else
    (cd "$TMP_ROOT" && shasum -a 256 --check SHA256SUMS)
  fi
  tar -xzf "$TMP_ROOT/toolsmith-$VERSION.tar.gz" -C "$TMP_ROOT/toolsmith"
else
  # Explicit branch overrides are development installs from that source tree.
  info "Downloading Toolsmith ($BRANCH)..."
  curl -fsSL "https://codeload.github.com/$RELEASE_REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP_ROOT/branch.tar.gz"
  tar -xzf "$TMP_ROOT/branch.tar.gz" -C "$TMP_ROOT/toolsmith" --strip-components=1
fi

info "Starting per-user installation..."
bun run "$TMP_ROOT/toolsmith/src/cli.ts" install "$TMP_ROOT/toolsmith"

info "Installation finished."
SHELL_NAME="${SHELL##*/}"
case "$SHELL_NAME" in
  bash)
    RELOAD_COMMAND="source ~/.bashrc"
    ;;
  zsh)
    RELOAD_COMMAND="source ~/.zshrc"
    ;;
  fish)
    RELOAD_COMMAND="source ~/.config/fish/config.fish"
    ;;
  *)
    RELOAD_COMMAND=""
    ;;
esac

if [[ -n "$RELOAD_COMMAND" ]]; then
  printf '[toolsmith] To activate PATH in your current session, run:\n'
  printf '  %s\n' "$RELOAD_COMMAND"
  printf '[toolsmith] Then run: toolsmith status\n'
else
  printf '[toolsmith] Could not detect your shell (%s). Add ~/.local/bin to PATH, then run: toolsmith status\n' "${SHELL_NAME:-unknown}"
fi
printf '[toolsmith] Or run immediately with: %s\n' "$HOME/.local/bin/toolsmith status"
