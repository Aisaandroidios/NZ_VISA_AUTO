@echo off
setlocal

cd /d "%~dp0"

set "AUTO_CONTINUE_PAUSES=1"
set "KEEP_BROWSER_OPEN=1"

echo AUTO_CONTINUE_PAUSES=%AUTO_CONTINUE_PAUSES%
echo KEEP_BROWSER_OPEN=%KEEP_BROWSER_OPEN%
echo Running real China flow to manual final submit, then payment autofill and final Pay click...

call pnpm.cmd run run -- --site config/site.json --applicant config/applicant.json

echo.
echo The browser is configured to stay open for manual takeover.
echo Press any key to close this window.
pause >nul
