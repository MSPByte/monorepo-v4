#!/usr/bin/env bash
# MSPByte Agent Core — macOS daemon installer
# Usage: sudo bash install_agent_core.sh --server-url https://agents.mspbyte.com --token <enrollment-token>
set -euo pipefail

SERVER_URL=""
ENROLLMENT_TOKEN=""
BINARY_URL=""
INSTALL_BIN="/usr/local/bin/agent-core"
CONFIG_DIR="/Library/Application Support/MSPAgent"
PLIST_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/com.mspbyte.agentcore.plist"
PLIST_DEST="/Library/LaunchDaemons/com.mspbyte.agentcore.plist"
LABEL="com.mspbyte.agentcore"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url)  SERVER_URL="$2";       shift 2 ;;
    --token)       ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --binary-url)  BINARY_URL="$2";       shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

[[ -z "$SERVER_URL" ]]       && { echo "Error: --server-url required"; exit 1; }
[[ -z "$ENROLLMENT_TOKEN" ]] && { echo "Error: --token required"; exit 1; }
[[ $EUID -ne 0 ]]            && { echo "Error: run as root (sudo)"; exit 1; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  PLATFORM="darwin-x86_64" ;;
  arm64)   PLATFORM="darwin-aarch64" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

if [[ -z "$BINARY_URL" ]]; then
  BINARY_URL="$SERVER_URL/downloads/darwin/agent-core/$PLATFORM"
fi

echo "Installing MSPByte Agent Core (daemon)"
echo "  Server:   $SERVER_URL"
echo "  Platform: $PLATFORM"

# Stop existing daemon
launchctl bootout system "$PLIST_DEST" 2>/dev/null || true

# Download binary
TMP=$(mktemp)
curl -fsSL "$BINARY_URL" -o "$TMP"
chmod 755 "$TMP"
mv "$TMP" "$INSTALL_BIN"

# Write config (preserve existing)
mkdir -p "$CONFIG_DIR"
if [[ ! -f "$CONFIG_DIR/config.toml" ]]; then
  cat >"$CONFIG_DIR/config.toml" <<TOML
[agent]
server_url = "$SERVER_URL"
enrollment_token = "$ENROLLMENT_TOKEN"
TOML
  echo "Wrote $CONFIG_DIR/config.toml"
fi

# Install launchd plist
cp "$PLIST_SRC" "$PLIST_DEST"
chown root:wheel "$PLIST_DEST"
chmod 644 "$PLIST_DEST"

launchctl bootstrap system "$PLIST_DEST"

echo "Agent Core daemon installed and started."
launchctl print system/"$LABEL" 2>/dev/null | grep -E 'state|pid' || true
