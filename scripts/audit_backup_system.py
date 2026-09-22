#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
💾 AUDIT SENIOR QA & DEVOPS (@AUD) -- BANC D'ESSAI AUTOMATISÉ DU SYSTÈME DE SAUVEGARDE
Vérification des exports périodiques JSON/SQL, compression tar.gz/zip, empreintes SHA-256,
réplication vers stockage distant sécurisé (S3 / GCS / Remote) et automatisation Cron.

Compatible Python 3.5+ et Windows CP1252.
"""

import sys
import os
import json
import tarfile
import zipfile
import subprocess
import time
from datetime import datetime, timedelta

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(PROJECT_DIR, 'scripts'))

class BackupAuditor:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.assertions = []

    def assert_true(self, condition, name, details=""):
        if condition:
            self.passed += 1
            self.assertions.append({'name': name, 'status': 'PASS', 'details': details})
            print("  [PASS] {0}".format(name))
        else:
            self.failed += 1
            self.assertions.append({'name': name, 'status': 'FAIL', 'details': details})
            print("  [FAIL] {0} -> {1}".format(name, details))

def audit_backup_files_presence(auditor):
    print("\n--- 1. Verification des Fichiers du Module de Sauvegarde ---")
    required = [
        'scripts/backup_data.py',
        'scripts/cron_backup.sh',
        'crontab.example',
        'scripts/backup_task.ps1'
    ]
    for rf in required:
        full_p = os.path.join(PROJECT_DIR, rf.replace('/', os.sep))
        exists = os.path.exists(full_p) and os.path.getsize(full_p) > 50
        auditor.assert_true(exists, "Presence et taille valide : {0}".format(rf))

def audit_backup_generation_nominal(auditor):
    print("\n--- 2. Verification de la Generation de Sauvegarde (JSON & SQL) ---")
    import backup_data

    test_out_dir = os.path.join(PROJECT_DIR, 'backups', 'qa_test')
    os.makedirs(test_out_dir, exist_ok=True)

    # Exécution d'un cycle de sauvegarde
    res = backup_data.perform_backup(
        format_choice='both',
        compress_choice='gzip',
        provider_choice='local',
        output_dir=test_out_dir
    )

    auditor.assert_true(res.get('status') == 'SUCCESS', "Statut global du cycle de sauvegarde : SUCCESS")
    auditor.assert_true(res.get('records_count', 0) > 0, "Nombre de reservations exportees superieur a 0")
    
    # Verification des métriques financières
    metrics = res.get('metrics', {})
    auditor.assert_true('ca_previsionnel' in metrics, "Metrique CA Previsionnel calculee")
    auditor.assert_true('ca_realise' in metrics, "Metrique CA Realise calculee")
    auditor.assert_true('show_up_rate_percent' in metrics, "Metrique Taux de Presence calculee")

    # Verification de l'archive tar.gz
    archive_info = res.get('archive', {})
    arch_path = archive_info.get('archive_path', '')
    auditor.assert_true(os.path.exists(arch_path), "Fichier archive compresse genere physiquement sur disque")
    auditor.assert_true(archive_info.get('size_bytes', 0) > 500, "Taille archive compressee superieure a 500 octets")
    auditor.assert_true(len(archive_info.get('sha256', '')) == 64, "Empreinte cryptographique SHA-256 valide (64 caracteres hex)")

    # Verification de l'intégrité de l'archive
    is_valid, msg = backup_data.verify_backup_archive(arch_path)
    auditor.assert_true(is_valid, "Integrite de l'archive certifiee (JSON + SQL valides)", msg)

def audit_sql_dump_structure(auditor):
    print("\n--- 3. Verification de la Conformite du Dump SQL Relationnel ---")
    import backup_data

    records = backup_data.load_appointments()
    metrics = backup_data.compute_metrics(records)
    test_sql_file = os.path.join(PROJECT_DIR, 'backups', 'qa_test', 'test_dump.sql')

    backup_data.generate_sql_export(records, metrics, test_sql_file)
    auditor.assert_true(os.path.exists(test_sql_file), "Fichier dump SQL genere avec succes")

    with open(test_sql_file, 'r', encoding='utf-8') as f:
        sql_content = f.read()

    auditor.assert_true('CREATE TABLE IF NOT EXISTS rdv_appointments' in sql_content, "Schema DDL de la table rdv_appointments present")
    auditor.assert_true('CREATE TABLE IF NOT EXISTS rdv_financial_snapshots' in sql_content, "Schema DDL de la table rdv_financial_snapshots present")
    auditor.assert_true('BEGIN TRANSACTION;' in sql_content, "Protection transactionnelle BEGIN TRANSACTION active")
    auditor.assert_true('COMMIT;' in sql_content, "Validation finale COMMIT presente")
    auditor.assert_true('INSERT INTO rdv_appointments' in sql_content, "Directives d'insertion des donnees clients presentes")
    auditor.assert_true('INSERT INTO rdv_financial_snapshots' in sql_content, "Directives d'insertion du snapshot financier presentes")

def audit_remote_storage_providers(auditor):
    print("\n--- 4. Verification de la Replication vers Stockage Distant (S3 / GCS / Remote) ---")
    import backup_data

    config = backup_data.load_env_config()
    test_file = os.path.join(PROJECT_DIR, 'backups', 'qa_test', 'test_remote_dummy.tar.gz')
    with open(test_file, 'wb') as f:
        f.write(b"RDV-HUB-TEST-PAYLOAD")
    dummy_sha = backup_data.compute_file_sha256(test_file)

    # Test S3 Provider
    s3_res = backup_data.dispatch_to_remote_storage(test_file, dummy_sha, config, provider_override='s3')
    auditor.assert_true(s3_res['status'] == 'SUCCESS', "Replication S3 executee avec statut SUCCESS")
    auditor.assert_true(s3_res['remote_uri'].startswith('s3://'), "URI de stockage S3 conforme (s3://...)")

    # Test GCS Provider
    gcs_res = backup_data.dispatch_to_remote_storage(test_file, dummy_sha, config, provider_override='gcs')
    auditor.assert_true(gcs_res['status'] == 'SUCCESS', "Replication Google Cloud Storage executee avec statut SUCCESS")
    auditor.assert_true(gcs_res['remote_uri'].startswith('gs://'), "URI de stockage GCS conforme (gs://...)")

    # Test Remote Server (SFTP) Provider
    rem_res = backup_data.dispatch_to_remote_storage(test_file, dummy_sha, config, provider_override='remote')
    auditor.assert_true(rem_res['status'] == 'SUCCESS', "Replication Serveur Secondaire executee avec statut SUCCESS")
    auditor.assert_true(rem_res['remote_uri'].startswith('sftp://'), "URI de stockage distant SFTP conforme (sftp://...)")

    # Test Local Vault Provider
    loc_res = backup_data.dispatch_to_remote_storage(test_file, dummy_sha, config, provider_override='local')
    auditor.assert_true(loc_res['status'] == 'SUCCESS', "Replication Coffre-fort local executee avec statut SUCCESS")
    auditor.assert_true('remote_vault' in loc_res['remote_uri'], "Fichier archive physiquement copie dans remote_vault")

def audit_cron_mode_and_rotation(auditor):
    print("\n--- 5. Verification de l'Automatisation Cron & Rotation des Archives ---")
    import backup_data

    # Test CLI --cron via subprocess
    py_bin = "C:\\Program Files\\LibreOffice\\program\\python.exe"
    if not os.path.exists(py_bin):
        py_bin = sys.executable

    cmd = [py_bin, os.path.join(PROJECT_DIR, 'scripts', 'backup_data.py'), '--cron', '--provider', 'local']
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    auditor.assert_true(res.returncode == 0, "Execution CLI en mode --cron terminee avec code 0 (Succes)")

    out_str = res.stdout.decode('utf-8', errors='ignore').strip()
    auditor.assert_true('"status": "SUCCESS"' in out_str or '"status":"SUCCESS"' in out_str, "Sortie standard en mode cron contient un JSON valide avec status SUCCESS")

    # Test de rotation / purge des anciennes sauvegardes
    test_purge_dir = os.path.join(PROJECT_DIR, 'backups', 'qa_test_purge')
    os.makedirs(test_purge_dir, exist_ok=True)
    old_file = os.path.join(test_purge_dir, 'rdv_backup_old_simulation.tar.gz')
    with open(old_file, 'wb') as f:
        f.write(b"OLD_ARCHIVE")

    # Simuler une date de modification vieille de 45 jours
    past_time = time.time() - (45 * 86400)
    os.utime(old_file, (past_time, past_time))

    purged = backup_data.rotate_old_backups(test_purge_dir, retention_days=30)
    auditor.assert_true(len(purged) == 1, "Purge automatique de l'archive vieille de 45 jours realisee avec succes")
    auditor.assert_true(not os.path.exists(old_file), "L'archive expiree a bien ete supprimee du disque")

def main():
    print("=" * 65)
    print(" [BACKUP QA] BANC D'ESSAI AUTOMATISE DES SAUVEGARDES SAAS (@AUD)")
    print("=" * 65)

    auditor = BackupAuditor()
    audit_backup_files_presence(auditor)
    audit_backup_generation_nominal(auditor)
    audit_sql_dump_structure(auditor)
    audit_remote_storage_providers(auditor)
    audit_cron_mode_and_rotation(auditor)

    # Nettoyage des dossiers temporaires de test
    import shutil
    for d in ['qa_test', 'qa_test_purge']:
        shutil.rmtree(os.path.join(PROJECT_DIR, 'backups', d), ignore_errors=True)

    total = auditor.passed + auditor.failed
    pct = round((auditor.passed / total * 100), 1) if total > 0 else 0.0

    print("\n" + "=" * 65)
    print(" [BILAN BACKUP QA] : {0}/{1} TESTS REUSSIS ({2}%)".format(auditor.passed, total, pct))
    print("=" * 65)

    if auditor.failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
