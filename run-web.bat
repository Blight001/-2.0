@echo off
setlocal

cd /d "%~dp0"
chcp 65001 >nul

set "WEB_UI=1"
set "HEADLESS_WEB=1"
set "REG_CONTROL_MQTT_ENABLED=1"
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

set "WEB_HOST=%WEB_UI_HOST%"
if not defined WEB_HOST set "WEB_HOST=127.0.0.1"
set "WEB_PORT=%WEB_UI_PORT%"
if not defined WEB_PORT set "WEB_PORT=18765"
set "WEB_URL=http://%WEB_HOST%:%WEB_PORT%"

echo ========================================
echo   AI Account Register 2.0 - Local Web
echo ========================================
echo Mode: local web UI
echo MQTT: enabled
echo URL : %WEB_URL%
echo.
echo The browser will open automatically after the web service is ready.
echo.

if not exist "%ELECTRON_EXE%" (
    echo [ERROR] electron.exe not found.
    echo [ERROR] Please run: npm install
    exit /b 1
)

@REM start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -Command "$url = '%WEB_URL%'; $health = '%WEB_URL%/health'; for ($i = 0; $i -lt 120; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $health; if ($response.StatusCode -eq 200) { Start-Process $url; exit 0 } } catch { Start-Sleep -Seconds 1 } }; Start-Process $url"

"%ELECTRON_EXE%" . --web-ui --headless-web --startup-mode=local

endlocal
