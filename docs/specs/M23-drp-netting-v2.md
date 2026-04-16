# M23 — DRP Netting v2 + Safety Stock CN

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 4-5
> **Owner:** BE1 · **DA:** DA1 · **FE:** FE1
> **Status:** 🟡 EXTEND M3+M4 (gộp Safety Stock + DRP Netting thành 1 engine D4)
> **PRD:** §F2-B3 DRP Netting + Safety Stock CN · **Flow:** 2 (Daily DRP, 23:15)
> **Domain:** D4 Replenishment
> **Feature flag:** `m23_drp_netting_v2_enabled`
> **Folder (Rule 3):** `backend/src/drp/` (EXTEND — file mới `drp.netting-v2.service.ts`, `drp.ss-cn.service.ts`)

---

## 1. Tại sao làm bài này

DRP hiện tại (M3+M4) tính tổng cho cả hệ thống — không phân biệt CN nào cần bao nhiêu, không có Safety Stock dynamic. Hậu quả:
- CN-BD over-stock 30% trong khi CN-ĐN stockout liên tục
- SS dùng z cố định 1.65 cho mọi SKU → thuốc lá có demand σ thấp (cần SS thấp) mà giữ buffer như SKU σ cao → kẹt vốn
- Không có LCNB awareness → không biết tận dụng inventory CN khác

M23 nâng cấp:
1. **Per-CN netting** — net demand riêng từng CN dựa Hub ảo allocate
2. **SS CN dynamic** — formula z × σ × √LT_hub, σ rolling 12w + seasonal lookback
3. **LCNB SS reduction** — khi LCNB enabled, SS CN giảm 25% (CN có thể nhận từ CN khác → buffer thấp hơn)
4. **Variant suggestion** — gợi ý variant breakdown dựa tồn kho variant hiện tại của CN
5. **Policy snapshot pin** (Rule 14) — pin `policy_run_id` vào `plan_run` tránh baseline drift

---

## 2. Scope

### ✅ Thêm
- `plan_run` extend: thêm `policy_run_id` FK (Rule 14 baseline pin)
- 3 bảng mới: `ss_cn`, `drp_cn_line`, `policy_run` (snapshot config + lookup tables)
- SS CN service: dynamic formula + seasonal σ + per-CN×SKU override
- DRP Netting v2 service per-CN
- Variant breakdown suggestion service
- Freshness gate guard (M21) inject before run
- M22 effective demand integration
- Service `getDrpResult(planRunId)` export cho M24 Allocation inject

### ❌ Không đụng
- M3 SS basic logic — giữ nguyên trong `policy.service.ts`, M23 dùng `drp.ss-cn.service.ts` riêng cho v2
- M4 `plan_run` core schema — chỉ ALTER ADD column
- M3 RTM rules — không liên quan
- Phase 1 KHÔNG build seasonal ML model — chỉ same-period-last-year lookup

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | M23 chạy nightly 23:15 VN sau khi M22 cutoff lock (18:00) và M21 sync 14:00 fresh | Sequence |
| **R2** | **Freshness gate** — M21 freshness check FAIL → M23 abort, ghi `plan_run.status='BLOCKED_STALE'`, alert SC Manager. SC Manager force override = audit | Gate (R3 M21) |
| **R3** | **Effective demand**: M23 ưu tiên `M22.getEffectiveDemand(weekStart)`. Nếu M22 throw/unavailable hoặc cell không có entry → fallback FC raw từ M11/M1 snapshot mới nhất | M22 contract |
| **R4** | **Hub available**: Phase 1 = `Σ supply_snapshot.qty` (gross mode, hub ảo). Phase 2 nhận từ M16 Hub ảo virtual inventory | Configurable mode |
| **R5** | **SS CN formula:** `SS_cn = z × σ_demand × √LT_hub`. Trong đó z, σ, LT_hub configurable per CN×SKU (M00 sku_cn_mapping override) | Dynamic |
| **R6** | **σ_demand 2 nguồn:** rolling 12w (default) + same-period-last-year (seasonal). Final σ = max(σ_rolling, σ_seasonal) — buffer cho seasonality | Phase 1: 2 năm history |
| **R7** | **LCNB enabled (M10 config)** → `SS_cn_final = SS_cn × (1 - lcnb_ss_reduction_pct)`. Default reduction 25%. Logic: CN có thể vay từ CN gần khi cần → buffer riêng thấp hơn | Closed-loop |
| **R8** | **z override per CN×SKU** (M00): critical items dùng z cao hơn (e.g. 1.96 = 97.5% CSL). Lookup `sku_cn_mapping.z_override` | Critical items |
| **R9** | **Per-CN netting:** `net_demand_cn = effective_demand_cn - on_hand_cn - in_transit_cn + SS_cn_final`. Nếu net < 0 → đánh dấu OVER_STOCK | Core formula |
| **R10** | **Variant breakdown suggestion:** sau khi tính net per (CN, SKU base), gợi ý phân variant theo tỷ lệ tồn variant hiện tại CN. SC Manager review/override ở M27 | Suggestion only, không enforce |
| **R11** | **Policy snapshot pin (Rule 14)** — bắt đầu run: tạo `policy_run` snapshot toàn bộ (M10 configs + sku_cn_mapping override + LT + σ values), pin `policy_run_id` vào `plan_run`. M23/M24/M25 đọc từ snapshot này, KHÔNG đọc active policy runtime | Hard rule |
| **R12** | DRP run chỉ trigger 1 lần per ngày (idempotent). Re-run cùng ngày → reject 409 trừ khi force re-run với mandatory reason | Avoid duplicate |

---

## 4. SS CN Formula Detail

```
σ_rolling   = STDDEV(actual_demand) over last 12 weeks
σ_seasonal  = STDDEV(actual_demand same period 2 years ago)
σ_final     = MAX(σ_rolling, σ_seasonal)

z           = sku_cn_mapping.z_override ?? plugin.csl_default_z (M10, default 1.65)
LT_hub      = transport_lane.transit_lt_days WHERE lane_type='HUB_TO_CN' AND to_location=CN

SS_cn_base  = z × σ_final × √LT_hub
SS_cn_final = lcnb_enabled ? SS_cn_base × (1 - 0.25) : SS_cn_base

// [C1 fix] Phase 1 σ≈0 guard — khi chỉ có FC data, σ_rolling≈0 → SS≈0 → over-alloc risk
SS_cn_floor = mean_demand_12w × min_ss_floor_pct  // M10 'planning.min_ss_floor_pct', default 0.05 (5%)
SS_cn_final = MAX(SS_cn_final, SS_cn_floor)
```

**Phase 1 fallback khi chưa có actual_sales:**
- σ_rolling: dùng `demand_snapshot.qty` 12w gần nhất (nếu chỉ có FC, σ ≈ 0 → SS CN ≈ 0 → cảnh báo)
- σ_seasonal: NULL nếu chưa có 2 năm history → dùng σ_rolling
- Phase 2: M28 backfill actual → recompute σ chính xác

**Override per CN×SKU** (M00 `sku_cn_mapping`):
- `ss_override` → bypass formula, dùng giá trị này
- `z_override` → dùng z khác formula default
- `is_critical=TRUE` → flag UI hiển thị badge

---

## 5. DRP Netting Pipeline (per run)

```
Step 1: Validate (R2 freshness, R12 idempotent, M22 cutoff passed)
Step 2: Create policy_run snapshot — pin tất cả config + master data
Step 3: Create plan_run với policy_run_id
Step 4: Load demand:
        - effective_demand = M22.getEffectiveDemand(weekStart)
        - fallback FC raw nếu cell missing
Step 5: Load supply (M25 C4 cross-link):
        - on_hand_cn = supply_snapshot.qty - reserved_for_transport - in_transit_qty (available)
          → KHÔNG dùng raw qty, phải trừ reserved_for_transport (M25 held trips reserve inventory)
        - in_transit_cn = supply_snapshot.in_transit_qty (track riêng cho net formula)
        - hub_available = Σ on_hand_cn available (Phase 1) hoặc M16 hub_virtual (Phase 2)
        - **Anti double-allocation invariant:** trips status='HELD' đã reserve qty → M23 cycle hôm nay
          KHÔNG được alloc lại số đó. Reservation lifecycle xem M25 §C4.
Step 6: Compute SS_cn per (CN, SKU):
        - σ_rolling, σ_seasonal, σ_final
        - SS_cn_base, SS_cn_final (apply LCNB reduction)
        - Apply override nếu có
Step 7: Per-CN netting:
        - net_demand_cn = effective_demand - on_hand - in_transit + SS_cn_final
        - status = NORMAL | OVER_STOCK (net<0) | STOCKOUT_RISK (net>hub_available)
Step 8: Variant breakdown suggestion per (CN, SKU base):
        - tỷ lệ variant từ supply_snapshot variant tồn kho
        - apply tỷ lệ vào net_demand
Step 9: Save drp_cn_line + plan_run.status='COMPLETED'
Step 10: Trigger M24 Allocation (or notify if standalone)
```

**Run time target:** < 5 phút cho 50 CN × 500 SKU = 25,000 cells.

---

## 6. User Stories (Acceptance)

### US-1: Happy path nightly run
**Given** 23:15 VN, M21 fresh ✓, M22 cutoff passed ✓. **When** DRP trigger. **Then** plan_run created với policy_run_id pinned, 25K cells computed, status=COMPLETED, M24 trigger.

### US-2: Freshness gate block
**Given** NM Mikado last_sync 30h trước. **When** DRP trigger 23:15. **Then** plan_run.status='BLOCKED_STALE', alert SC Manager: "DRP blocked do NM Mikado stale 30h. Force override hoặc sync gấp."

### US-3: SC Manager force override stale gate
**Given** US-2 state. **When** SC Manager click "Force run" + reason "NM bảo trì, dùng data 30h cũ acceptable". **Then** plan_run.status='COMPLETED' với flag `is_stale_override=TRUE`, audit log ghi reason.

### US-4: M22 adjusted demand áp dụng
**Given** CN-BD GA-300 W17: FC raw=500, M22 adjusted=580 status=APPROVED. **When** DRP run W17. **Then** drp_cn_line.effective_demand=580, source='M22_ADJUSTED'.

### US-5: M22 không có entry → fallback FC
**Given** CN-DN GA-300 W17 không có adjustment. **When** DRP run. **Then** effective_demand=FC raw từ M11/M1, source='FC_RAW'.

### US-6: M22 service unavailable → fallback toàn bộ
**Given** M22 flag off (`m22_cn_demand_adjust_enabled=false`). **When** DRP run. **Then** mọi cell dùng FC raw, log warning "M22 unavailable, fallback FC raw".

### US-7: SS CN với override
**Given** CN-BD × SKU-Critical sku_cn_mapping: `z_override=1.96, is_critical=true, ss_override=NULL`. **When** SS compute. **Then** dùng z=1.96 thay default 1.65, SS cao hơn ~19%.

### US-8: SS CN với explicit override
**Given** CN-CT × SKU-Special: `ss_override=200`. **When** compute. **Then** SS=200 (bypass formula), log source='OVERRIDE_EXPLICIT'.

### US-9: LCNB SS reduction
**Given** M10 `lcnb.enabled=true`, `lcnb.ss_reduction_pct=25`. **When** SS compute. **Then** SS_cn_final = SS_cn_base × 0.75.

### US-10: OVER_STOCK detection
**Given** CN-HN GA-400: on_hand=2000, in_transit=500, demand=300, SS=100. **When** netting. **Then** net = 300 - 2000 - 500 + 100 = -2100 → status='OVER_STOCK', flag cho M24 LCNB consider as donor.

### US-11: STOCKOUT_RISK
**Given** CN-DN SKU-X: net=800, hub_available=200. **When** netting. **Then** status='STOCKOUT_RISK', flag cho M24 + alert M8.

### US-12: Variant suggestion
**Given** GA-300 net CN-BD = 600m². CN-BD tồn variant: A4=400, B2=200, C1=0. **Then** suggestion: A4=400, B2=200, C1=0 (proportional). M27 PO Review có thể override.

### US-13: Policy pin baseline (Rule 14)
**Given** DRP đang chạy lúc 23:20. SC Manager đổi `lcnb.ss_reduction_pct` 25%→30% lúc 23:25. **When** M24 đọc config 23:30. **Then** M24 vẫn dùng 25% từ policy_run snapshot, KHÔNG đọc 30% mới. Cycle tiếp theo (24h sau) mới dùng 30%.

### US-14: Re-run same day reject
**Given** plan_run cho 2026-04-20 đã có status='COMPLETED'. **When** trigger DRP cùng ngày. **Then** 409 "DRP đã chạy hôm nay. Force re-run cần mandatory reason."

### US-15: M24 đọc kết quả
**Given** plan_run.status='COMPLETED'. **When** M24 init. **Then** gọi `M23Service.getDrpResult(planRunId)` → trả Map per (CN, SKU) với net_demand + SS + variant suggestion.

---

## 7. Data Contract

### `plan_run` extend (giữ M4 schema)
| Field thêm | Mô tả |
|------------|-------|
| `policy_run_id` BIGINT NULL FK policy_run | **Rule 14** baseline pin. NULL cho rows M4 cũ. |
| `effective_demand_source` JSONB NULL | Stats: `{m22_count, fc_raw_count, m22_unavailable: bool}` |
| `is_stale_override` BOOLEAN DEFAULT FALSE | Khi SC Manager force pass freshness gate |
| `stale_override_reason` TEXT NULL | Mandatory khi is_stale_override=TRUE |
| `stale_override_by` VARCHAR(100) NULL | userId |
| `status` VARCHAR(20) extend ENUM | Thêm: `BLOCKED_STALE`, `FORCE_OVERRIDDEN` |

### `policy_run` (mới — Rule 14 snapshot)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `created_at` TIMESTAMP | |
| `created_by` VARCHAR(100) | userId hoặc 'SYSTEM_NIGHTLY' |
| `config_snapshot` JSONB | Toàn bộ M10 configs liên quan DRP (csl, lcnb, ss params) |
| `master_data_snapshot` JSONB | sku_cn_mapping **override rows only** + supplier LT + transport_lane LT_hub (**không** dump toàn bộ 25K mapping rows) |
| `note` TEXT NULL | Optional context |

> Snapshot lưu để replay/audit DRP run sau này. JSONB compression OK Phase 1.
> **[M2 fix] Size guard:** chỉ snapshot override rows (thường < 500 rows, ~300KB) — KHÔNG dump full sku_cn_mapping.
> **Retention:** Sprint 5 cleanup job — xóa policy_run + plan_run > 90 ngày. M10 config: `planning.snapshot_retention_days=90`.

### `ss_cn` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `plan_run_id` FK plan_run | Pin per run (snapshot) |
| `cn_id` FK channel | |
| `sku_id` FK sku | |
| `sigma_rolling` DECIMAL(15,4) | σ 12w |
| `sigma_seasonal` DECIMAL(15,4) NULL | σ same-period-last-year (NULL nếu chưa 2yr history) |
| `sigma_final` DECIMAL(15,4) | MAX(rolling, seasonal) |
| `z_used` DECIMAL(5,4) | Default hoặc override |
| `lt_hub_days` DECIMAL(5,2) | From transport_lane |
| `ss_base` DECIMAL(15,2) | Trước LCNB reduction |
| `lcnb_reduction_pct` DECIMAL(5,2) | Snapshot từ policy_run |
| `ss_final` DECIMAL(15,2) | Sau LCNB reduction |
| `source` VARCHAR(20) | `FORMULA / OVERRIDE_EXPLICIT / OVERRIDE_Z` |
| `is_critical` BOOLEAN | Flag UI |

### `drp_cn_line` (mới — output per cell)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `plan_run_id` FK | |
| `cn_id` FK | |
| `sku_id` FK | (SKU base) |
| `period_start` DATE | Monday của tuần |
| `effective_demand` DECIMAL(15,2) | Sau M22 adjust hoặc FC raw |
| `effective_demand_source` VARCHAR(20) | `M22_ADJUSTED / FC_RAW` |
| `on_hand` DECIMAL(15,2) | |
| `in_transit` DECIMAL(15,2) | |
| `ss_final` DECIMAL(15,2) | Snapshot từ ss_cn |
| `net_demand` DECIMAL(15,2) | Core output |
| `status` VARCHAR(20) | `NORMAL / OVER_STOCK / STOCKOUT_RISK` |
| `variant_suggestion` JSONB NULL | `{variantCode: qty, ...}` |
| `created_at` | |
| Composite UNIQUE | `(plan_run_id, cn_id, sku_id, period_start)` |

### API chính

```
# DRP run lifecycle
POST  /api/v1/drp/v2/run                          # Trigger DRP nightly run (cron + manual)
POST  /api/v1/drp/v2/run/force-stale-override     # SC Manager bypass freshness gate
GET   /api/v1/drp/v2/runs?limit=&status=          # List runs paginated
GET   /api/v1/drp/v2/runs/:id                     # Detail + summary stats

# Result query
GET   /api/v1/drp/v2/runs/:id/lines?cnId=&status= # drp_cn_line filter
GET   /api/v1/drp/v2/runs/:id/ss-summary?cnId=    # SS CN per cell
GET   /api/v1/drp/v2/runs/:id/policy-snapshot     # Audit policy_run snapshot

# SS CN (live preview, pre-run)
GET   /api/v1/drp/v2/ss-preview?cnId=&skuId=      # Preview SS không lưu, dùng config hiện tại

# Internal (M24 inject)
# Method: M23Service.getDrpResult(planRunId): DrpResultDto
```

**Folder structure:**
```
backend/src/drp/
├── drp.service.ts                   ← M3+M4 cũ (giữ nguyên)
├── drp.netting-v2.service.ts        ← M23 logic core
├── drp.ss-cn.service.ts             ← SS formula + seasonal + override
├── drp.variant-suggestion.service.ts ← variant breakdown
├── drp.policy-run.service.ts        ← snapshot config + master data
├── drp.controller.ts                ← Cả M4 + M23 routes
└── entities/
    ├── plan-run.entity.ts            ← extend
    ├── policy-run.entity.ts          ← mới
    ├── ss-cn.entity.ts               ← mới
    └── drp-cn-line.entity.ts         ← mới
```

---

## 8. Cron Schedule

| Cron | Schedule (VN) | Purpose |
|------|---------------|---------|
| **DRP nightly** | `15 23 * * *` (23:15 VN) | Chính: trigger DRP run hằng đêm |
| **DRP retry** | `30 23 * * *` (23:30 VN) | **[M3 fix]** Retry **chỉ khi** không có plan_run hôm nay với status `COMPLETED` hoặc `RUNNING`. Guard: `SELECT 1 FROM plan_run WHERE run_date=today AND status IN ('RUNNING','COMPLETED')` → nếu tồn tại → SKIP. Tránh tạo duplicate run khi 23:15 đang chạy. |

Decorator: `@Cron(..., { timeZone: 'Asia/Ho_Chi_Minh' })`.

---

## 9. Non-functional

- DRP run hoàn tất < **5 phút** cho 50 CN × 500 SKU (25K cells) — NFR critical
- SS preview API < 500ms per cell
- Policy snapshot creation < 10s
- Result query < 2s với pagination 100 lines

---

## 10. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `channel`, `sku`, `sku_cn_mapping`, `supplier`, `transport_lane` | FK + LT lookup + override |
| **M00 minor m1 fix** `transport_lane.transit_lt_days, lane_type` | LT_hub formula |
| **M00 minor m3 fix** `supplier.id BIGSERIAL` | FK integrity với sku_nm_mapping |
| **M10** configs | `csl_default_z`, `lcnb.enabled`, `lcnb.ss_reduction_pct`, `seasonal_lookback_years` |
| **M10** feature flag | `m23_drp_netting_v2_enabled` |
| **M21** freshness gate | Block run nếu data stale (R2) |
| **M22** `getEffectiveDemand(weekStart)` | Adjusted demand input (R3) |
| **M11 / M1** demand snapshot | Fallback FC raw |
| **M2 supply** | on_hand, in_transit per CN |
| **M16** Hub ảo (Phase 2) | Hub available source — Phase 1 fallback Σ(supply) |
| **M28** (Phase 2) actual_sales | σ_rolling chính xác hơn FC-based |

| Feeds | Why |
|-------|-----|
| **M24 Allocation** | `getDrpResult(planRunId)` injectable |
| **M28 Feedback** | Track FC accuracy vs actual sau khi run, refresh σ weekly |
| **M8 Alerts** | OVER_STOCK, STOCKOUT_RISK, BLOCKED_STALE |

---

## 11. DoD

- [ ] Migration extend `plan_run` (4 columns + status enum) + 3 tables mới + .down.sql
- [ ] Composite UNIQUE `drp_cn_line(plan_run_id, cn_id, sku_id, period_start)`
- [ ] Policy snapshot service `createPolicyRun()` capture full state
- [ ] SS CN service: σ rolling 12w + seasonal lookup + override + LCNB reduction
- [ ] DRP Netting v2 service per-CN với fallback chain (M22 → FC raw)
- [ ] Variant suggestion service dựa supply_snapshot variant breakdown
- [ ] Freshness gate guard inject from M21 (R2)
- [ ] Idempotent run check (1 run per day, R12)
- [ ] Force stale override endpoint với mandatory reason min 20 chars
- [ ] Cron 23:15 VN + retry 23:30 VN
- [ ] `getDrpResult(planRunId)` injectable cho M24
- [ ] Performance: < 5 phút cho 25K cells (NFR-001)
- [ ] FE: Run trigger button + run history list
- [ ] FE: SS preview tool (live, không lưu)
- [ ] FE: drp_cn_line table với filter status/CN, badge OVER_STOCK/STOCKOUT_RISK
- [ ] FE: Policy snapshot viewer (audit)
- [ ] Alert integration M8: BLOCKED_STALE, force_override, OVER_STOCK count > 10%, STOCKOUT_RISK count > 0
- [ ] Audit log mọi run + override
- [ ] Feature flag wrapper — off → 503; nightly cron skip M23 và fallback M4 cũ
- [ ] QA: 15 user stories pass

---

## 12. Out of Scope

- **Statistical FC engine** — consume từ M11/M22, không build
- **Hub ảo physical inventory** — Phase 1 hub = Σ supply, M16 Phase 2
- **MOQ booking logic** — M13 Production Lot Sizing (Flow 1)
- **NM commitment** — M14
- **Allocation engine LCNB execute** — M24 (M23 chỉ flag OVER_STOCK donor candidates)
- **PO generation** — M27
- **Real-time DRP rerun** — Phase 1 chỉ daily 23:15
- **Multi-tenant** — single tenant
- **Seasonal ML model** — Phase 1 dùng same-period-last-year đơn giản
- **Cross-flow integration M16 Hub ảo feed** — Phase 2 swap

---

## 13. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| Performance 5 phút cho 25K cells khả thi? | Yes nếu: (1) batch SQL không loop per row, (2) preload all data 1 lần đầu, (3) compute in-memory. BE1 spike Sprint 4 Day 1 verify. |
| σ_seasonal cần actual_sales — Phase 1 chưa có | Phase 1 dùng `demand_snapshot.qty` (FC) làm proxy. Phase 2 unblock với actual. Note giảm accuracy ~10-15%. |
| Re-run cùng ngày — cho phép không? | Reject 409 default. Force re-run với mandatory reason + audit. Use case: bug fix sau run đầu. |
| Policy snapshot lưu JSONB hay relational? | JSONB Phase 1 (đơn giản, audit-friendly). Phase 2 nếu cần query → trigger materialize. |
| LCNB reduction áp cho mọi SKU hay theo class? | Phase 1 áp toàn bộ với % chung. Phase 2 phân theo ABC class (A=20%, B=25%, C=30%). |
| Variant suggestion conflict với explicit allocation M24? | M23 chỉ suggest. M24 có thể override. M27 PO Review final say. |
| Hub ảo Phase 1 = Σ(supply) có vấn đề? | Risk over-allocation (cùng hàng phân 2 nơi). M24 phải có SS guard: không alloc quá `on_hand_cn_donor - SS_cn_donor`. M23 ghi nhận, M24 enforce. |
| Idempotent key — by date only hay date+source? | By `period_date + nightly_cron_flag`. Manual force re-run dùng key khác (e.g. `2026-04-20_force_$timestamp`). |

---

## 14. Lưu ý cho dev

1. **`getDrpResult(planRunId)` injectable** — M24 inject trực tiếp. Trả `DrpResultDto`: `{ planRunId, policyRunId, generatedAt, lines: Map<"cn_id|sku_id|week", DrpCellDto> }`. Throw `PlanRunNotCompletedException` nếu status != COMPLETED → M24 wait/retry hoặc fallback M4 cũ.

   **[C2 fix] Key format chuẩn:** `"${cn_id}|${sku_id}|${period_start}"` — `period_start` là Monday YYYY-MM-DD.
   Bắt buộc dùng shared helper `drpCellKey(cnId, skuId, weekStart): string` trong `common/drp-utils.ts` — cả M23 builder lẫn M24 consumer đều gọi helper này để tránh format mismatch silent (Map.get() trả undefined không có lỗi).

2. **Policy snapshot pattern (Rule 14):**
   ```
   tx.start
     policyRun = createPolicyRun() // INSERT JSONB snapshot
     planRun = createPlanRun({ policyRunId: policyRun.id, status: 'RUNNING' })
   tx.commit
   // ... compute outside tx (long-running)
   updatePlanRun(status='COMPLETED')
   ```
   M24/M25 đọc config qua `policyRun.config_snapshot`, KHÔNG `M10Service.getConfig()`.

3. **M22 fallback chain:**
   ```typescript
   try {
     const m22Map = await m22Service.getEffectiveDemand(weekStart);
     for (cell) effective = m22Map.get(key) ?? fcRaw[key];
   } catch (FeatureFlagDisabled) {
     for (cell) effective = fcRaw[key];
     log.warn('M22 unavailable, fallback FC raw');
   }
   ```

4. **Performance critical** — preload 1 lần:
   - All `supply_snapshot` (cả `qty`, `reserved_for_transport`, `in_transit_qty`) per (CN, SKU) → Map. **available = qty - reserved_for_transport - in_transit_qty** (M25 C4 cross-link).
   - All `sku_cn_mapping` overrides → Map
   - All `transport_lane` LT_hub → Map
   - σ_rolling 12w aggregate query 1 lần
   - σ_seasonal aggregate query 1 lần
   Sau đó loop in-memory. KHÔNG query DB per cell.

5. **Bulk insert chunk** — `drp_cn_line` 25K rows: chunk 500 per INSERT để tránh PG 65535 param limit (đã có pattern trong M9/M22).

6. **Freshness gate guard** — `@UseGuards(FreshnessGateGuard)` decorator wrap endpoint trigger run. Inject `M21FreshnessService` trong guard.

7. **[M1 fix] Status transition matrix** — service `transitionPlanRun(id, newStatus)` validate theo bảng sau. Throw `InvalidTransitionException` nếu vi phạm. Audit log mỗi transition.

   | Từ | → Cho phép | Ghi chú |
   |----|-----------|---------|
   | `RUNNING` | `COMPLETED`, `FAILED`, `BLOCKED_STALE` | Normal flow |
   | `BLOCKED_STALE` | `FORCE_OVERRIDDEN`, `CANCELLED` | SC Manager action |
   | `FORCE_OVERRIDDEN` | `COMPLETED`, `FAILED` | Tiếp tục với stale data |
   | `FAILED` | *(tạo plan_run mới để retry)* | KHÔNG reuse row failed |
   | `COMPLETED` | *(terminal)* | Force re-run → plan_run mới với `is_force_rerun=TRUE` |

8. **M16 Hub ảo Phase 2 swap** — service method `getHubAvailable(skuId)`:
   - Phase 1: `SUM(supply_snapshot.qty WHERE item_code=skuCode AND latest snapshot)`
   - Phase 2: nếu `feature.m16_hub_virtual_enabled` → call `M16Service.getVirtualInventory(skuId)`
   Wrapped sau interface để swap clean.

9. **[M4 fix] Variant breakdown rule:** `variant_qty = net_demand × (variant_on_hand / total_on_hand)`. Nếu `total_on_hand=0`:
   - **Phase 1** — query `demand_snapshot` variant breakdown 4 tuần gần nhất cho cặp (cn_id, sku_id):
     ```sql
     SELECT variant_code, SUM(qty) AS total
     FROM demand_snapshot
     WHERE sku_id = $sku AND cn_id = $cn
       AND snapshot_date >= NOW() - INTERVAL '4 weeks'
     GROUP BY variant_code ORDER BY total DESC
     ```
   - Nếu demand_snapshot cũng trống → `variant_suggestion=NULL`, `planner_review_required=TRUE`, `review_reason='NO_VARIANT_HISTORY'`.
   - **Phase 2** — dùng actual_sales từ M28 thay demand_snapshot.

10. **Folder Rule 3 check:** EXTEND `src/drp/` (đã có M3+M4). KHÔNG tạo `src/drp-v2/` hoặc `src/replenishment/`. Tên file `drp.netting-v2.service.ts` (capability suffix v2 OK trong filename, vì có v1 cùng folder).

---

*M23 DRP Netting v2 + Safety Stock CN Spec v1.0.1 — 2026-04-17 (micro-update: Step 5 dùng available_qty per M25 C4 reservation cross-link)*
