#!/usr/bin/env bash
# Build agent-core for the current platform and copy the binary to
# backend/agents/assets/binaries/ so the download endpoint can serve it.
#
# Usage:
#   bash apps/agent-core/build-release.sh [version]
#
# If [version] is omitted, reads from Cargo.toml (bin/agent-core/Cargo.toml).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASSETS_DIR="$REPO_ROOT/backend/agents/assets/binaries"

# Resolve version.
if [[ "${1:-}" != "" ]]; then
  VERSION="$1"
else
  VERSION="$(grep '^version' "$SCRIPT_DIR/bin/agent-core/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/')"
fi

# Detect platform slug matching what the agent sends.
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)  PLATFORM="linux-x86_64" ;;
      aarch64) PLATFORM="linux-aarch64" ;;
      *)       echo "Unsupported arch: $ARCH"; exit 1 ;;
    esac
    EXT=""
    ;;
  Darwin)
    case "$ARCH" in
      x86_64) PLATFORM="darwin-x86_64" ;;
      arm64)  PLATFORM="darwin-aarch64" ;;
      *)      echo "Unsupported arch: $ARCH"; exit 1 ;;
    esac
    EXT=""
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    PLATFORM="windows-x86_64"
    EXT=".exe"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

echo "Building agent-core v$VERSION for $PLATFORM..."

# Build from the Cargo workspace root.
(cd "$SCRIPT_DIR" && cargo build --release -p agent-core)

SRC="$SCRIPT_DIR/target/release/agent-core${EXT}"
DEST="$ASSETS_DIR/agent-core-${PLATFORM}-${VERSION}${EXT}"

mkdir -p "$ASSETS_DIR"
cp "$SRC" "$DEST"

echo "Copied binary → $DEST"
