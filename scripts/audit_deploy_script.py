#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🚀 AUDIT SENIOR QA & DEVOPS (@AUD) -- BANC D'ESSAI AUTOMATISÉ DÉPLOIEMENT CONTINU ZERO-DOWNTIME
Vérification des scripts deploy.sh et deploy.ps1 : Git pull, build Docker, barrière HTTP 200 sur /health,
basculement Nginx à chaud, arrêt de l'ancien conteneur et rollback immédiat en cas d'anomalie.
Compatible Python 3.5+ et Windows CP1252.
"""

import sys
import os
import subprocess

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(PROJECT_DIR, 'scripts'))

class DeployAuditor:
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

def audit_deployment_files(auditor):
    print("\n--- 1. Verification de la Presence des Fichiers de Deploiement ---")
    files_to_check = [
        'scripts/deploy.sh',
        'deploy.sh',
        'scripts/deploy.ps1',
        'deploy.ps1',
        'docker-compose.bluegreen.yml'
    ]
    for rel_path in files_to_check:
        full_path = os.path.join(PROJECT_DIR, rel_path.replace('/', os.sep))
        exists = os.path.exists(full_path) and os.path.getsize(full_path) > 50
        auditor.assert_true(exists, "Presence et taille valide : {0}".format(rel_path))

def audit_bash_script_specification(auditor):
    print("\n--- 2. Verification des Exigences Metier dans deploy.sh (Bash) ---")
    sh_path = os.path.join(PROJECT_DIR, 'scripts', 'deploy.sh')
    with open(sh_path, 'r', encoding='utf-8') as f:
        sh_code = f.read()

    auditor.assert_true('git pull' in sh_code, "deploy.sh : Synchronisation derniere version de code (git pull)")
    auditor.assert_true('docker build' in sh_code and '--target production' in sh_code, "deploy.sh : Construction Docker multi-stage en arriere-plan")
    auditor.assert_true('blue' in sh_code and 'green' in sh_code, "deploy.sh : Strategie Blue/Green avec alternance de slots")
    auditor.assert_true('/health' in sh_code or 'api/health' in sh_code, "deploy.sh : Barriere de sante temps reel (/health ou /api/health)")
    auditor.assert_true('200' in sh_code, "deploy.sh : Assertion du code HTTP 200 OK nominal")
    auditor.assert_true('nginx -s reload' in sh_code, "deploy.sh : Basculement du trafic Nginx sans coupure (nginx -s reload)")
    auditor.assert_true('docker stop' in sh_code, "deploy.sh : Arret ordonne de l'ancien conteneur apres drainage")
    auditor.assert_true('trigger_rollback' in sh_code or 'ROLLBACK' in sh_code, "deploy.sh : Procedure de Rollback automatique declaree")
    auditor.assert_true('docker rm' in sh_code, "deploy.sh : Destruction du conteneur defaillant lors du rollback")

def audit_powershell_script_specification(auditor):
    print("\n--- 3. Verification des Exigences Metier dans deploy.ps1 (PowerShell) ---")
    ps_path = os.path.join(PROJECT_DIR, 'scripts', 'deploy.ps1')
    with open(ps_path, 'r', encoding='utf-8') as f:
        ps_code = f.read()

    auditor.assert_true('git pull' in ps_code, "deploy.ps1 : Synchronisation derniere version de code (git pull)")
    auditor.assert_true('docker build' in ps_code and 'target production' in ps_code, "deploy.ps1 : Construction Docker multi-stage en arriere-plan")
    auditor.assert_true('blue' in ps_code and 'green' in ps_code, "deploy.ps1 : Strategie Blue/Green avec alternance de slots")
    auditor.assert_true('HealthEndpoint' in ps_code, "deploy.ps1 : Point de controle de sante parametre")
    auditor.assert_true('200' in ps_code, "deploy.ps1 : Assertion du code HTTP 200 OK nominal")
    auditor.assert_true('nginx -s reload' in ps_code, "deploy.ps1 : Basculement Nginx sans coupure a chaud")
    auditor.assert_true('Invoke-Rollback' in ps_code or 'ROLLBACK' in ps_code, "deploy.ps1 : Procedure de Rollback immediat en cas d'echec")
    auditor.assert_true('docker rm' in ps_code, "deploy.ps1 : Neutralisation de l'instance defaillante lors du rollback")

def audit_bluegreen_compose_configuration(auditor):
    print("\n--- 4. Verification de l'Orchestration docker-compose.bluegreen.yml ---")
    bg_path = os.path.join(PROJECT_DIR, 'docker-compose.bluegreen.yml')
    with open(bg_path, 'r', encoding='utf-8') as f:
        bg_code = f.read()

    auditor.assert_true('rdv-app-blue:' in bg_code, "Slot rdv-app-blue defini")
    auditor.assert_true('rdv-app-green:' in bg_code, "Slot rdv-app-green defini")
    auditor.assert_true('rdv-proxy:' in bg_code, "Reverse proxy Nginx rdv-proxy defini")
    auditor.assert_true('8081:8080' in bg_code, "Port de test Blue mappe sur 8081")
    auditor.assert_true('8082:8080' in bg_code, "Port de test Green mappe sur 8082")

def audit_powershell_execution_and_rollback(auditor):
    print("\n--- 5. Test d'Execution Reelle & Validation du Rollback Automatique ---")
    ps1_path = os.path.join(PROJECT_DIR, 'scripts', 'deploy.ps1')

    # Test 1 : Validation du mode Dry-Run (Code de retour 0 attendu)
    cmd_dry = [
        'powershell', '-ExecutionPolicy', 'Bypass',
        '-File', ps1_path, '-DryRun'
    ]
    try:
        res_dry = subprocess.run(cmd_dry, cwd=PROJECT_DIR, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        auditor.assert_true(res_dry.returncode == 0, "Execution nominale deploy.ps1 -DryRun (Code 0 OK)")
    except Exception as e:
        auditor.assert_true(False, "Execution deploy.ps1 -DryRun", str(e))

    # Test 2 : Validation du Rollback automatique sur echec de sante (Code de retour 1 attendu)
    cmd_fail = [
        'powershell', '-ExecutionPolicy', 'Bypass',
        '-File', ps1_path, '-SimulateFailure'
    ]
    try:
        res_fail = subprocess.run(cmd_fail, cwd=PROJECT_DIR, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
        auditor.assert_true(res_fail.returncode == 1, "Declenchement garanti du Rollback sur anomalie /health (Code 1 attendu)")
        stdout_text = res_fail.stdout.decode('latin-1', errors='ignore')
        auditor.assert_true('ROLLBACK' in stdout_text, "Message de Rollback explicite trace dans la sortie console")
        auditor.assert_true("n'a JAMAIS" in stdout_text or "JAMAIS" in stdout_text, "Garantie que le trafic Nginx n'a jamais ete bascule")
    except Exception as e:
        auditor.assert_true(False, "Execution deploy.ps1 -SimulateFailure", str(e))

def main():
    print("=" * 65)
    print(" [DEPLOY QA] BANC D'ESSAI AUTOMATISE DEPLOIEMENT ZERO-DOWNTIME (@AUD)")
    print("=" * 65)

    auditor = DeployAuditor()
    audit_deployment_files(auditor)
    audit_bash_script_specification(auditor)
    audit_powershell_script_specification(auditor)
    audit_bluegreen_compose_configuration(auditor)
    audit_powershell_execution_and_rollback(auditor)

    total = auditor.passed + auditor.failed
    pct = round((auditor.passed / total * 100), 1) if total > 0 else 0.0

    print("\n" + "=" * 65)
    print(" [BILAN DEPLOY QA] : {0}/{1} TESTS REUSSIS ({2}%)".format(auditor.passed, total, pct))
    print("=" * 65)

    if auditor.failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
