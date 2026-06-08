#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export AUTO_CONTINUE_PAUSES=1
export KEEP_BROWSER_OPEN=1

echo "AUTO_CONTINUE_PAUSES=$AUTO_CONTINUE_PAUSES"
echo "KEEP_BROWSER_OPEN=$KEEP_BROWSER_OPEN"
echo "Running real China flow to manual final submit, then payment autofill and final Pay click..."

pnpm run run -- --site config/site.json --applicant config/applicant.json

echo
echo "The browser is configured to stay open for manual takeover."
read -r -p "Press Enter to close this window..."
