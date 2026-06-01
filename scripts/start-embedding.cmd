@echo off
setlocal EnableExtensions
cd /d "%~dp0embedding-server"

if not exist "main.py" (
  echo [ERROR] main.py not found: %CD%
  pause
  endlocal
  exit /b 1
)

if not exist "requirements.txt" (
  echo [ERROR] requirements.txt not found: %CD%
  pause
  endlocal
  exit /b 1
)

echo ============================================
echo   Smart-CAT embedding  http://127.0.0.1:8765
echo   Folder: %CD%
echo ============================================
echo.

if exist ".venv\Scripts\python.exe" (
  call :ensure_deps ".venv\Scripts\python.exe"
  if errorlevel 1 goto fail
  ".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8765
  if not errorlevel 1 goto done_ok
)

py -3 -c "import sentence_transformers" 2>nul
if errorlevel 1 (
  echo [pip] Installing dependencies, first run may take several minutes...
  py -3 -m pip install -r requirements.txt
  if errorlevel 1 goto fail
)
py -3 -m uvicorn main:app --host 127.0.0.1 --port 8765
if not errorlevel 1 goto done_ok

python -c "import sentence_transformers" 2>nul
if errorlevel 1 (
  echo [pip] Installing dependencies, first run may take several minutes...
  python -m pip install -r requirements.txt
  if errorlevel 1 goto fail
)
python -m uvicorn main:app --host 127.0.0.1 --port 8765
if not errorlevel 1 goto done_ok

:fail
echo.
echo [FAIL] Could not run uvicorn. In this folder, run:
echo   python -m pip install -r requirements.txt
echo Then:
echo   python -m uvicorn main:app --host 127.0.0.1 --port 8765
pause
endlocal
exit /b 1

:ensure_deps
"%~1" -c "import sentence_transformers" 2>nul
if errorlevel 1 (
  echo [pip] Installing into .venv, first run may take several minutes...
  "%~1" -m pip install -r requirements.txt
  if errorlevel 1 exit /b 1
)
exit /b 0

:done_ok
endlocal
exit /b 0
