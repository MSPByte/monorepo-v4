#!/usr/bin/env bash
# MSPByte Agent Core — macOS daemon uninstaller
set -euo pipefail

[[ $EUID -ne 0 ]] && { echo "Error: run as root (sudo)"; exit 1; }

PLIST_DEST="/Library/LaunchDaemons/com.mspbyte.agentcore.plist"

launchctl bootout system "$PLIST_DEST" 2>/dev/null || true
rm -f "$PLIST_DEST"
rm -f /usr/local/bin/agent-core

# Preserve config.toml and state.json
echo "Agent Core daemon uninstalled. Config preserved at '/Library/Application Support/MSPAgent/config.toml'"
