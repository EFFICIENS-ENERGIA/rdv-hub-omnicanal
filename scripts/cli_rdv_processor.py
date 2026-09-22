#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RDV-HUB SAAS — PROCESSEUR CLI D'AUTOMATISATION & ANALYSE DE RENDEZ-VOUS (PYTHON)
Module autonome pour l'ingestion, la validation déterministe, le calcul financier et la détection de conflits.
Compatible Windows CP1252 & Python 3.5+ (Standard Library pure).
"""

import sys
import os
import json
import csv
from datetime import datetime

VALID_CHANNELS = {'web', 'whatsapp', 'email', 'phone', 'ads', 'referral', 'file'}
VALID_STATUSES = {'new', 'confirmed', 'pending', 'done', 'cancelled'}

def load_data(file_path):
    """Charge un fichier JSON ou CSV et renvoie une liste de dictionnaires normalisés."""
    if not os.path.exists(file_path):
        raise FileNotFoundError("Fichier introuvable: {0}".format(file_path))

    ext = os.path.splitext(file_path)[1].lower()
    records = []

    if ext == '.json':
        with open(file_path, 'r', encoding='utf-8') as f:
            records = json.load(f)
    elif ext == '.csv':
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Normalisation des clés usuelles
                name = row.get('Nom Client') or row.get('clientName') or row.get('name') or 'Client Inconnu'
                email = row.get('Email') or row.get('email') or ''
                phone = row.get('Téléphone') or row.get('phone') or ''
                channel = (row.get('Canal') or row.get('channel') or 'file').lower()
                subject = row.get('Objet') or row.get('subject') or 'Rendez-vous'
                date = row.get('Date') or row.get('date') or datetime.now().strftime('%Y-%m-%d')
                start = row.get('Heure Début') or row.get('startTime') or '10:00'
                end = row.get('Heure Fin') or row.get('endTime') or '11:00'
                amount = float(row.get('Montant') or row.get('amount') or 0.0)
                status = (row.get('Statut') or row.get('status') or 'new').lower()
                address = row.get('Adresse') or row.get('address') or row.get('Lieu') or 'Adresse à préciser'

                records.append({
                    'clientName': name,
                    'email': email,
                    'phone': phone,
                    'channel': channel if channel in VALID_CHANNELS else 'file',
                    'subject': subject,
                    'address': address,
                    'date': date,
                    'startTime': start,
                    'endTime': end,
                    'amount': amount,
                    'status': status if status in VALID_STATUSES else 'new'
                })
    else:
        raise ValueError("Format de fichier non pris en charge: {0}. Utilisez .json ou .csv".format(ext))

    return records

def detect_conflicts(records):
    """Détecte tout chevauchement d'horaires entre rendez-vous sur une même date."""
    conflicts = []
    by_date = {}

    for i, r in enumerate(records):
        d = r.get('date')
        if not d: continue
        by_date.setdefault(d, []).append((i, r))

    for d, day_records in by_date.items():
        n = len(day_records)
        for i in range(n):
            idx_a, a = day_records[i]
            if a.get('status') == 'cancelled': continue
            start_a = a.get('startTime', '')
            end_a = a.get('endTime', '')

            for j in range(i + 1, n):
                idx_b, b = day_records[j]
                if b.get('status') == 'cancelled': continue
                start_b = b.get('startTime', '')
                end_b = b.get('endTime', '')

                # Chevauchement si start_a < end_b et end_a > start_b
                if start_a < end_b and end_a > start_b:
                    conflicts.append({
                        'date': d,
                        'rdv_A': {'index': idx_a, 'client': a.get('clientName'), 'time': "{0}-{1}".format(start_a, end_a)},
                        'rdv_B': {'index': idx_b, 'client': b.get('clientName'), 'time': "{0}-{1}".format(start_b, end_b)}
                    })

    return conflicts

def compute_financial_stats(records):
    """Calcule l'ensemble des métriques opérationnelles et financières (zéro-défaut)."""
    total = len(records)
    ca_previsionnel = 0.0
    ca_realise = 0.0
    count_honore = 0
    count_annule = 0
    by_channel = {c: {'count': 0, 'ca': 0.0} for c in VALID_CHANNELS}

    for r in records:
        amt = float(r.get('amount') or 0.0)
        st = r.get('status', 'new').lower()
        ch = r.get('channel', 'file').lower()
        if ch not in by_channel: ch = 'file'

        by_channel[ch]['count'] += 1
        by_channel[ch]['ca'] += amt

        if st != 'cancelled':
            ca_previsionnel += amt

        if st == 'done':
            ca_realise += amt
            count_honore += 1
        elif st == 'cancelled':
            count_annule += 1

    total_termines = count_honore + count_annule
    show_up_rate = round((count_honore / total_termines * 100), 2) if total_termines > 0 else 100.0
    conversion_rate = round((count_honore / total * 100), 2) if total > 0 else 0.0
    active_count = max(1, total - count_annule)
    panier_moyen = round(ca_previsionnel / active_count, 2) if total > 0 else 0.0

    return {
        'total_rendez_vous': total,
        'ca_previsionnel': round(ca_previsionnel, 2),
        'ca_realise': round(ca_realise, 2),
        'show_up_rate_percent': show_up_rate,
        'conversion_rate_percent': conversion_rate,
        'panier_moyen': panier_moyen,
        'repartition_canaux': by_channel
    }

def print_cli_summary(stats, conflicts):
    print("=" * 65)
    print(" [RDV-HUB SAAS] RAPPORT D'ANALYSE DETERMINISTE (CLI)")
    print("=" * 65)
    print("  Total Rendez-vous analyses : {0}".format(stats['total_rendez_vous']))
    print("  CA Previsionnel Cumule     : {0:,.2f} EUR".format(stats['ca_previsionnel']))
    print("  CA Realise / Honore        : {0:,.2f} EUR".format(stats['ca_realise']))
    print("  Taux de Presence (Show-up) : {0}%".format(stats['show_up_rate_percent']))
    print("  Taux de Conversion Global  : {0}%".format(stats['conversion_rate_percent']))
    print("  Panier Moyen par RDV Actif : {0:,.2f} EUR".format(stats['panier_moyen']))
    print("-" * 65)
    print(" [CANAUX] Repartition par Canal de Provenance :")
    for ch, data in sorted(stats['repartition_canaux'].items()):
        if data['count'] > 0:
            print("  - [{0:8}] : {1:2} RDV | CA: {2:10,.2f} EUR".format(ch.upper(), data['count'], data['ca']))
    print("-" * 65)
    print(" [CONFLITS] Conflits d'Agenda Detectes : {0}".format(len(conflicts)))
    for c in conflicts:
        print("  ! Date: {0} => {1} ({2}) EN CONFLIT AVEC {3} ({4})".format(
            c['date'], c['rdv_A']['client'], c['rdv_A']['time'], c['rdv_B']['client'], c['rdv_B']['time']))
    print("=" * 65)

def main():
    if len(sys.argv) < 2:
        print("Usage: python cli_rdv_processor.py <chemin_fichier_csv_ou_json> [--export-json <out.json>]")
        sys.exit(1)

    file_path = sys.argv[1]
    records = load_data(file_path)
    stats = compute_financial_stats(records)
    conflicts = detect_conflicts(records)

    print_cli_summary(stats, conflicts)

    # Option export JSON
    if '--export-json' in sys.argv:
        idx = sys.argv.index('--export-json')
        if idx + 1 < len(sys.argv):
            out_file = sys.argv[idx + 1]
            out_data = {'stats': stats, 'conflicts': conflicts, 'record_count': len(records)}
            with open(out_file, 'w', encoding='utf-8') as f:
                json.dump(out_data, f, indent=2, ensure_ascii=False)
            print("[OK] Rapport exporte vers : {0}".format(out_file))

if __name__ == '__main__':
    main()
