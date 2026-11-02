@echo off
setlocal EnableExtensions
cd /d "%~dp0.." || exit /b 1

echo Cozy Studio portable launcher
echo This launcher does not bundle ChatGPT login.

set "STUDIO_BUN=%CD%\runtime\bun.exe"
if exist "%STUDIO_BUN%" (
  set "PATH=%CD%\runtime;%PATH%"
  goto runtime_ready
)

set "STUDIO_BUN=bun"
where bun >nul 2>nul
if errorlevel 1 (
  echo Cozy Studio needs Bun. Install it from https://bun.sh/docs/installation then run this launcher again.
  echo This launcher does not bundle ChatGPT login.
  if not "%STUDIO_MANAGED_RESTART%"=="1" if not defined STUDIO_PORTABLE_NONINTERACTIVE pause
  exit /b 1
)

:runtime_ready
set "STUDIO_PORTABLE=1"

"%STUDIO_BUN%" run scripts/portable-start.ts
set "STUDIO_EXIT_CODE=%ERRORLEVEL%"
if "%STUDIO_EXIT_CODE%"=="75" exit /b 75
if not "%STUDIO_EXIT_CODE%"=="0" (
  echo Cozy Studio failed to start.
  if not "%STUDIO_MANAGED_RESTART%"=="1" if not defined STUDIO_PORTABLE_NONINTERACTIVE pause
  exit /b %STUDIO_EXIT_CODE%
)
exit /b 0
