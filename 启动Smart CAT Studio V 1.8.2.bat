@echo off
setlocal EnableExtensions
title Smart-CAT Studio V1.8.2
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

echo Smart-CAT Studio V1.8.2
echo.
echo [1/3] Starting Okapi sidecar ^(DOCX/PPTX/HTML/TXT, port 8090^) ...
call "%APP_DIR%\scripts\start-okapi-sidecar.cmd" silent
if errorlevel 1 (
    echo [ERROR] Okapi sidecar failed to start. Install Python 3.10+ or run scripts\start-okapi-sidecar.cmd manually.
    pause
    popd
    exit /b 1
)
echo       Okapi window opened with PPTX support.

timeout /t 2 /nobreak >nul

echo [2/3] Starting local DB server ...
start "SmartCAT-DB V1.8.2" /D "%APP_DIR%" cmd /k npm run server

timeout /t 3 /nobreak >nul

echo [3/3] Starting frontend ^(browser opens when Vite is ready^) ...
start "SmartCAT-Web V1.8.2" /D "%APP_DIR%" cmd /k npm run dev -- --open

echo.
echo Three windows should open: Okapi, DB server, Web UI.
echo Close them to stop services.
echo Optional sidecars: scripts\start-embedding.cmd, scripts\start-mt-reference.cmd
echo If a window closes instantly: run the command in that folder to see errors.
pause
popd
endlocal
