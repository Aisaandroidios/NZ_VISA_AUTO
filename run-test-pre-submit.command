#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export AUTO_CONTINUE_PAUSES=1
export KEEP_BROWSER_OPEN=1

echo "AUTO_CONTINUE_PAUSES=$AUTO_CONTINUE_PAUSES"
echo "KEEP_BROWSER_OPEN=$KEEP_BROWSER_OPEN"
echo "Running the single supported test flow (Germany) to manual final submit, then payment page autofill; final Pay is not clicked..."

pnpm run run -- --site config/site.germany.json --applicant config/applicant.json

echo
echo "The browser is configured to stay open for manual takeover."
read -r -p "Press Enter to close this window..."
