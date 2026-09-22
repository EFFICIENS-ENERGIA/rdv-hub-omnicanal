// 💽 RDV-HUB SAAS — MOTEUR DE PERSISTANCE INDEXEDDB & OFFLINE-FIRST

class RDVHubDB {
  constructor() {
    this.dbName = 'RDVHubDB_v1';
    this.version = 2;
    this.db = null;
    this.isIndexedDBSupported = typeof indexedDB !== 'undefined';
  }

  async init() {
    // Si exécution directe en double-clic (file://), les navigateurs bloquent souvent IndexedDB.
    // On bascule alors immédiatement sur localStorage pour une réactivité instantanée.
    if (!this.isIndexedDBSupported || window.location.protocol === 'file:') {
      console.log('[RDV-Hub DB] Protocole local détecté ou IndexedDB absent : utilisation directe de localStorage.');
      return this._initLocalStorage();
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store Rendez-vous
        if (!db.objectStoreNames.contains('appointments')) {
          const rdvStore = db.createObjectStore('appointments', { keyPath: 'id', autoIncrement: true });
          rdvStore.createIndex('channel', 'channel', { unique: false });
          rdvStore.createIndex('status', 'status', { unique: false });
          rdvStore.createIndex('date', 'date', { unique: false });
          rdvStore.createIndex('clientName', 'clientName', { unique: false });
        }

        // Store Clients
        if (!db.objectStoreNames.contains('clients')) {
          const clientStore = db.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
          clientStore.createIndex('email', 'email', { unique: true });
        }

        // Store Logs & Traçabilité
        if (!db.objectStoreNames.contains('audit_logs')) {
          db.createObjectStore('audit_logs', { keyPath: 'id', autoIncrement: true });
        }

        // Store File d'attente hors-ligne (Sync Queue)
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        console.log('[RDV-Hub DB] IndexedDB initialisée avec succès.');
        await this._seedInitialDataIfEmpty();
        resolve(this);
      };

      request.onerror = (event) => {
        console.error('[RDV-Hub DB] Erreur ouverture IndexedDB:', event.target.error);
        this._initLocalStorage();
        resolve(this);
      };
    });
  }

  async _initLocalStorage() {
    if (!localStorage.getItem('rdv_hub_appointments')) {
      localStorage.setItem('rdv_hub_appointments', JSON.stringify([]));
    }
    await this._seedInitialDataIfEmpty();
    return this;
  }

  // Seeding initial avec 15 cas réalistes omnicanaux
  async _seedInitialDataIfEmpty() {
    const count = await this.countAppointments();
    if (count > 0) return;

    console.log('[RDV-Hub DB] Base vierge : amorçage des données de démonstration certifiées...');
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // Calcul de dates futures et récentes
    const getDateOffset = (days) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const initialAppointments = [
      {
        clientName: "Sophie Delaunay",
        email: "sophie.delaunay@novapark.com",
        phone: "+33 6 42 18 90 12",
        channel: "web",
        subject: "Audit Énergétique & Rénovation Siège Social",
        address: "14 Boulevard Haussmann, 75009 Paris",
        date: getDateOffset(0),
        startTime: "09:30",
        endTime: "10:30",
        amount: 8500,
        status: "confirmed",
        notes: "Formulaire web rempli via landing page rénovation. Budget confirmé.",
        leadScore: 92,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Marc Vasseur",
        email: "m.vasseur@groupe-horizon.fr",
        phone: "+33 7 81 22 45 60",
        channel: "whatsapp",
        subject: "Devis Extension Villa Contemporaine 120m²",
        address: "28 Chemin du Vallon des Maires, 13090 Aix-en-Provence",
        date: getDateOffset(0),
        startTime: "11:00",
        endTime: "12:00",
        amount: 145000,
        status: "new",
        notes: "Demande reçue via bouton WhatsApp direct. Plans du permis de construire fournis.",
        leadScore: 88,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Claire Montmirail",
        email: "cmontmirail@atelierdurable.org",
        phone: "+33 6 11 34 56 78",
        channel: "email",
        subject: "Contrat Maîtrise d'Œuvre Chantier Tertiaire",
        address: "45 Rue de la République, 69002 Lyon",
        date: getDateOffset(0),
        startTime: "14:00",
        endTime: "15:30",
        amount: 32000,
        status: "pending",
        notes: "Email entrant suite à recommandation d'un architecte partenaire.",
        leadScore: 95,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Thierry Benamou",
        email: "t.benamou@immo-provence.com",
        phone: "+33 6 88 90 12 34",
        channel: "phone",
        subject: "Point d'étape Chantier Résidence Les Pins",
        address: "12 Traverse de la Jarre, 13009 Marseille",
        date: getDateOffset(1),
        startTime: "10:00",
        endTime: "11:00",
        amount: 54000,
        status: "confirmed",
        notes: "Appel téléphonique entrant. Rendez-vous de suivi et signature avenant.",
        leadScore: 78,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Émilie Roussel",
        email: "emilie.roussel@design-urban.com",
        phone: "+33 6 55 43 21 09",
        channel: "ads",
        subject: "Étude Bioclimatique RE2020 Maison Passive",
        address: "7 Avenue Victor Hugo, 33000 Bordeaux",
        date: getDateOffset(1),
        startTime: "15:00",
        endTime: "16:00",
        amount: 6200,
        status: "new",
        notes: "Campagne Google Ads Search RE2020. Formulaire qualifié.",
        leadScore: 82,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Alexandre Dupont",
        email: "alexandre.dupont@groupe-btp.fr",
        phone: "+33 7 90 11 22 33",
        channel: "referral",
        subject: "Rénovation Hangar Logistique 2500m²",
        address: "ZAC des Béthunes, 95310 Saint-Ouen-l'Aumône",
        date: getDateOffset(2),
        startTime: "09:00",
        endTime: "10:30",
        amount: 210000,
        status: "done",
        notes: "Apporté par le cabinet d'ingénierie partenaire. Dossier finalisé et signé.",
        leadScore: 98,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Sarah Louvet",
        email: "sarah.louvet@ecologik.net",
        phone: "+33 6 77 88 99 00",
        channel: "file",
        subject: "Mission Diagnostic Structure & Faisabilité",
        address: "18 Rue Royale, 59000 Lille",
        date: getDateOffset(2),
        startTime: "14:00",
        endTime: "15:00",
        amount: 4800,
        status: "done",
        notes: "Importé depuis le fichier Excel des prospects du salon BTP.",
        leadScore: 65,
        createdAt: new Date().toISOString()
      },
      {
        clientName: "Julien Giraud",
        email: "jgiraud@sud-immobilier.fr",
        phone: "+33 6 12 34 56 78",
        channel: "web",
        subject: "Consultation Permis d'Aménager Lotissement",
        address: "5 Allée des Fauvettes, 83000 Toulon",
        date: getDateOffset(3),
        startTime: "11:00",
        endTime: "12:00",
        amount: 18500,
        status: "cancelled",
        notes: "Report demandé par le client suite à décalage du compromis.",
        leadScore: 50,
        createdAt: new Date().toISOString()
      }
    ];

    for (const rdv of initialAppointments) {
      await this.addAppointment(rdv);
    }
  }

  // --- CRUD Rendez-vous ---
  async getAllAppointments() {
    if (!this.db) {
      return JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('appointments', 'readonly');
      const store = tx.objectStore('appointments');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async countAppointments() {
    if (!this.db) {
      return (JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]')).length;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction('appointments', 'readonly');
      const store = tx.objectStore('appointments');
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  }

  async addAppointment(data) {
    // Normalisation déterministe
    const rdv = {
      ...data,
      address: data.address || 'Adresse à préciser',
      amount: Number(data.amount) || 0,
      leadScore: Number(data.leadScore) || 50,
      createdAt: data.createdAt || new Date().toISOString()
    };

    if (!this.db) {
      const list = JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]');
      rdv.id = Date.now() + Math.floor(Math.random() * 1000);
      list.push(rdv);
      localStorage.setItem('rdv_hub_appointments', JSON.stringify(list));
      if (window.rdvSync && typeof window.rdvSync.enqueueOperation === 'function') {
        window.rdvSync.enqueueOperation('create', rdv.id, rdv);
      }
      return rdv;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('appointments', 'readwrite');
      const store = tx.objectStore('appointments');
      const req = store.add(rdv);

      req.onsuccess = (e) => {
        rdv.id = e.target.result;
        if (window.rdvSync && typeof window.rdvSync.enqueueOperation === 'function') {
          window.rdvSync.enqueueOperation('create', rdv.id, rdv);
        }
        resolve(rdv);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async updateAppointment(id, updates) {
    if (!this.db) {
      const list = JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]');
      const idx = list.findIndex(r => String(r.id) === String(id));
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...updates };
        localStorage.setItem('rdv_hub_appointments', JSON.stringify(list));
        if (window.rdvSync && typeof window.rdvSync.enqueueOperation === 'function') {
          window.rdvSync.enqueueOperation('update', id, list[idx]);
        }
        return list[idx];
      }
      return null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('appointments', 'readwrite');
      const store = tx.objectStore('appointments');
      const targetKey = (typeof id === 'number' || !isNaN(Number(id))) ? Number(id) : id;
      const getReq = store.get(targetKey);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return resolve(null);
        const updatedItem = { ...item, ...updates };
        const putReq = store.put(updatedItem);
        putReq.onsuccess = () => {
          if (window.rdvSync && typeof window.rdvSync.enqueueOperation === 'function') {
            window.rdvSync.enqueueOperation('update', id, updatedItem);
          }
          resolve(updatedItem);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteAppointment(id) {
    if (!this.db) {
      let list = JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]');
      list = list.filter(r => String(r.id) !== String(id));
      localStorage.setItem('rdv_hub_appointments', JSON.stringify(list));
      if (window.rdvSync && typeof window.rdvSync.enqueueOperation === 'function') {
        window.rdvSync.enqueueOperation('delete', id, { id });
      }
      return true;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('appointments', 'readwrite');
      const store = tx.objectStore('appointments');
      const targetKey = (typeof id === 'number' || !isNaN(Number(id))) ? Number(id) : id;
      const req = store.delete(targetKey);
      req.onsuccess = () => {
        if (window.rdvSync && typeof window.rdvSync.enqueueOperation === 'function') {
          window.rdvSync.enqueueOperation('delete', id, { id });
        }
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // --- ACTIONS DIRECTES SANS PROPAGATION (POUR PUSH SSE & SYNC PULL) ---
  async saveDirect(item) {
    if (!item || !item.id) return;
    if (!this.db) {
      const list = JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]');
      const idx = list.findIndex(r => String(r.id) === String(item.id));
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...item };
      } else {
        list.push(item);
      }
      localStorage.setItem('rdv_hub_appointments', JSON.stringify(list));
      return item;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('appointments', 'readwrite');
      const store = tx.objectStore('appointments');
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteDirect(id) {
    if (!id) return;
    if (!this.db) {
      let list = JSON.parse(localStorage.getItem('rdv_hub_appointments') || '[]');
      list = list.filter(r => String(r.id) !== String(id));
      localStorage.setItem('rdv_hub_appointments', JSON.stringify(list));
      return true;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('appointments', 'readwrite');
      const store = tx.objectStore('appointments');
      const targetKey = (typeof id === 'number' || !isNaN(Number(id))) ? Number(id) : id;
      const req = store.delete(targetKey);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- GESTION DE LA FILE D'ATTENTE DE SYNCHRONISATION (SYNC_QUEUE) ---
  async addToSyncQueue(item) {
    if (!this.db || !this.db.objectStoreNames.contains('sync_queue')) {
      const q = JSON.parse(localStorage.getItem('rdv_hub_sync_queue') || '[]');
      q.push(item);
      localStorage.setItem('rdv_hub_sync_queue', JSON.stringify(q));
      return item;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async getSyncQueue() {
    if (!this.db || !this.db.objectStoreNames.contains('sync_queue')) {
      return JSON.parse(localStorage.getItem('rdv_hub_sync_queue') || '[]');
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async removeSyncQueueItem(id) {
    if (!this.db || !this.db.objectStoreNames.contains('sync_queue')) {
      let q = JSON.parse(localStorage.getItem('rdv_hub_sync_queue') || '[]');
      q = q.filter(item => item.id !== id);
      localStorage.setItem('rdv_hub_sync_queue', JSON.stringify(q));
      return true;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async mergeFromServer(serverItems) {
    if (!Array.isArray(serverItems)) return;
    const queue = await this.getSyncQueue();
    const pendingIds = new Set(queue.map(q => String(q.rdvId)));

    for (const sRdv of serverItems) {
      // Si une modification locale n'est pas encore envoyée pour ce RDV, on préserve l'état local
      if (!pendingIds.has(String(sRdv.id))) {
        await this.saveDirect(sRdv);
      }
    }
  }

  async clearAll() {
    if (!this.db) {
      localStorage.removeItem('rdv_hub_appointments');
      localStorage.removeItem('rdv_hub_sync_queue');
      return true;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['appointments', 'sync_queue'], 'readwrite');
      tx.objectStore('appointments').clear();
      tx.objectStore('sync_queue').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Instance globale singleton
window.rdvDB = new RDVHubDB();
