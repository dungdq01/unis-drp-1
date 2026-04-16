# M10 System Config — Module Report

> **Sprint:** 1 · **DA:** DA1 · **Status:** DONE
> **Zone:** PROTECTED (Type 1 — keep BE + FE)

---

## BA Logic

### Feature Flag System
- Table `feature_flag` (PK `flag_name VARCHAR(100)`) — created by M00 migration
- `SystemConfigService.isEnabled(flagKey)` queries DB with **TTL 30s in-memory cache** + env fallback
- `FeatureFlagGuard` reads `@FeatureFlag()` decorator metadata via Reflector
- 3 M00 flags + 11 M11-M28 flags seeded (all M11+ initially `enabled=FALSE`)

### System Config (26 keys, 7 groups)
- Table `system_config` (PK `config_key`) with `config_group` discriminator
- Groups: PLANNING (2), LCNB (6), TRUST_SCORE (4), CN_ADJUST (3), TRANSPORT (3), FC_COMMIT (7), B2B_PIPELINE (1)
- Cross-field validation: `commit.hard < firm < soft`, `gap_alert_day < gap_escalate_day`
- Bounds validation via `BOUNDS` map covering all 26 keys
- Audit log: every config change writes `config_audit_log` with old/new value + actor

### Key Config Values (downstream dependency)
| Key | Value | Consumed By |
|-----|-------|-------------|
| `planning.max_stale_minutes` | 1440 | M21 FreshnessGateService |
| `cn_adjust.tolerance_pct` | 30 | M22 CnAdjustService |
| `cn_adjust.cutoff_time` | "18:00" | M22 cutoff check |
| `trust.auto_approve_threshold_pct` | 85 | M22 auto-approve |
| `lcnb.enabled` | DETECT_ONLY | M24 LCNB mode |

---

## DB Schema

### Migration Files
| File | Action |
|------|--------|
| `001_create_system_config_tables.sql` | system_config + config_audit_log |
| `002_seed_unis_defaults.sql` | Legacy PLANNING_CYCLE + PLUGIN_PARAMS seeds |
| `20260419_m10_config_extend_26_keys.up.sql` | 26 new keys + 11 feature flags |
| `20260419_m10_config_extend_26_keys.down.sql` | DELETE 26 keys + 11 flags |

---

## API Endpoints

**Base:** `/api/v1/system-config`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all configs (optional `?group=`) |
| GET | `/:group` | Get configs by group name |
| PATCH | `/` | Batch update configs (cross-field + bounds validation) |
| GET | `/roles` | RBAC roles (Phase 2 placeholder) |
| GET | `/toggles` | List all feature toggles |
| PATCH | `/toggles/:key` | Update toggle value + audit |
| GET | `/flags` | List all feature flags |
| PATCH | `/flags/:flagKey` | Update flag enabled + audit |
| GET | `/audit?page=&size=` | Paginated audit log |

---

## FE

- Page: `app/system-config/page.tsx`
- API: `lib/api/system-config.ts`
- 4 tabs: Planning Params | Plugin Params | Feature Toggles | System (Bravo + RBAC + Audit Log)
- Inline edit with save button per tab, actor field required

---

## Test

- `system-config.service.spec.ts` — 20 test cases
- Coverage: cross-field commit tolerances (3), gap_alert_day (2), bounds (5), isEnabled cache (3), updateFlag (3), listFlags (1), edge cases (3)

---

## Source Files
| Layer | Path |
|-------|------|
| Service | `backend/src/system-config/system-config.service.ts` |
| Controller | `backend/src/system-config/system-config.controller.ts` |
| Module | `backend/src/system-config/system-config.module.ts` |
| DTO | `backend/src/system-config/dto/index.ts` |
| Entities | `backend/src/system-config/entities/system-config.entity.ts`, `config-audit-log.entity.ts` |
