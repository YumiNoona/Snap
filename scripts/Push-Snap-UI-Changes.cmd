@echo off
setlocal DisableDelayedExpansion
set "GIT_TERMINAL_PROMPT=0"
git -C "%~dp0..\node_modules\.cache\snap-ui-cleanup" -c credential.helper= -c credential.https://github.com.helper= -c "credential.https://github.com.helper=!gh auth git-credential" push origin HEAD:refs/heads/main
exit /b %errorlevel%
