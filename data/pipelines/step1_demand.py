#!/usr/bin/env python3
"""
Module 1 — Demand Data Pipeline (step1_demand.py)
Reads forecast CSVs, cleans, transforms, outputs clean data for DB import.

Usage:
    python unis/data/pipelines/step1_demand.py
    python unis/data/pipelines/step1_demand.py --dry-run
    python unis/data/pipelines/step1_demand.py --verbose
"""

import csv
import json
import os
import sys
import argparse
from collections import defaultdict
from datetime import datetime

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DATA_DIR = os.path.join(BASE_DIR, 'unis', 'data')
FORECAST_DIR = os.path.join(DATA_DIR, 'demand-forecast')
OUTPUT_DIR = os.path.join(DATA_DIR, 'output', 'module1')

# Forecast_30032026.csv deleted — full_accuracy file is now loaded separately
# via ACCURACY-DASHBOARD (migration 003 + load_accuracy_to_db.py)
# AGG_CSV no longer used by step1 pipeline — branch-level DRP is the primary data source
AGG_CSV = None  # Disabled — aggregate overview handled by Accuracy Dashboard
DRP_CSV = os.path.join(FORECAST_DIR, 'drp_export_dec25_q1_2026.csv')
ITEM_MASTER = os.path.join(DATA_DIR, '[Masterdata] Item - Sheet1.csv')
BRANCH_MASTER = os.path.join(DATA_DIR, '[Masterdata] Branch - Sheet1.csv')

# Known unmatched DRP branch_ids (no master data)
KNOWN_UNMATCHED_BRANCHES = {'52', '53', '55', '56', '57', '58', '78', '85', '95', '96'}


def log(msg):
    try:
        print(f"[step1_demand] {msg}")
    except UnicodeEncodeError:
        print(f"[step1_demand] {msg.encode('ascii', 'replace').decode('ascii')}")


# ---------------------------------------------------------------------------
# Step 1: Load + Validate
# ---------------------------------------------------------------------------
def load_csv(path, skip_first_row=False, encoding='utf-8-sig'):
    """Stream-read a CSV. Returns (headers, rows_iterator_as_list_of_dicts)."""
    f = open(path, 'r', encoding=encoding, newline='')
    reader = csv.reader(f)
    if skip_first_row:
        next(reader)  # skip Vietnamese header row
    headers = next(reader)
    headers = [h.strip() for h in headers]
    return headers, reader, f


def load_all_rows(path, skip_first_row=False, encoding='utf-8-sig'):
    """Load entire CSV into list of dicts."""
    headers, reader, f = load_csv(path, skip_first_row=skip_first_row, encoding=encoding)
    rows = []
    for r in reader:
        if len(r) == len(headers):
            rows.append(dict(zip(headers, r)))
        elif len(r) > len(headers):
            rows.append(dict(zip(headers, r[:len(headers)])))
        # skip short rows
    f.close()
    return headers, rows


def validate_columns(headers, required, label):
    missing = [c for c in required if c not in headers]
    if missing:
        log(f"CRITICAL: {label} missing columns: {missing}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Step 3: Build mapping dicts
# ---------------------------------------------------------------------------
def build_item_map():
    """item_code from master. fsku in forecast == item_code directly."""
    _, rows = load_all_rows(ITEM_MASTER, skip_first_row=True)
    item_codes = set()
    for r in rows:
        code = r.get('item_code', '').strip()
        if code:
            item_codes.add(code)
    log(f"  Item master: {len(item_codes)} unique item_codes")
    return item_codes


def build_branch_map():
    """branch_code (zero-padded 3-digit) from master."""
    _, rows = load_all_rows(BRANCH_MASTER, skip_first_row=True)
    branch_codes = set()
    for r in rows:
        code = r.get('branch_code', '').strip()
        if code:
            branch_codes.add(code)
    log(f"  Branch master: {len(branch_codes)} unique branch_codes")
    return branch_codes


def drp_branch_to_code(branch_id_str):
    """Zero-pad DRP branch_id to 3 digits to match master branch_code."""
    return branch_id_str.strip().zfill(3)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def run(dry_run=False, verbose=False):
    stats = {
        'agg_input': 0, 'agg_filtered': 0, 'agg_output': 0,
        'drp_input': 0, 'drp_filtered': 0, 'drp_mapped': 0, 'drp_errors': 0,
        'snapshot_lines': 0, 'summary_lines': 0,
    }
    errors = []  # (row_index, reason, row_snippet)

    # ------------------------------------------------------------------
    # Step 1: Load
    # ------------------------------------------------------------------
    log("Step 1: Loading data files...")

    # Aggregate overview: now handled separately by Accuracy Dashboard
    # (full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv → migration 003 + load_accuracy_to_db.py)
    agg_headers, agg_rows, period_cols = [], [], []
    FORECAST_COL_TO_PERIOD = {}
    if AGG_CSV and os.path.exists(AGG_CSV):
        agg_headers, agg_rows = load_all_rows(AGG_CSV, skip_first_row=False)
        validate_columns(agg_headers, ['fsku'], 'Aggregate CSV')
        period_cols = [c for c in agg_headers if c != 'fsku']
        log(f"  Aggregate: {len(agg_rows)} rows, periods={period_cols}")
        stats['agg_input'] = len(agg_rows)
    else:
        log("  Aggregate: SKIPPED (file not configured or not found)")
        stats['agg_input'] = 0

    # DRP
    drp_headers, drp_rows = load_all_rows(DRP_CSV, skip_first_row=False)
    validate_columns(drp_headers, ['branch_id', 'fsku_id', 'forecast_date',
                                    'model_config_id', 'combo_class', 'forecast_qty',
                                    'segment'], 'DRP CSV')
    log(f"  DRP: {len(drp_rows)} rows, {len(drp_headers)} columns")
    stats['drp_input'] = len(drp_rows)

    if verbose:
        log(f"  Aggregate headers: {agg_headers}")
        log(f"  DRP headers: {drp_headers}")
        log(f"  Sample agg row: {agg_rows[0]}")
        log(f"  Sample DRP row: {drp_rows[0]}")

    # ------------------------------------------------------------------
    # Step 2: Filter
    # ------------------------------------------------------------------
    log("Step 2: Filtering...")

    # DRP: remove model_config_id = 'EXCLUDE'
    drp_before = len(drp_rows)
    drp_rows = [r for r in drp_rows if r['model_config_id'].strip() != 'EXCLUDE']
    excluded_count = drp_before - len(drp_rows)
    log(f"  DRP: removed {excluded_count} EXCLUDE rows")

    # DRP: remove DORMANT_DISCONTINUED with forecast_qty = 0
    drp_before2 = len(drp_rows)
    drp_rows = [r for r in drp_rows
                if not (r['combo_class'].strip() == 'DORMANT_DISCONTINUED'
                        and float(r['forecast_qty'].strip() or '0') == 0.0)]
    dormant_removed = drp_before2 - len(drp_rows)
    log(f"  DRP: removed {dormant_removed} DORMANT_DISCONTINUED (qty=0) rows")
    stats['drp_filtered'] = excluded_count + dormant_removed
    log(f"  DRP: {len(drp_rows)} rows remaining")

    # Aggregate: remove fsku where ALL period values = 0
    agg_before = len(agg_rows)
    agg_active = []
    for r in agg_rows:
        vals = [float(r[p].strip() or '0') for p in period_cols]
        if any(v != 0.0 for v in vals):
            agg_active.append(r)
    agg_dormant = agg_before - len(agg_active)
    agg_rows = agg_active
    stats['agg_filtered'] = agg_dormant
    log(f"  Aggregate: removed {agg_dormant} dormant FSKUs, {len(agg_rows)} remaining")

    # ------------------------------------------------------------------
    # Step 3: Map IDs
    # ------------------------------------------------------------------
    log("Step 3: Building ID maps...")
    item_codes = build_item_map()
    branch_codes = build_branch_map()

    # ------------------------------------------------------------------
    # Step 4: Transform
    # ------------------------------------------------------------------
    log("Step 4: Transforming...")

    # --- Aggregate wide → long (demand_summary) ---
    summary_rows = []
    agg_unmapped = 0
    if agg_rows and period_cols:
        for r in agg_rows:
            fsku = r.get('fsku', '').strip()
            item_code = fsku
            if item_code not in item_codes:
                agg_unmapped += 1
                errors.append(('AGG', f'item_code not in master: {item_code}', fsku))
            for p in period_cols:
                qty = float(r.get(p, '0').strip() or '0')
                period_start = p.strip() + '-01'
                summary_rows.append({
                    'item_code': item_code,
                    'period_start': period_start,
                    'qty': qty,
                })
        log(f"  Aggregate -> {len(summary_rows)} summary rows ({agg_unmapped} unmapped items)")
    else:
        log("  Aggregate: SKIPPED (no data)")
    stats['agg_output'] = len(summary_rows)
    stats['summary_lines'] = len(summary_rows)

    # --- DRP → demand_forecast_detail + demand_snapshot_line ---
    detail_rows = []
    snapshot_rows = []
    drp_mapped = 0
    drp_error = 0
    unmatched_branches_seen = set()

    for idx, r in enumerate(drp_rows):
        branch_id_raw = r['branch_id'].strip()
        branch_code = drp_branch_to_code(branch_id_raw)
        fsku = r['fsku_id'].strip()
        item_code = fsku  # direct match

        # Branch validation
        if branch_code not in branch_codes:
            if branch_id_raw not in KNOWN_UNMATCHED_BRANCHES:
                unmatched_branches_seen.add(branch_id_raw)
            errors.append(('DRP', f'branch unmapped: {branch_id_raw} (padded={branch_code})',
                           f'{fsku}|{branch_id_raw}'))
            drp_error += 1
            continue

        # Item validation (B2 fix — skip, not keep, to satisfy FK in loader).
        # Previous behavior kept unmapped item_codes → load_demand_to_db.py crashed
        # on FK violation against item master.
        if item_code not in item_codes:
            errors.append(('DRP', f'item_code not in master (skipped): {item_code}',
                           f'{fsku}|{branch_code}'))
            drp_error += 1
            continue

        drp_mapped += 1

        # forecast_date is like "2025-12", "2026-01"
        fd = r['forecast_date'].strip()
        period_start = fd + '-01' if len(fd) == 7 else fd

        qty = float(r['forecast_qty'].strip() or '0')
        segment = r['segment'].strip()

        # detail row: all 22 columns + mapped codes
        detail = dict(r)
        detail['item_code'] = item_code
        detail['location_code'] = branch_code
        detail_rows.append(detail)

        # snapshot line — 12 cols (7 base + 5 denormalized from G1/002b migration).
        # Senior review fix: populate combo_class / branch_archetype / tet_flag /
        # confidence bounds so BE insights endpoints work without detail-table JOINs.
        def _f(key):
            v = r.get(key, '').strip() if r.get(key) else ''
            try:
                return float(v) if v else None
            except (ValueError, TypeError):
                return None

        snapshot_rows.append({
            'item_code': item_code,
            'location_code': branch_code,
            'period_start': period_start,
            'qty': qty,
            'demand_type': 'FORECAST',
            'segment': segment,
            'priority': 1,
            'combo_class':      (r.get('combo_class', '') or '').strip() or None,
            'branch_archetype': (r.get('branch_archetype', '') or '').strip() or None,
            'tet_flag':         (r.get('tet_flag', '') or '').strip() or None,
            'confidence_lower': _f('confidence_lower'),
            'confidence_upper': _f('confidence_upper'),
        })

    stats['drp_mapped'] = drp_mapped
    stats['drp_errors'] = drp_error
    stats['snapshot_lines'] = len(snapshot_rows)
    log(f"  DRP → {drp_mapped} mapped, {drp_error} errors (branch unmapped)")

    if unmatched_branches_seen - KNOWN_UNMATCHED_BRANCHES:
        log(f"  WARNING: unexpected unmatched branches: {unmatched_branches_seen - KNOWN_UNMATCHED_BRANCHES}")
    if unmatched_branches_seen & KNOWN_UNMATCHED_BRANCHES:
        log(f"  Known unmatched branches skipped: {sorted(unmatched_branches_seen & KNOWN_UNMATCHED_BRANCHES)}")

    if verbose:
        if snapshot_rows:
            log(f"  Sample snapshot: {snapshot_rows[0]}")
        if detail_rows:
            log(f"  Sample detail keys: {list(detail_rows[0].keys())}")
        if summary_rows:
            log(f"  Sample summary: {summary_rows[0]}")

    # ------------------------------------------------------------------
    # Step 5: Output
    # ------------------------------------------------------------------
    if dry_run:
        log("Step 5: DRY RUN — no files written.")
    else:
        log("Step 5: Writing output files...")
        os.makedirs(OUTPUT_DIR, exist_ok=True)

        # 1. demand_snapshot_line.csv
        snap_path = os.path.join(OUTPUT_DIR, 'demand_snapshot_line.csv')
        snap_cols = ['item_code', 'location_code', 'period_start', 'qty',
                     'demand_type', 'segment', 'priority',
                     'combo_class', 'branch_archetype', 'tet_flag',
                     'confidence_lower', 'confidence_upper']
        with open(snap_path, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=snap_cols)
            w.writeheader()
            w.writerows(snapshot_rows)
        log(f"  Written: {snap_path} ({len(snapshot_rows)} rows)")

        # 2. demand_forecast_detail.csv
        detail_path = os.path.join(OUTPUT_DIR, 'demand_forecast_detail.csv')
        if detail_rows:
            detail_cols = drp_headers + ['item_code', 'location_code']
            with open(detail_path, 'w', encoding='utf-8', newline='') as f:
                w = csv.DictWriter(f, fieldnames=detail_cols, extrasaction='ignore')
                w.writeheader()
                w.writerows(detail_rows)
            log(f"  Written: {detail_path} ({len(detail_rows)} rows)")

        # 3. demand_summary.csv
        summ_path = os.path.join(OUTPUT_DIR, 'demand_summary.csv')
        summ_cols = ['item_code', 'period_start', 'qty']
        with open(summ_path, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=summ_cols)
            w.writeheader()
            w.writerows(summary_rows)
        log(f"  Written: {summ_path} ({len(summary_rows)} rows)")

        # 4. import_errors.csv
        err_path = os.path.join(OUTPUT_DIR, 'import_errors.csv')
        with open(err_path, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow(['source', 'reason', 'key'])
            for e in errors:
                w.writerow(e)
        log(f"  Written: {err_path} ({len(errors)} errors)")

        # 5. pipeline_report.json
        report = {
            'pipeline': 'step1_demand',
            'run_at': datetime.now().isoformat(),
            'stats': stats,
            'total_errors': len(errors),
        }
        report_path = os.path.join(OUTPUT_DIR, 'pipeline_report.json')
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        log(f"  Written: {report_path}")

    log("Done.")
    log(f"  Stats: {json.dumps(stats, indent=2)}")
    return 0


def main():
    parser = argparse.ArgumentParser(description='Module 1 Demand Data Pipeline')
    parser.add_argument('--dry-run', action='store_true', help='Analyze only, no output')
    parser.add_argument('--verbose', action='store_true', help='Print sample data')
    args = parser.parse_args()

    try:
        sys.exit(run(dry_run=args.dry_run, verbose=args.verbose))
    except Exception as e:
        log(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
