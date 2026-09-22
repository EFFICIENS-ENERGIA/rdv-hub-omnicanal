// ⚡ RDV-HUB SAAS — APPLICATION CORE CONTROLLER (ZERO-DEPENDENCY & OWASP SECURE)

(function () {
  'use strict';

  // Sécurité OWASP : Échappement systématique des entrées HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/"/g, '&quot;');
  }

  // État Applicatif Central
  const state = {
    appointments: [],
    currentView: 'kanban', // 'kanban' | 'calendar' | 'table' | 'analytics' | 'ai' | 'import'
    filters: {
      search: '',
      channel: 'all',
      status: 'all'
    },
    editingRdvId: null
  };

  // Noms et icônes des canaux
  const CHANNELS = {
    web: { name: 'Site Web', icon: '🌐', color: '#3b82f6' },
    whatsapp: { name: 'WhatsApp', icon: '💬', color: '#22c55e' },
    email: { name: 'Email entrant', icon: '✉️', color: '#8b5cf6' },
    phone: { name: 'Téléphone', icon: '📞', color: '#10b981' },
    ads: { name: 'Campagne Pub', icon: '🎯', color: '#f59e0b' },
    referral: { name: 'Recommandation', icon: '🤝', color: '#ec4899' },
    file: { name: 'Import Fichier', icon: '📁', color: '#64748b' }
  };

  const STATUSES = {
    new: { name: 'Nouveau / À qualifier', badgeClass: 'badge-new' },
    confirmed: { name: 'Confirmé', badgeClass: 'badge-confirmed' },
    pending: { name: 'En attente', badgeClass: 'badge-pending' },
    done: { name: 'Honoré / Gagné', badgeClass: 'badge-done' },
    cancelled: { name: 'Annulé / Perdu', badgeClass: 'badge-cancelled' }
  };

  // Initialisation de l'application
  document.addEventListener('DOMContentLoaded', async () => {
    console.log('[RDV-Hub] Initialisation de l\'application SaaS...');
    
    // Initialiser IndexedDB
    try {
      await window.rdvDB.init();
      await refreshData();
    } catch (err) {
      console.error('[RDV-Hub] Erreur DB:', err);
      showToast('⚠️ Erreur de chargement de la base locale.', 'error');
    }

    // Initialiser le moteur de synchronisation serveur / offline-first
    if (window.rdvSync && typeof window.rdvSync.init === 'function') {
      try {
        await window.rdvSync.init();
      } catch (syncErr) {
        console.warn('[RDV-Hub] Initialisation synchronisation différée:', syncErr);
      }
    }

    // Initialiser le moteur de synchronisation Cloud Supabase
    if (window.supabaseSync && typeof window.supabaseSync.init === 'function') {
      try {
        await window.supabaseSync.init();
      } catch (supaErr) {
        console.warn('[RDV-Hub] Initialisation Supabase Sync différée:', supaErr);
      }
    }

    // Écouter les rafraîchissements issus de la synchronisation distante (SSE / Pull / Supabase)
    window.addEventListener('rdv-sync-refresh', async () => {
      console.log('[RDV-Hub] Rafraîchissement automatique suite à synchronisation distante.');
      await refreshData();
    });

    // Enregistrer le Service Worker pour le mode Offline-First
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(() => {
        console.log('[RDV-Hub] Service Worker actif (Mode Offline-First opérationnel).');
      }).catch(e => console.warn('[RDV-Hub] Service Worker non activé:', e));
    }

    initEventListeners();
    updateThemeFromStorage();
    updateGoogleAccountBadge();
    renderAll();
  });

  // Recharger les données depuis IndexedDB
  async function refreshData() {
    state.appointments = await window.rdvDB.getAllAppointments();
    updateKpis();
    renderCurrentView();
  }

  // --- CALCULS DETERMINISTES & METRIQUES (ZERO-DEFAUT) ---
  function updateKpis() {
    const total = state.appointments.length;
    let caPrevisionnel = 0;
    let caRealise = 0;
    let countHonore = 0;
    let countAnnule = 0;
    let countNew = 0;

    state.appointments.forEach(rdv => {
      const amt = Number(rdv.amount) || 0;
      if (rdv.status !== 'cancelled') {
        caPrevisionnel += amt;
      }
      if (rdv.status === 'done') {
        caRealise += amt;
        countHonore++;
      } else if (rdv.status === 'cancelled') {
        countAnnule++;
      } else if (rdv.status === 'new') {
        countNew++;
      }
    });

    // Taux d'honoration / présence
    const totalTermines = countHonore + countAnnule;
    const showUpRate = totalTermines > 0 ? ((countHonore / totalTermines) * 100).toFixed(1) : '100.0';

    // Taux de conversion global
    const conversionRate = total > 0 ? ((countHonore / total) * 100).toFixed(1) : '0.0';

    // Panier moyen
    const panierMoyen = total > 0 ? Math.round(caPrevisionnel / Math.max(1, total - countAnnule)) : 0;

    // Mise à jour du DOM des KPIs
    setElementText('kpiTotalRdv', total);
    setElementText('kpiCaPrevisionnel', formatCurrency(caPrevisionnel));
    setElementText('kpiCaRealise', formatCurrency(caRealise));
    setElementText('kpiShowUpRate', `${showUpRate}%`);
    setElementText('kpiConversionRate', `${conversionRate}%`);
    setElementText('kpiPanierMoyen', formatCurrency(panierMoyen));

    // Compteurs sidebar
    setElementText('navCountKanban', total);
    setElementText('navCountNew', countNew);
  }

  function formatCurrency(val) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  }

  function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // --- DETECTION DES CONFLITS D'AGENDA ---
  function detectConflicts(date, startTime, endTime, excludeId = null) {
    if (!date || !startTime || !endTime) return false;

    return state.appointments.some(r => {
      if (r.id === excludeId) return false;
      if (r.date !== date) return false;
      if (r.status === 'cancelled') return false;

      // Chevauchement d'intervalles [startA, endA] et [startB, endB]
      // Deux créneaux se chevauchent si startA < endB ET endA > startB
      return (startTime < r.endTime && endTime > r.startTime);
    });
  }

  // --- INTEGRATION GOOGLE AGENDA & GMAIL ---
  function getSavedGoogleEmail() {
    return localStorage.getItem('rdv_google_email') || 'sebastien.pro@gmail.com';
  }

  function setSavedGoogleEmail(email) {
    const clean = (email || '').trim().toLowerCase();
    if (clean) {
      localStorage.setItem('rdv_google_email', clean);
      updateGoogleAccountBadge();
    }
  }

  function updateGoogleAccountBadge() {
    const email = getSavedGoogleEmail();
    const badge = document.getElementById('googleAccountBadge');
    if (badge) badge.textContent = `Google : ${email}`;
    const inp = document.getElementById('googleEmailInput');
    if (inp) inp.value = email;
  }

  function buildGoogleCalendarUrl(rdv) {
    if (!rdv) return 'https://calendar.google.com';
    const cleanDate = (rdv.date || '').replace(/-/g, '');
    const cleanStart = (rdv.startTime || '10:00').replace(':', '') + '00';
    const cleanEnd = (rdv.endTime || '11:00').replace(':', '') + '00';
    const dates = `${cleanDate}T${cleanStart}/${cleanDate}T${cleanEnd}`;
    
    const title = encodeURIComponent(`[${(rdv.channel || 'RDV').toUpperCase()}] ${rdv.subject || 'Rendez-vous'} - ${rdv.clientName}`);
    const details = encodeURIComponent(
      `👤 Client : ${rdv.clientName}\n` +
      `📋 Objet : ${rdv.subject || 'Rendez-vous'}\n` +
      `📧 Email : ${rdv.email || 'Non spécifié'}\n` +
      `📞 Téléphone : ${rdv.phone || 'Non spécifié'}\n` +
      `💶 Montant prévisionnel : ${rdv.amount || 0} €\n` +
      `🏷️ Canal d'acquisition : ${rdv.channel}\n` +
      `📝 Notes : ${rdv.notes || ''}\n\n` +
      `--\nGénéré automatiquement par RDV-Hub Omnicanal SaaS`
    );
    const location = encodeURIComponent(rdv.address || (rdv.channel === 'phone' ? 'Appel Téléphonique' : (rdv.channel === 'web' ? 'Visioconférence Google Meet' : 'Chantier Client')));
    
    let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
    if (rdv.email && rdv.email.includes('@')) {
      url += `&add=${encodeURIComponent(rdv.email)}`;
    }
    return url;
  }

  // --- INTEGRATION NAVIGATION WAZE ---
  function buildWazeUrl(address) {
    if (!address || address.trim() === '' || address === 'Adresse à préciser') {
      return 'https://waze.com/ul';
    }
    return `https://waze.com/ul?q=${encodeURIComponent(address.trim())}&navigate=yes`;
  }

  function buildGmailComposeUrl(rdv) {
    if (!rdv) return 'https://mail.google.com';
    const to = encodeURIComponent(rdv.email || '');
    const subject = encodeURIComponent(`Confirmation Rendez-vous : ${rdv.subject || 'Échange BÂTI-EXCELLENCE'}`);
    const body = encodeURIComponent(
      `Bonjour ${rdv.clientName},\n\n` +
      `Nous vous confirmons notre rendez-vous prévu le ${rdv.date} de ${rdv.startTime} à ${rdv.endTime}.\n\n` +
      `Objet : ${rdv.subject}\n` +
      (rdv.address ? `Lieu : ${rdv.address}\n` : '') +
      (rdv.notes ? `Détails : ${rdv.notes}\n\n` : '\n') +
      `Restant à votre disposition pour tout échange complémentaire.\n\n` +
      `Bien cordialement,\n` +
      `L'équipe BÂTI-EXCELLENCE Architecture & Ingénierie`
    );
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
  }

  function exportGoogleCalendarIcs() {
    if (state.appointments.length === 0) {
      showToast('Aucun rendez-vous à exporter.', 'error');
      return;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}00Z`;

    let lines = [
      'BEGIN:VCALENDAR',
      'PRODID:-//RDV-Hub Omnicanal//FR',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:RDV-Hub Google Planning',
      'X-WR-TIMEZONE:Europe/Paris'
    ];

    state.appointments.forEach(r => {
      if (r.status === 'cancelled') return;
      const cleanDate = (r.date || '').replace(/-/g, '');
      const cleanStart = (r.startTime || '10:00').replace(':', '') + '00';
      const cleanEnd = (r.endTime || '11:00').replace(':', '') + '00';

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:rdv-${r.id}-${cleanDate}@rdvhub.google`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${cleanDate}T${cleanStart}`);
      lines.push(`DTEND:${cleanDate}T${cleanEnd}`);
      lines.push(`SUMMARY:[${(r.channel || 'RDV').toUpperCase()}] ${r.subject} - ${r.clientName}`);
      if (r.address) lines.push(`LOCATION:${r.address}`);
      lines.push(`DESCRIPTION:Client: ${r.clientName}\\nAdresse: ${r.address || 'N/A'}\\nEmail: ${r.email || ''}\\nTel: ${r.phone || ''}\\nBudget: ${r.amount || 0} EUR`);
      lines.push('STATUS:CONFIRMED');
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `planning_google_agenda_${now.toISOString().split('T')[0]}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('📅 Export Google Agenda généré (.ics) !', 'success');
  }

  // --- FILTRAGE DES RENDEZ-VOUS ---
  function getFilteredAppointments() {
    return state.appointments.filter(rdv => {
      // Filtre canal
      if (state.filters.channel !== 'all' && rdv.channel !== state.filters.channel) {
        return false;
      }
      // Filtre statut
      if (state.filters.status !== 'all' && rdv.status !== state.filters.status) {
        return false;
      }
      // Filtre recherche textuelle
      if (state.filters.search.trim()) {
        const q = state.filters.search.toLowerCase();
        const clientMatch = (rdv.clientName || '').toLowerCase().includes(q);
        const subjectMatch = (rdv.subject || '').toLowerCase().includes(q);
        const emailMatch = (rdv.email || '').toLowerCase().includes(q);
        const phoneMatch = (rdv.phone || '').toLowerCase().includes(q);
        const addressMatch = (rdv.address || '').toLowerCase().includes(q);
        if (!clientMatch && !subjectMatch && !emailMatch && !phoneMatch && !addressMatch) {
          return false;
        }
      }
      return true;
    });
  }

  // --- RENDU DES VUES ---
  function renderAll() {
    updateKpis();
    renderCurrentView();
  }

  function renderCurrentView() {
    const views = ['kanbanView', 'calendarView', 'tableView', 'analyticsView', 'aiView', 'importView', 'googleView'];
    views.forEach(v => {
      const el = document.getElementById(v);
      if (el) el.style.display = (v === `${state.currentView}View`) ? 'block' : 'none';
    });

    switch (state.currentView) {
      case 'kanban':
        renderKanban();
        break;
      case 'calendar':
        renderCalendar();
        break;
      case 'table':
        renderTable();
        break;
      case 'analytics':
        renderAnalytics();
        break;
      case 'ai':
        // Déjà prêt ou rafraîchir
        break;
      case 'import':
        // Vue d'import
        break;
      case 'google':
        updateGoogleAccountBadge();
        break;
    }
  }

  // 1. Vue Kanban
  function renderKanban() {
    const filtered = getFilteredAppointments();
    const columns = {
      new: document.getElementById('colNew'),
      confirmed: document.getElementById('colConfirmed'),
      pending: document.getElementById('colPending'),
      done: document.getElementById('colDone'),
      cancelled: document.getElementById('colCancelled')
    };

    // Vider les colonnes
    Object.keys(columns).forEach(status => {
      if (columns[status]) columns[status].innerHTML = '';
    });

    filtered.forEach(rdv => {
      const col = columns[rdv.status];
      if (!col) return;

      const ch = CHANNELS[rdv.channel] || CHANNELS.web;
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.dataset.id = rdv.id;

      card.innerHTML = `
        <div class="kanban-card-top">
          <span class="badge badge-channel" data-channel="${escapeAttr(rdv.channel)}">
            ${ch.icon} ${escapeHtml(ch.name)}
          </span>
          <span class="badge ${STATUSES[rdv.status]?.badgeClass || ''}">
            <span class="badge-dot"></span>${escapeHtml(STATUSES[rdv.status]?.name || rdv.status)}
          </span>
        </div>
        <div class="kanban-card-client">${escapeHtml(rdv.clientName)}</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
          ${escapeHtml(rdv.subject || 'Rendez-vous')}
        </div>
        <div style="margin-bottom: 0.45rem;">
          <a href="${buildWazeUrl(rdv.address)}" target="_blank" rel="noopener noreferrer" class="waze-link" title="Lancer le guidage Waze : ${escapeAttr(rdv.address || '')}">
            🚙 ${escapeHtml(rdv.address || 'Adresse à préciser')}
          </a>
        </div>
        <div class="kanban-card-meta">
          <span>📅 ${escapeHtml(rdv.date)}</span>
          <span>⏰ ${escapeHtml(rdv.startTime)} - ${escapeHtml(rdv.endTime)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.4rem;">
          <span class="kanban-card-amount">${formatCurrency(rdv.amount || 0)}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">Score: ${rdv.leadScore || 50}/100</span>
        </div>
        <div class="kanban-card-actions">
          <a href="${buildWazeUrl(rdv.address)}" target="_blank" rel="noopener noreferrer" class="btn btn-waze btn-pill" style="font-size:0.72rem; padding:0.25rem 0.55rem;" title="Lancer l'itinéraire Waze en 1-clic">
            🚙 Waze ↗
          </a>
          <a href="${buildGoogleCalendarUrl(rdv)}" target="_blank" rel="noopener noreferrer" class="btn btn-google btn-pill" style="font-size:0.72rem; padding:0.25rem 0.55rem;" title="Ajouter à Google Agenda en 1-clic">
            🇬 Agenda ↗
          </a>
          <a href="${buildGmailComposeUrl(rdv)}" target="_blank" rel="noopener noreferrer" class="btn btn-gmail btn-pill" style="font-size:0.72rem; padding:0.25rem 0.55rem;" title="Écrire au client avec Gmail">
            ✉️ Gmail ↗
          </a>
          <button class="btn btn-secondary btn-pill edit-rdv-btn" data-id="${rdv.id}">✏️</button>
          <button class="btn btn-danger btn-pill delete-rdv-btn" data-id="${rdv.id}">🗑️</button>
        </div>
      `;

      col.appendChild(card);
    });

    // Mettre à jour les badges de colonnes
    Object.keys(columns).forEach(status => {
      const badge = document.getElementById(`countBadge_${status}`);
      if (badge) {
        const count = filtered.filter(r => r.status === status).length;
        badge.textContent = count;
      }
    });

    attachCardActions();
  }

  // 2. Vue Calendrier
  function renderCalendar() {
    const grid = document.getElementById('calendarDaysGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const filtered = getFilteredAppointments();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    // Affichage des 14 prochains jours
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const isToday = i === 0;

      const dayCell = document.createElement('div');
      dayCell.className = `cal-cell ${isToday ? 'today' : ''}`;

      const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      const dayRDVs = filtered.filter(r => r.date === dateStr);

      let slotsHtml = '';
      dayRDVs.forEach(r => {
        const hasConflict = detectConflicts(r.date, r.startTime, r.endTime, r.id);
        const conflictClass = hasConflict ? 'cal-slot-conflict' : '';
        const ch = CHANNELS[r.channel] || CHANNELS.web;

        slotsHtml += `
          <div class="cal-slot-item ${conflictClass}" title="${escapeAttr(r.clientName)} - ${escapeAttr(r.subject)} - 📍 ${escapeAttr(r.address || 'Adresse à préciser')}" data-id="${r.id}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.25rem;">
              <span><strong>${escapeHtml(r.startTime)}</strong> ${ch.icon} ${escapeHtml(r.clientName)}</span>
              <a href="${buildWazeUrl(r.address)}" target="_blank" rel="noopener noreferrer" class="waze-link-mini" title="Lancer Waze : ${escapeAttr(r.address || '')}" onclick="event.stopPropagation();">
                🚙
              </a>
            </div>
            ${r.address ? `<div style="font-size:0.65rem; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-top:2px;">📍 ${escapeHtml(r.address)}</div>` : ''}
          </div>
        `;
      });

      dayCell.innerHTML = `
        <div class="cal-cell-header">
          <span>${escapeHtml(dayName)}</span>
          ${isToday ? '<span style="color:var(--accent-primary); font-size:0.65rem;">AUJOURD\'HUI</span>' : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:0.25rem; flex:1; overflow-y:auto;">
          ${slotsHtml || '<div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.5rem; text-align:center;">Libre</div>'}
        </div>
      `;

      grid.appendChild(dayCell);
    }
  }

  // 3. Vue Table Dynamique
  function renderTable() {
    const tbody = document.getElementById('appointmentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = getFilteredAppointments();

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Aucun rendez-vous ne correspond aux critères.</td></tr>`;
      return;
    }

    filtered.forEach(rdv => {
      const ch = CHANNELS[rdv.channel] || CHANNELS.web;
      const st = STATUSES[rdv.status] || STATUSES.new;
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${escapeHtml(rdv.clientName)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(rdv.email || rdv.phone || 'Non renseigné')}</div>
        </td>
        <td>
          <span class="badge badge-channel" data-channel="${escapeAttr(rdv.channel)}">
            ${ch.icon} ${escapeHtml(ch.name)}
          </span>
        </td>
        <td>
          <div style="font-weight:500;">${escapeHtml(rdv.subject || 'Rendez-vous')}</div>
          <div style="margin-top:0.25rem;">
            <a href="${buildWazeUrl(rdv.address)}" target="_blank" rel="noopener noreferrer" class="waze-link" title="Lancer le guidage Waze : ${escapeAttr(rdv.address || '')}">
              🚙 ${escapeHtml(rdv.address || 'Adresse à préciser')}
            </a>
          </div>
        </td>
        <td>
          <div>📅 ${escapeHtml(rdv.date)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">⏰ ${escapeHtml(rdv.startTime)} - ${escapeHtml(rdv.endTime)}</div>
        </td>
        <td style="font-weight:700; color:var(--status-emerald);">
          ${formatCurrency(rdv.amount || 0)}
        </td>
        <td>
          <select class="form-control status-select" data-id="${rdv.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; width:auto;">
            <option value="new" ${rdv.status === 'new' ? 'selected' : ''}>Nouveau</option>
            <option value="confirmed" ${rdv.status === 'confirmed' ? 'selected' : ''}>Confirmé</option>
            <option value="pending" ${rdv.status === 'pending' ? 'selected' : ''}>En attente</option>
            <option value="done" ${rdv.status === 'done' ? 'selected' : ''}>Honoré / Gagné</option>
            <option value="cancelled" ${rdv.status === 'cancelled' ? 'selected' : ''}>Annulé</option>
          </select>
        </td>
        <td>
          <div style="display:flex; gap:0.25rem; align-items:center;">
            <a href="${buildWazeUrl(rdv.address)}" target="_blank" rel="noopener noreferrer" class="btn btn-waze btn-pill" style="font-size:0.75rem; padding:0.25rem 0.55rem;" title="Lancer Waze en 1-clic">
              🚙 Waze
            </a>
            <a href="${buildGoogleCalendarUrl(rdv)}" target="_blank" rel="noopener noreferrer" class="btn btn-google btn-pill" style="font-size:0.75rem; padding:0.25rem 0.55rem;" title="Ajouter à Google Agenda">
              🇬 Agenda
            </a>
            <a href="${buildGmailComposeUrl(rdv)}" target="_blank" rel="noopener noreferrer" class="btn btn-gmail btn-pill" style="font-size:0.75rem; padding:0.25rem 0.55rem;" title="Écrire via Gmail">
              ✉️
            </a>
            <button class="btn btn-secondary btn-pill edit-rdv-btn" data-id="${rdv.id}">✏️</button>
            <button class="btn btn-danger btn-pill delete-rdv-btn" data-id="${rdv.id}">🗑️</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    attachCardActions();

    // Écouteur changement direct de statut dans le tableau
    document.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const id = Number(e.target.dataset.id);
        const newStatus = e.target.value;
        await window.rdvDB.updateAppointment(id, { status: newStatus });
        showToast('Statut mis à jour avec succès.', 'success');
        await refreshData();
      });
    });
  }

  // 4. Vue Analytics (Graphiques SVG Natifs)
  function renderAnalytics() {
    renderChannelDonutChart();
    renderRevenueBarChart();
  }

  function renderChannelDonutChart() {
    const container = document.getElementById('channelChartContainer');
    if (!container) return;

    // Agréger par canal
    const counts = {};
    Object.keys(CHANNELS).forEach(k => counts[k] = 0);
    state.appointments.forEach(r => {
      counts[r.channel] = (counts[r.channel] || 0) + 1;
    });

    const total = state.appointments.length || 1;
    let currentAngle = 0;
    const slices = [];

    Object.entries(counts).forEach(([channelKey, count]) => {
      if (count === 0) return;
      const angle = (count / total) * 360;
      const ch = CHANNELS[channelKey];
      slices.push({
        key: channelKey,
        name: ch.name,
        color: ch.color,
        count,
        percent: ((count / total) * 100).toFixed(1),
        startAngle: currentAngle,
        endAngle: currentAngle + angle
      });
      currentAngle += angle;
    });

    // Générer SVG Donut
    let svgPaths = '';
    const cx = 130, cy = 130, r = 90, rInner = 55;

    slices.forEach(s => {
      const p = getDonutSlicePath(cx, cy, r, rInner, s.startAngle, s.endAngle);
      svgPaths += `<path d="${p}" fill="${s.color}" opacity="0.9"><title>${escapeAttr(s.name)}: ${s.count} (${s.percent}%)</title></path>`;
    });

    let legendHtml = '<div style="display:flex; flex-direction:column; gap:0.4rem; justify-content:center;">';
    slices.forEach(s => {
      legendHtml += `
        <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.75rem;">
          <span style="width:10px; height:10px; border-radius:50%; background:${s.color}; display:inline-block;"></span>
          <span style="font-weight:500;">${escapeHtml(s.name)}</span>
          <span style="color:var(--text-muted); margin-left:auto;">${s.count} (${s.percent}%)</span>
        </div>
      `;
    });
    legendHtml += '</div>';

    container.innerHTML = `
      <div style="display:flex; gap:1.5rem; align-items:center; height:100%;">
        <svg viewBox="0 0 260 260" width="200" height="200">
          ${svgPaths}
          <circle cx="${cx}" cy="${cy}" r="${rInner - 2}" fill="var(--bg-card)" />
          <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--text-primary)" font-size="22" font-weight="700">${state.appointments.length}</text>
          <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="var(--text-muted)" font-size="11" text-transform="uppercase">RDV TOTAL</text>
        </svg>
        <div style="flex:1;">
          ${legendHtml}
        </div>
      </div>
    `;
  }

  function getDonutSlicePath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    // Éviter le cas 360 complet exact pour l'arc SVG
    if (endAngle - startAngle >= 359.9) endAngle = startAngle + 359.99;

    const rad = Math.PI / 180;
    const x1 = cx + rOuter * Math.cos(startAngle * rad);
    const y1 = cy + rOuter * Math.sin(startAngle * rad);
    const x2 = cx + rOuter * Math.cos(endAngle * rad);
    const y2 = cy + rOuter * Math.sin(endAngle * rad);

    const x3 = cx + rInner * Math.cos(endAngle * rad);
    const y3 = cy + rInner * Math.sin(endAngle * rad);
    const x4 = cx + rInner * Math.cos(startAngle * rad);
    const y4 = cy + rInner * Math.sin(startAngle * rad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  }

  function renderRevenueBarChart() {
    const container = document.getElementById('revenueChartContainer');
    if (!container) return;

    // Regrouper le CA par statut
    const statusData = [
      { name: 'Nouveau', key: 'new', color: '#38bdf8' },
      { name: 'Confirmé', key: 'confirmed', color: '#c084fc' },
      { name: 'En attente', key: 'pending', color: '#f59e0b' },
      { name: 'Honoré / Gagné', key: 'done', color: '#10b981' },
      { name: 'Annulé', key: 'cancelled', color: '#f43f5e' }
    ];

    let maxCa = 1;
    statusData.forEach(st => {
      st.ca = state.appointments
        .filter(r => r.status === st.key)
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      if (st.ca > maxCa) maxCa = st.ca;
    });

    let barsHtml = '';
    const h = 180;
    statusData.forEach((st, i) => {
      const barH = Math.max(10, Math.round((st.ca / maxCa) * h));
      const y = h - barH + 20;
      const x = 40 + i * 85;

      barsHtml += `
        <rect x="${x}" y="${y}" width="48" height="${barH}" rx="6" fill="${st.color}" opacity="0.85">
          <title>${st.name} : ${formatCurrency(st.ca)}</title>
        </rect>
        <text x="${x + 24}" y="${y - 8}" text-anchor="middle" fill="var(--text-primary)" font-size="10" font-weight="600">
          ${Math.round(st.ca / 1000)}k€
        </text>
        <text x="${x + 24}" y="${h + 40}" text-anchor="middle" fill="var(--text-muted)" font-size="10">
          ${st.name.split(' ')[0]}
        </text>
      `;
    });

    container.innerHTML = `
      <svg viewBox="0 0 480 240" width="100%" height="240">
        <line x1="30" y1="200" x2="460" y2="200" stroke="var(--border-subtle)" stroke-width="1" />
        ${barsHtml}
      </svg>
    `;
  }

  // --- ATTACH ACTIONS AUX CARTES ET BOUTONS ---
  function attachCardActions() {
    // Bouton Éditer
    document.querySelectorAll('.edit-rdv-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        openEditModal(id);
      };
    });

    // Bouton Supprimer
    document.querySelectorAll('.delete-rdv-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        if (confirm('Voulez-vous vraiment supprimer ce rendez-vous ?')) {
          await window.rdvDB.deleteAppointment(id);
          showToast('Rendez-vous supprimé.', 'success');
          await refreshData();
        }
      };
    });
  }

  // --- GESTION DE LA MODALE AJOUT / ÉDITION ---
  function openAddModal() {
    state.editingRdvId = null;
    document.getElementById('modalTitle').textContent = 'Nouveau Rendez-vous Client';
    document.getElementById('rdvForm').reset();
    
    // Date et créneau par défaut
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('rdvDate').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    document.getElementById('rdvStartTime').value = '10:00';
    document.getElementById('rdvEndTime').value = '11:00';
    document.getElementById('rdvAmount').value = '5000';
    document.getElementById('rdvAddress').value = '';
    document.getElementById('conflictAlert').style.display = 'none';

    document.getElementById('rdvModal').classList.add('open');
  }

  function openEditModal(id) {
    const rdv = state.appointments.find(r => r.id === id);
    if (!rdv) return;

    state.editingRdvId = id;
    document.getElementById('modalTitle').textContent = 'Modifier le Rendez-vous';
    
    document.getElementById('rdvClientName').value = rdv.clientName || '';
    document.getElementById('rdvEmail').value = rdv.email || '';
    document.getElementById('rdvPhone').value = rdv.phone || '';
    document.getElementById('rdvChannel').value = rdv.channel || 'web';
    document.getElementById('rdvSubject').value = rdv.subject || '';
    document.getElementById('rdvAddress').value = rdv.address || '';
    document.getElementById('rdvDate').value = rdv.date || '';
    document.getElementById('rdvStartTime').value = rdv.startTime || '';
    document.getElementById('rdvEndTime').value = rdv.endTime || '';
    document.getElementById('rdvAmount').value = rdv.amount || 0;
    document.getElementById('rdvStatus').value = rdv.status || 'new';
    document.getElementById('rdvNotes').value = rdv.notes || '';
    document.getElementById('conflictAlert').style.display = 'none';

    document.getElementById('rdvModal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('rdvModal').classList.remove('open');
  }

  // --- ECOUTEURS D'EVENEMENTS GLOBAUX ---
  function initEventListeners() {
    // Bascule de vue via Sidebar et Onglets
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => {
        const view = el.dataset.view;
        state.currentView = view;

        // Mise à jour de la classe active
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
        if (navEl) navEl.classList.add('active');

        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        const tabEl = document.querySelector(`.tab-btn[data-view="${view}"]`);
        if (tabEl) tabEl.classList.add('active');

        renderCurrentView();
      });
    });

    // Filtres
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        renderCurrentView();
      });
    }

    const channelFilter = document.getElementById('channelFilterSelect');
    if (channelFilter) {
      channelFilter.addEventListener('change', (e) => {
        state.filters.channel = e.target.value;
        renderCurrentView();
      });
    }

    const statusFilter = document.getElementById('statusFilterSelect');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        state.filters.status = e.target.value;
        renderCurrentView();
      });
    }

    // Boutons Modale RDV
    document.getElementById('btnNewRdv')?.addEventListener('click', openAddModal);
    document.getElementById('btnQuickAdd')?.addEventListener('click', openAddModal);
    document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
    document.getElementById('cancelModalBtn')?.addEventListener('click', closeModal);

    // Détection de conflit dynamique en cours de saisie
    const checkFormConflict = () => {
      const date = document.getElementById('rdvDate').value;
      const start = document.getElementById('rdvStartTime').value;
      const end = document.getElementById('rdvEndTime').value;
      const hasConflict = detectConflicts(date, start, end, state.editingRdvId);
      const alertEl = document.getElementById('conflictAlert');
      if (alertEl) alertEl.style.display = hasConflict ? 'block' : 'none';
    };

    document.getElementById('rdvDate')?.addEventListener('change', checkFormConflict);
    document.getElementById('rdvStartTime')?.addEventListener('change', checkFormConflict);
    document.getElementById('rdvEndTime')?.addEventListener('change', checkFormConflict);

    // Soumission du formulaire RDV
    document.getElementById('rdvForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const rdvData = {
        clientName: document.getElementById('rdvClientName').value.trim(),
        email: document.getElementById('rdvEmail').value.trim(),
        phone: document.getElementById('rdvPhone').value.trim(),
        channel: document.getElementById('rdvChannel').value,
        subject: document.getElementById('rdvSubject').value.trim(),
        address: document.getElementById('rdvAddress').value.trim(),
        date: document.getElementById('rdvDate').value,
        startTime: document.getElementById('rdvStartTime').value,
        endTime: document.getElementById('rdvEndTime').value,
        amount: parseFloat(document.getElementById('rdvAmount').value) || 0,
        status: document.getElementById('rdvStatus').value,
        notes: document.getElementById('rdvNotes').value.trim()
      };

      if (!rdvData.clientName || !rdvData.date || !rdvData.startTime || !rdvData.endTime) {
        showToast('Veuillez remplir les champs obligatoires.', 'error');
        return;
      }

      // Alerte Conflit non bloquante mais avertie
      const isConflict = detectConflicts(rdvData.date, rdvData.startTime, rdvData.endTime, state.editingRdvId);
      if (isConflict) {
        const proceed = confirm('⚠️ Attention : un autre rendez-vous chevauche ce créneau horaire. Confirmer quand même ?');
        if (!proceed) return;
      }

      if (state.editingRdvId) {
        await window.rdvDB.updateAppointment(state.editingRdvId, rdvData);
        showToast('Rendez-vous mis à jour avec succès.', 'success');
      } else {
        await window.rdvDB.addAppointment(rdvData);
        showToast('Nouveau rendez-vous enregistré.', 'success');
      }

      closeModal();
      await refreshData();
    });

    // Thème Sombre / Clair
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

    // Copilote IA (Fin AI)
    document.getElementById('btnAnalyzeAI')?.addEventListener('click', runAiQualification);
    document.getElementById('btnApplyAiSlot')?.addEventListener('click', applyAiSlotToForm);

    // Export CSV Client-Side
    document.getElementById('btnExportCsv')?.addEventListener('click', exportToCsv);
    document.getElementById('btnExportPdf')?.addEventListener('click', () => window.print());

    // Import Fichier Drag & Drop
    const dropArea = document.getElementById('fileDropArea');
    const fileInput = document.getElementById('csvFileInput');
    if (dropArea && fileInput) {
      dropArea.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleFileUpload);
      dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.style.borderColor = 'var(--accent-primary)'; });
      dropArea.addEventListener('dragleave', () => { dropArea.style.borderColor = 'var(--border-subtle)'; });
      dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.style.borderColor = 'var(--border-subtle)';
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
    }

    // Événements Intégration Google Agenda & Gmail
    document.getElementById('googleAccountBtn')?.addEventListener('click', () => {
      state.currentView = 'google';
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelector(`.nav-item[data-view="google"]`)?.classList.add('active');
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelector(`.tab-btn[data-view="google"]`)?.classList.add('active');
      renderCurrentView();
    });

    document.getElementById('btnSaveGoogleEmail')?.addEventListener('click', () => {
      const email = document.getElementById('googleEmailInput')?.value;
      if (email && email.includes('@')) {
        setSavedGoogleEmail(email);
        showToast('Compte Google enregistré avec succès.', 'success');
      } else {
        showToast('Veuillez saisir une adresse email valide.', 'error');
      }
    });

    document.getElementById('btnExportGoogleIcs')?.addEventListener('click', exportGoogleCalendarIcs);

    document.getElementById('btnTestGoogleLink')?.addEventListener('click', () => {
      const firstRdv = state.appointments.find(r => r.status !== 'cancelled') || state.appointments[0];
      if (firstRdv) {
        const url = buildGoogleCalendarUrl(firstRdv);
        window.open(url, '_blank', 'noopener,noreferrer');
        showToast('Google Agenda ouvert dans un nouvel onglet.', 'info');
      } else {
        showToast('Aucun rendez-vous à synchroniser.', 'error');
      }
    });

    // Enregistrer et ouvrir directement dans Google Agenda depuis la modale
    document.getElementById('saveAndGoogleBtn')?.addEventListener('click', async () => {
      const rdvData = {
        clientName: document.getElementById('rdvClientName').value.trim(),
        email: document.getElementById('rdvEmail').value.trim(),
        phone: document.getElementById('rdvPhone').value.trim(),
        channel: document.getElementById('rdvChannel').value,
        subject: document.getElementById('rdvSubject').value.trim(),
        address: document.getElementById('rdvAddress').value.trim(),
        date: document.getElementById('rdvDate').value,
        startTime: document.getElementById('rdvStartTime').value,
        endTime: document.getElementById('rdvEndTime').value,
        amount: parseFloat(document.getElementById('rdvAmount').value) || 0,
        status: document.getElementById('rdvStatus').value,
        notes: document.getElementById('rdvNotes').value.trim()
      };

      if (!rdvData.clientName || !rdvData.date || !rdvData.startTime || !rdvData.endTime) {
        showToast('Veuillez remplir les champs obligatoires.', 'error');
        return;
      }

      if (state.editingRdvId) {
        await window.rdvDB.updateAppointment(state.editingRdvId, rdvData);
      } else {
        await window.rdvDB.addAppointment(rdvData);
      }

      closeModal();
      await refreshData();
      const gUrl = buildGoogleCalendarUrl(rdvData);
      window.open(gUrl, '_blank', 'noopener,noreferrer');
      showToast('✅ Enregistré et ouvert dans Google Agenda !', 'success');
    });

    // Bouton Test de guidage Waze depuis la modale
    document.getElementById('btnPreviewWaze')?.addEventListener('click', () => {
      const address = document.getElementById('rdvAddress')?.value;
      if (address && address.trim()) {
        window.open(buildWazeUrl(address), '_blank', 'noopener,noreferrer');
        showToast('🚙 Itinéraire Waze ouvert dans un nouvel onglet !', 'info');
      } else {
        showToast('Veuillez saisir une adresse avant de tester Waze.', 'error');
      }
    });

    // Événements Authentification Supabase Cloud
    document.getElementById('userProfileBtn')?.addEventListener('click', async () => {
      if (window.supabaseSync && window.supabaseSync.currentUser) {
        const email = window.supabaseSync.currentUser.email || 'Utilisateur';
        const confirmLogout = confirm(`Connecté en tant que ${email}.\nSouhaitez-vous vous déconnecter ?`);
        if (confirmLogout && window.supabaseClient) {
          await window.supabaseClient.auth.signOut();
          showToast('Déconnexion effectuée. Mode Invité / Offline actif.', 'info');
          await refreshData();
        }
      } else {
        openAuthModal();
      }
    });

    document.getElementById('closeAuthModalBtn')?.addEventListener('click', closeAuthModal);
    document.getElementById('cancelAuthModalBtn')?.addEventListener('click', closeAuthModal);
    document.getElementById('authGuestBtn')?.addEventListener('click', () => {
      closeAuthModal();
      showToast('Mode Invité actif (IndexedDB Locale opérationnelle).', 'info');
    });

    document.getElementById('tabAuthLogin')?.addEventListener('click', () => setAuthMode('login'));
    document.getElementById('tabAuthRegister')?.addEventListener('click', () => setAuthMode('register'));
    document.getElementById('authForm')?.addEventListener('submit', handleAuthSubmit);
  }

  // --- GESTION DE L'AUTHENTIFICATION SUPABASE CLOUD ---
  let authMode = 'login';

  function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    setAuthMode('login');
    const alertEl = document.getElementById('authAlert');
    if (alertEl) {
      alertEl.style.display = 'none';
      alertEl.className = '';
    }
    document.getElementById('authForm')?.reset();
    modal.classList.add('open');
  }

  function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
  }

  function setAuthMode(mode) {
    authMode = mode;
    const tabLogin = document.getElementById('tabAuthLogin');
    const tabRegister = document.getElementById('tabAuthRegister');
    const groupName = document.getElementById('groupAuthName');
    const submitBtn = document.getElementById('authSubmitBtn');
    const title = document.getElementById('authModalTitle');

    if (mode === 'login') {
      tabLogin?.classList.add('active');
      tabRegister?.classList.remove('active');
      if (groupName) groupName.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Se connecter';
      if (title) title.innerHTML = '<span>☁️</span> <span>Connexion Supabase Cloud</span>';
    } else {
      tabRegister?.classList.add('active');
      tabLogin?.classList.remove('active');
      if (groupName) groupName.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Créer mon compte';
      if (title) title.innerHTML = '<span>🚀</span> <span>Inscription Supabase Cloud</span>';
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const alertEl = document.getElementById('authAlert');
    const submitBtn = document.getElementById('authSubmitBtn');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const name = document.getElementById('authName')?.value.trim() || '';

    if (!email || !password) {
      if (alertEl) {
        alertEl.className = 'error';
        alertEl.textContent = 'Veuillez saisir votre email et votre mot de passe.';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Vérification en cours...';
    }

    try {
      const client = window.supabaseClient;
      if (!client) throw new Error('Client Supabase non initialisé.');

      if (authMode === 'login') {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (alertEl) {
          alertEl.className = 'success';
          alertEl.textContent = 'Connexion réussie ! Chargement de votre espace...';
        }
        showToast('Connexion Cloud réussie.', 'success');
      } else {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { nom: name } }
        });
        if (error) throw error;
        if (alertEl) {
          alertEl.className = 'success';
          alertEl.textContent = 'Compte créé avec succès ! Vos données sont protégées par RLS.';
        }
        showToast('Compte Supabase créé avec succès.', 'success');
      }

      setTimeout(async () => {
        closeAuthModal();
        if (submitBtn) submitBtn.disabled = false;
        if (window.supabaseSync) {
          await window.supabaseSync.pushLocalQueueToCloud();
          await window.supabaseSync.pullCloudToLocal();
        }
        await refreshData();
      }, 800);
    } catch (err) {
      if (alertEl) {
        alertEl.className = 'error';
        alertEl.textContent = err.message || 'Erreur d\'authentification.';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = (authMode === 'login') ? 'Se connecter' : 'Créer mon compte';
      }
    }
  }

  // --- FIN AI QUALIFICATION RUNNER ---
  function runAiQualification() {
    const text = document.getElementById('aiInquiryInput').value.trim();
    if (!text) {
      showToast('Veuillez saisir le texte de la demande à analyser.', 'error');
      return;
    }

    const result = window.rdvAI.analyzeInquiry(text);
    const slot = window.rdvAI.findOptimalSlot(state.appointments);

    document.getElementById('aiScoreValue').textContent = `${result.score}/100`;
    document.getElementById('aiUrgencyValue').textContent = result.urgency.toUpperCase();
    document.getElementById('aiBudgetValue').textContent = formatCurrency(result.estimatedBudget);
    document.getElementById('aiSlotValue').textContent = `${slot.formattedDate} (${slot.startTime} - ${slot.endTime})`;
    
    // Entités
    const entList = document.getElementById('aiEntitiesList');
    entList.innerHTML = result.detectedEntities.map(e => `<li>${escapeHtml(e)}</li>`).join('');

    // Sauvegarder dans dataset pour transfert rapide
    document.getElementById('aiResultsContainer').dataset.suggested = JSON.stringify({
      subject: result.suggestedSubject,
      amount: result.estimatedBudget,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      email: result.extractedEmail,
      phone: result.extractedPhone,
      leadScore: result.score
    });

    document.getElementById('aiResultsContainer').style.display = 'block';
    showToast('✨ Demande analysée avec succès par l\'IA.', 'success');
  }

  function applyAiSlotToForm() {
    const raw = document.getElementById('aiResultsContainer').dataset.suggested;
    if (!raw) return;
    const data = JSON.parse(raw);

    openAddModal();
    document.getElementById('rdvSubject').value = data.subject || '';
    document.getElementById('rdvAmount').value = data.amount || 5000;
    document.getElementById('rdvDate').value = data.date || '';
    document.getElementById('rdvStartTime').value = data.startTime || '10:00';
    document.getElementById('rdvEndTime').value = data.endTime || '11:00';
    if (data.email) document.getElementById('rdvEmail').value = data.email;
    if (data.phone) document.getElementById('rdvPhone').value = data.phone;
  }

  // --- IMPORT CSV / JSON ---
  function handleFileUpload(e) {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  }

  function handleFile(file) {
    const reader = new FileReader();
    const isJson = file.name.endsWith('.json');

    reader.onload = async (e) => {
      try {
        let items = [];
        if (isJson) {
          items = JSON.parse(e.target.result);
        } else {
          // Parse CSV basique mais robuste
          const lines = e.target.result.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length > 1) {
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
              items.push({
                clientName: cols[0] || 'Client Importé',
                email: cols[1] || '',
                phone: cols[2] || '',
                channel: cols[3] || 'file',
                subject: cols[4] || 'Rendez-vous importé',
                date: cols[5] || new Date().toISOString().split('T')[0],
                startTime: cols[6] || '10:00',
                endTime: cols[7] || '11:00',
                amount: parseFloat(cols[8]) || 3500,
                status: cols[9] || 'new',
                address: cols[10] || 'Adresse à préciser'
              });
            }
          }
        }

        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            await window.rdvDB.addAppointment(item);
          }
          showToast(`✅ ${items.length} rendez-vous importés avec succès !`, 'success');
          await refreshData();
          state.currentView = 'kanban';
          renderAll();
        } else {
          showToast('⚠️ Fichier vide ou format non reconnu.', 'error');
        }
      } catch (err) {
        console.error('Erreur import:', err);
        showToast('Erreur lors du traitement du fichier.', 'error');
      }
    };

    reader.readAsText(file);
  }

  // --- EXPORT CSV ---
  function exportToCsv() {
    if (state.appointments.length === 0) {
      showToast('Aucun rendez-vous à exporter.', 'error');
      return;
    }

    const headers = ['Nom Client', 'Email', 'Téléphone', 'Canal', 'Objet', 'Adresse', 'Lien Waze', 'Date', 'Heure Début', 'Heure Fin', 'Montant (€)', 'Statut', 'Score IA'];
    const rows = state.appointments.map(r => [
      `"${(r.clientName || '').replace(/"/g, '""')}"`,
      `"${(r.email || '').replace(/"/g, '""')}"`,
      `"${(r.phone || '').replace(/"/g, '""')}"`,
      `"${(r.channel || '').replace(/"/g, '""')}"`,
      `"${(r.subject || '').replace(/"/g, '""')}"`,
      `"${(r.address || '').replace(/"/g, '""')}"`,
      `"${buildWazeUrl(r.address)}"`,
      r.date,
      r.startTime,
      r.endTime,
      r.amount || 0,
      r.status,
      r.leadScore || 50
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `rdv_hub_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Export CSV généré avec succès.', 'success');
  }

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // --- GESTION DU THEME ---
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('rdv_theme', next);
    
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = next === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre';
    renderAnalytics();
  }

  function updateThemeFromStorage() {
    const saved = localStorage.getItem('rdv_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = saved === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre';
  }

})();
