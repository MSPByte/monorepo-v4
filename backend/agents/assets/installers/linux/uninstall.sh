#!/usr/bin/env bash
# MSPByte Agent Core — Linux uninstaller
set -euo pipefail

[[ $EUID -ne 0 ]] && { echo "Error: run as root"; exit 1; }

systemctl stop mspagent-core  2>/dev/null || true
systemctl disable mspagent-core 2>/dev/null || true
rm -f /etc/systemd/system/mspagent-core.service
systemctl daemon-reload

rm -f /usr/local/bin/agent-core

# Preserve config.toml and state.json so re-enrollment isn't needed on reinstall.
echo "Agent Core uninstalled. Config preserved at /etc/mspagent/config.toml"
