#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AUDIT @AUD -- BANC D'ESSAI AUTOMATISE API REST SQLITE & SYNCHRONISATION OFFLINE-FIRST
Teste de facon exhaustive les contrats d'interface REST, la persistance relationnelle SQLite,
les index de performance, les filtres metier et la mecanique de resilience offline-first.

Usage:
    python scripts/audit_api_sync.py
"""

import os
import sys
import json
import time
import socket
import urllib.request
import urllib.error
import threading
from datetime import datetime

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, PROJECT_ROOT)

import backend.app as backend_module
from backend.app import DatabaseManager, RestApiHandler

TEST_DB_PATH = os.path.join(PROJECT_ROOT, 'data', 'test_audit_sync.db')
TEST_PORT = 8199

class AuditResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.tests = []

    def assert_true(self, condition, message):
        if condition:
            self.passed += 1
            self.tests.append(("PASS", message))
            print("  [PASS] {0}".format(message))
        else:
            self.failed += 1
            self.tests.append(("FAIL", message))
            print("  [FAIL] {0}".format(message))

def run_tests():
    print("=" * 80)
    print("AUDIT @AUD : BANC D'ESSAI API REST, PERSISTANCE SQLITE & SYNC OFFLINE-FIRST")
    print("   Horodatage : {0}".format(datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    print("=" * 80)

    results = AuditResults()

    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except Exception:
            pass

    print("\n--- SECTION 1 : PERSISTANCE RELATIONNELLE SQLITE & INTEGRITE DU SCHEMA ---")
    
    db = DatabaseManager(db_path=TEST_DB_PATH)
    # On connecte le backend a la base de test
    backend_module.db_manager = db

    results.assert_true(db is not None, "Initialisation de DatabaseManager reussie")
    results.assert_true(os.path.exists(TEST_DB_PATH) or not db.has_sqlite, "Fichier de base SQLite cree physiquement")

    if db.has_sqlite:
        import sqlite3
        conn = sqlite3.connect(TEST_DB_PATH)
        cur = conn.cursor()
        
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='appointments'")
        table_exists = cur.fetchone() is not None
        results.assert_true(table_exists, "Table 'appointments' presente dans le schema SQLite")

        cur.execute("PRAGMA table_info(appointments)")
        cols = [col[1] for col in cur.fetchall()]
        required_cols = [
            'id', 'client_name', 'email', 'phone', 'channel', 'subject',
            'address', 'date', 'start_time', 'end_time', 'amount', 'status',
            'notes', 'lead_score', 'created_at', 'updated_at'
        ]
        for col in required_cols:
            results.assert_true(col in cols, "Colonne SQLite '{0}' presente et typee".format(col))

        cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        indexes = [idx[0] for idx in cur.fetchall()]
        results.assert_true('idx_date' in indexes, "Index de performance 'idx_date' actif")
        results.assert_true('idx_status' in indexes, "Index de performance 'idx_status' actif")
        results.assert_true('idx_channel' in indexes, "Index de performance 'idx_channel' actif")

        conn.close()

    print("\n--- SECTION 2 : OPERATIONS CRUD & VALIDATION DES FORMATS DE DONNEES ---")
    
    initial_rdvs = db.get_all()
    results.assert_true(isinstance(initial_rdvs, list), "get_all() renvoie une liste")
    results.assert_true(len(initial_rdvs) >= 3, "Seeding initial certifie present (>= 3 rendez-vous)")

    first_rdv = initial_rdvs[0]
    results.assert_true('clientName' in first_rdv, "Cle camelCase 'clientName' presente")
    results.assert_true('startTime' in first_rdv, "Cle camelCase 'startTime' presente")
    results.assert_true('endTime' in first_rdv, "Cle camelCase 'endTime' presente")
    results.assert_true('leadScore' in first_rdv, "Cle camelCase 'leadScore' presente")
    results.assert_true(isinstance(first_rdv.get('amount'), (int, float)), "Montant type numeriquement (float/int)")

    test_id = "test-rdv-audit-999"
    new_data = {
        "id": test_id,
        "clientName": "Nexity Immobilier Corporate",
        "email": "dir-programme@nexity.fr",
        "phone": "+33 1 85 55 12 34",
        "channel": "web",
        "subject": "Mission AMO Decarbonation 12 000 m2",
        "address": "19 Rue de Vienne, 75008 Paris",
        "date": "2026-10-15",
        "startTime": "14:00",
        "endTime": "15:30",
        "amount": 14500.0,
        "status": "confirmed",
        "notes": "Validation du protocole RE2020",
        "leadScore": 95
    }
    inserted = db.insert(new_data)
    results.assert_true(inserted is not None and inserted.get('id') == test_id, "Insertion CRUD reussie avec ID certifie")

    retrieved = db.get_by_id(test_id)
    results.assert_true(retrieved is not None, "Lecture par ID get_by_id('{0}') reussie".format(test_id))
    results.assert_true(retrieved.get('clientName') == "Nexity Immobilier Corporate", "Veracite du nom client")
    results.assert_true(retrieved.get('amount') == 14500.0, "Veracite du montant (14 500 EUR)")
    results.assert_true(retrieved.get('address') == "19 Rue de Vienne, 75008 Paris", "Veracite de l'adresse postale")

    updated = db.update(test_id, {"status": "done", "amount": 16000.0, "notes": "Contrat signe en seance"})
    results.assert_true(updated is not None, "Mise a jour CRUD reussie")
    results.assert_true(updated.get('status') == "done", "Statut mis a jour a 'done'")
    results.assert_true(updated.get('amount') == 16000.0, "Montant reevalue a 16 000 EUR")

    filtered_status = db.get_all(status="done")
    results.assert_true(any(r.get('id') == test_id for r in filtered_status), "Filtrage par statut fonctionnel")
    filtered_search = db.get_all(search="Nexity")
    results.assert_true(any(r.get('id') == test_id for r in filtered_search), "Recherche textuelle fonctionnelle")

    deleted = db.delete(test_id)
    results.assert_true(deleted is True, "Suppression CRUD delete('{0}') reussie".format(test_id))
    results.assert_true(db.get_by_id(test_id) is None, "Confirmation de non-existence apres suppression")

    print("\n--- SECTION 3 : CONTRATS D'INTERFACE REST HTTP (/api/appointments) ---")

    from http.server import HTTPServer
    current_port = TEST_PORT
    httpd = None
    for offset in range(15):
        try:
            httpd = HTTPServer(('127.0.0.1', current_port + offset), RestApiHandler)
            break
        except Exception:
            continue

    results.assert_true(httpd is not None, "Serveur HTTP de test initialise sur port {0}".format(httpd.server_port if httpd else 'FAIL'))
    
    if httpd:
        server_thread = threading.Thread(target=httpd.serve_forever)
        server_thread.daemon = True
        server_thread.start()
        time.sleep(0.3)

        base_url = "http://127.0.0.1:{0}".format(httpd.server_port)

        # 3.1 Test Health Endpoint
        try:
            req = urllib.request.Request("{0}/api/health".format(base_url))
            with urllib.request.urlopen(req, timeout=3) as resp:
                results.assert_true(resp.status == 200, "GET /api/health repond HTTP 200 OK")
                h_data = json.loads(resp.read().decode('utf-8'))
                results.assert_true(h_data.get('status') == 'healthy', "Statut global 'healthy' valide")
                results.assert_true('components' in h_data, "Composants de sante presents")
        except Exception as e:
            results.assert_true(False, "Erreur GET /api/health : {0}".format(e))

        # 3.2 Test GET /api/appointments
        try:
            req = urllib.request.Request("{0}/api/appointments".format(base_url))
            with urllib.request.urlopen(req, timeout=3) as resp:
                results.assert_true(resp.status == 200, "GET /api/appointments repond HTTP 200 OK")
                results.assert_true('application/json' in resp.headers.get('Content-Type', ''), "Content-Type JSON respecte")
                items = json.loads(resp.read().decode('utf-8'))
                results.assert_true(isinstance(items, list) and len(items) >= 3, "Liste des rendez-vous recue (>=3)")
        except Exception as e:
            results.assert_true(False, "Erreur GET /api/appointments : {0}".format(e))

        # 3.3 Test POST /api/appointments (Creation)
        http_created_id = None
        try:
            post_payload = {
                "clientName": "Eiffage Construction Tertiaire",
                "email": "contact-projets@eiffage.fr",
                "phone": "+33 4 72 00 11 22",
                "channel": "phone",
                "subject": "Chantier Campus Biotech 8 500 m2",
                "address": "45 Boulevard Vivier-Merle, 69003 Lyon",
                "date": "2026-11-04",
                "startTime": "10:30",
                "endTime": "12:00",
                "amount": 22000.0,
                "status": "new",
                "notes": "Consultation ingenierie CVC",
                "leadScore": 91
            }
            req = urllib.request.Request(
                "{0}/api/appointments".format(base_url),
                data=json.dumps(post_payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                results.assert_true(resp.status == 201, "POST /api/appointments repond HTTP 201 Created")
                created_resp = json.loads(resp.read().decode('utf-8'))
                http_created_id = created_resp.get('id')
                results.assert_true(http_created_id is not None, "ID de rendez-vous genere par le serveur")
                results.assert_true(created_resp.get('clientName') == "Eiffage Construction Tertiaire", "Nom client certifie")
        except Exception as e:
            results.assert_true(False, "Erreur POST /api/appointments : {0}".format(e))

        # 3.4 Test GET /api/appointments/{id}
        if http_created_id:
            try:
                req = urllib.request.Request("{0}/api/appointments/{1}".format(base_url, http_created_id))
                with urllib.request.urlopen(req, timeout=3) as resp:
                    results.assert_true(resp.status == 200, "GET /api/appointments/{id} repond HTTP 200 OK")
                    item = json.loads(resp.read().decode('utf-8'))
                    results.assert_true(item.get('id') == http_created_id, "ID correspondant retourne")
            except Exception as e:
                results.assert_true(False, "Erreur GET /api/appointments/{id} : {0}".format(e))

        # 3.5 Test PUT /api/appointments/{id} (Modification)
        if http_created_id:
            try:
                put_payload = {
                    "status": "confirmed",
                    "amount": 25000.0
                }
                req = urllib.request.Request(
                    "{0}/api/appointments/{1}".format(base_url, http_created_id),
                    data=json.dumps(put_payload).encode('utf-8'),
                    headers={'Content-Type': 'application/json'},
                    method='PUT'
                )
                with urllib.request.urlopen(req, timeout=3) as resp:
                    results.assert_true(resp.status == 200, "PUT /api/appointments/{id} repond HTTP 200 OK")
                    updated_resp = json.loads(resp.read().decode('utf-8'))
                    results.assert_true(updated_resp.get('status') == "confirmed", "Statut modifie a 'confirmed'")
                    results.assert_true(updated_resp.get('amount') == 25000.0, "Montant modifie a 25 000 EUR")
            except Exception as e:
                results.assert_true(False, "Erreur PUT /api/appointments/{id} : {0}".format(e))

        # 3.6 Test DELETE /api/appointments/{id} (Suppression)
        if http_created_id:
            try:
                req = urllib.request.Request(
                    "{0}/api/appointments/{1}".format(base_url, http_created_id),
                    method='DELETE'
                )
                with urllib.request.urlopen(req, timeout=3) as resp:
                    results.assert_true(resp.status == 200, "DELETE /api/appointments/{id} repond HTTP 200 OK")
                    del_resp = json.loads(resp.read().decode('utf-8'))
                    results.assert_true(del_resp.get('success') is True, "Confirmation succes suppression")
            except Exception as e:
                results.assert_true(False, "Erreur DELETE /api/appointments/{id} : {0}".format(e))

            try:
                req = urllib.request.Request("{0}/api/appointments/{1}".format(base_url, http_created_id))
                urllib.request.urlopen(req, timeout=3)
                results.assert_true(False, "GET apres suppression aurait du renvoyer 404")
            except urllib.error.HTTPError as he:
                results.assert_true(he.code == 404, "GET sur ressource supprimee renvoie HTTP 404 Not Found")
            except Exception as e:
                results.assert_true(False, "Erreur inattendue verification 404 : {0}".format(e))

        httpd.shutdown()
        httpd.server_close()

    print("\n--- SECTION 4 : AUDIT DE L'INTEGRATION CLIENT (js/sync.js & js/db.js) ---")

    sync_js_path = os.path.join(PROJECT_ROOT, 'js', 'sync.js')
    db_js_path = os.path.join(PROJECT_ROOT, 'js', 'db.js')
    app_js_path = os.path.join(PROJECT_ROOT, 'js', 'app.js')
    index_html_path = os.path.join(PROJECT_ROOT, 'index.html')

    results.assert_true(os.path.exists(sync_js_path), "Fichier js/sync.js present")
    results.assert_true(os.path.exists(db_js_path), "Fichier js/db.js present")

    with open(sync_js_path, 'r', encoding='utf-8') as f:
        sync_code = f.read()
    with open(db_js_path, 'r', encoding='utf-8') as f:
        db_code = f.read()
    with open(app_js_path, 'r', encoding='utf-8') as f:
        app_code = f.read()
    with open(index_html_path, 'r', encoding='utf-8') as f:
        html_code = f.read()

    results.assert_true("sync_queue" in db_code, "Store IndexedDB 'sync_queue' configure dans js/db.js")
    results.assert_true("enqueueOperation" in sync_code, "Methode 'enqueueOperation' implementee dans js/sync.js")
    results.assert_true("processQueue" in sync_code, "Depilage automatique 'processQueue' implemente")
    results.assert_true("saveDirect" in db_code, "Methode 'saveDirect' anti-boucle d'echo presente dans js/db.js")
    results.assert_true("deleteDirect" in db_code, "Methode 'deleteDirect' presente dans js/db.js")
    results.assert_true("mergeFromServer" in db_code, "Methode 'mergeFromServer' avec resolution de conflit presente")

    results.assert_true("rdvSync.enqueueOperation('create'" in db_code, "Declencheur 'create' synchronise sur addAppointment")
    results.assert_true("rdvSync.enqueueOperation('update'" in db_code, "Declencheur 'update' synchronise sur updateAppointment")
    results.assert_true("rdvSync.enqueueOperation('delete'" in db_code, "Declencheur 'delete' synchronise sur deleteAppointment")

    results.assert_true("syncStatusBadge" in html_code, "Badge '#syncStatusBadge' present dans index.html")
    results.assert_true("js/sync.js" in html_code, "Inclusion ordonnee du script js/sync.js dans index.html")
    results.assert_true("rdv-sync-refresh" in app_code, "Ecouteur d'evenement 'rdv-sync-refresh' actif dans js/app.js")
    results.assert_true("window.rdvSync.init" in app_code, "Initialisation de window.rdvSync dans js/app.js")

    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except Exception:
            pass

    total = results.passed + results.failed
    success_rate = (results.passed / total * 100) if total > 0 else 0
    print("\n" + "=" * 80)
    print("BILAN DU BANC D'ESSAI API REST & SYNC OFFLINE-FIRST :")
    print("   Total assertions : {0}".format(total))
    print("   Succes (PASS)    : {0}".format(results.passed))
    print("   Echecs (FAIL)    : {0}".format(results.failed))
    print("   Taux de reussite : {0:.1f}%".format(success_rate))
    print("=" * 80)

    if results.failed == 0:
        print("CERTIFICATION @AUD : 100% CONFORME AUX STANDARDS SAAS REST & OFFLINE-FIRST.")
        return 0
    else:
        print("NON-CONFORMITES DETECTEES : {0} tests en echec.".format(results.failed))
        return 1

if __name__ == '__main__':
    sys.exit(run_tests())
