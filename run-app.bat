@echo off
setlocal

cd /d "%~dp0"
chcp 65001 >nul

set "WEB_UI=0"
set "HEADLESS_WEB=0"
set "REG_CONTROL_MQTT_ENABLED=1"
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

echo ========================================
echo   AI Automation 2.0 - Local App
echo ========================================
echo.
echo Mode: local desktop UI
echo MQTT: enabled
echo.

if not exist "%ELECTRON_EXE%" (
    echo [ERROR] electron.exe not found.
    echo [ERROR] Please run: npm install
    exit /b 1
)

"%ELECTRON_EXE%" . --startup-mode=local

endlocal
