"""
Load demand CSVs into PostgreSQL (called after step1_demand.py generates CSVs).

Inputs:
  data/output/demand_snapshot_line.csv   — 12 cols (post senior-review fix)
  data/output/demand_forecast_detail.csv — DRP full 24 cols

Behavior:
  1. Create a new DRAFT demand_snapshot row (UUID).
  2. COPY snapshot_line rows (adding snapshot_id) via temp table + INSERT SELECT.
  3. COPY forecast_detail rows (adding snapshot_id) via same pattern.
  4. Update snapshot counts + horizon.

Usage:
  export DATABASE_URL='postgresql://user:pass@localhost:5432/unis'
  python load_demand_to_db.py \
    [--run-id W9_20260413] \
    [--snapshot-name "Reload 2026-04-13"] \
    [--cleanup-drafts]   # Delete existing DRAFT snapshots first (FROZEN preserved)

Requires: psycopg2-binary (pip install psycopg2-binary).
"""
import argparse
import csv
import io
import os
import sys
import uuid
from datetime import datetime

try:
    import psycopg2
except ImportError:
    print('ERROR: psycopg2 not installed. Run: pip install psycopg2-binary', file=sys.stderr)
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
# Must match step1_demand.py OUTPUT_DIR (data/output/module1).
OUTPUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'output', 'module1'))


def read_csv_header(path):
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        return next(reader)


def copy_csv_with_snapshot_id(conn, csv_path, target_table, snapshot_id, extra_defaults=None):
    """
    COPY a CSV into target_table, injecting snapshot_id.
    Strategy: stream CSV → add snapshot_id column → COPY from stdin.
    extra_defaults: dict of column → literal value to inject per row (e.g. {'run_id': 'W9'}).
    """
    header = read_csv_header(csv_path)
    # Columns in target order: header + injected columns
    injected = ['snapshot_id']
    if extra_defaults:
        injected += list(extra_defaults.keys())
    target_cols = injected + header

    # Build in-memory pipe
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    with open(csv_path, 'r', encoding='utf-8', newline='') as src:
        reader = csv.reader(src)
        next(reader)  # skip header
        for row in reader:
            prefix = [str(snapshot_id)]
            if extra_defaults:
                prefix += [str(v) if v is not None else '' for v in extra_defaults.values()]
            writer.writerow(prefix + row)
    buf.seek(0)

    cur = conn.cursor()
    col_list = ','.join(f'"{c}"' for c in target_cols)
    cur.copy_expert(
        f'COPY {target_table} ({col_list}) FROM STDIN WITH (FORMAT csv, NULL \'\')',
        buf,
    )
    count = cur.rowcount
    cur.close()
    return count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run-id', default=f'W_{datetime.now():%Y%m%d_%H%M}')
    ap.add_argument('--snapshot-name', default=None)
    ap.add_argument('--created-by', default='pipeline')
    ap.add_argument('--dsn', default=os.getenv('DATABASE_URL'))
    ap.add_argument('--cleanup-drafts', action='store_true',
                    help='Delete all DRAFT snapshots (and their lines/details/overrides) '
                         'before loading. FROZEN/ARCHIVED snapshots are preserved.')
    args = ap.parse_args()

    if not args.dsn:
        print('ERROR: provide --dsn or set DATABASE_URL env var', file=sys.stderr)
        sys.exit(2)

    snap_csv = os.path.join(OUTPUT_DIR, 'demand_snapshot_line.csv')
    det_csv = os.path.join(OUTPUT_DIR, 'demand_forecast_detail.csv')
    if not os.path.exists(snap_csv):
        print(f'ERROR: {snap_csv} not found — run step1_demand.py first', file=sys.stderr)
        sys.exit(3)

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    try:
        # --cleanup-drafts: remove all DRAFT snapshots (FROZEN/ARCHIVED preserved).
        # Old DRAFTs have only 7 snapshot_line columns — would contaminate aggregates
        # once new 12-column load is active.
        if args.cleanup_drafts:
            cur = conn.cursor()
            cur.execute("""
                SELECT snapshot_id FROM demand_snapshot WHERE status = 'DRAFT'
            """)
            drafts = [r[0] for r in cur.fetchall()]
            if drafts:
                print(f'[cleanup] Removing {len(drafts)} DRAFT snapshot(s): {drafts}')
                # Order matters (FK constraints)
                cur.execute("""
                    DELETE FROM demand_override_log
                     WHERE snapshot_id IN (
                       SELECT snapshot_id FROM demand_snapshot WHERE status = 'DRAFT'
                     )
                """)
                cur.execute("""
                    DELETE FROM demand_snapshot_line
                     WHERE snapshot_id IN (
                       SELECT snapshot_id FROM demand_snapshot WHERE status = 'DRAFT'
                     )
                """)
                cur.execute("""
                    DELETE FROM demand_forecast_detail
                     WHERE snapshot_id IN (
                       SELECT snapshot_id FROM demand_snapshot WHERE status = 'DRAFT'
                     )
                """)
                cur.execute("DELETE FROM demand_snapshot WHERE status = 'DRAFT'")
                print(f'[cleanup] Deleted {cur.rowcount} DRAFT snapshot row(s). '
                      'FROZEN/ARCHIVED preserved.')
            else:
                print('[cleanup] No DRAFT snapshots to delete.')
            cur.close()

        snapshot_id = str(uuid.uuid4())
        name = args.snapshot_name or f'Pipeline reload {datetime.now():%Y-%m-%d %H:%M}'

        cur = conn.cursor()
        cur.execute("""
            INSERT INTO demand_snapshot
              (snapshot_id, run_id, status, demand_basis, snapshot_name,
               source_type, forecast_file_name, created_by)
            VALUES (%s, %s, 'DRAFT', 'MAX_FORECAST_PO', %s, 'PIPELINE', %s, %s)
        """, (snapshot_id, args.run_id, name, os.path.basename(snap_csv), args.created_by))
        cur.close()
        print(f'[1/3] Created snapshot {snapshot_id} ({name})')

        n_lines = copy_csv_with_snapshot_id(
            conn, snap_csv, 'demand_snapshot_line', snapshot_id,
        )
        print(f'[2/3] Loaded {n_lines} rows -> demand_snapshot_line')

        if os.path.exists(det_csv):
            n_det = copy_csv_with_snapshot_id(
                conn, det_csv, 'demand_forecast_detail', snapshot_id,
            )
            print(f'[3/3] Loaded {n_det} rows -> demand_forecast_detail')
        else:
            print(f'[3/3] SKIPPED — {det_csv} not found (detail insights will be empty)')

        # Update snapshot aggregates + horizon
        cur = conn.cursor()
        cur.execute("""
            UPDATE demand_snapshot s
            SET total_lines = agg.n_lines,
                total_items = agg.n_items,
                total_locations = agg.n_locs,
                horizon_start = agg.h_start,
                horizon_end = agg.h_end
            FROM (
              SELECT COUNT(*) AS n_lines,
                     COUNT(DISTINCT item_code) AS n_items,
                     COUNT(DISTINCT location_code) AS n_locs,
                     MIN(period_start) AS h_start,
                     MAX(period_start) AS h_end
              FROM demand_snapshot_line WHERE snapshot_id = %s
            ) AS agg
            WHERE s.snapshot_id = %s
        """, (snapshot_id, snapshot_id))
        cur.close()

        conn.commit()
        print(f'[OK] DONE -- snapshot_id={snapshot_id}')
    except Exception as e:
        conn.rollback()
        print(f'[FAIL] FAILED: {e}', file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
