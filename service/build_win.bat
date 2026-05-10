@echo off
cd /d "%~dp0"
echo Building pepe-service.exe with PyInstaller...
pyinstaller build_win.spec --clean --noconfirm
if errorlevel 1 (
    echo BUILD FAILED
    pause
    exit /b 1
)
echo.
echo Done. Output: dist\pepe-service.exe
echo.
:: echo Copy dist\pepe-service.exe to pepe\client\resources\ before building Electron app.
copy /y dist\pepe-service.exe ..\client\resources
::pause
