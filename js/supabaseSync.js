// ☁️ RDV-HUB SAAS -- MOTEUR DE SYNCHRONISATION CLOUD HYBRIDE SUPABASE (OFFLINE-FIRST)
// Synchronisation bidirectionnelle : IndexedDB (Local 0 ms) <---> Supabase Cloud (PostgreSQL + RLS)

class SupabaseSyncEngine {
  constructor() {
    this.client = null;
    this.isOnline = navigator.onLine;
    this.currentUser = null;
    this.isSyncing = false;
    this.realtimeChannel = null;
    this.syncInterval = null;
    this.lastSyncTime = null;
  }

  async init() {
    console.log('[Supabase Sync] Initialisation du moteur de synchronisation Cloud...');
    this.client = window.supabaseClient;

    if (!this.client) {
      console.warn('[Supabase Sync] Client Supabase non instancie. Mode offline actif.');
      return this;
    }

    // 1. Écouteurs de connectivité réseau navigateur
    window.addEventListener('online', () => this.handleConnectivityChange(true));
    window.addEventListener('offline', () => this.handleConnectivityChange(false));

    // 2. Écouteur d'état d'authentification Supabase
    this.client.auth.onAuthStateChange(async (event, session) => {
      console.log(`[Supabase Sync] Événement Auth : ${event}`);
      this.currentUser = session ? session.user : null;
      this.updateUserInterface(this.currentUser);

      if (this.currentUser && this.isOnline) {
        await this.pushLocalQueueToCloud();
        await this.pullCloudToLocal();
        this.subscribeRealtime();
      }
    });

    // 3. Récupération de la session existante
    const { data: { session } } = await this.client.auth.getSession();
    if (session && session.user) {
      this.currentUser = session.user;
      this.updateUserInterface(this.currentUser);
      if (this.isOnline) {
        await this.pushLocalQueueToCloud();
        await this.pullCloudToLocal();
        this.subscribeRealtime();
      }
    } else {
      this.updateUserInterface(null);
    }

    // 4. Intervalle régulier de synchronisation en arrière-plan (toutes les 45 secondes)
    this.syncInterval = setInterval(() => {
      if (this.isOnline && this.currentUser) {
        this.pushLocalQueueToCloud();
      }
    }, 45000);

    return this;
  }

  async handleConnectivityChange(online) {
    console.log(`[Supabase Sync] Changement réseau détecté : ${online ? 'En ligne' : 'Hors-ligne'}`);
    this.isOnline = online;

    if (online) {
      this.updateBadge('syncing', 'Reconnexion Cloud...');
      if (this.currentUser) {
        await this.pushLocalQueueToCloud();
        await this.pullCloudToLocal();
        this.subscribeRealtime();
        this.updateBadge('online', 'Supabase Cloud Synchronisé');
      } else {
        this.updateBadge('pending', 'En ligne (Non connecté)');
      }
    } else {
      this.updateBadge('offline', 'Mode Hors-ligne (IndexedDB actif)');
      if (this.realtimeChannel) {
        try { this.realtimeChannel.unsubscribe(); } catch (e) {}
        this.realtimeChannel = null;
      }
    }
  }

  updateUserInterface(user) {
    const userBadge = document.getElementById('userProfileBadge');
    const authBtnText = document.getElementById('authBtnText');
    const authBtnIcon = document.getElementById('authBtnIcon');

    if (user) {
      const email = user.email || 'Utilisateur';
      const displayName = user.user_metadata?.nom || email.split('@')[0];
      if (userBadge) {
        userBadge.textContent = `${displayName} (${email})`;
        userBadge.title = `Connecté via Supabase Auth : ${email}`;
      }
      if (authBtnText) authBtnText.textContent = 'Déconnexion';
      if (authBtnIcon) authBtnIcon.textContent = '🚪';
      this.updateBadge('online', 'Supabase Cloud Synchronisé');
    } else {
      if (userBadge) {
        userBadge.textContent = 'Mode Invité / Hors-ligne';
        userBadge.title = 'Cliquez pour vous connecter ou créer un compte Supabase';
      }
      if (authBtnText) authBtnText.textContent = 'Connexion / Inscription';
      if (authBtnIcon) authBtnIcon.textContent = '👤';
      this.updateBadge('offline', 'IndexedDB Locale (Invité)');
    }
  }

  updateBadge(status, text) {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;

    badge.className = 'status-badge';
    if (status === 'online') {
      badge.classList.add('badge-online');
      badge.innerHTML = `<span class="pulse-dot green"></span> ☁️ <strong>Supabase</strong> : ${escapeHtml(text || 'Synchronisé')}`;
      badge.title = 'Base Cloud Supabase (PostgreSQL + RLS) synchronisée en direct.';
    } else if (status === 'offline') {
      badge.classList.add('badge-offline');
      badge.innerHTML = `<span class="pulse-dot gray"></span> 🔌 ${escapeHtml(text || 'Hors-ligne (IndexedDB)')}`;
      badge.title = 'Mode Offline-First actif. Données stockées localement sans perte.';
    } else if (status === 'syncing') {
      badge.classList.add('badge-syncing');
      badge.innerHTML = `<span class="pulse-dot yellow"></span> ⏳ ${escapeHtml(text || 'Sync Cloud en cours...')}`;
    } else {
      badge.classList.add('badge-warning');
      badge.innerHTML = `<span class="pulse-dot yellow"></span> ⚠️ ${escapeHtml(text || 'En attente')}`;
    }
  }

  // --- CONVERSION DES FORMATS (CamelCase Local <---> Snake_case Supabase) ---
  toSupabaseFormat(rdv) {
    const userId = this.currentUser ? this.currentUser.id : '00000000-0000-0000-0000-000000000000';
    return {
      id: String(rdv.id),
      user_id: userId,
      client_name: rdv.clientName || 'Client Inconnu',
      subject: rdv.subject || 'Rendez-vous',
      address: rdv.address || 'Adresse à préciser',
      date: rdv.date || new Date().toISOString().split('T')[0],
      start_time: rdv.startTime || '10:00',
      end_time: rdv.endTime || '11:00',
      status: rdv.status || 'new',
      montant_prevu: Number(rdv.amount) || 0.0,
      montant_realise: rdv.status === 'done' ? (Number(rdv.amount) || 0.0) : 0.0,
      urgency_level: rdv.urgency || (rdv.leadScore > 80 ? 'haute' : 'moyen'),
      notes: rdv.notes || '',
      lead_score: Number(rdv.leadScore) || 50,
      updated_at: new Date().toISOString()
    };
  }

  toLocalFormat(sRdv) {
    return {
      id: sRdv.id,
      clientName: sRdv.client_name || 'Client Inconnu',
      subject: sRdv.subject || 'Rendez-vous',
      address: sRdv.address || 'Adresse à préciser',
      date: sRdv.date,
      startTime: sRdv.start_time,
      endTime: sRdv.end_time,
      status: sRdv.status || 'new',
      amount: Number(sRdv.montant_prevu) || 0,
      urgency: sRdv.urgency_level || 'moyen',
      notes: sRdv.notes || '',
      leadScore: Number(sRdv.lead_score) || 50,
      channel: sRdv.channel || 'web',
      createdAt: sRdv.created_at || new Date().toISOString()
    };
  }

  // --- POUSSER LES MODIFICATIONS LOCALES VERS LE CLOUD SUPABASE (PUSH) ---
  async pushLocalQueueToCloud() {
    if (this.isSyncing || !this.isOnline || !this.client) return;
    this.isSyncing = true;

    let queue = [];
    if (window.rdvDB && window.rdvDB.getSyncQueue) {
      queue = await window.rdvDB.getSyncQueue();
    } else {
      queue = JSON.parse(localStorage.getItem('rdv_hub_sync_queue') || '[]');
    }

    if (!queue || queue.length === 0) {
      this.isSyncing = false;
      if (this.isOnline && this.currentUser) this.updateBadge('online', 'À jour');
      return;
    }

    this.updateBadge('syncing', `Envoi Cloud (${queue.length} en attente)...`);
    console.log(`[Supabase Sync] Dépilage de ${queue.length} opérations vers Supabase...`);

    const failed = [];

    for (const op of queue) {
      try {
        let error = null;
        if (op.action === 'create') {
          const payload = this.toSupabaseFormat(op.data);
          const res = await this.client.from('appointments').insert(payload);
          error = res.error;
        } else if (op.action === 'update') {
          const payload = this.toSupabaseFormat(op.data);
          const res = await this.client.from('appointments').update(payload).eq('id', String(op.rdvId));
          error = res.error;
        } else if (op.action === 'delete') {
          const res = await this.client.from('appointments').delete().eq('id', String(op.rdvId));
          error = res.error;
        }

        if (!error) {
          if (window.rdvDB && window.rdvDB.removeSyncQueueItem) {
            await window.rdvDB.removeSyncQueueItem(op.id);
          }
        } else {
          console.warn(`[Supabase Sync] Erreur Cloud sur op ${op.id}:`, error);
          failed.push(op);
        }
      } catch (err) {
        console.warn(`[Supabase Sync] Exception réseau op ${op.id}:`, err);
        failed.push(op);
        break; // Arrêt en cas de coupure soudaine
      }
    }

    if (!window.rdvDB || !window.rdvDB.removeSyncQueueItem) {
      localStorage.setItem('rdv_hub_sync_queue', JSON.stringify(failed));
    }

    this.isSyncing = false;
    if (failed.length === 0) {
      this.updateBadge('online', 'Synchronisé');
    } else {
      this.updateBadge('pending', `${failed.length} action(s) Cloud en attente`);
    }
  }

  // --- RÉCUPÉRER LES DONNÉES DEPUIS SUPABASE (PULL) ---
  async pullCloudToLocal() {
    if (!this.isOnline || !this.client || !this.currentUser) return;

    try {
      console.log('[Supabase Sync] Récupération des rendez-vous Cloud pour l\'utilisateur:', this.currentUser.id);
      const { data, error } = await this.client
        .from('appointments')
        .select('*')
        .eq('user_id', this.currentUser.id);

      if (error) {
        console.warn('[Supabase Sync] Erreur lors du pull Supabase:', error);
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        console.log(`[Supabase Sync] ${data.length} rendez-vous reçus de Supabase Cloud.`);
        const localRdvs = data.map(r => this.toLocalFormat(r));
        if (window.rdvDB && window.rdvDB.mergeFromServer) {
          await window.rdvDB.mergeFromServer(localRdvs);
          window.dispatchEvent(new CustomEvent('rdv-sync-refresh'));
        }
      }
    } catch (e) {
      console.warn('[Supabase Sync] Exception pullCloudToLocal:', e);
    }
  }

  // --- ÉCOUTE TEMPS RÉEL VIA SUPABASE REALTIME (WEBSOCKETS) ---
  subscribeRealtime() {
    if (!this.client || !this.currentUser || this.realtimeChannel) return;

    try {
      this.realtimeChannel = this.client.channel('public:appointments');
      this.realtimeChannel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointments', filter: `user_id=eq.${this.currentUser.id}` },
          async (payload) => {
            console.log('[Supabase Realtime] Changement distant reçu :', payload.eventType);
            const { eventType, new: newRec, old: oldRec } = payload;

            if (window.rdvDB) {
              if (eventType === 'INSERT' || eventType === 'UPDATE') {
                const item = this.toLocalFormat(newRec);
                await window.rdvDB.saveDirect(item);
              } else if (eventType === 'DELETE') {
                await window.rdvDB.deleteDirect(oldRec.id);
              }
              window.dispatchEvent(new CustomEvent('rdv-sync-refresh'));
            }
          }
        )
        .subscribe((status) => {
          console.log('[Supabase Realtime] Statut d abonnement:', status);
        });
    } catch (e) {
      console.warn('[Supabase Realtime] Erreur souscription WebSocket:', e);
    }
  }
}

// Utilitaires de protection XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.supabaseSync = new SupabaseSyncEngine();
