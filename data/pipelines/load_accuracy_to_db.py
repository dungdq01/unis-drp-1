"""
Load demand accuracy CSVs into PostgreSQL (demand_accuracy table).

Inputs (from data/demand-forecast/):
  summary_accuracy_FINAL_vs_MA3.csv          — 1,660 SKUs (primary, has final_fc_t2/t3)
  full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv  — 1,660 SKUs (WMA extras)

Behavior:
  1. Parse summary CSV into {fsku: row} dict.
  2. Parse full CSV, merge WMA columns per fsku.
  3. UPSERT into demand_accuracy (ON CONFLICT fsku DO UPDATE).

Usage:
  export DATABASE_URL='postgresql://user:pass@localhost:5432/unis'
  python load_accuracy_to_db.py [--truncate]

Requires: psycopg2-binary.
"""
import argparse
import csv
import os
import sys

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print('ERROR: psycopg2 not installed. Run: pip install psycopg2-binary', file=sys.stderr)
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(HERE, '..', 'demand-forecast'))
SUMMARY_CSV = os.path.join(DATA_DIR, 'summary_accuracy_FINAL_vs_MA3.csv')
FULL_CSV = os.path.join(DATA_DIR, 'full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv')


def _num(v):
    """Parse decimal-ish string; return None for blank or invalid."""
    if v is None:
        return None
    s = str(v).strip().replace('%', '').replace(',', '')
    if not s:
        return None
    try:
        f = float(s)
        # CSV accuracy values already in percent form (e.g. 54.2). Leave as-is.
        return f
    except (ValueError, TypeError):
        return None


def read_csv_dict(path):
    """Read CSV → dict keyed by fsku."""
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        for r in reader:
            fsku = (r.get('fsku') or '').strip()
            if fsku:
                out[fsku] = r
    return out


def merge_rows(summary, full):
    """
    Produce unified dicts ready for INSERT. summary is authoritative for FINAL +
    MA3 forecasts and accuracies; full adds WMA backtest columns.
    """
    merged = []
    all_fskus = set(summary.keys()) | set(full.keys())
    for fsku in sorted(all_fskus):
        s = summary.get(fsku, {})
        f = full.get(fsku, {})
        merged.append({
            'fsku': fsku,
            'actual_t10':    _num(s.get('actual_t10') or f.get('actual_t10')),
            'actual_t11':    _num(s.get('actual_t11') or f.get('actual_t11')),
            'actual_t12':    _num(s.get('actual_t12') or f.get('actual_t12')),
            'actual_t1':     _num(s.get('actual_t1')  or f.get('actual_t1')),
            'final_fc_t12':  _num(s.get('final_fc_t12') or f.get('final_t12')),
            'final_fc_t1':   _num(s.get('final_fc_t1')  or f.get('final_t1')),
            'final_fc_t2':   _num(s.get('final_fc_t2')  or f.get('final_t2')),
            'final_fc_t3':   _num(s.get('final_fc_t3')  or f.get('final_t3')),
            'ma3_fc_t12':    _num(s.get('ma3_fc_t12')   or f.get('ma3_t12')),
            'ma3_fc_t1':     _num(s.get('ma3_fc_t1')    or f.get('ma3_t1')),
            'acc_final_t12': _num(s.get('acc_final_t12') or f.get('acc_final_t12')),
            'acc_ma3_t12':   _num(s.get('acc_ma3_t12')   or f.get('acc_ma3_t12')),
            'acc_final_t1':  _num(s.get('acc_final_t1')  or f.get('acc_final_t1')),
            'acc_ma3_t1':    _num(s.get('acc_ma3_t1')    or f.get('acc_ma3_t1')),
            'wma_t10':       _num(f.get('wma_t10')),
            'wma_t11':       _num(f.get('wma_t11')),
            'acc_wma_t10':   _num(f.get('acc_wma_t10')),
            'acc_wma_t11':   _num(f.get('acc_wma_t11')),
            'is_modified':   False,
        })
    return merged


COLS = [
    'fsku',
    'actual_t10', 'actual_t11', 'actual_t12', 'actual_t1',
    'final_fc_t12', 'final_fc_t1', 'final_fc_t2', 'final_fc_t3',
    'ma3_fc_t12', 'ma3_fc_t1',
    'acc_final_t12', 'acc_ma3_t12', 'acc_final_t1', 'acc_ma3_t1',
    'wma_t10', 'wma_t11', 'acc_wma_t10', 'acc_wma_t11',
    'is_modified',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dsn', default=os.getenv('DATABASE_URL'))
    ap.add_argument('--truncate', action='store_true',
                    help='TRUNCATE demand_accuracy before load (dev only)')
    args = ap.parse_args()

    if not args.dsn:
        print('ERROR: provide --dsn or set DATABASE_URL', file=sys.stderr)
        sys.exit(2)

    print(f'[1/3] Reading {SUMMARY_CSV}')
    summary = read_csv_dict(SUMMARY_CSV)
    print(f'      ->{len(summary)} rows')

    print(f'[1/3] Reading {FULL_CSV}')
    full = read_csv_dict(FULL_CSV)
    print(f'      ->{len(full)} rows')

    rows = merge_rows(summary, full)
    print(f'[2/3] Merged ->{len(rows)} unique fskus')

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    try:
        cur = conn.cursor()
        if args.truncate:
            cur.execute('TRUNCATE demand_accuracy RESTART IDENTITY')
            print('      [truncate] demand_accuracy cleared')

        # UPSERT in batches of 500
        update_set = ', '.join(f'{c} = EXCLUDED.{c}' for c in COLS if c != 'fsku')
        sql = f"""
            INSERT INTO demand_accuracy ({', '.join(COLS)})
            VALUES %s
            ON CONFLICT (fsku) DO UPDATE SET {update_set}
        """
        values = [tuple(r[c] for c in COLS) for r in rows]
        execute_values(cur, sql, values, page_size=500)
        n = cur.rowcount
        cur.close()
        conn.commit()
        print(f'[3/3] Upserted {n} rows into demand_accuracy')
        print('[OK] DONE')
    except Exception as e:
        conn.rollback()
        print(f'[FAIL] {e}', file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
