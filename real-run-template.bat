@echo off
setlocal

cd /d "%~dp0"

set "AUTO_CONTINUE_PAUSES=1"
set "KEEP_BROWSER_OPEN=1"

echo AUTO_CONTINUE_PAUSES=%AUTO_CONTINUE_PAUSES%
echo KEEP_BROWSER_OPEN=%KEEP_BROWSER_OPEN%
echo Using real site template: config/site.json
echo Using applicant data: config/applicant.json

call pnpm.cmd run run -- --site config/site.json --applicant config/applicant.json

echo.
echo Browser is configured to stay open. Close the browser manually when you are done.
echo Press any key to close this window.
pause >nul
