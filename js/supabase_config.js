// ⚙️ CONFIGURATION CLIENT SUPABASE & INJECTION DES VARIABLES D'ENVIRONNEMENT

(function () {
  'use strict';

  // Valeurs par defaut synchronisees avec .env
  const DEFAULT_CONFIG = {
    url: 'https://votre-projet.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.votre_cle_publique_anon_supabase'
  };

  // Recuperation depuis le stockage local (permet a Seb de configurer via l UI ou d injecter via deploy)
  function loadConfig() {
    let url = localStorage.getItem('supabase_custom_url') || DEFAULT_CONFIG.url;
    let key = localStorage.getItem('supabase_custom_key') || DEFAULT_CONFIG.anonKey;

    // Detection de balises meta eventuelles injectees par Docker/Nginx
    const metaUrl = document.querySelector('meta[name="supabase-url"]');
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]');
    if (metaUrl && metaUrl.content) url = metaUrl.content;
    if (metaKey && metaKey.content) key = metaKey.content;

    return { url, anonKey: key };
  }

  const config = loadConfig();

  // Initialisation du client Supabase
  let client = null;
  if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
    try {
      client = supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      console.log('[Supabase Config] Client initialise avec succes vers :', config.url);
    } catch (err) {
      console.error('[Supabase Config] Erreur initialisation client:', err);
    }
  } else {
    console.warn('[Supabase Config] SDK Supabase non detecte. Chargement differe...');
  }

  // Exposition globale
  window.RDV_SUPABASE_CONFIG = config;
  window.supabaseClient = client;

  window.isSupabaseConfigured = function () {
    return !!(config.url && config.anonKey && !config.url.includes('votre-projet'));
  };

  window.setSupabaseConfig = function (newUrl, newKey) {
    if (newUrl) localStorage.setItem('supabase_custom_url', newUrl);
    if (newKey) localStorage.setItem('supabase_custom_key', newKey);
    window.location.reload();
  };
})();
