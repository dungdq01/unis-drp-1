# M21 Data Sync & Freshness Gate — Module Report

> **Sprint:** 2 · **DA:** DA1 · **Status:** DONE
> **Zone:** EXTEND · **Depends on:** M00 (supplier), M10 (system_config)

---

## BA Logic

### Freshness Gate (blocking M23 DRP)
- `FreshnessGateService.check()` returns `{ canRun: boolean, staleNms: [...] }`
- Joins `supplier` (active) LEFT JOIN `supply_snapshot` (non-legacy) to compute per-NM freshness
- Threshold: `planning.max_stale_minutes` from system_config (default 1440 = 24h)
- `is_legacy_data=TRUE` rows skipped (grace period for existing data)
- **M23 blocks** if any NM is STALE/MISSING — SC Manager can force override

### NM Data Upload (CSV)
- `POST /supply/nm-upload/:nmCode` — parse CSV, validate headers + rows, persist snapshot + sync_log
- Template: `GET /supply/sync/template/:nmCode` — generates CSV with BOM for Excel UTF-8
- Headers: `sku_code, sku_name, uom, available_qty, atp_qty, last_updated`

### Cron Scheduler
- 06:00 VN + 14:00 VN daily — `runSyncAll()` pings all active NMs, tolerant (1 NM fail → continue)
- Recursive `setTimeout` pattern (no external cron lib)

### Override (force DRP with stale data)
- `POST /supply/sync/override` — reason >= 20 chars, writes `drp_override_log` with stale snapshot

---

## DB Schema

### Migration
| File | Action |
|------|--------|
| `V002_m21_supply_snapshot_extend.up.sql` | Extends `supply_snapshot` (+nm_code, synced_at, source, is_legacy_data), creates `sync_log`, `drp_override_log`, backfills legacy rows, 3 indexes |

### Key Tables
| Table | Purpose |
|-------|---------|
| `sync_log` | Per-NM sync history (FK supplier_code) |
| `drp_override_log` | Audit trail for forced DRP runs |
| `supply_snapshot` (extended) | nm_code + synced_at for gate queries |

---

## API Endpoints

**Base:** `/api/v1/supply`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/nm-upload/:nmCode` | Upload NM CSV data |
| GET | `/sync/template/:nmCode` | Download CSV template |
| GET | `/sync/dashboard` | All NMs freshness status |
| GET | `/freshness/gate` | Gate check (canRun?) |
| POST | `/sync/trigger/:nmCode` | Manual trigger 1 NM |
| POST | `/sync/trigger-all` | Trigger all NMs |
| GET | `/sync/history?nmCode=&page=` | Sync log paginated |
| POST | `/sync/override` | Force override (stale data) |

---

## FE

- Page: `app/supply/page.tsx` (existing M2 supply page — M21 extends backend only)
- API: `lib/api/supply.ts`

---

## Test

- `freshness-gate.service.spec.ts` — 7 test cases (canRun true/false, MISSING, threshold, checkedAt, checkAll status, hoursSinceSync null)

---

## Source Files
| Layer | Path |
|-------|------|
| FreshnessGateService | `backend/src/data-sync/freshness-gate.service.ts` |
| DataSyncService | `backend/src/data-sync/data-sync.service.ts` |
| Controller | `backend/src/data-sync/data-sync.controller.ts` |
| Module | `backend/src/data-sync/data-sync.module.ts` |
| Exports | `FreshnessGateService`, `DataSyncService` |
