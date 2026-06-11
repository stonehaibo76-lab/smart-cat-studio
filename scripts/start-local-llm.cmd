@echo off
chcp 65001 >nul
set "LLAMA_DIR=%LOCAL_LLM_DIR%"
if not defined LLAMA_DIR set "LLAMA_DIR=D:\llama-b9505-bin-win-cuda-13.3-x64"

if not exist "%LLAMA_DIR%\llama-server.exe" (
  echo [ERROR] 未找到 llama-server.exe：%LLAMA_DIR%
  echo 请设置环境变量 LOCAL_LLM_DIR 指向您的 llama.cpp 目录。
  pause
  exit /b 1
)

if exist "%LLAMA_DIR%\run-text-only.bat" (
  start "Local LLM" cmd /k ""%LLAMA_DIR%\run-text-only.bat""
) else if exist "%LLAMA_DIR%\run.bat" (
  start "Local LLM" cmd /k ""%LLAMA_DIR%\run.bat""
) else (
  echo [ERROR] 未找到 run.bat 或 run-text-only.bat
  pause
  exit /b 1
)

echo 已在独立窗口启动本地 LLM 服务，请在 Smart-CAT 设置中选择「本地 LLM (llama.cpp)」。
