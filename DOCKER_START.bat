@echo off
chcp 65001 >nul
title RDV-HUB SAAS -- LANCEUR DOCKER & DOCKER COMPOSE
echo ============================================================
echo   ?? RDV-HUB SAAS -- DEMARRAGE CONTENEURISE (DOCKER)
echo ============================================================
echo.

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Docker n'est pas installe ou pas accessible dans votre PATH.
    echo Veuillez installer Docker Desktop depuis https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

echo [1/3] Verification du fichier .env...
if not exist .env (
    echo Creation automatique du fichier .env depuis .env.example...
    copy .env.example .env >nul
)

echo [2/3] Construction et demarrage des conteneurs (Multi-Stage Build + Nginx)...
docker compose up -d --build

if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo  ? APPLICATION LANCEE AVEC SUCCES EN CONTENEURS ISOLES !
    echo ============================================================
    echo   Port d'acces Reverse Proxy : http://localhost:8092
    echo   Conteneur Web App          : rdv_hub_web_app (port 8080 non-root)
    echo   Conteneur Reverse Proxy    : rdv_hub_reverse_proxy (port 80)
    echo   Volumes persistants        : rdv_hub_data_volume, rdv_hub_logs_volume
    echo ============================================================
    echo.
    echo Ouverture dans votre navigateur par defaut...
    start http://localhost:8092
) else (
    echo.
    echo [ERREUR] Echec du demarrage Docker Compose.
)

pause
