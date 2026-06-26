@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ===========================================================================
REM BarclaudeGateway - Supprime les donnees de la base SQLite de test.
REM Demande une confirmation explicite (taper OUI). Refuse de tourner tant que
REM l'environnement est demarre (SQLite verrouille le fichier). La cle maitre
REM est conservee : la base est recreee vierge au prochain start-test.bat.
REM ===========================================================================

pushd "%~dp0..\.."

set "TEST_PORT=8090"
set "DATA_DIR=%CD%\.testdata"
set "DB_FILE=%DATA_DIR%\barclaudegateway.sqlite"

REM Refuse si l'environnement tourne (fichier verrouille par SQLite).
netstat -ano | findstr ":%TEST_PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo [ERREUR] L'environnement de test tourne encore ^(port %TEST_PORT%^).
  echo          Lancez d'abord stop-test.bat, puis reessayez.
  goto :end
)

if not exist "%DB_FILE%" (
  echo [INFO] Aucune base de test a supprimer ^(%DB_FILE% absent^).
  goto :end
)

echo.
echo  ATTENTION : suppression DEFINITIVE de la base de test :
echo    %DB_FILE%
echo  Cela efface la configuration et les identifiants Chronodrive chiffres
echo  de l'environnement de test. La cle maitre est conservee.
echo.
set "ANS="
set /p "ANS=Tapez OUI pour confirmer, ou autre chose pour annuler : "
if /I not "!ANS!"=="OUI" (
  echo [ANNULE] Aucune donnee supprimee.
  goto :end
)

del /f /q "%DB_FILE%" "%DB_FILE%-wal" "%DB_FILE%-shm" "%DB_FILE%-journal" >nul 2>nul
if exist "%DB_FILE%" (
  echo [ERREUR] La base n'a pas pu etre supprimee. Est-elle encore ouverte ?
) else (
  echo [OK] Base de test supprimee. Elle sera recreee vierge au prochain start-test.bat.
)

:end
popd
endlocal
