#!/usr/bin/env bash
# ==============================================================================
# 🚀 RDV-HUB SAAS -- ENTRYPOINT ROOT DU SCRIPT DE DÉPLOIEMENT EN CONTINU
# Délègue l'exécution à scripts/deploy.sh
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/scripts/deploy.sh" "$@"
