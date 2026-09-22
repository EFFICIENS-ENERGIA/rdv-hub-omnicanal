// 🔄 RDV-HUB SAAS — MOTEUR DE SYNCHRONISATION BIDIRECTIONNELLE & OFFLINE-FIRST
// Gère la persistance locale IndexedDB, la file d'attente hors-ligne (sync_queue),
// l'API REST (/api/appointments) et le streaming temps réel (Server-Sent Events).

class RDVHubSync {
  constructor() {
    this.apiBase = '/api/appointments';
    this.isOnline = navigator.onLine;
    this.isServerReachable = false;
    this.isSyncing = false;
    this.eventSource = null;
    this.syncInterval = null;
    this.lastSyncTime = null;
  }

  async init() {
    console.log('[RDV-Hub Sync] Initialisation du moteur de synchronisation...');
    
    // 1. Écouteurs de connectivité navigateur
    window.addEventListener('online', () => this.handleConnectivityChange(true));
    window.addEventListener('offline', () => this.handleConnectivityChange(false));

    // 2. Vérification de joignabilité du serveur
    await this.checkServer();

    // 3. Traitement de la file d'attente & synchronisation initiale
    if (this.isOnline && this.isServerReachable) {
      await this.processQueue();
      await this.pullFromServer();
      this.connectSSE();
    } else {
      this.updateBadge('offline', 'Mode Hors-ligne (IndexedDB actif)');
    }

    // 4. Polling régulier de secours (toutes les 30 secondes)
    this.syncInterval = setInterval(() => {
      if (this.isOnline) {
        this.processQueue();
      }
    }, 30000);

    return this;
  }

  async checkServer() {
    try {
      const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      this.isServerReachable = (res.status === 200);
    } catch (e) {
      this.isServerReachable = false;
    }
    this.isOnline = navigator.onLine && this.isServerReachable;
    return this.isServerReachable;
  }

  async handleConnectivityChange(online) {
    console.log(`[RDV-Hub Sync] Changement réseau détecté : ${online ? 'En ligne' : 'Hors-ligne'}`);
    this.isOnline = online;
    
    if (online) {
      this.updateBadge('syncing', 'Reconnexion en cours...');
      await this.checkServer();
      if (this.isServerReachable) {
        await this.processQueue();
        await this.pullFromServer();
        this.connectSSE();
        this.updateBadge('online', 'Synchronisé (Serveur SQLite)');
      } else {
        this.updateBadge('pending', 'Serveur distant indisponible');
      }
    } else {
      this.updateBadge('offline', 'Hors-ligne (Sauvegarde IndexedDB)');
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    }
  }

  updateBadge(status, text) {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;

    badge.className = 'status-badge';
    if (status === 'online') {
      badge.classList.add('badge-online');
      badge.innerHTML = `<span class="pulse-dot green"></span> ☁️ ${escapeHtml(text || 'Synchronisé')}`;
      badge.title = 'Base serveur SQLite synchronisée en temps réel.';
    } else if (status === 'offline') {
      badge.classList.add('badge-offline');
      badge.innerHTML = `<span class="pulse-dot gray"></span> 🔌 ${escapeHtml(text || 'Hors-ligne')}`;
      badge.title = 'Données enregistrées localement dans IndexedDB. Envoi automatique dès la reconnexion.';
    } else if (status === 'syncing') {
      badge.classList.add('badge-syncing');
      badge.innerHTML = `<span class="pulse-dot yellow"></span> ⏳ ${escapeHtml(text || 'Sync en cours...')}`;
    } else {
      badge.classList.add('badge-warning');
      badge.innerHTML = `<span class="pulse-dot yellow"></span> ⚠️ ${escapeHtml(text || 'En attente')}`;
    }
  }

  // --- GESTION DE LA FILE D'ATTENTE LOCALE (OFFLINE SYNC QUEUE) ---
  async enqueueOperation(action, rdvId, rdvData) {
    const item = {
      id: 'sq-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      action: action, // 'create' | 'update' | 'delete'
      rdvId: String(rdvId),
      data: rdvData,
      timestamp: new Date().toISOString()
    };

    if (window.rdvDB && window.rdvDB.addToSyncQueue) {
      await window.rdvDB.addToSyncQueue(item);
    } else {
      // Fallback localStorage
      const q = JSON.parse(localStorage.getItem('rdv_hub_sync_queue') || '[]');
      q.push(item);
      localStorage.setItem('rdv_hub_sync_queue', JSON.stringify(q));
    }

    console.log(`[RDV-Hub Sync] Opération '${action}' mise en file d'attente (ID: ${item.id}).`);
    
    // Si connecté, tenter le vidage immédiat
    if (this.isOnline) {
      this.processQueue();
    } else {
      this.updateBadge('offline', 'Modifications locales en attente');
    }
  }

  async processQueue() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    let queue = [];
    if (window.rdvDB && window.rdvDB.getSyncQueue) {
      queue = await window.rdvDB.getSyncQueue();
    } else {
      queue = JSON.parse(localStorage.getItem('rdv_hub_sync_queue') || '[]');
    }

    if (!queue || queue.length === 0) {
      this.isSyncing = false;
      if (this.isOnline) this.updateBadge('online', 'Synchronisé (SQLite)');
      return;
    }

    this.updateBadge('syncing', `Envoi de ${queue.length} mise(s) à jour...`);
    console.log(`[RDV-Hub Sync] Traitement de ${queue.length} opérations en attente...`);

    const failed = [];

    for (const op of queue) {
      try {
        let ok = false;
        if (op.action === 'create') {
          const res = await fetch(this.apiBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.data)
          });
          ok = (res.status === 200 || res.status === 201);
        } else if (op.action === 'update') {
          const res = await fetch(`${this.apiBase}/${op.rdvId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.data)
          });
          ok = (res.status === 200 || res.status === 404);
        } else if (op.action === 'delete') {
          const res = await fetch(`${this.apiBase}/${op.rdvId}`, {
            method: 'DELETE'
          });
          ok = (res.status === 200 || res.status === 204 || res.status === 404);
        }

        if (ok) {
          if (window.rdvDB && window.rdvDB.removeSyncQueueItem) {
            await window.rdvDB.removeSyncQueueItem(op.id);
          }
        } else {
          failed.push(op);
        }
      } catch (err) {
        console.warn(`[RDV-Hub Sync] Échec envoi opération ${op.id}:`, err);
        failed.push(op);
        break; // Arrêt temporaire si coupure réseau
      }
    }

    if (!window.rdvDB || !window.rdvDB.removeSyncQueueItem) {
      localStorage.setItem('rdv_hub_sync_queue', JSON.stringify(failed));
    }

    this.isSyncing = false;
    if (failed.length === 0) {
      this.updateBadge('online', 'Synchronisé (SQLite)');
    } else {
      this.updateBadge('pending', `${failed.length} action(s) en attente`);
    }
  }

  // --- RÉCUPÉRATION DU SERVEUR VERS LE CLIENT (PULL) ---
  async pullFromServer() {
    try {
      const res = await fetch(this.apiBase, { method: 'GET', cache: 'no-store' });
      if (res.status === 200) {
        const serverRdvs = await res.json();
        if (Array.isArray(serverRdvs) && serverRdvs.length > 0) {
          console.log(`[RDV-Hub Sync] ${serverRdvs.length} rendez-vous reçus du serveur.`);
          if (window.rdvDB && window.rdvDB.mergeFromServer) {
            await window.rdvDB.mergeFromServer(serverRdvs);
            window.dispatchEvent(new CustomEvent('rdv-sync-refresh'));
          }
        }
      }
    } catch (e) {
      console.warn('[RDV-Hub Sync] Erreur lors du pull serveur:', e);
    }
  }

  // --- STREAMING TEMPS RÉEL VIA SERVER-SENT EVENTS (SSE) ---
  connectSSE() {
    if (this.eventSource) return;
    if (typeof EventSource === 'undefined') return;

    try {
      this.eventSource = new EventSource(`${this.apiBase}/stream`);
      
      this.eventSource.addEventListener('rdv_update', async (e) => {
        try {
          const payload = JSON.parse(e.data);
          console.log('[RDV-Hub Sync] Événement temps réel reçu:', payload.action);
          
          if (window.rdvDB) {
            if (payload.action === 'created' || payload.action === 'updated') {
              await window.rdvDB.saveDirect(payload.data);
            } else if (payload.action === 'deleted') {
              await window.rdvDB.deleteDirect(payload.data.id);
            }
            window.dispatchEvent(new CustomEvent('rdv-sync-refresh'));
          }
        } catch (err) {
          console.warn('[RDV-Hub Sync] Erreur traitement événement SSE:', err);
        }
      });

      this.eventSource.onerror = () => {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        // Tentative de reconnexion après 10s
        setTimeout(() => {
          if (this.isOnline) this.connectSSE();
        }, 10000);
      };
    } catch (e) {
      console.warn('[RDV-Hub Sync] SSE non disponible:', e);
    }
  }
}

// Fonction utilitaire d'échappement XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.rdvSync = new RDVHubSync();
