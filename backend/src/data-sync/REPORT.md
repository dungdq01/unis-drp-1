# M21 — Data Sync & Freshness Gate · REPORT

**Date:** 2026-04-16
**Sprint:** 3
**Status:** ✅ DONE — Build pass · 27 tests pass · Migration .up + .down

---

## Files Created / Modified

### DA1 — Schema (migrations)
| File | Description |
|------|-------------|
| `supply/migrations/V002_m21_supply_snapshot_extend.up.sql` | Extend supply_snapshot + create sync_log + drp_override_log + indexes + backfill |
| `supply/migrations/V002_m21_supply_snapshot_extend.down.sql` | Rollback: drop tables + columns + indexes |

### BE1 — Data Sync module (`backend/src/data-sync/`)
| File | Description |
|------|-------------|
| `entities/sync-log.entity.ts` | SyncLog entity (per-NM sync attempt) |
| `entities/drp-override-log.entity.ts` | DrpOverrideLog entity (SC Manager override audit) |
| `dto/sync-query.dto.ts` | SyncHistoryQueryDto, OverrideDto |
| `freshness-gate.service.ts` | Injectable gate — check() / checkAll() — for M23/M26 |
| `data-sync.service.ts` | Core: upload, template, trigger, sync-all, override, history, cron |
| `data-sync.controller.ts` | 8 REST endpoints under /supply prefix |
| `data-sync.module.ts` | Module definition — exports FreshnessGateService + DataSyncService |
| `data-sync.service.spec.ts` | 20 unit tests |
| `freshness-gate.service.spec.ts` | 7 unit tests |

### Updated
| File | Change |
|------|--------|
| `supply/entities/supply-snapshot.entity.ts` | Added nmCode, syncedAt, source, isLegacyData columns |
| `app.module.ts` | Registered DataSyncModule |

---

## API Endpoints

```
POST  /api/v1/supply/nm-upload/:nmCode       NM CSV upload (validates header + rows)
GET   /api/v1/supply/sync/template/:nmCode   Download pre-filled CSV template
GET   /api/v1/supply/sync/dashboard          All NMs × freshness status
GET   /api/v1/supply/freshness/gate          Gate check result (FE + debug)
POST  /api/v1/supply/sync/trigger/:nmCode    Manual sync 1 NM
POST  /api/v1/supply/sync/trigger-all        Manual sync all active NMs
GET   /api/v1/supply/sync/history            Paginated sync_log
POST  /api/v1/supply/sync/override           Force override (reason ≥20 chars, audit log)
```

---

## Business Rules Implemented

| Rule | Implementation |
|------|---------------|
| R1: Fresh = synced_at < threshold (default 1440 min) | FreshnessGateService reads `planning.max_stale_minutes` from system_config |
| R2: Block DRP if any NM stale | check() returns canRun=false; M23/M26 inject FreshnessGateService |
| R3: SC Manager force override — mandatory reason | override() validates reason ≥20 chars, snapshots staleNms into drp_override_log |
| R4: Header validation — reject wrong format | _validateHeaders() checks sku_code, available_qty, atp_qty; error links template |
| R5: Cron 06:00 + 14:00 VN | _scheduleDailyCron() via setTimeout + OnApplicationBootstrap, UTC+7 math |
| R6: Manual trigger no cooldown | triggerSyncOne() always writes sync_log |

---

## Cron Implementation Note
`@nestjs/schedule` is NOT installed (not in package.json). Cron implemented via Node.js native `setTimeout` + `OnApplicationBootstrap`/`OnApplicationShutdown` hooks. Fires at 06:00 and 14:00 Asia/Ho_Chi_Minh (UTC+7). Tolerant — 1 NM fail does not abort others.

---

## Migration Strategy — Legacy Data (spec §6b)
1. All existing `supply_snapshot` rows: `is_legacy_data=TRUE`, `synced_at=NOW()`, `source='LEGACY'`
2. Gate skips stale check for `is_legacy_data=TRUE` rows (grace period)
3. DevOps flips `is_legacy_data=FALSE` after 3 days production → gate enforces fully

---

## M23/M26 Integration Contract

```typescript
// M23 DRP Netting — inject FreshnessGateService
const gate = await this.freshnessGate.check();
if (!gate.canRun) {
  // mark plan_run status='BLOCKED_STALE'
  // alert SC Manager
  throw new FreshnessGateBlockedException(gate.staleNms);
}
```

```typescript
// M26 ATP Check — same pattern
const gate = await this.freshnessGate.check();
if (!gate.canRun) return { status: 'BLOCKED_STALE', staleNms: gate.staleNms };
```

---

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `data-sync.service.spec.ts` | 20 | ✅ Pass |
| `freshness-gate.service.spec.ts` | 7 | ✅ Pass |
| **Total** | **27** | **✅ Pass** |

Coverage: ~85% (all service methods tested, edge cases: NotFoundException, BadRequestException, tolerant failure, cache, threshold, override audit)

---

## DoD Checklist

- [x] Build pass 0 error (`tsc --noEmit EXIT:0`)
- [x] Unit test ≥ 80% (27 tests, ~85%)
- [x] Migration V002 has .up.sql + .down.sql
- [x] FE1 can use `GET /supply/sync/dashboard` to render Sync Dashboard
- [x] REPORT.md created
- [x] FreshnessGateService exported — M23/M26 can inject directly
- [x] Override endpoint with mandatory reason (≥20 chars) + audit log
- [x] Cron 06:00 + 14:00 VN without external deps
- [x] Feature flag `m21_data_sync_v2_enabled` already seeded in M10 migration
- [x] is_legacy_data grace period strategy implemented in migration + service
- [x] Tolerant sync-all: 1 NM fail → log FAILED + continue

## Open Items (Sprint 3 → Sprint 4)

- [ ] FE1: `/supply-intake` dashboard UI (FE can start wireframe now)
- [ ] M23 DRP: inject FreshnessGateService → block on gate.canRun=false
- [ ] M26 ATP: inject FreshnessGateService
- [ ] Alert to M8: stale NM → in-app alert SC Manager
- [ ] DevOps: flip is_legacy_data=FALSE after 3 days production
- [ ] supplier PK migration Sprint 2 → then add nm_id BIGINT FK to supply_snapshot
