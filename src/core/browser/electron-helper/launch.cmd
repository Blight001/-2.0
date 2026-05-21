@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "ELECTRON_EXE="

rem Development build: use the Electron binary from node_modules.
if exist "%SCRIPT_DIR%..\..\..\..\node_modules\electron\dist\electron.exe" (
    set "ELECTRON_EXE=%SCRIPT_DIR%..\..\..\..\node_modules\electron\dist\electron.exe"
)

rem Packaged build: use the installed app executable next to the resources folder.
if not defined ELECTRON_EXE (
    for /f "delims=" %%F in ('dir /b /a-d "%SCRIPT_DIR%..\..\*.exe" 2^>nul') do (
        set "EXE_NAME=%%~nxF"
        if /I not "!EXE_NAME:~0,9!"=="Uninstall" (
            if /I not "!EXE_NAME:~0,6!"=="Update" (
                set "ELECTRON_EXE=%%~fF"
                goto :launch
            )
        )
    )
)

:launch
if not defined ELECTRON_EXE (
    echo Failed to locate Electron executable.
    exit /b 1
)

"%ELECTRON_EXE%" %*
