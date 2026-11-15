@echo off
cd /d "%~dp0.."
if not exist node_modules (
  echo Chua cai dat. Dang chay npm install...
  call npm install --no-fund --no-audit || exit /b 1
)
call npm run build:web || exit /b 1
start "" http://127.0.0.1:5178/
call npx tsx src/server/index.ts
