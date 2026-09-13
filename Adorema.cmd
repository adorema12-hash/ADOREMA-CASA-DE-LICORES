@echo off
chcp 65001 >nul
title Adorema - Caja
cd /d "%~dp0"
node apps\local\servidor.js
if errorlevel 1 (
  echo.
  echo  Algo fallo al arrancar. Revisa el mensaje de arriba.
  pause
)
