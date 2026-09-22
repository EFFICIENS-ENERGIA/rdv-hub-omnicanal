// 🤖 RDV-HUB SAAS — MOTEUR D'ASSISTANT IA & QUALIFICATION (FIN AI STYLE)

class RDVAIAssistant {
  constructor() {
    this.urgencyKeywords = [
      'urgent', 'urgence', 'immédiat', 'rapidement', 'au plus vite', 'cette semaine', 
      'dès que possible', 'asap', 'signer', 'bloquer'
    ];
    
    this.highValueKeywords = [
      'construction', 'villa', 'rénovation', 'immeuble', 'hangar', 'siège', 'bâtiment',
      'marché public', 'promoteur', 'architecte', 'clé en main', 'ingénierie', 'maîtrise d\'œuvre'
    ];
  }

  /**
   * Analyse le texte brut d'une demande client (provenant d'un mail, formulaire, message)
   * et en extrait les entités qualifiées, l'estimation financière et le score d'opportunité.
   */
  analyzeInquiry(text) {
    if (!text || typeof text !== 'string') {
      return {
        score: 50,
        urgency: 'normale',
        estimatedBudget: 5000,
        suggestedSubject: 'Prise de contact générale',
        suggestedChannel: 'web',
        entities: []
      };
    }

    const lower = text.toLowerCase();
    let score = 40;
    const detectedEntities = [];

    // Détection Urgence
    let urgency = 'normale';
    const foundUrgency = this.urgencyKeywords.some(kw => lower.includes(kw));
    if (foundUrgency) {
      urgency = 'haute';
      score += 25;
      detectedEntities.push('⚡ Signal d\'urgence élevé');
    }

    // Détection Projet à Forte Valeur
    let budgetEstimate = 8000;
    const foundHighVal = this.highValueKeywords.filter(kw => lower.includes(kw));
    if (foundHighVal.length > 0) {
      score += Math.min(30, foundHighVal.length * 15);
      budgetEstimate = 25000 + (foundHighVal.length * 20000);
      detectedEntities.push(`🏢 Mots-clés BTP identifiés: ${foundHighVal.slice(0, 3).join(', ')}`);
    }

    // Détection Montants explicites dans le texte
    const budgetMatch = text.match(/([0-9\s.,]{3,})\s*(?:€|euros|k€|keuros)/i);
    if (budgetMatch) {
      let rawVal = budgetMatch[1].replace(/\s/g, '').replace(',', '.');
      let val = parseFloat(rawVal);
      if (lower.includes('k€') || lower.includes('keuros')) val *= 1000;
      if (!isNaN(val) && val > 0) {
        budgetEstimate = val;
        score += 20;
        detectedEntities.push(`💶 Budget explicite détecté : ${val.toLocaleString('fr-FR')} €`);
      }
    }

    // Détection Coordonnées (Email, Téléphone)
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/);
    
    if (emailMatch) {
      score += 10;
      detectedEntities.push(`📧 Email: ${emailMatch[0]}`);
    }
    if (phoneMatch) {
      score += 10;
      detectedEntities.push(`📞 Tél: ${phoneMatch[0]}`);
    }

    // Bornage du score de 10 à 99
    score = Math.max(10, Math.min(99, score));

    // Déduction du sujet
    let subject = 'Qualification de projet BTP';
    if (lower.includes('rénovation')) subject = 'Projet de Rénovation Énergétique';
    else if (lower.includes('villa') || lower.includes('maison')) subject = 'Construction Villa Individuelle';
    else if (lower.includes('extension')) subject = 'Projet d\'Extension & Surélévation';
    else if (lower.includes('audit')) subject = 'Mission d\'Audit & Conseil Technique';

    return {
      score,
      urgency,
      estimatedBudget: budgetEstimate,
      suggestedSubject: subject,
      detectedEntities,
      extractedEmail: emailMatch ? emailMatch[0] : '',
      extractedPhone: phoneMatch ? phoneMatch[0] : ''
    };
  }

  /**
   * Trouve le prochain créneau disponible sans aucun conflit avec les rendez-vous existants.
   */
  findOptimalSlot(existingAppointments, preferredDate = null) {
    const pad = (n) => String(n).padStart(2, '0');
    let target = preferredDate ? new Date(preferredDate) : new Date();
    
    // Si c'est le week-end, passer au lundi
    if (target.getDay() === 0) target.setDate(target.getDate() + 1);
    if (target.getDay() === 6) target.setDate(target.getDate() + 2);

    const businessSlots = [
      { start: '09:00', end: '10:00' },
      { start: '10:30', end: '11:30' },
      { start: '14:00', end: '15:00' },
      { start: '15:30', end: '16:30' },
      { start: '17:00', end: '18:00' }
    ];

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const checkDate = new Date(target);
      checkDate.setDate(checkDate.getDate() + dayOffset);
      
      // Ignorer samedi et dimanche
      if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;

      const dateStr = `${checkDate.getFullYear()}-${pad(checkDate.getMonth() + 1)}-${pad(checkDate.getDate())}`;
      
      // RDV du jour
      const daysRDV = existingAppointments.filter(r => r.date === dateStr && r.status !== 'cancelled');

      for (const slot of businessSlots) {
        // Vérifier conflit d'intersection
        const hasConflict = daysRDV.some(r => {
          return (slot.start < r.endTime && slot.end > r.startTime);
        });

        if (!hasConflict) {
          return {
            date: dateStr,
            startTime: slot.start,
            endTime: slot.end,
            formattedDate: checkDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
          };
        }
      }
    }

    // Repli par défaut
    const defaultDate = new Date(target);
    defaultDate.setDate(defaultDate.getDate() + 1);
    const dateStr = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(defaultDate.getDate())}`;
    return {
      date: dateStr,
      startTime: '09:30',
      endTime: '10:30',
      formattedDate: defaultDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    };
  }
}

window.rdvAI = new RDVAIAssistant();
