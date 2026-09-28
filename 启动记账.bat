@echo off
chcp 65001 >nul
cd /d "%~dp0"
python "%~dp0app.py"
if errorlevel 1 (
  echo.
  echo ============================================
  echo  Start failed. See the message above.
  echo ============================================
  pause
)
