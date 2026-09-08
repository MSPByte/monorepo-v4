#!/usr/bin/env bash
# MSPByte Agent Core — macOS daemon installer
# Usage: sudo bash install_agent_core.sh --server-url https://agents.mspbyte.com --org-id <org-id> --token <enrollment-token>
set -euo pipefail

SERVER_URL=""
ORG_ID=""
ENROLLMENT_TOKEN=""
BINARY_URL=""
INSTALL_BIN="/usr/local/bin/agent-core"
CONFIG_DIR="/Library/Application Support/MSPAgent"
PLIST_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/com.mspbyte.agentcore.plist"
PLIST_DEST="/Library/LaunchDaemons/com.mspbyte.agentcore.plist"
LABEL="com.mspbyte.agentcore"
LOG_DIR="$CONFIG_DIR/logs"
LOG_FILE="$LOG_DIR/install.log"

ilog() {
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "$@"
  mkdir -p "$LOG_DIR"
  echo "[$ts] $*" >> "$LOG_FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url)  SERVER_URL="$2";       shift 2 ;;
    --org-id)      ORG_ID="$2";           shift 2 ;;
    --token)       ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --binary-url)  BINARY_URL="$2";       shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

[[ -z "$SERVER_URL" ]]       && { echo "Error: --server-url required"; exit 1; }
[[ -z "$ORG_ID" ]]           && { echo "Error: --org-id required"; exit 1; }
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

ilog "=== MSPByte Agent Core install — $(date -u) ==="
ilog "  server:   $SERVER_URL"
ilog "  platform: $PLATFORM"

# Stop existing daemon
launchctl bootout system "$PLIST_DEST" 2>/dev/null && ilog "Stopped existing daemon" || true

# Download binary
TMP=$(mktemp)
ilog "Downloading binary..."
curl -fsSL "$BINARY_URL" -o "$TMP"
chmod 755 "$TMP"
mv "$TMP" "$INSTALL_BIN"
ilog "Binary installed to $INSTALL_BIN"

# Write config (preserve existing)
mkdir -p "$CONFIG_DIR"
if [[ ! -f "$CONFIG_DIR/config.toml" ]]; then
  cat >"$CONFIG_DIR/config.toml" <<TOML
[agent]
server_url = "$SERVER_URL"
org_id = "$ORG_ID"
enrollment_token = "$ENROLLMENT_TOKEN"
TOML
  ilog "Wrote $CONFIG_DIR/config.toml"
else
  ilog "Preserved existing $CONFIG_DIR/config.toml"
fi

# Install launchd plist
cp "$PLIST_SRC" "$PLIST_DEST"
chown root:wheel "$PLIST_DEST"
chmod 644 "$PLIST_DEST"

launchctl bootstrap system "$PLIST_DEST"
ilog "Daemon bootstrapped via launchd"
ilog "=== install complete ==="

echo "Agent Core daemon installed and started."
launchctl print system/"$LABEL" 2>/dev/null | grep -E 'state|pid' || true
