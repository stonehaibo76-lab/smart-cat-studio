@echo off
setlocal EnableExtensions
title Smart-CAT Studio V1.7.7.7
REM Must cd first when launched from Explorer (ASCII-only to avoid cmd.exe UTF-8 parse errors)

pushd "%~dp0" 2>nul
if errorlevel 1 (
    echo Cannot open folder: "%~dp0"
    pause
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
        pause
        exit /b 1
    )
)

REM DB path: smartcat-db-path.json uses data\smartcat-local.db under this folder

set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"
if exist "node_modules\" if not exist "node_modules\vite\package.json" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="1" (
    echo [deps] Running npm install ^(includes Vite^)...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. See messages above.
        pause
        exit /b 1
    )
)

REM Canonical folder path without trailing "\" (avoids broken quoting for START /D)
for %%I in ("%~dp0.") do set "APP_DIR=%%~fI"

echo Smart-CAT Studio V1.7.7.7
echo.
echo [1/2] Starting local DB server ...
start "SmartCAT-DB V1.7.7.7" /D "%APP_DIR%" cmd /k npm run server

timeout /t 3 /nobreak >nul

echo [2/2] Starting frontend ^(browser opens when Vite is ready^) ...
start "SmartCAT-Web V1.7.7.7" /D "%APP_DIR%" cmd /k npm run dev -- --open

echo.
echo Two windows should open. Close them to stop services.
echo If a window closes instantly: run "npm run server" or "npm run dev" here to see errors.
pause
popd
endlocal
