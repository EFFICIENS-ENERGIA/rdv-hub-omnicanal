#!/bin/bash
# ==============================================================================
# 🐳 RDV-HUB SAAS -- SCRIPT DE DEPLOIEMENT DOCKER POUR SERVEUR LINUX / VPS
# ==============================================================================
set -e

echo "============================================================"
echo " 🐳 DEPLOIEMENT DU RDV-HUB SAAS EN CONTENEURS DOCKER"
echo "============================================================"

# Verification de la presence de Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Erreur : Docker n'est pas installe sur ce serveur."
    echo "Installez Docker : curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Verification du fichier .env
if [ ! -f .env ]; then
    echo "ℹ️  Creation du fichier .env a partir de .env.example..."
    cp .env.example .env
fi

# Construction et lancement avec Docker Compose
echo "📦 Construction des images multi-stage et demarrage des services..."
docker compose up -d --build

echo ""
echo "✅ Deploiement termine avec succes !"
echo "• Statut des services :"
docker compose ps
