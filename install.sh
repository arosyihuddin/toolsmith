#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="https://github.com/arosyihuddin/toolsmith-mcp.git"
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
command -v git >/dev/null 2>&1 || fail "Git is required. Install git and retry."

if ! command -v bun >/dev/null 2>&1; then
  info "Bun was not found. Installing Bun for the current user..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || fail "Bun installation failed. Install it from https://bun.sh/."

info "Downloading Toolsmith ($BRANCH)..."
git clone --quiet --depth 1 --branch "$BRANCH" "$REPOSITORY" "$TMP_ROOT/toolsmith"

info "Starting per-user installation..."
if [[ "$BRANCH" == "main" ]]; then
  # The bootstrap CLI itself comes from main, but the installed application
  # starts from the latest official stable GitHub Release.
  (cd "$TMP_ROOT" && bun run "$TMP_ROOT/toolsmith/src/cli.ts" install)
else
  # Explicit branch overrides are development installs from that source tree.
  bun run "$TMP_ROOT/toolsmith/src/cli.ts" install "$TMP_ROOT/toolsmith"
fi

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
