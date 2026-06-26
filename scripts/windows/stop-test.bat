@echo off
setlocal EnableExtensions

REM ===========================================================================
REM BarclaudeGateway - Arrete l'environnement de test local (Windows).
REM Stoppe le processus qui ecoute sur le port de test et ferme sa fenetre.
REM ===========================================================================

set "TEST_PORT=8090"
set "WINDOW_TITLE=BarclaudeGatewayTest"

set "FOUND="
echo [INFO] Recherche du service de test sur le port %TEST_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%TEST_PORT% " ^| findstr LISTENING') do (
  echo [INFO] Arret du processus PID %%P...
  taskkill /PID %%P /F >nul 2>nul
  set "FOUND=1"
)

REM Ferme la fenetre console restante (cmd /k), si presente.
taskkill /FI "WINDOWTITLE eq %WINDOW_TITLE%" /T /F >nul 2>nul

if defined FOUND (
  echo [OK] Environnement de test arrete.
) else (
  echo [INFO] Aucun service de test ne tournait sur le port %TEST_PORT%.
)

endlocal
