@echo off
setlocal EnableExtensions
title Smart-CAT Studio V1.8.3.1
REM ASCII-only for cmd.exe (GBK/ANSI). Do not add UTF-8 symbols to this file.

cd /d "%~dp0"
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

set "APP_DIR=%CD%"

echo Smart-CAT Studio V1.8.3.1
echo.
echo [1/4] Starting Python Okapi sidecar ^(HTML/TXT, port 8090^) ...
call "%APP_DIR%\scripts\start-okapi-sidecar.cmd" silent
if errorlevel 1 (
    echo [ERROR] Okapi sidecar failed to start. Install Python 3.10+ or run scripts\start-okapi-sidecar.cmd manually.
    pause
    exit /b 1
)
echo       Okapi window opened.

timeout /t 2 /nobreak >nul

echo [2/4] Starting Java Okapi sidecar ^(DOCX/PPTX/XLSX, port 8091^) ...
call "%APP_DIR%\scripts\start-okapi-java-sidecar.cmd" silent
if errorlevel 1 (
    echo [WARN] Java Okapi sidecar failed - Office round-trip unavailable. Run scripts\packaging\fetch-jre.ps1 or install Java 17+.
)

timeout /t 2 /nobreak >nul

echo [3/4] Starting local DB server ...
start "SmartCAT-DB V1.8.3.1" /D "%APP_DIR%" cmd /k npm run server

timeout /t 3 /nobreak >nul

echo [4/4] Starting frontend ^(browser opens when Vite is ready^) ...
start "SmartCAT-Web V1.8.3.1" /D "%APP_DIR%" cmd /k npm run dev -- --open

echo.
echo Four windows may open: Python Okapi, Java Okapi, DB server, Web UI.
echo Close them to stop services.
echo Optional sidecars: scripts\start-embedding.cmd, scripts\start-mt-reference.cmd
echo If a window closes instantly: run the command in that folder to see errors.
pause
endlocal
