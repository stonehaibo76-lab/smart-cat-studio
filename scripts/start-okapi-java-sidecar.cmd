@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "JAR=%ROOT%\binaries\okapi-java-sidecar\okapi-sidecar.jar"
set "PORT=8091"
if defined OKAPI_JAVA_PORT set "PORT=%OKAPI_JAVA_PORT%"

if not exist "%JAR%" (
  echo [ERROR] Okapi Java sidecar JAR not found:
  echo   %JAR%
  echo Download from Supervertaler release: okapi-sidecar-v0.1.7.jar
  goto finish_fail
)

set "JAVA_CMD=java"
if exist "%ROOT%\runtime\jre\bin\java.exe" (
  set "JAVA_CMD=%ROOT%\runtime\jre\bin\java.exe"
) else if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" (
  set "JAVA_CMD=%JAVA_HOME%\bin\java.exe"
) else (
  where java >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Java 17+ not found. Run scripts\packaging\fetch-jre.ps1 or install Temurin 17.
    goto finish_fail
  )
)

echo [Okapi-Java] Stopping previous sidecar on port %PORT% if any...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  if not "%%P"=="0" taskkill /F /PID %%P >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [Okapi-Java] Starting Java Okapi sidecar at http://127.0.0.1:%PORT% ^(DOCX/PPTX/XLSX^)
start "SmartCAT-Okapi-Java V1.8.3.1" /D "%ROOT%" cmd /k ""%JAVA_CMD%" -jar \"%JAR%\" --port=%PORT%"
goto finish_ok

:finish_fail
if /i not "%~1"=="silent" pause
exit /b 1

:finish_ok
if /i not "%~1"=="silent" (
  echo Okapi Java sidecar window opened.
  pause
)
exit /b 0
