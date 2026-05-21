@echo off
setlocal

cd /d "%~dp0"
chcp 65001 >nul

echo ========================================
echo   AI Account Register 2.0 - Web Build
echo ========================================
echo.
echo Starting one-click traditional build...
echo.

call npm run dist:web

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
