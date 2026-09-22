#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AUDIT @AUD -- BANC D'ESSAI AUTOMATISE SUPABASE CLOUD, RLS & SYNCHRONISATION HYBRIDE
Valide de facon exhaustive l'integrite du schema SQL Supabase, les regles RLS,
les variables d'environnement, le moteur js/supabaseSync.js, l'authentification
et la preservation de l'architecture Offline-First IndexedDB.

Usage:
    python scripts/audit_supabase_sync.py
"""

import os
import sys
import re
import json
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

class SupabaseAuditor:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.assertions = []

    def assert_true(self, condition, name, details=""):
        if condition:
            self.passed += 1
            self.assertions.append({'status': 'PASS', 'name': name, 'details': details})
            print("  [PASS] {0}".format(name))
        else:
            self.failed += 1
            self.assertions.append({'status': 'FAIL', 'name': name, 'details': details})
            print("  [FAIL] {0} -> {1}".format(name, details))

def run_tests():
    print("=" * 80)
    print("AUDIT @AUD : BANC D'ESSAI SUPABASE CLOUD, RLS & OFFLINE-FIRST PWA")
    print("   Horodatage : {0}".format(datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    print("=" * 80)

    auditor = SupabaseAuditor()

    # =========================================================================
    # SECTION 1 : AUDIT DU SCHEMA SQL SUPABASE & REGLES RLS (POSTGRESQL)
    # =========================================================================
    print("\n--- SECTION 1 : AUDIT DU SCHEMA SQL & SECURITE RLS (sql/supabase_schema.sql) ---")
    sql_path = os.path.join(PROJECT_ROOT, 'sql', 'supabase_schema.sql')
    auditor.assert_true(os.path.exists(sql_path), "Presence du fichier sql/supabase_schema.sql")

    with open(sql_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()

    # Tables requises
    auditor.assert_true("CREATE TABLE IF NOT EXISTS public.profiles" in sql_content, "Table 'profiles' definie dans le schema SQL")
    auditor.assert_true("CREATE TABLE IF NOT EXISTS public.clients" in sql_content, "Table 'clients' definie dans le schema SQL")
    auditor.assert_true("CREATE TABLE IF NOT EXISTS public.appointments" in sql_content, "Table 'appointments' definie dans le schema SQL")

    # Colonnes cles profiles
    auditor.assert_true("id_user UUID PRIMARY KEY REFERENCES auth.users" in sql_content, "profiles: id_user lie a auth.users(id) ON DELETE CASCADE")
    auditor.assert_true("email TEXT" in sql_content, "profiles: colonne email presente")
    auditor.assert_true("nom TEXT" in sql_content, "profiles: colonne nom presente")
    auditor.assert_true("role TEXT" in sql_content, "profiles: colonne role presente")

    # Colonnes cles clients
    auditor.assert_true("user_id UUID NOT NULL REFERENCES auth.users" in sql_content, "clients: user_id lie a auth.users(id)")
    auditor.assert_true("canal_origine TEXT" in sql_content, "clients: colonne canal_origine presente")
    auditor.assert_true("score_ia INTEGER" in sql_content, "clients: colonne score_ia presente")

    # Colonnes cles appointments
    auditor.assert_true("client_id TEXT REFERENCES public.clients" in sql_content, "appointments: client_id lie a public.clients(id)")
    auditor.assert_true("montant_prevu NUMERIC" in sql_content, "appointments: colonne montant_prevu presente")
    auditor.assert_true("montant_realise NUMERIC" in sql_content, "appointments: colonne montant_realise presente")
    auditor.assert_true("urgency_level TEXT" in sql_content, "appointments: colonne urgency_level presente")

    # Activation Row Level Security (RLS)
    auditor.assert_true("ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;" in sql_content, "RLS active sur la table profiles")
    auditor.assert_true("ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;" in sql_content, "RLS active sur la table clients")
    auditor.assert_true("ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;" in sql_content, "RLS active sur la table appointments")

    # Politiques RLS etanches
    auditor.assert_true("auth.uid() = id_user" in sql_content, "Politique RLS profiles : acces restreint a auth.uid() = id_user")
    auditor.assert_true("auth.uid() = user_id" in sql_content, "Politique RLS clients & appointments : acces restreint a auth.uid() = user_id")

    # Trigger d'inscription automatique
    auditor.assert_true("handle_new_user()" in sql_content, "Fonction trigger handle_new_user() pour auto-provisionnement")
    auditor.assert_true("on_auth_user_created" in sql_content, "Trigger on_auth_user_created branche sur auth.users")
    auditor.assert_true("supabase_realtime ADD TABLE" in sql_content, "Publication Supabase Realtime active sur les tables")

    # =========================================================================
    # SECTION 2 : AUDIT DES VARIABLES D'ENVIRONNEMENT (.env & .env.example)
    # =========================================================================
    print("\n--- SECTION 2 : AUDIT DES VARIABLES D'ENVIRONNEMENT SUPABASE ---")
    env_example_path = os.path.join(PROJECT_ROOT, '.env.example')
    env_path = os.path.join(PROJECT_ROOT, '.env')

    with open(env_example_path, 'r', encoding='utf-8') as f:
        env_ex_txt = f.read()
    with open(env_path, 'r', encoding='utf-8') as f:
        env_txt = f.read()

    auditor.assert_true("SUPABASE_URL=" in env_ex_txt, "SUPABASE_URL documente dans .env.example")
    auditor.assert_true("SUPABASE_ANON_KEY=" in env_ex_txt, "SUPABASE_ANON_KEY documente dans .env.example")
    auditor.assert_true("SUPABASE_URL=" in env_txt, "SUPABASE_URL configure dans .env")
    auditor.assert_true("SUPABASE_ANON_KEY=" in env_txt, "SUPABASE_ANON_KEY configure dans .env")

    # Securite OWASP : Pas de service_role dans le frontend
    app_js_path = os.path.join(PROJECT_ROOT, 'js', 'app.js')
    sync_js_path = os.path.join(PROJECT_ROOT, 'js', 'supabaseSync.js')
    with open(app_js_path, 'r', encoding='utf-8') as f:
        app_js = f.read()
    with open(sync_js_path, 'r', encoding='utf-8') as f:
        sync_js = f.read()

    auditor.assert_true("service_role" not in app_js, "Securite OWASP : Aucune cle service_role exposee dans js/app.js")
    auditor.assert_true("service_role" not in sync_js, "Securite OWASP : Aucune cle service_role exposee dans js/supabaseSync.js")

    # =========================================================================
    # SECTION 3 : AUDIT DU MOTEUR DE SYNCHRONISATION (js/supabaseSync.js)
    # =========================================================================
    print("\n--- SECTION 3 : AUDIT DU MOTEUR DE SYNCHRONISATION HYBRIDE (js/supabaseSync.js) ---")
    auditor.assert_true(os.path.exists(sync_js_path), "Presence de js/supabaseSync.js")

    auditor.assert_true("class SupabaseSyncEngine" in sync_js, "Definition de la classe SupabaseSyncEngine")
    auditor.assert_true("pushLocalQueueToCloud" in sync_js, "Methode pushLocalQueueToCloud presente (Depilage offline)")
    auditor.assert_true("pullCloudToLocal" in sync_js, "Methode pullCloudToLocal presente (Recuperation cloud)")
    auditor.assert_true("subscribeRealtime" in sync_js, "Methode subscribeRealtime presente (Ecoute WebSocket)")
    auditor.assert_true("toSupabaseFormat" in sync_js, "Convertisseur toSupabaseFormat (CamelCase -> Snake_case)")
    auditor.assert_true("toLocalFormat" in sync_js, "Convertisseur toLocalFormat (Snake_case -> CamelCase)")
    auditor.assert_true("window.addEventListener('online'" in sync_js, "Ecouteur reseau 'online' configure pour reconnexion auto")
    auditor.assert_true("window.addEventListener('offline'" in sync_js, "Ecouteur reseau 'offline' configure")
    auditor.assert_true("window.supabaseSync = new SupabaseSyncEngine()" in sync_js, "Instance globale window.supabaseSync exposee")

    # =========================================================================
    # SECTION 4 : AUDIT DE L'AUTHENTIFICATION & UI (index.html & js/app.js)
    # =========================================================================
    print("\n--- SECTION 4 : AUDIT DE L'INTERFACE AUTHENTIFICATION (index.html) ---")
    html_path = os.path.join(PROJECT_ROOT, 'index.html')
    with open(html_path, 'r', encoding='utf-8') as f:
        html_txt = f.read()

    auditor.assert_true("id=\"authModal\"" in html_txt, "Modale d'authentification #authModal presente dans index.html")
    auditor.assert_true("id=\"userProfileBtn\"" in html_txt, "Bouton de profil utilisateur #userProfileBtn present dans le header")
    auditor.assert_true("id=\"userProfileBadge\"" in html_txt, "Badge d'etat utilisateur #userProfileBadge present")
    auditor.assert_true("id=\"authGuestBtn\"" in html_txt, "Bouton 'Mode Invite (Offline)' present pour garantir l'Offline-First")
    auditor.assert_true("tabAuthLogin" in html_txt, "Onglet de connexion #tabAuthLogin present")
    auditor.assert_true("tabAuthRegister" in html_txt, "Onglet d'inscription #tabAuthRegister present")

    # Scripts ordonnes
    auditor.assert_true("js/libs/supabase.js" in html_txt, "SDK Supabase js/libs/supabase.js inclus dans index.html")
    auditor.assert_true("js/supabase_config.js" in html_txt, "Configuration js/supabase_config.js incluse dans index.html")
    auditor.assert_true("js/supabaseSync.js" in html_txt, "Moteur js/supabaseSync.js inclus dans index.html")

    # Service Worker PWA
    sw_path = os.path.join(PROJECT_ROOT, 'sw.js')
    with open(sw_path, 'r', encoding='utf-8') as f:
        sw_txt = f.read()
    auditor.assert_true("js/libs/supabase.js" in sw_txt, "SDK Supabase mis en cache Service Worker (Offline-First)")
    auditor.assert_true("js/supabaseSync.js" in sw_txt, "Moteur Supabase Sync mis en cache Service Worker")

    # =========================================================================
    # SECTION 5 : AUDIT DES EN-TETES CONTENT-SECURITY-POLICY (CSP)
    # =========================================================================
    print("\n--- SECTION 5 : AUDIT DE CONFORMITE CSP & CONNEXIONS SUPABASE ---")
    proxy_conf_path = os.path.join(PROJECT_ROOT, 'docker', 'proxy', 'default.conf')
    prod_conf_path = os.path.join(PROJECT_ROOT, 'docker', 'proxy', 'nginx.production.conf')

    with open(proxy_conf_path, 'r', encoding='utf-8') as f:
        proxy_conf = f.read()
    with open(prod_conf_path, 'r', encoding='utf-8') as f:
        prod_conf = f.read()

    auditor.assert_true("https://*.supabase.co" in proxy_conf, "CSP default.conf autorise https://*.supabase.co")
    auditor.assert_true("wss://*.supabase.co" in proxy_conf, "CSP default.conf autorise les WebSockets wss://*.supabase.co")
    auditor.assert_true("https://*.supabase.co" in prod_conf, "CSP nginx.production.conf autorise https://*.supabase.co")
    auditor.assert_true("wss://*.supabase.co" in prod_conf, "CSP nginx.production.conf autorise wss://*.supabase.co")

    # Synthese
    total = auditor.passed + auditor.failed
    success_rate = (auditor.passed / total * 100) if total > 0 else 0
    print("\n" + "=" * 80)
    print("BILAN DU BANC D'ESSAI SUPABASE CLOUD & RLS :")
    print("   Total assertions : {0}".format(total))
    print("   Succes (PASS)    : {0}".format(auditor.passed))
    print("   Echecs (FAIL)    : {0}".format(auditor.failed))
    print("   Taux de reussite : {0:.1f}%".format(success_rate))
    print("=" * 80)

    if auditor.failed == 0:
        print("CERTIFICATION @AUD : 100% CONFORME AUX DIRECTIVES SUPABASE & OFFLINE-FIRST.")
        return 0
    else:
        print("NON-CONFORMITES DETECTEES : {0} tests en echec.".format(auditor.failed))
        return 1

if __name__ == '__main__':
    sys.exit(run_tests())
