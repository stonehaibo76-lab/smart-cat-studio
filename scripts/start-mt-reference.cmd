@echo off
chcp 65001 >nul
set "ROOT=%~dp0.."
set "SVC=%ROOT%\scripts\translators-server"
cd /d "%SVC%"

if not exist ".venv\Scripts\python.exe" (
  echo 正在创建虚拟环境并安装依赖…
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] 无法创建 venv，请确认已安装 Python 3.10+
    pause
    exit /b 1
  )
  call .venv\Scripts\activate.bat
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

echo 启动机器翻译参考服务 http://127.0.0.1:8770
start "MT Reference" cmd /k "cd /d \"%SVC%\" && .venv\Scripts\activate.bat && uvicorn main:app --host 127.0.0.1 --port 8770"
echo 已在独立窗口启动。请在 Smart-CAT「系统设置 → 机器翻译参考」中启用并检测连接。
pause
