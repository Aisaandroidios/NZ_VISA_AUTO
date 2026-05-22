#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building portable package..."
pnpm run package:portable

echo
echo "Portable package build finished."
echo "Check release/LATEST-PORTABLE-ZIP.txt for the newest zip path."
read -r -p "Press Enter to close this window..."
