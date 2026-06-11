@echo off
setlocal EnableExtensions
REM Portable one-click launcher (ASCII-only for cmd.exe compatibility).
title Smart-CAT Studio Portable V1.8.0
cd /d "%~dp0"

if not exist "%~dp0runtime\node\node.exe" (
  echo [ERROR] runtime\node\node.exe not found.
  echo Extract the full portable zip, then run Start-SmartCAT.bat from that folder.
  pause
  exit /b 1
)

if not exist "%~dp0scripts\packaging\smartcat-launcher.mjs" (
  echo [ERROR] scripts\packaging\smartcat-launcher.mjs not found.
  echo Use a complete portable package built with npm run build:portable.
  pause
  exit /b 1
)

echo Starting Smart-CAT Studio...
"%~dp0runtime\node\node.exe" "%~dp0scripts\packaging\smartcat-launcher.mjs"
if errorlevel 1 pause
endlocal
