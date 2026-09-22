# 🚀 RDV-HUB SAAS — HUB OMNICANAL DE CENTRALISATION & PILOTAGE DES RENDEZ-VOUS CLIENTS

Solution SaaS tout-en-un inspirée de l'ergonomie d'**Intercom (Fin AI)**, **Calendly** et **Linear**, conçue pour centraliser, qualifier automatiquement, planifier et rentabiliser tous les rendez-vous clients, quelle que soit leur provenance.

---

## 🌟 Points Forts & Fonctionnalités Clés

1. **Centralisation Omnicanale Unifiée** :
   - Ingestion depuis 7 canaux de prospection : *Site Web*, *WhatsApp*, *Email entrant*, *Appel téléphonique*, *Campagnes Pub (Google/Meta Ads)*, *Recommandation / Réseau*, *Import de fichiers*.
2. **Copilote IA de Qualification (Fin AI Style)** :
   - Analyse sémantique en temps réel de toute demande client brute (texte d'email, WhatsApp, message de formulaire).
   - Détection automatique de l'urgence, estimation déterministe du budget, scoring de l'opportunité (0 à 100).
   - Suggestion instantanée du créneau horaire optimal libre sans conflit.
3. **Moteur d'Agenda Déterministe (Zéro Conflit)** :
   - Algorithme mathématique d'exclusion de collision temporelle `[start_A, end_A] ∩ [start_B, end_B]`.
   - Alertes visuelles instantanées en cas de chevauchement.
4. **Télémétrie Financière & KPIs en Temps Réel** :
   - CA Prévisionnel et CA Réalisé mis à jour en direct.
   - Calcul exact du taux de présence client (*Show-up rate*) et du taux de conversion.
   - Panier moyen pondéré par opportunité active.
   - Visualisations SVG natives (Donut chart omnicanal, bar chart d'évolution du CA) sans aucune bibliothèque externe lourde.
5. **PWA Offline-First & Résilience** :
   - Persistance des données via **IndexedDB** (`RDVHubDB_v1`) avec synchronisation locale automatique et fallback `localStorage`.
   - Application 100% utilisable sans aucune connexion internet via Service Worker (`sw.js`).
6. **Processeur CLI d'Automatisation (Python)** :
   - Script autonome `scripts/cli_rdv_processor.py` pour importer en masse des CSV/Excel/JSON, auditer les métriques financières et exporter des synthèses exécutives.
7. **Sécurité OWASP Sans Concession** :
   - Sanitisation systématique de tous les champs utilisateur (`escapeHtml`, `escapeAttr`).
   - Protection contre le Cross-Site Scripting (XSS), zéro `eval()`, en-têtes sécurisés.
8. **Architecture Conteneurisée Docker & Reverse Proxy Nginx** :
   - Déploiement multi-conteneurs `rdv-app` + `rdv-proxy` via `docker-compose.yml`.
   - `Dockerfile` multi-stage build durci (utilisateur non-root `USER 101`, zéro privilège).
   - Reverse proxy Nginx avec masquage de version, compression gzip et en-têtes OWASP (CSP, X-Frame-Options, X-Content-Type-Options).
   - Isolation des secrets et paramètres dans `.env` / `.env.example`.
   - Persistance des données et des logs via volumes Docker nommés (`rdv_data` et `rdv_proxy_logs`).

---

## 🚀 Démarrage Rapide

### Option 1 : Déploiement Conteneurisé (Docker & Docker Compose) — Recommandé Production
```bash
# 1. Cloner et configurer l'environnement
cp .env.example .env

# 2. Construire et démarrer les conteneurs en tâche de fond
docker compose up -d --build

# 3. Accéder à l'application sécurisée via le Reverse Proxy Nginx
# URL : http://localhost:8092
```
*Ou sous Windows : double-cliquez simplement sur `DOCKER_START.bat`.*

### Option 2 : Lancement Local 1-Clic dans le Navigateur (Sans Docker)
- Double-cliquez simplement sur `LANCER_HUB_RDV.bat`.
- Le serveur local se lance et votre navigateur s'ouvre automatiquement sur : `http://localhost:8092/index.html`.

### Option 3 : Traitement en Ligne de Commande (CLI Python)
```bash
python scripts/cli_rdv_processor.py data/sample_rdv.json
python scripts/cli_rdv_processor.py data/sample_rdv.csv
```

### Option 4 : Lancer le Banc d'Essai Automatisé (QA, Sécurité & Docker)
```bash
python scripts/audit_hub_rdv.py
```
*(Résultat certifié : 64/64 tests PASS - 100% conforme).*
