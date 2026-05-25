@echo off
setlocal

cd /d "%~dp0"

echo Building licensed user package...
echo.

if not exist ".secrets\license-private.pem" (
  echo Missing .secrets\license-private.pem
  echo Run this once first:
  echo   pnpm run license:init
  echo.
  pause
  exit /b 1
)

if not exist "config\applicant.json" (
  echo Missing config\applicant.json
  echo Fill the customer's applicant information first.
  echo.
  pause
  exit /b 1
)

echo Step 1/2: issuing license for config\applicant.json...
call pnpm.cmd run license:issue -- --applicant config/applicant.json
if errorlevel 1 goto fail

echo.
echo Step 2/2: packaging licensed runtime zip...
call pnpm.cmd run package:licensed
if errorlevel 1 goto fail

echo.
echo Licensed package build finished.
echo Latest zip:
type release\LATEST-PORTABLE-ZIP.txt
echo.
pause
exit /b 0

:fail
echo.
echo Package build failed. Check the error above.
pause
exit /b 1
