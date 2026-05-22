@echo off
setlocal

cd /d "%~dp0"

echo Building portable package...
call pnpm.cmd run package:portable

echo.
echo Portable package build finished.
echo Check release\LATEST-PORTABLE-ZIP.txt for the newest zip path.
pause
