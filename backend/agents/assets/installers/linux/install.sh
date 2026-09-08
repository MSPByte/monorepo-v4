#!/usr/bin/env bash
# MSPByte Agent Core — Linux installer
# Usage: sudo bash install.sh --server-url https://agents.mspbyte.com --org-id <org-id> --token <enrollment-token>
set -euo pipefail

BINARY_URL=""
SERVER_URL=""
ORG_ID=""
ENROLLMENT_TOKEN=""
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/mspagent"
SERVICE_NAME="mspagent-core"
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
    --server-url)   SERVER_URL="$2";        shift 2 ;;
    --org-id)       ORG_ID="$2";            shift 2 ;;
    --token)        ENROLLMENT_TOKEN="$2";  shift 2 ;;
    --binary-url)   BINARY_URL="$2";        shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

[[ -z "$SERVER_URL" ]]        && { echo "Error: --server-url required"; exit 1; }
[[ -z "$ORG_ID" ]]            && { echo "Error: --org-id required"; exit 1; }
[[ -z "$ENROLLMENT_TOKEN" ]]  && { echo "Error: --token required"; exit 1; }
[[ $EUID -ne 0 ]]             && { echo "Error: run as root"; exit 1; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  PLATFORM="linux-x86_64" ;;
  aarch64) PLATFORM="linux-aarch64" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Determine binary URL if not supplied
if [[ -z "$BINARY_URL" ]]; then
  # Query the server for the latest version
  LATEST=$(curl -fsSL "$SERVER_URL/v2.0/updates/latest" 2>/dev/null | grep -oP '"latest_version"\s*:\s*"\K[^"]+' || echo "")
  if [[ -z "$LATEST" ]]; then
    echo "Warning: could not determine latest version; using bundled binary from download endpoint"
    BINARY_URL="$SERVER_URL/downloads/linux/agent-core/$PLATFORM"
  else
    BINARY_URL="$SERVER_URL/v2.0/updates/download/$PLATFORM/$LATEST"
  fi
fi

ilog "=== MSPByte Agent Core install — $(date -u) ==="
ilog "  server:   $SERVER_URL"
ilog "  platform: $PLATFORM"
ilog "  binary:   $BINARY_URL"

# Stop existing service
systemctl stop "$SERVICE_NAME" 2>/dev/null && ilog "Stopped existing service" || true

# Download binary
TMP=$(mktemp)
ilog "Downloading binary..."
curl -fsSL "$BINARY_URL" -o "$TMP"
chmod 755 "$TMP"
mv "$TMP" "$INSTALL_DIR/agent-core"
ilog "Binary installed to $INSTALL_DIR/agent-core"

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

# Install systemd unit
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/mspagent-core.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
ilog "Service enabled and started"
ilog "=== install complete ==="

echo "Agent Core installed and started."
systemctl status "$SERVICE_NAME" --no-pager || true
