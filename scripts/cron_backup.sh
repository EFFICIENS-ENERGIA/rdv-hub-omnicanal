#!/usr/bin/env bash
# ==============================================================================
# 💾 RDV-HUB SAAS -- EXÉCUTEUR DE SAUVEGARDE CRON AUTOMATISÉ
# Planifié quotidiennement (ex: 02:00 UTC) avec gestion de verrou anti-concurrence
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

LOG_DIR="${PROJECT_DIR}/docker/logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/backup.log"
LOCK_FILE="/tmp/rdv_hub_backup.lock"

# Empêcher les exécutions concurrentes via lockfile
if [ -f "${LOCK_FILE}" ]; then
    PID="$(cat "${LOCK_FILE}" 2>/dev/null || echo '')"
    if [ -n "${PID}" ] && kill -0 "${PID}" 2>/dev/null; then
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [WARN] Sauvegarde déjà en cours d'exécution (PID ${PID}). Abandon." >> "${LOG_FILE}"
        exit 0
    fi
fi

echo $$ > "${LOCK_FILE}"
trap 'rm -f "${LOCK_FILE}"' EXIT

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [CRON] Début du cycle de sauvegarde automatique..." >> "${LOG_FILE}"

# Sélection de l'interpréteur Python disponible
PYTHON_BIN="python3"
if ! command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi

if "${PYTHON_BIN}" "${SCRIPT_DIR}/backup_data.py" --cron >> "${LOG_FILE}" 2>&1; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [CRON] ✅ Sauvegarde et réplication distante achevées avec succès." >> "${LOG_FILE}"
    exit 0
else
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [CRON] ❌ Échec critique de la sauvegarde." >> "${LOG_FILE}"
    exit 1
fi
