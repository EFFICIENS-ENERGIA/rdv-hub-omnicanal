#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🛡️ AUDIT SENIOR QA & SECURITY (@AUD) -- BANC D'ESSAI AUTOMATISE INFRASTRUCTURE DOCKER
Verification de conformite du Dockerfile multi-stage, docker-compose.yml, Nginx reverse proxy et fichiers .env.
Compatible Python 3.5+ et Windows CP1252.
"""

import sys
import os
import re

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

class DockerAuditor:
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

def audit_dockerfile(auditor):
    print("\n--- 1. Audit du Dockerfile (Multi-Stage Build & Hardening) ---")
    df_path = os.path.join(PROJECT_DIR, 'Dockerfile')
    auditor.assert_true(os.path.exists(df_path), "Presence du fichier Dockerfile a la racine")

    if not os.path.exists(df_path):
        return

    with open(df_path, 'r', encoding='utf-8') as f:
        content = f.read()

    auditor.assert_true('FROM' in content and 'AS builder' in content, "Multi-stage build : Stage 1 (builder) defini")
    auditor.assert_true('AS production' in content, "Multi-stage build : Stage 2 (production) defini")
    auditor.assert_true('COPY --from=builder' in content, "Transfert securise des artefacts depuis le stage builder")
    auditor.assert_true('USER 101' in content or 'USER nginx' in content, "Securite : Execution sous utilisateur non-root (Non-privileged)")
    auditor.assert_true('EXPOSE 8080' in content, "Exposition du port non-root standard (8080)")
    auditor.assert_true('HEALTHCHECK' in content, "Directive HEALTHCHECK integree pour la surveillance d'etat")

def audit_docker_compose(auditor):
    print("\n--- 2. Audit de l'Orchestration docker-compose.yml ---")
    dc_path = os.path.join(PROJECT_DIR, 'docker-compose.yml')
    auditor.assert_true(os.path.exists(dc_path), "Presence du fichier docker-compose.yml a la racine")

    if not os.path.exists(dc_path):
        return

    with open(dc_path, 'r', encoding='utf-8') as f:
        content = f.read()

    auditor.assert_true('rdv-app:' in content, "Definition du service applicatif rdv-app")
    auditor.assert_true('rdv-proxy:' in content, "Definition du service reverse proxy rdv-proxy")
    auditor.assert_true('depends_on:' in content and 'service_healthy' in content, "Ordonnancement avec verification d'etat (depends_on service_healthy)")
    auditor.assert_true('volumes:' in content, "Section de gestion des volumes persistants presente")
    auditor.assert_true('rdv_data:' in content, "Volume persistant nomme rdv_data defini")
    auditor.assert_true('rdv_proxy_logs:' in content, "Volume persistant nomme rdv_proxy_logs defini")
    auditor.assert_true('networks:' in content, "Section d'isolation reseau presente")
    auditor.assert_true('rdv-internal-network:' in content, "Reseau bridge interne rdv-internal-network configure")
    auditor.assert_true('env_file:' in content and '.env' in content, "Liaison explicite avec le fichier d'environnement .env")

def audit_env_and_security(auditor):
    print("\n--- 3. Audit des Variables d'Environnement & Confidentialite (.env) ---")
    env_example_path = os.path.join(PROJECT_DIR, '.env.example')
    env_path = os.path.join(PROJECT_DIR, '.env')
    dignore_path = os.path.join(PROJECT_DIR, '.dockerignore')
    gignore_path = os.path.join(PROJECT_DIR, '.gitignore')

    auditor.assert_true(os.path.exists(env_example_path), "Presence du modele de configuration .env.example")
    auditor.assert_true(os.path.exists(env_path), "Presence du fichier actif .env")
    auditor.assert_true(os.path.exists(dignore_path), "Presence du fichier .dockerignore")
    auditor.assert_true(os.path.exists(gignore_path), "Presence du fichier .gitignore")

    # Verification des variables obligatoires
    with open(env_path, 'r', encoding='utf-8') as f:
        env_content = f.read()

    auditor.assert_true('HOST_PORT=' in env_content, "Variable HOST_PORT configuree")
    auditor.assert_true('APP_SECRET_KEY=' in env_content, "Variable critique APP_SECRET_KEY configuree")
    auditor.assert_true('DEFAULT_GOOGLE_EMAIL=' in env_content, "Variable DEFAULT_GOOGLE_EMAIL configuree")
    auditor.assert_true('WAZE_BASE_URL=' in env_content, "Variable WAZE_BASE_URL configuree")

    # Verification anti-fuite dans .dockerignore et .gitignore
    with open(dignore_path, 'r', encoding='utf-8') as f:
        dignore_content = f.read()
    with open(gignore_path, 'r', encoding='utf-8') as f:
        gignore_content = f.read()

    auditor.assert_true('.env' in dignore_content, "Securite : exclusion de .env dans .dockerignore")
    auditor.assert_true('.env' in gignore_content, "Securite : exclusion de .env dans .gitignore")

def audit_nginx_configuration(auditor):
    print("\n--- 4. Audit de la Configuration Nginx Reverse Proxy ---")
    proxy_conf = os.path.join(PROJECT_DIR, 'docker', 'proxy', 'default.conf')
    proxy_main = os.path.join(PROJECT_DIR, 'docker', 'proxy', 'nginx.conf')
    app_conf = os.path.join(PROJECT_DIR, 'docker', 'app', 'nginx-app.conf')

    auditor.assert_true(os.path.exists(proxy_conf), "Presence de docker/proxy/default.conf")
    auditor.assert_true(os.path.exists(proxy_main), "Presence de docker/proxy/nginx.conf")
    auditor.assert_true(os.path.exists(app_conf), "Presence de docker/app/nginx-app.conf")

    with open(proxy_conf, 'r', encoding='utf-8') as f:
        p_code = f.read()

    auditor.assert_true('upstream rdv_app_backend' in p_code, "Configuration upstream rdv_app_backend declaree")
    auditor.assert_true('proxy_pass http://rdv_app_backend' in p_code, "Directive proxy_pass vers l'application active")
    auditor.assert_true('X-Frame-Options' in p_code, "En-tete OWASP X-Frame-Options configure")
    auditor.assert_true('X-Content-Type-Options' in p_code, "En-tete OWASP X-Content-Type-Options configure")
    auditor.assert_true('Content-Security-Policy' in p_code, "En-tete OWASP Content-Security-Policy configure")
    auditor.assert_true('/healthz' in p_code, "Route de healthcheck /healthz operationnelle sur le proxy")

    with open(app_conf, 'r', encoding='utf-8') as f:
        a_code = f.read()
    auditor.assert_true('listen 8080' in a_code, "Conteneur applicatif a l'ecoute sur le port non-root 8080")
    auditor.assert_true('sw.js' in a_code and 'no-cache' in a_code, "Directive no-cache specifique pour le Service Worker PWA")

def audit_production_ssl_and_rate_limiting(auditor):
    print("\n--- 5. Audit Nginx Production Hardening (SSL Let's Encrypt, OWASP, Rate Limiting) ---")
    prod_conf = os.path.join(PROJECT_DIR, 'docker', 'proxy', 'nginx.production.conf')
    ssl_conf = os.path.join(PROJECT_DIR, 'docker', 'proxy', 'conf.d', 'production-ssl.conf')
    dc_prod = os.path.join(PROJECT_DIR, 'docker-compose.prod.yml')
    le_script = os.path.join(PROJECT_DIR, 'scripts', 'init_letsencrypt.sh')

    auditor.assert_true(os.path.exists(prod_conf), "Presence du fichier de production docker/proxy/nginx.production.conf")
    auditor.assert_true(os.path.exists(ssl_conf), "Presence du virtualhost SSL docker/proxy/conf.d/production-ssl.conf")
    auditor.assert_true(os.path.exists(dc_prod), "Presence de l'orchestration de production docker-compose.prod.yml")
    auditor.assert_true(os.path.exists(le_script), "Presence du script d'initialisation Let's Encrypt init_letsencrypt.sh")

    with open(prod_conf, 'r', encoding='utf-8') as f:
        p_code = f.read()

    # Redirection HTTP -> HTTPS & Let's Encrypt
    auditor.assert_true('return 301 https://' in p_code, "Redirection automatique 301 du trafic HTTP vers HTTPS")
    auditor.assert_true('/.well-known/acme-challenge/' in p_code, "Support du challenge ACME Let's Encrypt / Certbot")

    # SSL / TLS durci
    auditor.assert_true('ssl_protocols TLSv1.2 TLSv1.3' in p_code, "Protocoles securises modernes TLSv1.2 et TLSv1.3 actives")
    auditor.assert_true('ssl_ciphers' in p_code and 'ECDHE' in p_code, "Suites de chiffrement fortes Mozilla Intermediate")
    auditor.assert_true('ssl_session_cache' in p_code, "Session cache SSL optimisee")

    # En-tetes OWASP
    auditor.assert_true('Strict-Transport-Security' in p_code and 'preload' in p_code, "En-tete OWASP HSTS (Strict-Transport-Security) avec preload")
    auditor.assert_true('X-Content-Type-Options "nosniff"' in p_code, "En-tete OWASP X-Content-Type-Options: nosniff")
    auditor.assert_true('Content-Security-Policy' in p_code, "En-tete OWASP Content-Security-Policy robuste")
    auditor.assert_true('X-Frame-Options "SAMEORIGIN"' in p_code, "En-tete OWASP X-Frame-Options: SAMEORIGIN")

    # Rate Limiting anti-spam
    auditor.assert_true('limit_req_zone' in p_code and 'booking_limit' in p_code, "Zone de rate limiting dediee aux reservations (booking_limit)")
    auditor.assert_true('limit_req_zone' in p_code and 'general_limit' in p_code, "Zone de rate limiting generale declaree (general_limit)")
    auditor.assert_true('limit_req_status 429' in p_code, "Code HTTP 429 (Too Many Requests) configure pour le rate limiting")
    auditor.assert_true('limit_req zone=booking_limit burst=5 nodelay' in p_code, "Limitation stricte (burst=5 nodelay) sur les endpoints de reservation")
    auditor.assert_true('@rate_limited' in p_code, "Gestionnaire de reponse d'erreur 429 personnalise")

def main():
    print("=" * 65)
    print(" [DOCKER QA] BANC D'ESSAI AUTOMATISE INFRASTRUCTURE DOCKER (@AUD)")
    print("=" * 65)
    auditor = DockerAuditor()
    audit_dockerfile(auditor)
    audit_docker_compose(auditor)
    audit_env_and_security(auditor)
    audit_nginx_configuration(auditor)
    audit_production_ssl_and_rate_limiting(auditor)

    total = auditor.passed + auditor.failed
    pct = round((auditor.passed / total * 100), 1) if total > 0 else 0.0

    print("\n" + "=" * 65)
    print(" [BILAN DOCKER QA] : {0}/{1} TESTS REUSSIS ({2}%)".format(auditor.passed, total, pct))
    print("=" * 65)

    if auditor.failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
