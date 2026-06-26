@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ===========================================================================
REM BarclaudeGateway - Demarre l'environnement de test local (Windows).
REM
REM Construit (si besoin) puis lance l'unique processus Fastify qui sert la SPA
REM + les routes /api et /v1, comme le conteneur mais via la chaine Node (Docker
REM n'est jamais utilise sous Windows). Les donnees de test vivent dans .testdata\
REM (base SQLite + cle maitre conservee), dossier ignore par git.
REM
REM Usage : start-test.bat            (build seulement si dist absent)
REM         start-test.bat rebuild    (force un build avant de demarrer)
REM ===========================================================================

pushd "%~dp0..\.."

set "TEST_PORT=8090"
set "DATA_DIR=%CD%\.testdata"
set "DB_FILE=%DATA_DIR%\barclaudegateway.sqlite"
set "KEY_FILE=%DATA_DIR%\master.key"
set "WINDOW_TITLE=BarclaudeGatewayTest"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node introuvable dans le PATH. Installez Node 24+ puis reessayez.
  goto :end
)

REM Deja en cours d'execution ?
netstat -ano | findstr ":%TEST_PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo [INFO] Un service ecoute deja sur le port %TEST_PORT% : l'environnement semble deja demarre.
  echo        Lancez stop-test.bat pour l'arreter, puis relancez si besoin.
  goto :end
)

REM node:sqlite ne cree pas le dossier parent de la base : on le cree.
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM Cle maitre : generee une fois et conservee, sinon la base chiffree devient illisible.
if not exist "%KEY_FILE%" (
  echo [INFO] Generation d'une cle maitre de test ^(conservee dans %KEY_FILE%^)...
  for /f "usebackq delims=" %%K in (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) do set "MASTER_KEY=%%K"
  > "%KEY_FILE%" echo !MASTER_KEY!
) else (
  set /p MASTER_KEY=<"%KEY_FILE%"
)
if "%MASTER_KEY%"=="" (
  echo [ERREUR] Impossible d'obtenir la cle maitre.
  goto :end
)

REM Build si necessaire (ou force par l'argument "rebuild").
set "NEED_BUILD="
if /I "%~1"=="rebuild" set "NEED_BUILD=1"
if not exist "packages\backend\dist\main.js" set "NEED_BUILD=1"
if not exist "packages\frontend\dist\index.html" set "NEED_BUILD=1"
if defined NEED_BUILD (
  echo [INFO] Construction du projet ^(npm run build^)... cela peut prendre une minute.
  call npm run build
  if errorlevel 1 (
    echo [ERREUR] La construction a echoue. Corrigez l'erreur ci-dessus puis reessayez.
    goto :end
  )
)

REM Environnement d'execution (clef + base de test + port + ecoute locale).
set "BCG_MASTER_KEY=%MASTER_KEY%"
set "BCG_DB_PATH=%DB_FILE%"
set "BCG_PORT=%TEST_PORT%"
set "BCG_HOST=127.0.0.1"

echo.
echo [OK] Demarrage de BarclaudeGateway (test) dans une nouvelle fenetre...
echo      URL   : http://127.0.0.1:%TEST_PORT%
echo      Base  : %DB_FILE%
echo      Arret : stop-test.bat
echo.
start "%WINDOW_TITLE%" cmd /k "node packages\backend\dist\main.js"

REM Laisse le serveur demarrer, puis ouvre la page dans le navigateur par defaut.
echo [INFO] Ouverture de la page dans le navigateur...
timeout /t 2 /nobreak >nul 2>nul
start "" "http://127.0.0.1:%TEST_PORT%"

:end
popd
endlocal
