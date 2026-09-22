# ==============================================================================
# 🐳 RDV-HUB SAAS -- DOCKERFILE MULTI-STAGE BUILD OPTIMISE & HARDENED (NON-ROOT)
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1 : VALIDATION & PREPARATION DES ARTEFACTS (BUILDER)
# ------------------------------------------------------------------------------
FROM alpine:3.20 AS builder

LABEL stage="builder"
LABEL maintainer="Equipe Antigravity SaaS <support@antigravity.pro>"

WORKDIR /app

# Copie des fichiers sources applicatifs
COPY index.html manifest.webmanifest sw.js ./
COPY css/ ./css/
COPY js/ ./js/
COPY data/ ./data/
COPY assets/ ./assets/

# Verification de l'integrite et interdiction absolue d'artefacts sensibles
RUN set -e; \
    echo ">> [STAGE 1] Verification de l'integrite des fichiers applicatifs..."; \
    test -f index.html || (echo "ERREUR: index.html manquant !" && exit 1); \
    test -f manifest.webmanifest || (echo "ERREUR: manifest manquant !" && exit 1); \
    test -f sw.js || (echo "ERREUR: sw.js manquant !" && exit 1); \
    test -d css && test -d js && test -d data && test -d assets; \
    # Verification anti-fuite de secrets
    ! test -f .env; \
    echo ">> [STAGE 1] Fichiers certifies conformes."

# ------------------------------------------------------------------------------
# STAGE 2 : RUNTIME DE PRODUCTION HAUTEMENT SECURISE (NGINX UNPRIVILEGED)
# ------------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS production

LABEL org.opencontainers.image.title="RDV-Hub Omnicanal SaaS"
LABEL org.opencontainers.image.description="Hub de centralisation et pilotage des rendez-vous clients"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="BÂTI-EXCELLENCE Architecture & Ingénierie"

# Nettoyage des configurations par defaut
USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*

# Copie de la configuration optimisee Nginx pour l'application Web
COPY docker/app/nginx-app.conf /etc/nginx/conf.d/default.conf

# Copie des fichiers statiques valides depuis le Stage Builder
COPY --from=builder --chown=nginx:nginx /app /usr/share/nginx/html

# Creation du dossier data pour les montages persistants et attribution des droits
RUN mkdir -p /usr/share/nginx/html/data && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Bascule definitive sur l'utilisateur non-privilegie (CIS Benchmark)
USER 101

# Port non-root standard
EXPOSE 8080

# Verification continue de l'etat de sante du conteneur
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

# Lancement du serveur Web en premier plan
CMD ["nginx", "-g", "daemon off;"]
