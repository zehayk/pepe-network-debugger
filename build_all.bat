call cd service
call build_win.bat
call cd ..\client
call npm run dist
call explorer dist-electron
call cd ..