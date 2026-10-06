@echo off
cd /d "%~dp0"
rem Load .env (e.g. OPENCODE_SERVER_PASSWORD) so the managed OpenCode server is not started unsecured.
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do set "%%A=%%B"
)
rem Kill any previous Electron instances, Agent Relay desktop/service processes
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -like '*Electron*') -or ($_.CommandLine -like '*agent-relay*') -or ($_.CommandLine -like '*Agent Relay*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
timeout /t 1 /nobreak >nul

rem Prevent sleep/lock only while Agent Relay runs; capture previous settings to restore on exit
set PREV_SLEEP=
set PREV_MONITOR=
for /f "tokens=6" %%a in ('powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYTIMEOUTAC 2^>nul ^| findstr /i /c:"Current AC Power Setting Index"') do set PREV_SLEEP=%%a
for /f "tokens=6" %%a in ('powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLEAC 2^>nul ^| findstr /i /c:"Current AC Power Setting Index"') do set PREV_MONITOR=%%a
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1

npm run desktop:relay
set RELAY_EXIT=%errorlevel%

if defined PREV_SLEEP set /a PREV_SLEEP_SEC=%PREV_SLEEP%
if defined PREV_SLEEP powercfg /change standby-timeout-ac %PREV_SLEEP_SEC% >nul 2>&1
if defined PREV_MONITOR set /a PREV_MONITOR_SEC=%PREV_MONITOR%
if defined PREV_MONITOR powercfg /change monitor-timeout-ac %PREV_MONITOR_SEC% >nul 2>&1

if not "%RELAY_EXIT%"=="0" (
    echo.
    echo Agent Relay failed to start.
    pause
    exit /b 1
)