@echo off
title Sound Control PC Server
setlocal enableextensions

echo Starting Sound Control System (auto-restart enabled)...
echo.

set ROOT_DIR=%~dp0
set APP_DIR=%ROOT_DIR%pc-app

cd /d "%APP_DIR%"

:restart
echo [%date% %time%] Starting pc-app server...
node index.js
echo [%date% %time%] Server stopped with exit code %errorlevel%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto restart
