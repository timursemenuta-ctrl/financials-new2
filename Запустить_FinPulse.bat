@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo FinPulse запускается на http://127.0.0.1:5173
echo.
echo Не закрывайте это окно, пока пользуетесь приложением.
echo Для остановки нажмите Ctrl+C или просто закройте окно.
echo.
start "" "http://127.0.0.1:5173"
python -m http.server 5173 --bind 127.0.0.1
pause
