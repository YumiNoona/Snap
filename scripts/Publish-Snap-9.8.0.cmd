@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Publish-Snap-9.8.0.ps1"
exit /b %errorlevel%
