@echo off
chcp 65001 >nul
echo ===========================================
echo    AI Automation 2.0 - Code Backup Tool
echo ===========================================
echo.

REM Create main backup directory
set main_backup_dir=backup
if not exist "%main_backup_dir%" (
    mkdir "%main_backup_dir%" 2>nul
    if errorlevel 1 (
        echo Error: Cannot create main backup directory
        pause
        exit /b 1
    )
) else (
    REM Clean up old files in main backup directory (keep only timestamp subdirectories)
    echo Cleaning up old backup files...
    for %%f in ("%main_backup_dir%\*") do (
        if exist "%%f\*" (
            REM This is a directory, check if it's a timestamp directory
            echo %%~nf | findstr /r "^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_[0-9][0-9]-[0-9][0-9]-[0-9][0-9]$" >nul
            if errorlevel 1 (
                REM Not a timestamp directory, remove it
                rd /s /q "%%f" 2>nul
            )
        ) else (
            REM This is a file, remove it
            del /q "%%f" 2>nul
        )
    )
)

REM Create timestamp subdirectory
for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value') do set datetime=%%i
set timestamp=%datetime:~0,4%-%datetime:~4,2%-%datetime:~6,2%_%datetime:~8,2%-%datetime:~10,2%-%datetime:~12,2%
set backup_dir=%main_backup_dir%\%timestamp%

echo Creating timestamp backup directory: %backup_dir%
mkdir "%backup_dir%" 2>nul
if errorlevel 1 (
    echo Error: Cannot create timestamp backup directory
    pause
    exit /b 1
)

echo.
echo 开始备份重要文件...
echo.

REM 备份核心源码
echo [1/5] 备份核心源码...
xcopy "src" "%backup_dir%\src\" /E /I /Y /Q

REM 备份配置文件
echo [2/5] 备份项目配置文件...
xcopy "package.json" "%backup_dir%\" /Y /Q
xcopy "package-lock.json" "%backup_dir%\" /Y /Q
xcopy "README.md" "%backup_dir%\" /Y /Q

REM 备份自动化卡片配置
echo [3/5] 备份自动化卡片配置...
mkdir "%backup_dir%\cards" 2>nul
xcopy "cards\*.*" "%backup_dir%\cards\" /Y /Q /S

REM 备份Cookie数据
echo [4/5] 备份Cookie数据...
mkdir "%backup_dir%\cookies" 2>nul
xcopy "cookies\*.*" "%backup_dir%\cookies\" /Y /Q /S

REM 备份构建脚本
echo [5/5] 备份构建脚本...
xcopy "build.bat" "%backup_dir%\" /Y /Q
xcopy "start.bat" "%backup_dir%\" /Y /Q
xcopy "backup.bat" "%backup_dir%\" /Y /Q

echo.
echo ===========================================
echo          备份完成！
echo ===========================================
echo.
echo 备份位置: %backup_dir%
echo.
echo 备份内容包括：
echo   ✓ 核心代码文件 (src/*)
echo   ✓ UI界面文件 (src/ui/*)
echo   ✓ 项目配置文件 (package.json等)
echo   ✓ 自动化卡片配置 (cards/*)
echo   ✓ Cookie数据 (cookies/*)
echo   ✓ 构建脚本 (build.bat, start.bat, backup.bat)
echo.
echo 注意：node_modules和dist目录未备份
echo      可通过 npm install 和 npm run build 重新生成
echo.
echo 按任意键退出...
pause >nul
