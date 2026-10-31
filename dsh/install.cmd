@echo off
rem Installs the dsh-cline bundle row into the current DSH profile (cmd.exe wrapper).
rem   dsh\install.cmd             install
rem   dsh\install.cmd --remove    uninstall
setlocal
node "%~dp0install.mjs" %*
exit /b %ERRORLEVEL%
