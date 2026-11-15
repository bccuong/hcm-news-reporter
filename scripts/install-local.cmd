@echo off
cd /d "%~dp0.."
where node >nul 2>nul || (echo Can cai Node.js LTS: https://nodejs.org & exit /b 1)
call npm install --no-fund --no-audit
