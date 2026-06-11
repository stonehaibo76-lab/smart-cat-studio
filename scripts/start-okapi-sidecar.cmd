@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "SVC=%ROOT%\scripts\okapi-sidecar"
cd /d "%SVC%"

if not exist "main.py" (
  echo [ERROR] main.py not found: %SVC%
  goto finish_fail
)

if not exist "requirements.txt" (
  echo [ERROR] requirements.txt not found: %SVC%
  goto finish_fail
)

if not exist ".venv\Scripts\python.exe" (
  echo [Okapi] Creating venv and installing deps, first run may be slow...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Could not create venv. Install Python 3.10+ and retry.
    goto finish_fail
  )
  call .venv\Scripts\activate.bat
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] pip install failed.
    goto finish_fail
  )
) else (
  ".venv\Scripts\python.exe" -c "import fastapi, uvicorn" 2>nul
  if errorlevel 1 (
    echo [Okapi] Installing missing deps...
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 goto finish_fail
  )
)

echo [Okapi] Starting sidecar at http://127.0.0.1:8090
start "SmartCAT-Okapi V1.8.0" /D "%SVC%" cmd /k ".venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8090"
goto finish_ok

:finish_fail
if /i not "%~1"=="silent" pause
endlocal
exit /b 1

:finish_ok
if /i not "%~1"=="silent" (
  echo.
  echo Okapi sidecar window opened.
  pause
)
endlocal
exit /b 0
