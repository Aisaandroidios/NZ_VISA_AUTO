#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building licensed user package..."
echo

if [ ! -f ".secrets/license-private.pem" ]; then
  echo "Missing .secrets/license-private.pem"
  echo "Run this once first:"
  echo "  pnpm run license:init"
  echo
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -f "config/applicant.json" ]; then
  echo "Missing config/applicant.json"
  echo "Fill the customer's applicant information first."
  echo
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Step 1/2: issuing license for config/applicant.json..."
pnpm run license:issue -- --applicant config/applicant.json

echo
echo "Step 2/2: packaging licensed runtime zip..."
pnpm run package:licensed

echo
echo "Licensed package build finished."
echo "Latest zip:"
cat release/LATEST-PORTABLE-ZIP.txt
echo
read -r -p "Press Enter to close..."
