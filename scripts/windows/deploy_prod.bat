@echo off
REM ============================================================================
REM  deploy_prod.bat
REM  Triggers an immediate BarclaudeGateway prod update via Watchtower's HTTP API
REM  (pulls the latest image + redeploys).
REM
REM  No secret lives in this file. The Watchtower token (and optional host/port
REM  overrides) come from a GIT-IGNORED companion file next to this one:
REM      scripts\windows\deploy_prod.secret.bat
REM  which simply does:   set "TOKEN=your_watchtower_token"
REM  (and may override SERVER / PORT). See .gitignore.
REM ============================================================================
setlocal
set "HERE=%~dp0"

REM Defaults — override any of these in the git-ignored companion file.
set "SERVER=192.168.1.37"
set "PORT=4685"
set "TOKEN="

REM Load local secrets / overrides (git-ignored): must define TOKEN.
if exist "%HERE%deploy_prod.secret.bat" call "%HERE%deploy_prod.secret.bat"

if "%TOKEN%"=="" (
  echo.
  echo  [ERREUR] Token Watchtower manquant.
  echo  Cree le fichier "%HERE%deploy_prod.secret.bat" avec, par exemple :
  echo      set "TOKEN=ton_token_watchtower"
  echo  Ce fichier est git-ignore : il ne sera jamais commite.
  echo.
  pause
  exit /b 1
)

echo.
echo  BarclaudeGateway - deploiement prod  (Watchtower @ %SERVER%:%PORT%)
echo  --------------------------------------------------------------
echo  Declenchement de la mise a jour...
echo.

curl -fsS -X POST -H "Authorization: Bearer %TOKEN%" "http://%SERVER%:%PORT%/v1/update"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo  [OK] Mise a jour declenchee. Verifie la version via GET /api/health sur l'app.
) else (
  echo  [ERREUR] curl a echoue ^(code %RC%^).
  echo  Verifie : Watchtower joignable sur %SERVER%:%PORT% ^(mapping "4685:8080"^), token correct.
)

echo.
pause
endlocal
