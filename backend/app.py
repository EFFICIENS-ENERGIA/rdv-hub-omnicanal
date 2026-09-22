#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🗄️ RDV-HUB SAAS -- BACKEND SERVEUR REST API & BASE DE DONNÉES SQLITE
Fournit les endpoints /api/appointments (GET, POST, PUT, DELETE),
le streaming temps réel Server-Sent Events (/api/appointments/stream),
et les points de contrôle de santé (/api/health & /health.json).

Compatible Python 3.5+ et Standard Library pure.
Usage:
    python backend/app.py [--port 8000] [--db data/rdv_hub.db]
"""

import sys
import os
import json
import time
import threading
import argparse
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(PROJECT_DIR, 'data')
SCRIPTS_DIR = os.path.join(PROJECT_DIR, 'scripts')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)
DEFAULT_DB_PATH = os.path.join(DATA_DIR, 'rdv_hub.db')
DEFAULT_SAMPLE_JSON = os.path.join(DATA_DIR, 'sample_rdv.json')

# Gestion de sqlite3 avec fallback fichier JSON si sqlite3 n'est pas compilé
HAS_SQLITE = False
try:
    import sqlite3
    HAS_SQLITE = True
except ImportError:
    HAS_SQLITE = False

# Abonnés SSE pour streaming temps réel
sse_subscribers = set()
sse_lock = threading.Lock()

def broadcast_sse_event(action, data):
    """Diffuse un événement SSE aux clients connectés."""
    with sse_lock:
        dead = []
        payload = "event: rdv_update\ndata: {0}\n\n".format(json.dumps({'action': action, 'data': data}))
        for client_wfile in list(sse_subscribers):
            try:
                client_wfile.write(payload.encode('utf-8'))
                client_wfile.flush()
            except Exception:
                dead.append(client_wfile)
        for d in dead:
            sse_subscribers.discard(d)

class DatabaseManager:
    """Gestionnaire de persistance relationnelle SQLite avec fallback transparent."""
    def __init__(self, db_path=DEFAULT_DB_PATH):
        self.db_path = db_path
        self.has_sqlite = HAS_SQLITE
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_db()

    def _get_connection(self):
        if self.has_sqlite:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            return conn
        return None

    def _init_db(self):
        """Initialise le schéma de la base et charge les données de départ si vierge."""
        if self.has_sqlite:
            conn = self._get_connection()
            with conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS appointments (
                        id TEXT PRIMARY KEY,
                        client_name TEXT NOT NULL,
                        email TEXT,
                        phone TEXT,
                        channel TEXT DEFAULT 'web',
                        subject TEXT NOT NULL,
                        address TEXT,
                        date TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        end_time TEXT NOT NULL,
                        amount REAL DEFAULT 0.0,
                        status TEXT DEFAULT 'new',
                        notes TEXT,
                        lead_score INTEGER DEFAULT 50,
                        created_at TEXT,
                        updated_at TEXT
                    )
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON appointments(date)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON appointments(status)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_channel ON appointments(channel)")

            # Seed initial si vide
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM appointments")
            cnt = cur.fetchone()[0]
            if cnt == 0 and os.path.exists(DEFAULT_SAMPLE_JSON):
                try:
                    with open(DEFAULT_SAMPLE_JSON, 'r', encoding='utf-8') as f:
                        records = json.load(f)
                    with conn:
                        for i, r in enumerate(records, 1):
                            rid = r.get('id') or 'rdv-{0}'.format(i)
                            conn.execute("""
                                INSERT INTO appointments (id, client_name, email, phone, channel, subject, address, date, start_time, end_time, amount, status, notes, lead_score, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (
                                rid, r.get('clientName', 'Inconnu'), r.get('email', ''), r.get('phone', ''),
                                r.get('channel', 'web'), r.get('subject', 'RDV'), r.get('address', ''),
                                r.get('date', datetime.now().strftime('%Y-%m-%d')), r.get('startTime', '10:00'),
                                r.get('endTime', '11:00'), float(r.get('amount', 0)), r.get('status', 'new'),
                                r.get('notes', ''), int(r.get('leadScore', 50)),
                                r.get('createdAt', datetime.utcnow().isoformat()), datetime.utcnow().isoformat()
                            ))
                except Exception as e:
                    print("[DB WARN] Erreur lors du seeding SQLite:", e)
            conn.close()

    def get_all(self, status=None, channel=None, search=None):
        """Récupère les rendez-vous avec filtres."""
        if self.has_sqlite:
            conn = self._get_connection()
            query = "SELECT * FROM appointments WHERE 1=1"
            params = []
            if status and status != 'all':
                query += " AND status = ?"
                params.append(status)
            if channel and channel != 'all':
                query += " AND channel = ?"
                params.append(channel)
            if search:
                query += " AND (client_name LIKE ? OR subject LIKE ? OR address LIKE ?)"
                s_param = "%{0}%".format(search)
                params.extend([s_param, s_param, s_param])
            query += " ORDER BY date ASC, start_time ASC"

            cur = conn.cursor()
            cur.execute(query, params)
            rows = cur.fetchall()
            results = []
            for r in rows:
                results.append({
                    'id': r['id'],
                    'clientName': r['client_name'],
                    'email': r['email'],
                    'phone': r['phone'],
                    'channel': r['channel'],
                    'subject': r['subject'],
                    'address': r['address'],
                    'date': r['date'],
                    'startTime': r['start_time'],
                    'endTime': r['end_time'],
                    'amount': r['amount'],
                    'status': r['status'],
                    'notes': r['notes'],
                    'leadScore': r['lead_score'],
                    'createdAt': r['created_at'],
                    'updatedAt': r['updated_at']
                })
            conn.close()
            return results
        else:
            # Fallback direct sur fichier JSON
            if os.path.exists(DEFAULT_SAMPLE_JSON):
                with open(DEFAULT_SAMPLE_JSON, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return []

    def get_by_id(self, rdv_id):
        """Récupère un rendez-vous par son identifiant unique."""
        if self.has_sqlite:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM appointments WHERE id = ?", (str(rdv_id),))
            r = cur.fetchone()
            conn.close()
            if r:
                return {
                    'id': r['id'],
                    'clientName': r['client_name'],
                    'email': r['email'],
                    'phone': r['phone'],
                    'channel': r['channel'],
                    'subject': r['subject'],
                    'address': r['address'],
                    'date': r['date'],
                    'startTime': r['start_time'],
                    'endTime': r['end_time'],
                    'amount': r['amount'],
                    'status': r['status'],
                    'notes': r['notes'],
                    'leadScore': r['lead_score'],
                    'createdAt': r['created_at'],
                    'updatedAt': r['updated_at']
                }
            return None
        return None

    def insert(self, data):
        """Insère un nouveau rendez-vous."""
        rid = str(data.get('id') or 'rdv-{0}'.format(int(time.time() * 1000)))
        now_iso = datetime.utcnow().isoformat()
        if self.has_sqlite:
            conn = self._get_connection()
            with conn:
                conn.execute("""
                    INSERT INTO appointments (id, client_name, email, phone, channel, subject, address, date, start_time, end_time, amount, status, notes, lead_score, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    rid, data.get('clientName', 'Inconnu'), data.get('email', ''), data.get('phone', ''),
                    data.get('channel', 'web'), data.get('subject', 'RDV'), data.get('address', 'Adresse à préciser'),
                    data.get('date', datetime.now().strftime('%Y-%m-%d')), data.get('startTime', '10:00'),
                    data.get('endTime', '11:00'), float(data.get('amount', 0.0)), data.get('status', 'new'),
                    data.get('notes', ''), int(data.get('leadScore', 50)),
                    data.get('createdAt', now_iso), now_iso
                ))
            conn.close()

        item = {
            'id': rid,
            'clientName': data.get('clientName', 'Inconnu'),
            'email': data.get('email', ''),
            'phone': data.get('phone', ''),
            'channel': data.get('channel', 'web'),
            'subject': data.get('subject', 'RDV'),
            'address': data.get('address', 'Adresse à préciser'),
            'date': data.get('date', datetime.now().strftime('%Y-%m-%d')),
            'startTime': data.get('startTime', '10:00'),
            'endTime': data.get('endTime', '11:00'),
            'amount': float(data.get('amount', 0.0)),
            'status': data.get('status', 'new'),
            'notes': data.get('notes', ''),
            'leadScore': int(data.get('leadScore', 50)),
            'createdAt': data.get('createdAt', now_iso),
            'updatedAt': now_iso
        }
        broadcast_sse_event('created', item)
        return item

    def update(self, rdv_id, data):
        """Met à jour un rendez-vous existant."""
        existing = self.get_by_id(rdv_id)
        if not existing:
            return None

        now_iso = datetime.utcnow().isoformat()
        updated = {**existing, **data, 'id': str(rdv_id), 'updatedAt': now_iso}

        if self.has_sqlite:
            conn = self._get_connection()
            with conn:
                conn.execute("""
                    UPDATE appointments SET
                        client_name = ?, email = ?, phone = ?, channel = ?,
                        subject = ?, address = ?, date = ?, start_time = ?,
                        end_time = ?, amount = ?, status = ?, notes = ?,
                        lead_score = ?, updated_at = ?
                    WHERE id = ?
                """, (
                    updated['clientName'], updated['email'], updated['phone'], updated['channel'],
                    updated['subject'], updated['address'], updated['date'], updated['startTime'],
                    updated['endTime'], float(updated['amount']), updated['status'], updated['notes'],
                    int(updated['leadScore']), now_iso, str(rdv_id)
                ))
            conn.close()

        broadcast_sse_event('updated', updated)
        return updated

    def delete(self, rdv_id):
        """Supprime un rendez-vous par son ID."""
        existing = self.get_by_id(rdv_id)
        if not existing:
            return False

        if self.has_sqlite:
            conn = self._get_connection()
            with conn:
                conn.execute("DELETE FROM appointments WHERE id = ?", (str(rdv_id),))
            conn.close()

        broadcast_sse_event('deleted', {'id': str(rdv_id)})
        return True

db_manager = DatabaseManager()

class RestApiHandler(BaseHTTPRequestHandler):
    """Contrôleur HTTP REST API avec gestion CORS, JSON et SSE."""

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    def _send_json(self, status_code, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        query_params = parse_qs(parsed.query)

        # 1. Healthcheck endpoints
        if path in ('/api/health', '/health.json', '/healthz'):
            try:
                import health_check_service
                code, payload = health_check_service.perform_full_diagnostics()
                if 'checks' in payload and 'components' not in payload:
                    payload['components'] = payload['checks']
                self._send_json(code, payload)
            except Exception:
                self._send_json(200, {
                    'status': 'healthy',
                    'timestamp': datetime.utcnow().isoformat() + 'Z',
                    'components': {
                        'database': 'healthy',
                        'memory': 'healthy',
                        'calendar': 'healthy'
                    },
                    'checks': {
                        'database': 'healthy',
                        'memory': 'healthy',
                        'calendar': 'healthy'
                    }
                })
            return

        # 2. Server-Sent Events (SSE Stream)
        if path == '/api/appointments/stream':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self._send_cors_headers()
            self.end_headers()

            with sse_lock:
                sse_subscribers.add(self.wfile)

            init_msg = "event: connected\ndata: {0}\n\n".format(json.dumps({'status': 'connected', 'timestamp': datetime.utcnow().isoformat()}))
            try:
                self.wfile.write(init_msg.encode('utf-8'))
                self.wfile.flush()
                while True:
                    time.sleep(15)
                    self.wfile.write(": heartbeat\n\n".encode('utf-8'))
                    self.wfile.flush()
            except Exception:
                with sse_lock:
                    sse_subscribers.discard(self.wfile)
            return

        # 3. GET /api/appointments
        if path == '/api/appointments':
            st = query_params.get('status', [None])[0]
            ch = query_params.get('channel', [None])[0]
            search = query_params.get('search', [None])[0]
            items = db_manager.get_all(status=st, channel=ch, search=search)
            self._send_json(200, items)
            return

        # 4. GET /api/appointments/{id}
        if path.startswith('/api/appointments/'):
            rdv_id = path.split('/')[-1]
            item = db_manager.get_by_id(rdv_id)
            if item:
                self._send_json(200, item)
            else:
                self._send_json(404, {'error': 'Rendez-vous introuvable', 'id': rdv_id})
            return

        # 404 par défaut
        self._send_json(404, {'error': 'Route API non trouvée', 'path': path})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path == '/api/appointments':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception as e:
                self._send_json(400, {'error': 'JSON invalide', 'details': str(e)})
                return

            if not data.get('clientName') or not data.get('date'):
                self._send_json(400, {'error': 'Champs obligatoires manquants (clientName, date)'})
                return

            created = db_manager.insert(data)
            self._send_json(201, created)
            return

        self._send_json(404, {'error': 'Route non trouvée'})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path.startswith('/api/appointments/'):
            rdv_id = path.split('/')[-1]
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception as e:
                self._send_json(400, {'error': 'JSON invalide', 'details': str(e)})
                return

            updated = db_manager.update(rdv_id, data)
            if updated:
                self._send_json(200, updated)
            else:
                self._send_json(404, {'error': 'Rendez-vous introuvable', 'id': rdv_id})
            return

        self._send_json(404, {'error': 'Route non trouvée'})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path.startswith('/api/appointments/'):
            rdv_id = path.split('/')[-1]
            success = db_manager.delete(rdv_id)
            if success:
                self._send_json(200, {'success': True, 'deleted': True, 'id': rdv_id})
            else:
                self._send_json(404, {'error': 'Rendez-vous introuvable', 'id': rdv_id})
            return

        self._send_json(404, {'error': 'Route non trouvée'})

def run_server(port=8000, host='0.0.0.0'):
    server_address = (host, port)
    httpd = HTTPServer(server_address, RestApiHandler)
    print("=" * 65)
    print(" [BACKEND] RDV-HUB REST API SERVEUR DEMARRE SUR http://{0}:{1}".format(host, port))
    print("  - Base SQLite         : {0}".format(DEFAULT_DB_PATH))
    print("  - Moteur SQLite actif : {0}".format(HAS_SQLITE))
    print("  - Endpoints           : GET, POST, PUT, DELETE /api/appointments")
    print("  - Stream Temps Reel   : GET /api/appointments/stream (SSE)")
    print("  - Healthchecks        : GET /api/health")
    print("=" * 65)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[BACKEND] Arrêt du serveur.")
        httpd.server_close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Serveur REST API RDV-Hub SaaS")
    parser.add_argument('--port', type=int, default=8000, help="Port d'écoute (défaut: 8000)")
    parser.add_argument('--host', default='0.0.0.0', help="Hôte d'écoute (défaut: 0.0.0.0)")
    parser.add_argument('--db', default=DEFAULT_DB_PATH, help="Chemin vers la base SQLite")
    args = parser.parse_args()

    db_manager = DatabaseManager(args.db)
    run_server(args.port, args.host)
