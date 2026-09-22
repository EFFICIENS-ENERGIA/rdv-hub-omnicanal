#!/bin/bash
# ==============================================================================
# 🔐 RDV-HUB SAAS -- SCRIPT D'OBTENTION INITIALE DU CERTIFICAT LET'S ENCRYPT
# ==============================================================================
set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage : ./scripts/init_letsencrypt.sh <mon-domaine.fr> <email-contact@domaine.fr>"
    echo "Exemple : ./scripts/init_letsencrypt.sh rdv-hub.bati-excellence.fr sebastien.pro@gmail.com"
    exit 1
fi

DOMAIN=$1
EMAIL=$2

echo "============================================================"
echo " 🔐 OBTENTION DU CERTIFICAT LET'S ENCRYPT POUR : $DOMAIN"
echo "============================================================"

# 1. Verification de Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Erreur : Docker n'est pas installe."
    exit 1
fi

# 2. Lancement du proxy en mode HTTP pour repondre au challenge ACME
echo ">> Demarrage temporaire de Nginx pour valider le challenge..."
docker compose -f docker-compose.prod.yml up -d rdv-proxy

# 3. Execution de Certbot pour delivrer le certificat
echo ">> Demande du certificat a l'autorite Let's Encrypt..."
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# 4. Redemarrage complet en mode HTTPS avec renouvellement automatique
echo ">> Rechargement de Nginx avec le nouveau certificat SSL..."
docker compose -f docker-compose.prod.yml restart rdv-proxy
docker compose -f docker-compose.prod.yml up -d certbot

echo "============================================================"
echo " ✅ CERTIFICAT SSL INSTALLE AVEC SUCCES !"
echo " • Votre site est accessible en HTTPS : https://$DOMAIN"
echo " • Renouvellement automatique active via Certbot toutes les 12h."
echo "============================================================"
