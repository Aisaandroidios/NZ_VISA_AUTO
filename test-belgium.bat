@echo off
setlocal

cd /d "%~dp0"

set "AUTO_CONTINUE_PAUSES=1"
echo AUTO_CONTINUE_PAUSES=%AUTO_CONTINUE_PAUSES%
call pnpm.cmd run run -- --site config/site.belgium.json --applicant config/applicant.json

echo.
echo Test run finished. Press any key to close this window.
pause >nul
