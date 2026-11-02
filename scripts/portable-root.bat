@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0" || exit /b 1
set "STUDIO_PORTABLE_ROOT=%CD%"
set "STUDIO_MANAGED_RESTART=1"

:launch
call :update swap
if errorlevel 1 echo Close windows or terminals using the app folder; the update will retry next launch. Existing recovery folders are preserved.
if not exist "%STUDIO_PORTABLE_ROOT%\app\scripts\Cozy Studio.bat" (
  echo Cozy Studio app launcher is missing.
  set "STUDIO_EXIT_CODE=1"
  goto after_launch
)
call "%STUDIO_PORTABLE_ROOT%\app\scripts\Cozy Studio.bat"
set "STUDIO_EXIT_CODE=%ERRORLEVEL%"
:after_launch
cd /d "%STUDIO_PORTABLE_ROOT%" || exit /b 1
if "%STUDIO_EXIT_CODE%"=="75" (
  set "STUDIO_PORTABLE_RESTART=1"
  goto launch
)
if "%STUDIO_EXIT_CODE%"=="0" exit /b 0
if not exist "app\.update-pending" goto failed
if not exist "app.previous\" goto failed
call :update rollback
if errorlevel 1 (
  echo Could not restore the previous app. Recovery folders and user data were kept.
  goto failed
)
echo The update failed to start. Restored the previous app.
goto launch

:failed
if not defined STUDIO_PORTABLE_NONINTERACTIVE pause
exit /b %STUDIO_EXIT_CODE%

:update
if "%~1"=="swap" if exist "%STUDIO_PORTABLE_ROOT%\app\" if not exist "%STUDIO_PORTABLE_ROOT%\app.next\portable.json" exit /b 0
set "STUDIO_PORTABLE_OPERATION=%~1"
rem Keep mutations in PowerShell, using checked absolute paths and rename-only moves.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command ^
  "$ErrorActionPreference = 'Stop'; try {" ^
  "$root = [IO.Path]::GetFullPath($env:STUDIO_PORTABLE_ROOT);" ^
  "function Checked($name) { $p = [IO.Path]::GetFullPath((Join-Path $root $name)); if (-not $p.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Update path is outside the portable folder.' }; $item = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw ('Linked update path is not allowed: ' + $name) }; return $p };" ^
  "$app = Checked 'app'; $previous = Checked 'app.previous';" ^
  "if ($env:STUDIO_PORTABLE_OPERATION -eq 'swap') {" ^
  "if (-not (Test-Path -LiteralPath $app) -and (Test-Path -LiteralPath $previous)) { [IO.Directory]::Move($previous, $app) };" ^
  "$next = Checked 'app.next'; $manifest = Checked 'app.next/portable.json';" ^
  "if (Test-Path -LiteralPath $manifest -PathType Leaf) {" ^
  "if (Test-Path -LiteralPath $previous) { throw 'app.previous already exists.' };" ^
  "$sourceEnv = Checked 'app/.env.local'; $targetEnv = Checked 'app.next/.env.local'; $pending = Checked 'app.next/.update-pending';" ^
  "if (Test-Path -LiteralPath $sourceEnv -PathType Leaf) { [IO.File]::Copy($sourceEnv, $targetEnv, $true) };" ^
  "[IO.File]::WriteAllText($pending, ''); [IO.Directory]::Move($app, $previous);" ^
  "try { [IO.Directory]::Move($next, $app) } catch { [IO.Directory]::Move($previous, $app); throw }" ^
  "}" ^
  "} else {" ^
  "$failed = Checked 'app.failed'; if (Test-Path -LiteralPath $failed) { throw 'app.failed already exists.' };" ^
  "[IO.Directory]::Move($app, $failed); try { [IO.Directory]::Move($previous, $app) } catch { [IO.Directory]::Move($failed, $app); throw }" ^
  "}" ^
  "} catch { Write-Host $_.Exception.Message; exit 1 }"
exit /b %ERRORLEVEL%
