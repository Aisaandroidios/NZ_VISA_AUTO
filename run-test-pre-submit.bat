@echo off
setlocal

cd /d "%~dp0"

set "AUTO_CONTINUE_PAUSES=1"
set "KEEP_BROWSER_OPEN=1"

echo AUTO_CONTINUE_PAUSES=%AUTO_CONTINUE_PAUSES%
echo KEEP_BROWSER_OPEN=%KEEP_BROWSER_OPEN%
echo Running the single supported test flow (Germany) to manual final submit, then payment page autofill; final Pay is not clicked...

call pnpm.cmd run run -- --site config/site.germany.json --applicant config/applicant.json

echo.
echo The browser is configured to stay open for manual takeover.
echo Press any key to close this window.
pause >nul
