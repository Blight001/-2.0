@echo off
setlocal

cd /d "%~dp0"
chcp 65001 >nul

echo ========================================
echo   AI Account Register 2.0 - App Build
echo ========================================
echo.
echo Starting one-click traditional build...
echo.

call npm run dist:app

if errorlevel 1 (
    echo.
    echo Build failed
    pause
    exit /b 1
)

echo.
echo Build completed
pause
endlocal
