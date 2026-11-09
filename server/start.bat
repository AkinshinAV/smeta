@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Установите Node.js 22 или новее: https://nodejs.org
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22) process.exit(1)"
if errorlevel 1 (
  echo Нужен Node.js 22 или новее: в нём есть встроенный SQLite, отдельные модули ставить не нужно.
  exit /b 1
)
if "%SMETA_ADMIN_USER%"=="" echo Если пользователей ещё нет, задайте SMETA_ADMIN_USER и SMETA_ADMIN_PASSWORD в этом окне и запустите снова.
node --disable-warning=ExperimentalWarning "%~dp0server.mjs"
