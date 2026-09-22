#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🩺 AUDIT SENIOR QA & SECURITY (@AUD) -- BANC D'ESSAI AUTOMATISE ENDPOINT D'ETAT DE SANTE
Validation des diagnostics temps reel : stockage/DB, memoire, agenda, code 200 OK et bascule 503 en cas de panne.
Compatible Python 3.5+ et Windows CP1252.
"""

import sys
import os
import json

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(PROJECT_DIR, 'scripts'))

class HealthAuditor:
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

def audit_health_service_nominal(auditor):
    print("\n--- 1. Diagnostic de Sante en Conditions Normales (HTTP 200 OK) ---")
    import health_check_service
    health_check_service.SIMULATE_FAILURE = False

    code, payload = health_check_service.perform_full_diagnostics()

    auditor.assert_true(code == 200, "Code de retour nominal conforme (HTTP 200 OK)", "Reçu: {0}".format(code))
    auditor.assert_true(payload.get('status') == 'healthy', "Statut global conforme (status: 'healthy')")
    auditor.assert_true('timestamp' in payload, "Champ timestamp ISO 8601 present")
    auditor.assert_true('uptime_seconds' in payload, "Metrique uptime_seconds presente")
    auditor.assert_true('UptimeRobot' in payload.get('monitoring_compatible', []), "Compatibilite UptimeRobot certifiee")

    # Verification des 3 sous-systemes
    checks = payload.get('checks', {})
    db_check = checks.get('database_storage', {})
    mem_check = checks.get('memory', {})
    engine_check = checks.get('calendar_engine', {})

    auditor.assert_true(db_check.get('status') == 'up', "Diagnostic Stockage/Base : operationnel (status: 'up')")
    auditor.assert_true('latency_ms' in db_check, "Diagnostic Stockage/Base : mesure de latence I/O presente")
    auditor.assert_true(mem_check.get('status') == 'healthy', "Diagnostic Memoire : statut conforme (status: 'healthy')")
    auditor.assert_true(mem_check.get('percent', 100) < 90.0, "Diagnostic Memoire : consommation inferieure au seuil d'alarme (90%)")
    auditor.assert_true(engine_check.get('status') == 'operational', "Diagnostic Moteur d'Agenda : collision detectee (status: 'operational')")

def audit_health_service_failure_simulation(auditor):
    print("\n--- 2. Test de Resilience & Alerte Moniteur (Bascule HTTP 503) ---")
    import health_check_service
    # Simulation d'une panne du stockage
    health_check_service.SIMULATE_FAILURE = True

    code, payload = health_check_service.perform_full_diagnostics()

    auditor.assert_true(code == 503, "Code de retour d'anomalie conforme (HTTP 503 Service Unavailable)", "Reçu: {0}".format(code))
    auditor.assert_true(payload.get('status') == 'unhealthy', "Statut de defaillance conforme (status: 'unhealthy')")
    auditor.assert_true('failed_checks' in payload, "Detail des sous-systemes en defaillance retourne pour UptimeRobot")
    auditor.assert_true(payload.get('checks', {}).get('database_storage', {}).get('status') == 'down', "Sous-systeme defaillant identifie comme down")

    # Restauration de l'etat normal
    health_check_service.SIMULATE_FAILURE = False

def audit_health_json_file(auditor):
    print("\n--- 3. Verification du Fichier Miroir data/health.json ---")
    h_path = os.path.join(PROJECT_DIR, 'data', 'health.json')
    auditor.assert_true(os.path.exists(h_path), "Presence du fichier data/health.json")

    if os.path.exists(h_path):
        with open(h_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        auditor.assert_true(data.get('status') == 'healthy', "Contenu de data/health.json : healthy")
        auditor.assert_true('checks' in data, "Arborescence des verifications presente dans data/health.json")

def audit_service_worker_health_interception(auditor):
    print("\n--- 4. Verification de l'Interception par le Service Worker (PWA Offline) ---")
    sw_path = os.path.join(PROJECT_DIR, 'sw.js')
    with open(sw_path, 'r', encoding='utf-8') as f:
        sw_code = f.read()

    auditor.assert_true('/api/health' in sw_code, "Interception de /api/health declaree dans sw.js")
    auditor.assert_true('/health.json' in sw_code, "Interception de /health.json declaree dans sw.js")
    auditor.assert_true('generateBrowserHealthResponse' in sw_code, "Moteur de diagnostic in-browser implemente dans sw.js")
    auditor.assert_true('IndexedDB' in sw_code, "Verification de persistance IndexedDB dans le diagnostic client")

def audit_nginx_health_routing(auditor):
    print("\n--- 5. Verification du Routage Nginx (/api/health & /health.json) ---")
    app_conf = os.path.join(PROJECT_DIR, 'docker', 'app', 'nginx-app.conf')
    proxy_conf = os.path.join(PROJECT_DIR, 'docker', 'proxy', 'default.conf')
    prod_conf = os.path.join(PROJECT_DIR, 'docker', 'proxy', 'nginx.production.conf')

    with open(app_conf, 'r', encoding='utf-8') as f:
        a_code = f.read()
    auditor.assert_true('api/health' in a_code and ('health.json' in a_code or 'health\\.json' in a_code), "Routage /api/health configure dans nginx-app.conf")

    with open(proxy_conf, 'r', encoding='utf-8') as f:
        p_code = f.read()
    auditor.assert_true('api/health' in p_code and ('health.json' in p_code or 'health\\.json' in p_code), "Routage /api/health configure dans default.conf")

    with open(prod_conf, 'r', encoding='utf-8') as f:
        pr_code = f.read()
    auditor.assert_true('api/health' in pr_code and ('health.json' in pr_code or 'health\\.json' in pr_code), "Routage /api/health configure dans nginx.production.conf")

def main():
    print("=" * 65)
    print(" [HEALTH QA] BANC D'ESSAI AUTOMATISE ENDPOINT D ETAT DE SANTE (@AUD)")
    print("=" * 65)
    auditor = HealthAuditor()
    audit_health_service_nominal(auditor)
    audit_health_service_failure_simulation(auditor)
    audit_health_json_file(auditor)
    audit_service_worker_health_interception(auditor)
    audit_nginx_health_routing(auditor)

    total = auditor.passed + auditor.failed
    pct = round((auditor.passed / total * 100), 1) if total > 0 else 0.0

    print("\n" + "=" * 65)
    print(" [BILAN HEALTH QA] : {0}/{1} TESTS REUSSIS ({2}%)".format(auditor.passed, total, pct))
    print("=" * 65)

    if auditor.failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
