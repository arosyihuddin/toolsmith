#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="https://github.com/arosyihuddin/toolsmith.git"
BRANCH="main"
TMP_ROOT="$(mktemp -d)"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

info() { printf '[toolsmith] %s\n' "$*"; }
fail() { printf '[toolsmith] error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "The one-line installer currently supports Linux only."
command -v systemctl >/dev/null 2>&1 || fail "systemd is required."
systemctl --user show-environment >/dev/null 2>&1 || fail "No active systemd user session. Log in to your desktop/user session and retry."

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
bun run "$TMP_ROOT/toolsmith/src/cli.ts" install "$TMP_ROOT/toolsmith"

info "Installation finished."
printf 'Run: %s\n' "toolsmith status"
