# UNIS — TerraX DRP to 8-Step SCP Pipeline Mapping

> **Version:** 1.2 | **Date:** 2026-04-13  
> **Purpose:** Mapping TerraX DRP flows (data-flow.md, business-rules.md, system-flows.md) với 8-step execution core của SCP platform  
> **Audience:** BE, DA, DE teams implementing UNIS tenant

---

## Tổng quan Mapping

| SCP 8-Step Pipeline | TerraX DRP Component | Mapping Type | Notes |
|---------------------|---------------------|--------------|-------|
| **Step 1: Demand Ingestion** | Master Data Upload (SKU forecast) | ✅ DIRECT | `demand_mean` + `demand_std` → forecast snapshot |
| **Step 2: Supply Snapshot** | Inventory Upload (NM + CN) | ✅ DIRECT | `inventory` table → supply snapshot (OEM/DISTRIBUTION) |
| **Step 3: Inventory Policy** | Pattern Ratios + Lead Time | ⚠️ PARTIAL | Safety stock logic exists; CSL/LCNB gaps remain |
| **Step 4: DRP Netting** | DRP Compute (13-week) | ✅ DIRECT | Core algorithm 1:1 match |
| **Step 5: Allocation** | Pull Order creation (Nơi kéo RTM rules) | ⚠️ ADAPTED | RTM data exists; channel isolation + UOM + lifecycle gaps |
| **Step 6: Transport Planning** | Container bin-pack (FR17) | ⚠️ PARTIAL | Weight constraint only, no route/carrier selection |
| **Step 7: Execution Bridge** | Approval flow (CN → TCU) + PO | ⚠️ ADAPTED | CN must approve; edit-after-approval = **re-approve** (not 403); ERP=Bravo |
| **Step 8: Monitor & Learn** | KPI Dashboard + Audit Log | ✅ DIRECT | HSTK alerts + adjustment reports |

**Legend:**
- ✅ **DIRECT:** TerraX logic maps 1:1 to SCP step
- ⚠️ **PARTIAL:** Một phần logic khớp, cần bổ sung
- ❌ **MISSING:** TerraX không có, phải implement từ đầu

---

## Step 1: Demand Ingestion — Master Data Upload

### TerraX DRP Flow (data-flow.md §2)

```
POST /api/v1/master-data/upload (Excel .xlsx)
  ↓
Sheet "sku": [sku_code, sku_name, demand_mean, demand_std, pattern_group, weight_kg]
  ↓
ExcelIngestionAdapter.ingest()
  ↓
UPSERT sku table
  ↓
AuditLog: master_data.uploaded
```

**Key fields:**
- `demand_mean` (μ) → forecast quantity (weekly average)
- `demand_std` (σ) → forecast volatility
- `pattern_group` → SKU grouping logic (main/border/point tiles)

### SCP 8-Step Equivalent

```
POST /api/v1/demand/forecast/upload (CSV)  ← NEW endpoint (T1 implemented Sprint 8)
  ↓
Format: detailed (branch-level) | summary (aggregated)
  ↓
Bulk INSERT demand_forecast_detail
  ↓
Create demand_snapshot { status=DRAFT }
  ↓
POST /api/v1/demand/snapshot/{id}/freeze → status=FROZEN
```

**Mapping:**

| TerraX Field | SCP Equivalent | Transformation |
|--------------|----------------|----------------|
| `sku.demand_mean` | `demand_forecast_detail.forecast_qty` | Weekly μ → monthly forecast (multiply × 4.33) |
| `sku.demand_std` | Metadata: `confidence_lower`, `confidence_upper` | σ → forecast range (μ ± 1.65σ for 90% CSL) |
| `sku.pattern_group` | `item.specs_id_mode=VARIANT` + `item_variant_id` | TerraX pattern = SCP variant matching |
| Upload source | `source='excel'` vs `source='CSV_UPLOAD'` | Same idempotency concept |

### PlanningCycle Config (FR-v3-016 — HIGH, Ph1) 🆕

**UNIS cutoff time:** `23:00 ICT nightly` (SCP §10.7, SCP §16.4 FR-v3-016)

| Parameter | UNIS Config | MDLZ Config | SCP Object |
|-----------|-------------|-------------|------------|
| `cutoff_time` | `23:00 ICT` | `16:00 ICT` | `PlanningCycle.cutoff_time` |
| `frequency` | `NIGHTLY` | `DAILY` | `PlanningCycle.cadence` |
| `horizon_weeks` | `12` (SCP) vs `13` (TerraX) | N/A | `PlanningCycle.horizon` |
| `timezone` | `Asia/Ho_Chi_Minh` | same | `PlanningCycle.timezone` |

### Freshness Gate (Pre-condition — T-240 min for UNIS) 🆕

**Source:** Supplement §B.1 step ①, Supplement §D default `max_stale_minutes=240 (UNIS Bravo batch)`

Before the demand snapshot freeze, SCP runs a **mandatory freshness gate**:

```python
# T-240 min before cutoff (19:00 for UNIS — 4h before 23:00):
freshness_check:
    wms_sync_age = now() - last_wms_sync_timestamp
    IF wms_sync_age > max_stale_minutes (UNIS=240):
        RAISE STALE_DATA → block plan run
        OR force_override=True → audit log + continue with warning
```

| Config | UNIS Value | SCP Default | Notes |
|--------|-----------|-------------|-------|
| `max_stale_minutes` | **`240`** (Bravo batch override) | `60` | UNIS: Bravo ERP batch sync mode — WMS data updated nightly, not real-time. 240 min threshold matches `UNISSupplyPlugin.freshness_threshold_minutes()` |
| `force_override_allowed` | `True` | `True` | Planner can bypass with audit log |
| Error code | `STALE_DATA` (HIGH) | — | Alert to SC_MANAGER + Planner |

> **Lý do 240 min (không phải 60):** UNIS dùng Bravo ERP batch mode — inventory sync chạy nightly, không real-time WMS. SCP default 60 min chỉ phù hợp cho MDLZ (real-time WMS). UNIS phải override lên 240 min.

**Action (BE):** Implement freshness gate check in planning cycle scheduler before Step 1 trigger.

**Gaps:**
- ✅ TerraX: Single file upload (sku + branches + patterns combined)
- ❌ SCP: Separate endpoints (forecast vs master data vs RTM rules)
- ❌ SCP: Freshness gate + PlanningCycle config not yet set for UNIS (23:00 nightly)
- ➡️ **Action:** Use TerraX `demand_mean` as proxy for UNIS forecast; configure PlanningCycle with `cutoff=23:00`

---

## Step 2: Supply Snapshot — Inventory Upload

### TerraX DRP Flow (data-flow.md §3)

```
POST /api/v1/inventory/upload (Excel + Idempotency-Key header)
  ↓
Columns: [sku_code, branch_code, color_code, quantity, inv_type]
  ↓
inv_type ∈ {OEM, DISTRIBUTION}
  ↓
idempotency_key = SHA256(sku:branch:color:date)
  ↓
INSERT inventory (skip if key exists)
```

**FR08 — OEM vs Distribution:**
- **OEM:** Tồn NM chính xác (UNIS đặt riêng)
- **DISTRIBUTION:** Tồn NM ước tính (NM sản xuất cho nhiều bên)

### SCP 8-Step Equivalent

```
POST /api/v1/supply/snapshot (Batch mode for UNIS)
  ↓
Columns: [location_id, item_id, qty_allocatable, qty_reserved, snapshot_date]
  ↓
Bucket types (SCP §11.10.2 — 4 buckets):
  - ALLOCATABLE   : available for allocation (OEM stock, confirmed DISTRIBUTION)
  - RESERVED      : channel-reserved / soft-committed (not available to other channels)
  - QUARANTINE    : quality hold / lot quarantined (excluded from allocation)
  - SOFT_RESERVED : pending allocation / reservation token held (TTL=5min)
  ↓
INSERT supply_snapshot { status=DRAFT }
  ↓
POST /supply/snapshots/{id}/freeze → status=FROZEN
```

**Mapping:**

| TerraX Field | SCP Equivalent | Notes |
|--------------|----------------|-------|
| `inv_type=OEM` | `bucket_type=ALLOCATABLE` | Available for allocation |
| `inv_type=DISTRIBUTION` | `bucket_type=ALLOCATABLE` + `is_estimated=true` | Track confidence level |
| *(quality hold)* | `bucket_type=QUARANTINE` | Excluded from allocation (e.g. defective NM batch) |
| *(pending allocation)* | `bucket_type=SOFT_RESERVED` | Reservation token held (TTL=5min) |
| `color_code` | `item_variant_id` (if VARIANT mode) | UNIS uses color/size variants |
| `branch_code=NM-*` | `location.type=WAREHOUSE` | Factory locations |
| `branch_code=CN-*` | `location.type=BRANCH` | Distribution branches |
| `idempotency_key` (SHA-256) | `snapshot_id` + `recorded_at` uniqueness | Same dedup concept |

**Gaps:**
- ✅ TerraX: Manual flag `is_factory_empty` (Planner marks NM out of stock)
- ✅ SCP: Freshness gate (60min threshold — see Step 1 Freshness Gate section)
- ❌ SCP: TerraX only uses 2 inv_type; SCP needs explicit 4-bucket classification for QUARANTINE/SOFT_RESERVED
- ➡️ **Action:** Add `is_estimated` + `bucket_type` fields to `supply_snapshot_line`; populate QUARANTINE from NM quality hold signals

---

## Step 3: Inventory Policy — Safety Stock + RTM Rules

### TerraX DRP Logic (business-rules.md §FR13)

**Safety Stock (Simplified):**
```python
safety_stock = 1.65 × demand_std × √(lead_days / 7)
```
- CSL = 90% **FIXED** (z-score 1.65 for ALL classes)
- Lead time: North factories 14 days, South 3 days (FR12 fallback)
- **No LT variability** (assumes reliable suppliers)
- **No ABC differentiation** (same z-score for all SKUs)
- **No variant dimension** (per SKU only, not per color)

**Pattern Ratios (data-flow.md §2):**
```
pattern_ratios table (append-only, versioned by effective_date)
  ↓
SELECT * WHERE effective_date <= today ORDER BY effective_date DESC LIMIT 1
  ↓
Used ONLY when creating Pull Order (FR14), NOT in DRP compute
```

### SCP 8-Step Equivalent

**Safety Stock (UNIS plugin — Full Formula):**
```python
# src/policy_engine/plugins/unis.py
"INVENTORY": {
    "ss_method": "STATISTICAL",  # Dynamic σ-based (NOT fixed days)
    "ss_csl_a": 0.975,  # 97.5% → z=1.96 (vs TerraX 90%)
    "ss_csl_b": 0.95,   # 95% → z=1.65
    "ss_csl_c": 0.90,   # 90% → z=1.28
}

# Full formula with LT variability (UNIS_Safety_Stock_Analysis.md §4.1):
SS = z × √(LT_avg × σ²_demand + ADU² × σ²_LT)

# Simplified (when σ_LT = 0):
SS = z × σ_demand × √(LT + Review_period)
```

**Example: GA-300 Đuôi A4 at CN Bình Dương (ref: UNIS_Safety_Stock_Analysis.md §4.2):**

| Parameter | Value | Source |
|-----------|-------|--------|
| Avg daily demand (ADU) | 90 m²/day | Rolling 90d actual sales |
| σ daily demand | 35 m²/day | CV = 0.39 (high variance) |
| Service level A-class | **97.5%** | UNIS plugin (vs doc 95%) |
| z-score | **1.96** | (vs doc 1.65) |
| Avg LT from NM Toko | 5 days | Historical PO tracking |
| σ LT (LT variability) | 2 days | NM unreliable (3-7d range) |
| Review period | 1 day | Nightly DRP cycle |

**Calculation:**
```python
SS = 1.96 × √(5 × 35² + 90² × 2²)
   = 1.96 × √(6,125 + 32,400)
   = 1.96 × √38,525
   = 1.96 × 196.3
   = 385 m²  # vs TerraX 324m² (z=1.65)
   = 4.3 days of supply
```

**⚠️ CRITICAL CONFLICT with Safety Stock Analysis Document:**
- **UNIS_Safety_Stock_Analysis.md:** Recommends CSL A=95% (z=1.65) → SS=324m²
- **UNIS PolicyPlugin (actual code):** Implements CSL A=97.5% (z=1.96) → SS=385m²
- **Impact:** Plugin 19% more conservative → higher inventory cost, lower stockout risk
- **Decision needed:** Keep 97.5% (safer) OR reduce to 95% (lower cost)?

**RTM Rules — Data Available via `Nơi kéo` Master ✅:**
```
[Masterdata] Nơi kéo - Sheet1.csv
  Fields: pull_source_code, factory_code, pull_source_area (MB=North / blank=South)
  ↓
Priority 1: factory where pull_source_area = branch_area (same region)
Priority 2: factory where pull_source_area = blank (national / South fallback)
  ↓
Item master (`pull_source_code` column) links each SKU to its pull source directly
  ↓
ETL → rtm_rule table: [item_id, source_location_id, dest_location_id, priority]
  ↓
Used in Step 5 Allocation to determine sourcing (73 pull source mappings available)
```
> **Note:** RTM rules are NOT implicit/missing — full 2-layer mapping: Item → pull_source_code → Nơi kéo (factory_code + region).

**Detailed Comparison:**

| Dimension | TerraX | UNIS Plugin | UNIS Doc (SS Analysis) | Status |
|-----------|--------|-------------|------------------------|--------|
| **Formula structure** | `z×σ×√LT` | `z×√(LT×σ²_d + ADU²×σ²_LT)` | Same as plugin | ✅ UNIS includes LT variance |
| **CSL A-class** | 90% (1.65) | **97.5% (1.96)** | 95% (1.65) | ⚠️ PLUGIN HIGHER than doc |
| **CSL B-class** | 90% (1.65) | **95% (1.65)** | 90% (1.28) | ⚠️ PLUGIN HIGHER than doc |
| **CSL C-class** | 90% (1.65) | 90% (1.28) | 85% (1.04) | ⚠️ PLUGIN HIGHER than doc |
| **LT variability** | ❌ NO | ✅ YES (σ_LT) | ✅ YES | ✅ UNIS accounts for unreliable NM |
| **Demand input** | `demand_std` from FC | Rolling 90d actual σ | Rolling 90d actual σ | ✅ UNIS variance-based |
| **Variant dimension** | ❌ NO (per SKU) | ✅ VARIANT mode | ✅ Per đuôi màu | 🔴 CRITICAL for color matching |
| **ABC differentiation** | ❌ NO (all 90%) | ✅ YES (3 tiers) | ✅ YES (3 tiers) | ✅ UNIS differentiates |
| **LCNB impact** | ❌ NO | ❌ DETECT_ONLY | ✅ EXECUTE (−25% SS) | 🔴 GAP: Savings NOT realized |
| **Pattern ratios** | ✅ Border/point (FR14) | ❌ NO EQUIVALENT | N/A | TerraX tiles ≠ UNIS materials |
| **RTM rules** | **Explicit** via `Nơi kéo` master (73 entries: pull_source_code → factory_code + area) | Explicit multi-priority | Explicit | ✅ **DATA EXISTS** — ETL to `rtm_rule` table |

**Per-Variant SS (UNIS_Safety_Stock_Analysis.md §4.4):**

| Variant (GA-300) | ADU | σ | CV | z (CSL) | LT | **SS (m²)** | **SS (days)** | Note |
|------------------|-----|---|----|---------|----|-------------|---------------|------|
| **A4 (primary)** | 90 | 35 | 0.39 | 1.96 (97.5%) | 5 | **385** | **4.3** | Main color variant |
| **B2 (secondary)** | 25 | 18 | 0.72 | 1.65 (95%) | 5 | **154** | **6.2** | Border tile |
| **C1 (premium)** | 12 | 10 | 0.83 | 1.28 (90%) | 5 | **87** | **7.3** | Premium finish |

**Key Insight:** Higher variance (CV) → more days of SS even with lower volume. Fixed DoS (e.g., 14d like MDLZ) would:
- **OVER-stock** A4: 14d × 90 = 1,260m² vs needed 385m² (3.3× excess)
- **UNDER-stock** C1: 14d × 12 = 168m² vs needed 87m² (OK but not optimal)

**LCNB Network Effect (UNIS_Safety_Stock_Analysis.md §4.5):**

```python
# When LCNB EXECUTE mode (document assumption):
Effective_SS_CN_BD = SS_local × (1 − LCNB_factor)
                   = 385 × (1 − 0.25)
                   = 289 m²  # 25% reduction due to risk pooling

# Current plugin (DETECT_ONLY mode):
Effective_SS_CN_BD = 385 m²  # No reduction — LCNB not executing transfers
```

**🔴 IMPLEMENTATION GAP:**
- **Document assumes:** LCNB EXECUTE mode → 15-20% network SS savings (§6 Phase 4)
- **Plugin current state:** LCNB DETECT_ONLY → NO SS reduction applied
- **Impact:** Missing ~96m² inventory reduction per CN × 4 CN = 384m² total network over-stock
- **Cost impact:** 384m² × avg_cost (~500k VND/m²) = **192M VND** tied up unnecessarily

**Gaps & Action Items:**

| # | Gap | TerraX | UNIS Status | Action | Priority |
|---|-----|--------|-------------|--------|----------|
| 1 | **CSL Level Decision** | 90% all | Plugin 97.5%/95%/90% vs Doc 95%/90%/85% | BA verify acceptable inventory cost (+19-29%) | 🔴 P0 |
| 2 | **LCNB Mode** | N/A | DETECT_ONLY vs Doc EXECUTE | Roadmap Phase 4 enable EXECUTE | ⚠️ P1 |
| 3 | **Pattern logic** | Border/point consolidation | N/A (materials ≠ tiles) | Ignore TerraX pattern, use ABC | ✅ DONE |
| 4 | **LT variability tracking** | NO | Formula ready, σ_LT needs data | Implement NM lead time variance tracking | ⚠️ P1 |
| 5 | **Variant SS calculation** | NO | Plugin VARIANT mode ✅ | Verify per-color SS in DRP output | ⚠️ P1 |

---

## Step 4: DRP Netting — Core Algorithm

### TerraX DRP Engine (system-flows.md §8)

**13-Week Rolling Horizon:**

```python
# Celery async task
for week in range(0, 13):
    forecast_demand = sku.demand_mean
    safety_stock = 1.65 × demand_std × √(lead_days/7)
    net_demand = max(0, forecast + safety - begin_stock)
    hstk = begin_stock / forecast  # 99 if forecast=0
    
    if hstk < 1.5:
        action = "PULL"  # 🔴 STOCKOUT
        suggested_qty = net_demand
    elif 1.5 <= hstk <= 3.0:
        action = "OK"  # 🟡 Normal
        suggested_qty = 0
    else:
        action = "OVERSTOCK"  # 🟢 Excess
        suggested_qty = 0
    
    # Lookback for planned receipts
    if week >= lead_time_weeks:
        planned_receipt = results[week - lead_time_weeks].suggested_qty
    else:
        planned_receipt = 0
    
    end_stock = begin_stock - forecast + planned_receipt
```

### SCP 8-Step Equivalent

**DRP Netting (UNIS plugin):**

```python
# src/drp_engine/plugins/unis.py
# Horizon: 12 weeks (vs TerraX 13 weeks)
# Lot sizing: L4L (Lot-for-Lot, no MOQ)
# Planning mode: PUSH (not PULL like TerraX)

for period in range(0, 12):
    gross_req = demand_forecast[period]
    on_hand = pab[period-1] if period > 0 else initial_inventory
    net_req = max(0, gross_req + safety_stock - on_hand)
    
    planned_order = net_req  # L4L sizing
    pab[period] = on_hand - gross_req + planned_order
```

**Mapping:**

| TerraX Logic | SCP Logic | Match? |
|--------------|-----------|--------|
| 13-week horizon | 12-week horizon | ⚠️ Off by 1 week |
| `action=PULL` (hstk < 1.5) | `net_req > 0` | ✅ Equivalent trigger |
| `suggested_qty = net_demand` | `planned_order = net_req` | ✅ Same output |
| Planned receipt lookback | Planned order release (lead time offset) | ✅ Same concept |
| Safety stock in net calc | Safety stock in net calc | ✅ Same |
| `hstk` threshold display | PAB (Projected Available Balance) | ⚠️ Different KPI |

**Gaps:**
- ✅ TerraX: HSTK-based alerts (< 1.5 weeks = critical)
- ❌ SCP: Exception-based (net_req > 0 = shortage)
- ➡️ **Action:** Keep SCP DRP logic. Add HSTK as **monitoring metric** in Step 8 (not Step 4 output).

---

## Step 5: Allocation — Pull Order Creation

### TerraX Pull Order Flow (system-flows.md §5B, business-rules.md §FR14-FR17)

**Pattern Consolidation (FR14):**
```
IF sku.pattern_role = 'main':
    border_qty = round(main_qty × ratio.border_qty / ratio.main_qty)
    point_qty = round(main_qty × ratio.point_qty / ratio.main_qty)
    auto-add border + point SKUs to Pull Order
```

**CN Stock Offset (FR15):**
```
net_pull_qty = max(0, drp_suggested_qty - cn_distribution_stock)
```

**Color Priority (FR16):**
```
1. Prefer color_code present at dest CN
2. Fallback: latest color at source NM (recorded_at DESC)
```

**Container Constraint (FR17):**
```
total_weight = Σ(item.qty × sku.weight_kg)
IF total_weight > 28,000 kg:
    RAISE 400 "Exceeds container limit"
```

### RTM Rules — Data Already Exists in Master ✅

> **Corrected:** RTM rules are NOT missing. They exist explicitly as a **2-layer mapping** in the master data.

**Layer 1 — Item master (`[Masterdata] Item - Sheet1.csv`):**

Each SKU has a `pull_source_code` column that directly names its pull source (e.g., `PAK`, `TOKO - HUNG YEN`, `MIKADO - DONG NAI`). This links each item to its designated NM supplier.

**Layer 2 — `Nơi kéo` master (`[Masterdata] Nơi kéo - Sheet1.csv`):**

| Column | Field | Example | Description |
|--------|-------|---------|-------------|
| `pull_source_code` | Pull source name | `TOKO - HUNG YEN` | Name of supplier/factory |
| `factory_code` | Factory numeric ID | `39` | FK to location table |
| `pull_source_area` | Region | `MB` | `MB`=Miền Bắc (North); blank=South/Other |

**Sample mappings (73 entries):**
```
PAK               → factory_code=01, area=blank  (national)
TOKO - HUNG YEN   → factory_code=39, area=MB     (North primary)
MIKADO - DONG NAI → factory_code=29 + 47, area=blank  (South, multi-factory)
VITTO - VINH PHUC → factory_code=00,03,04,08,10, area=MB  (multi-factory North)
```

**RTM Priority logic (derived from data):**
```
Priority 1: pull_source_area matches branch_area (same region preferred)
Priority 2: pull_source_area = blank (national supplier — any region)
Priority 3: multi-factory supplier → latest factory_code (or lowest factory_code)
```

**ETL: `Nơi kéo` + Item → SCP `rtm_rule` table:**

| Source Field | SCP `rtm_rule` Field | Transformation |
|--------------|---------------------|----------------|
| Item.`pull_source_code` | `item_id` FK filter | Item-level source constraint |
| Nơi kéo.`factory_code` | `source_location_id` | FK to `location` table |
| Nơi kéo.`pull_source_area = MB` | `priority = 1` | North region preferred |
| Nơi kéo.`pull_source_area = blank` | `priority = 2` | National / South fallback |

**Action (DE):** ETL pipeline: Item master + Nơi kéo CSV → `rtm_rule` table. **Data is complete and ready.** ✅

### SCP 8-Step Equivalent

**Allocation Engine (UNIS plugin):**

```python
# SCP §11.6.2 — 6 pluggable constraint evaluators (Allocation Orchestrator):

# Layer 1: Source Selection / RTM Engine
#   → Lookup rtm_rule: pull_source_code → factory_code + priority (Nơi kéo + Item master)
#   → UNIS: Priority 1 = same-region NM (pull_source_area=MB for North branches)
#   → UNIS: Priority 2 = national supplier (pull_source_area=blank)
#   → Failure: NO_SOURCE_AVAILABLE → escalate to planner

# Layer 2: Quality / Variant Match  ← SCP §11.6.1 "UNIS: Variant/color matching"
#   → For UNIS: FEFO check DISABLED (no expiry on ceramic tiles)
#   → For UNIS: color_tail (đuôi màu) match ENABLED
#       Prefer color_code present at dest CN (FR16 Priority 1)
#       Fallback: latest color at source NM (recorded_at DESC, FR16 Priority 2)
#   → NOT SpecsID matching (TTC-specific)

# Layer 3: FEFO + Shelf-Life (DISABLED for UNIS)
#   → fefo_policy.enabled = False (tiles have no expiry date)
#   → Pass-through for UNIS

# Layer 4: Quantity + ABC Priority (Classification Engine)
#   → Fair-share weighted by ABC class (A > B > C)
#   → Shortage → SHORTAGE exception

# Layer 5: Safety Stock Guard
#   → Verify remaining stock ≥ SS threshold (CSL A=97.5%, B=95%, C=90%)
#   → Do NOT allocate below SS → SS_BREACH warning

# Layer 6: Lateral Transfer / LCNB Gate
#   → UNIS default: DETECT_ONLY (SCP-BUILDING template, Supplement §D)
#   → Scan sibling CN excess → create recommendation only (no draft TO)
#   → Only escalate to EXECUTE mode after Gate C sign-off (Supplement §I.3)
#   → Failure: LATERAL_EXHAUSTED → create PO to NM factory

# Output: allocation_result { allocated, partial, exception }
```

### Branch Channel Isolation Logic 🆕

**Critical finding from `Branch` master (`[Masterdata] Branch - Sheet1.csv`):**

One physical warehouse (`warehouseid`) serves **multiple sales channels** simultaneously:

| `warehouseid` | Channels at same physical warehouse |
|---------------|-------------------------------------|
| `HUBR00001` | UNIS, UNIMAX, UNICHEMI |
| `HUBR00002` | UNIS, UNIMAX, UNICHEMI, UNILUX |
| `HUBR00005` | UNIS, UNIMAX, UNILUX, UNICHEMI |
| `HUBR00020` | UNIS (×2), UNIMAX (×3), UNICHEMI, UNILUX + LOTINA |

**Observed channels:** `UNIS`, `UNIMAX`, `UNILUX`, `UNICHEMI`, `LOTINA`

**Additional finding — Item master also has `branch_channel`:**
The Item master (`branch_channel` column) specifies which channel each SKU is deployed to. This provides **item-level channel constraint** on top of branch-level channel constraint.

**Isolation Rule — allocation MUST be channel-scoped:**
```python
# WRONG (SCP default — location only):
allocate WHERE supply_snapshot.location_id = branch.warehouseid

# CORRECT (UNIS requirement):
allocate WHERE supply_snapshot.location_id = branch.warehouseid
          AND supply_snapshot.channel_code = demand.channel_code   # channel isolation
          AND supply_snapshot.corporation_id = demand.corporation_id  # UNIS=000, LOTINA=222
```

**Why critical:** Without channel isolation, UNIS-channel stock could fill UNIMAX demand at the same warehouse → cross-channel P&L contamination and incorrect order attribution.

**LOTINA entity isolation (`branch_corporation = 222`):**
- LOTINA = **separate legal entity** (CÔNG TY TNHH LOTINA)
- Branches `093`, `111`, `222`, `065`, `076`, `081` are LOTINA-owned
- Must be **strictly isolated** from UNIS (corporation=000) allocations at all times
- SCP implementation: `corporation_id` scope in JWT claims + allocation engine filter

**Implementation gap — fields to add:**
```sql
-- Add to supply_snapshot_line:
channel_code    VARCHAR(20)  -- e.g., 'UNIS', 'UNIMAX', 'LOTINA'
corporation_id  VARCHAR(10)  -- '000'=UNIS, '222'=LOTINA

-- Allocation filter (unis.py plugin):
def get_supply_filter(demand_line):
    return {
        "channel_code": demand_line.channel_code,
        "corporation_id": demand_line.corporation_id
    }
```

**Status:** Data exists (`branch_channel` in Branch + Item master) ✅ | Enforcement in allocation engine ❌ NOT IMPLEMENTED

### Unit of Measure (UOM) Conversion 🆕

**UOM hierarchy already in Item master (`[Masterdata] Item - Sheet1.csv`):**

| Column | Field | Example (25×40 tile) | Meaning |
|--------|-------|----------------------|---------|
| `masterunit` | Base unit | `VIEN` | Single piece (viên) |
| `uom_level2` | Pack unit | `HOP` | Box (hộp) |
| `quantity_exchange_level2` | Pieces/box | `10` | 10 VIEN per HOP |
| `uom_level3` | Pallet unit | `PALLET` | Pallet |
| `uom_level4` | Area unit | `M2` | Square meter |
| `quantity_exchange_level4` | Pieces/m² | `10` | 10 VIEN per m² (25×40 = 0.01 m²/piece) |
| `gross_weight` | Weight/piece | `0` | ⚠️ Often 0 — needs fix |

**UOM conversion chain:**
```
Demand (m²)
    ÷ (1 / quantity_exchange_level4)  →  demand in VIEN
    ÷ quantity_exchange_level2        →  demand in HOP (box)
    × gross_weight                    →  weight in kg (for FR17 container check)
```

**Example (GA-300, 25×40, demand=100 m²):**
```python
demand_vien  = 100 × 10 = 1,000 VIEN
demand_box   = 1,000 / 10 = 100 HOP
weight_kg    = 1,000 × gross_weight  # ← gross_weight currently 0 for many items
```

**Short-term workaround (while gross_weight is missing):**
```python
# Use TerraX sku.weight_kg (weight per m²) as proxy:
container_weight_kg = Σ(allocation_qty_m2 × sku.weight_kg)  # Same as FR17 formula
```

**Data gap:**
- UOM structure (`VIEN/HOP/M2` + conversion factors) ✅ **EXISTS** in Item master
- `gross_weight` ❌ **mostly 0** — needs population from factory/ERP
- **Action:** Validate `gross_weight` with factory specs; use `weight_kg` from TerraX as interim

### Item Lifecycle Filter 🆕

**Lifecycle status already in Item master (`status` column):**

Observed values in `[Masterdata] Item - Sheet1.csv`:

| `status` value | Example | Meaning | SCP `item_lifecycle_status` | Allocation behavior |
|----------------|---------|---------|----------------------------|---------------------|
| `END-YYYY` | `END-2020` | Discontinued in year YYYY | `INACTIVE` | Skip — no DRP, no allocation |
| `ACTIVE` | `ACTIVE` | Currently sold | `ACTIVE` | Full DRP + allocation |
| _(inferred)_ | — | Being phased out | `PHASEOUT` | Drain stock only; no new Pull Orders |
| _(inferred)_ | — | New launch | `LAUNCH` | Allocate with `min_launch_qty` |

**Additional column `branch_status`:** per-branch lifecycle override (e.g., item ACTIVE globally but `END-2020` at specific branch).

**Filter applied before DRP Netting (Step 4) and Allocation (Step 5):**
```python
eligible_items = items.filter(
    lifecycle_status__in=['ACTIVE', 'LAUNCH'],
    exclude(lifecycle_status='INACTIVE'),              # END items → skip
    exclude(lifecycle_status='PHASEOUT', stock_on_hand=0)  # PHASEOUT → drain existing only
)
```

**ETL mapping:**
```python
# Map TerraX/Bravo status → SCP lifecycle:
status_map = {
    r"^END-\d{4}$": "INACTIVE",   # END-2020, END-2021, etc.
    "ACTIVE":        "ACTIVE",
    "PHASEOUT":      "PHASEOUT",
    "LAUNCH":        "LAUNCH",
    None:            "ACTIVE",    # Default for existing items without status
}
```

**Status:** Data exists (`status` + `branch_status` in Item master) ✅ | ETL mapping + filter enforcement ❌ NOT IMPLEMENTED

### RBAC Role Mapping Table 🆕

| TerraX Role | TerraX Permission | SCP JWT Role | SCP Permission | Status |
|-------------|------------------|--------------|----------------|--------|
| `admin` | All ops, all branches | `ADMIN` | Full access + tenant config | ✅ 1:1 |
| `cn_head` | Approve/reject Pull Orders (own CN only) | `CN_WH` | Approve transfer orders (location-scoped) | ✅ MATCHED |
| `planner` (TCU/VPT) | Create DRP, view all CNs, bulk approve | `SC_MANAGER` | DRP trigger, view all branches, bulk approve | ⚠️ FR32 bulk approve pending |
| `viewer` | Read-only dashboard | `ANALYST` | Dashboard + KPI reports only | ✅ OK |
| — | N/A in TerraX | `FORECAST_EDITOR` | Upload demand forecast snapshots | ❌ New role (no TerraX equiv.) |
| — | N/A in TerraX | `DATA_MANAGER` | Upload master data + inventory | ❌ New role (no TerraX equiv.) |

**Scoping rules:**

| Role | Scope Level | Constraint |
|------|-------------|------------|
| `CN_WH` | **Location-scoped** | Only approve orders where `dest_branch_id = user.branch_id` |
| `SC_MANAGER` | **Tenant-scoped** | View + approve across all branches in tenant |
| `ADMIN` | **Super** | Override + impersonate |
| `ANALYST` | **Tenant read-only** | No mutations allowed |

**LOTINA JWT extension:**
```json
{
    "role": "CN_WH",
    "tenant_id": "00000000-0000-0000-0000-000000000003",
    "branch_id": "093",
    "corporation_id": "222"
}
```
LOTINA users (`corporation_id=222`) **cannot see** UNIS branches (`corporation_id=000`) and vice versa.

**Pending (FR32):** `SC_MANAGER` bulk approve endpoint not yet in SCP. Required for TCU/VPT planner workflow matching TerraX `POST /orders/pull/bulk-approve`.

### Mapping Table (Updated)

| TerraX Concept | SCP Equivalent | Notes |
|----------------|----------------|-------|
| Pull Order (NM → CN) | Transfer Order (Warehouse → Branch) | ✅ Same document type |
| `suggested_qty` from DRP | `demand_snapshot_line.qty` | ✅ Input source |
| CN stock offset | Allocation Layer 5 (split if needed) | ⚠️ Different logic |
| Pattern consolidation | **NO EQUIVALENT** | ❌ UNIS doesn't use tile patterns |
| Color priority (`color_code`) | VARIANT matching (`specs_id_mode=VARIANT`) | ✅ `color_tail` = variant key |
| Container weight limit | Transport Step 6 (28T limit) | ✅ Moved to Step 6 |
| **`pull_source_code` + Nơi kéo** | `rtm_rule.source_location_id` | **✅ DATA EXISTS — ETL from 2-layer master** |
| **`branch_channel` (Branch + Item master)** | `channel_code` (add to `supply_snapshot_line`) | **🆕 DATA EXISTS — enforcement needed** |
| **`status` column (Item master)** | `item_lifecycle_status` | **✅ DATA EXISTS — ETL mapping needed** |
| **CN role / planner role** | `CN_WH` / `SC_MANAGER` JWT roles | **✅ RBAC mapped; FR32 pending** |

### Gaps (Updated)

| # | Gap | Data Status | Implementation Status | Action | Priority |
|---|-----|------------|----------------------|--------|----------|
| 1 | **RTM Rules** | ✅ Nơi kéo CSV + Item.pull_source_code | ❌ Not ETL'd yet | DE: ETL → `rtm_rule` table | 🔴 P0 |
| 2 | **Branch channel isolation** | ✅ `branch_channel` in Branch + Item master | ❌ Not enforced in allocator | Add `channel_code` filter to allocation engine (unis.py) | 🔴 P0 |
| 3 | **LOTINA entity isolation** | ✅ `branch_corporation=222` in Branch master | ❌ Not scoped in SCP JWT | Add `corporation_id` to JWT claims + allocation filter | 🔴 P0 |
| 4 | **UOM `gross_weight`** | ⚠️ UOM structure exists; `gross_weight` mostly 0 | ⚠️ Interim: use TerraX `weight_kg` | Validate + populate `gross_weight` from factory specs | ⚠️ P1 |
| 5 | **Item lifecycle filter** | ✅ `status` + `branch_status` in Item master | ❌ ETL mapping + filter not implemented | Map `END-YYYY` → INACTIVE; add filter before DRP | ⚠️ P1 |
| 6 | **RBAC bulk approve (FR32)** | N/A | ❌ No SCP equivalent | Implement `POST /orders/bulk-approve` for `SC_MANAGER` | ⚠️ P1 |
| 7 | **Multi-echelon allocation** | N/A | ✅ SCP supports natively | No action needed | ✅ OK |

---

## Step 6: Transport Planning — Container Bin-Pack

### TerraX Container Logic (business-rules.md §FR17)

```
Greedy bin-pack algorithm:
  containers = []
  current_container = { items: [], weight: 0 }
  
  for item in pull_order_items:
      item_weight = item.qty × sku.weight_kg
      if current_container.weight + item_weight <= 28000:
          current_container.items.append(item)
          current_container.weight += item_weight
      else:
          containers.append(current_container)
          current_container = { items: [item], weight: item_weight }
  
  containers.append(current_container)
  MIN 1 container per Pull Order
```

### SCP 8-Step Equivalent

**Transport Planning (UNIS plugin):**

```python
# SE1: Bin-packing (OR-Tools CP-SAT)
# SE2: Carrier selection (BEST_SLA for UNIS)
# SE3: Consolidation (DISABLED for UNIS — no multi-stop)

# Vehicle constraints:
vehicle_frame = {"FLATBED": 28000, "CRANE": 30000}  # kg capacity
```

**Mapping:**

| TerraX Logic | SCP Logic | Match? |
|--------------|-----------|--------|
| 28,000 kg container limit | `vehicle_capacity=28000` kg | ✅ Same |
| Greedy bin-pack | OR-Tools FFD (First Fit Decreasing) | ✅ Similar |
| Min 1 container | Min 1 trip | ✅ Same constraint |
| No route optimization | No consolidation (UNIS plugin) | ✅ Same |

**Gaps:**
- ✅ TerraX: Weight-only constraint (no volume, no pallet count)
- ✅ SCP: Weight + volume + pallet (more sophisticated)
- ➡️ **Action:** Use SCP transport planning. Set `consolidation_mode=NONE` for UNIS.

---

## Step 7: Execution Bridge — Approval Flow

### TerraX Approval State Machine (system-flows.md §5A)

```
draft → pending_cn → pending_tcu → approved
    ↓           ↓            ↓
  (skip)    rejected     rejected (FINAL)
```

**FR30: CN Block Rule (Hard)**
- Pull Order CANNOT skip `pending_cn` stage
- No timeout bypass, no escalation
- CN rejection = ABSOLUTE (cannot undo)

**FR28: CN Approve/Reject**
```
POST /orders/pull/{id}/approve-cn → status=pending_tcu
POST /orders/pull/{id}/reject → status=rejected (requires reject_reason)
```

**FR29: CN Adjust Qty Before Approving**
```
PATCH /orders/pull/{id}/items/{item_id}
  { adjusted_qty, adjustment_reason }
```

**FR32: TCU Bulk Approve**
```
POST /orders/pull/bulk-approve
  { order_ids: [uuid, ...] }
```

### SCP 8-Step Equivalent

**Execution Bridge (UNIS plugin):**

```python
# 14-state machine (UNIS = subset 5 states)
DRAFT → PENDING_APPROVAL → APPROVED → POSTING → CONFIRMED

# UNIS approval_chain (from unis.py):
approval_chain = ["CN_WH"]  # CN approval required (ALL orders)
approval_role = "CN_WH"     # JWT role for CN branch approvers

# Post-approval edit — per SCP v3.6 §11.8.2 + Supplement §F:
# Edit IS allowed but triggers re-approval workflow
post_approval_edit_allowed = True
require_re_approval_after_edit = True  # edit → status resets to PENDING_APPROVAL
adjustment_logged_to = "AdjustmentReport"  # SCP §9.4 first-class object for UNIS
```

**Mapping:**

| TerraX State | SCP State | Match? |
|--------------|-----------|--------|
| `draft` | `DRAFT` | ✅ Same |
| `pending_cn` | `PENDING_APPROVAL` (role=CN_WH) | ✅ Same |
| `pending_tcu` | **SKIP** (UNIS = single approval) | ❌ TerraX has 2-tier |
| `approved` | `APPROVED` | ✅ Same |
| `rejected` (FINAL) | `CANCELLED` | ✅ Same concept |

**FR mapping:**

| TerraX FR | SCP Equivalent | Status |
|-----------|----------------|--------|
| FR30 (CN block) | `requires_approval(order_type) = True` | ✅ Enforced |
| FR28 (approve/reject) | `POST /orders/{id}/approve`, `POST /orders/{id}/reject` | ✅ Exists |
| FR29 (CN adjust qty) | `post_approval_edit_allowed=True, require_re_approval=True` | ✅ **RESOLVED** — SCP v3.6 §11.8.2 |
| FR32 (bulk approve) | **NO EQUIVALENT** | ❌ Implement if needed |

**Gaps:**
- ✅ TerraX: CN can adjust qty BEFORE approving (FR29)
- ✅ SCP UNIS: Edit IS allowed — triggers re-approval (SCP v3.6 §11.8.2; Supplement §F all roles = re-approval)
- ❌ SCP UNIS: `AdjustmentReport` object (SCP §9.4, UNIS-specific) not yet implemented
- ❌ SCP UNIS: `ERP posting = Bravo` integration not yet configured
- ➡️ **Action (BE):** Set `post_approval_edit_allowed=True, require_re_approval=True`; implement `AdjustmentReport` + Bravo ERP posting

### AdjustmentReport Object (UNIS) 🆕

**Source:** SCP §9.4 — first-class object for UNIS (audit record for edit after approval)

```python
# AdjustmentReport (immutable append-only):
adjustment_report = {
    "order_id": "uuid",
    "item_id": "SKU-GA300",
    "branch_id": "CN-BDG",
    "actor_id": "user.cn_head",
    "actor_role": "CN_WH",
    "before_qty": 500,        # suggested_qty from DRP
    "after_qty": 420,         # adjusted by CN head
    "adjustment_reason": "Kho đầy, giảm sản lượng",
    "adjusted_at": "2026-04-13T08:30:00+07:00",
    "re_approval_required": True,
    "re_approved_by": None,   # NULL until SC_MANAGER re-approves
    "re_approved_at": None
}
```

**Mapping to TerraX FR39 Adjustment Report:**

| TerraX Field | SCP `AdjustmentReport` Field | Match? |
|--------------|------------------------------|--------|
| `suggested_qty` | `before_qty` | ✅ Same |
| `adjusted_qty` | `after_qty` | ✅ Same |
| `adjustment_reason` | `adjustment_reason` | ✅ Same |
| *(implicit)* | `actor_role`, `re_approval_required` | 🆕 Extended |
| `audit_log` entry | `AdjustmentReport` + `audit_log` entry | ✅ Double-logged |

**KPI mapping:** `AdjustmentReport` feeds Step 8 TRUST group: `override_rate = count(adjusted) / count(total_orders)`

### Mobile Masking (UNIS) 🆕

**Source:** SCP v3.6 §15.4, §10.8, Supplement §F

**Rule:** Branch (CN) roles are restricted from seeing sensitive NM data:

| Field | SC_MANAGER | PLANNER | CN_WH (Branch) | ANALYST |
|-------|-----------|---------|----------------|--------|
| Allocation result (own branch) | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| NM stock levels (`supply_snapshot` at NM) | ✅ | ✅ | ❌ **masked** | ❌ |
| NM price / contract value | ✅ | ✅ | ❌ **masked** | ❌ |
| Other branch stock | ✅ | ✅ | ❌ **masked** | ❌ |
| LCNB lateral transfer excess (other CN) | ✅ | ✅ | ❌ **masked** | ❌ |

**Supplement §F explicit row:** `View NM stock/price (UNIS) | ✅ | ✅ | ❌ (masked) | ✅ | ✅ | —`

**Implementation:**
```python
# Mobile masking policy (SCP §10.8):
mobile_masking_policy = {
    "default_deny": True,   # Supplement §D: mask all if config missing
    "role_field_visibility": {
        "CN_WH": {
            "supply_snapshot.qty": "MASK if location.type=WAREHOUSE",  # hide NM stock
            "supply_snapshot.cost": "MASK always",  # hide prices
            "supply_snapshot.location_id": "MASK if branch_id != user.branch_id"
        },
        "SC_MANAGER": "FULL",
        "PLANNER": "FULL",
        "ANALYST": "READ_ONLY_TENANT"
    }
}
```

**Deep links:** PO/Transfer/Pull Order deep links must use signed tokens with TTL + audit (SCP §15.4).

**Status:** Data exists (RBAC roles mapped) ✅ | Mobile masking policy enforcement ❌ NOT IMPLEMENTED

### Bravo ERP Posting 🆕

**Source:** SCP v3.6 §11.8.2 ("UNIS: Push to Bravo"), Supplement §G

**UNIS ERP target = Bravo** (not SAP or Oracle)

| SCP Draft Order Field | Bravo Field | Notes |
|-----------------------|-------------|-------|
| `order_type` | `MA_LOAI_CHUNG_TU` | TO = transfer order |
| `item_id` | `MA_HANG` | Item code |
| `source_location` | `MA_KHO_XUAT` | Source warehouse |
| `dest_location` | `MA_KHO_NHAP` | Destination warehouse |
| `qty` | `SO_LUONG` | Quantity |
| `unit` | `DON_VI_TINH` | UOM |
| `required_date` | `NGAY_GIAO` | Delivery date |
| `lot_id` | `MA_LO` | Lot/batch code |
| `idempotency_key` | `GHI_CHU_1` | Dedup key |

**Error handling (Supplement §G.2):**
```python
bravo_posting = {
    "timeout": "8s per call",
    "retry": "3 retries, exponential (1s, 4s, 16s)",
    "reversal": "HUY_CHUNG_TU API",
    "failure_state": "MANUAL_POSTING alert"
}
```

**Status:** Bravo integration not yet configured for UNIS tenant ❌ **Action (BE):** Register Bravo adapter in ERP integration hub

---

## Step 8: Monitor & Learn — KPI Dashboard

### TerraX KPI & Alerts (business-rules.md §FR34-FR39)

**FR34: STOCKOUT Alert**
```
drp_results.action = "PULL" (hstk < 1.5)
  ↓
GET /drp/result/{id}/summary → stockout_count
  ↓
Frontend: "🔴 X rủi ro" badge
```

**FR35: OVERSTOCK Alert**
```
drp_results.action = "OVERSTOCK" (hstk > 3.0)
  ↓
Alert threshold: > 3.0 weeks (NOT 4.0 — corrected)
```

**FR38: KPI Dashboard**
```
GET /api/v1/kpi/summary
  {
    avg_hstk,
    stockout_rate_pct,
    order_count,
    approval_sla_pct
  }
```

**FR39: Adjustment Report**
```
GET /api/v1/kpi/adjustment-report
  Compare: suggested_qty vs adjusted_qty per SKU × branch
  Metrics: diff, diff_pct
```

**FR44: Audit Log**
```
audit_log table (append-only)
  { actor_id, timestamp, module, action, entity_id, before_value, after_value, reason }
```

### SCP 8-Step Equivalent

**Monitor Service:**

```python
# Drift detection (weekly batch):
# - MAPE (weighted, COVID 2020-2022 @ 0.3)
# - Bias (3-week consecutive > 10%)
# - PSI (threshold 0.15)

# KPI aggregation (7 outcome groups):
# - SERVICE: fill rate, stockout days
# - WORKING_CAPITAL: inventory turns, avg value
# - TRUST: override rate, adoption %
# - DECISION_SPEED: cycle time, approval SLA
# - AI_VALUE: forecast MAPE, labor savings
# - SUSTAINABILITY: CO2 savings, green carrier %
# - DATA_QUALITY: completeness, accuracy

# FC→SS loop:
# σ_fc_error change > 5% → Policy Engine SS recalc → DRP re-run
```

**Mapping:**

| TerraX KPI | SCP KPI Group | Match? |
|------------|---------------|--------|
| `avg_hstk` | SERVICE group: `stockout_days` | ⚠️ Different metric |
| `stockout_rate_pct` | SERVICE: `fill_rate` (inverse) | ✅ Equivalent |
| `order_count` | DECISION_SPEED: `cycle_time` | ⚠️ Partial |
| `approval_sla_pct` | DECISION_SPEED: `approval_time` | ✅ Same |
| Adjustment report | TRUST: `override_rate` | ✅ Same concept |
| Audit log | Audit log + `decision_lineage` | ✅ Same |

**Gaps:**
- ✅ TerraX: Simple 4 KPIs
- ❌ SCP: 7 outcome groups (35+ metrics)
- ➡️ **Action:** Use SCP Monitor Service. Map TerraX HSTK to `stockout_days` metric.

---

## Data Model Comparison

### TerraX DRP Tables (data-flow.md §7)

```
users (id, username, role, branch_id)
sku (id, sku_code, demand_mean, demand_std, pattern_group, weight_kg)
branches (id, code, type, region, lead_days)
pattern_ratios (id, pattern_group, main_sku_id, border_qty, point_qty, effective_date)
inventory (id, sku_id, branch_id, quantity, inv_type, color_code, idempotency_key)
drp_jobs (id, status, triggered_by, started_at, completed_at)
drp_results (id, job_id, sku_id, branch_id, week, hstk, action, suggested_qty)
pull_orders (id, status, source_factory_id, dest_branch_id, drp_job_id)
pull_order_items (id, order_id, sku_id, color_code, suggested_qty, adjusted_qty)
purchase_orders (id, status, factory_id)
audit_log (id, actor_id, module, action, entity_id, before_value, after_value)
```

### SCP 8-Step Tables (Equivalent)

```
users → user (tenant-scoped)
sku → item (+ item_classification for ABC)
branches → location (type=WAREHOUSE|BRANCH)
pattern_ratios → NO EQUIVALENT (UNIS doesn't use)
inventory → supply_snapshot + supply_snapshot_line (bucket_type=ALLOCATABLE|RESERVED)
drp_jobs → drp_run (+ drp_plan_line for results)
drp_results → drp_plan_line (PAB, net_req, planned_order)
pull_orders → draft_order (order_type=TRANSFER)
pull_order_items → draft_order_line
purchase_orders → draft_order (order_type=PURCHASE — soft commitment)
audit_log → audit_log (same structure)
```

**Key Differences:**

| Aspect | TerraX DRP | SCP 8-Step |
|--------|------------|------------|
| Multi-tenancy | Single tenant (UNIS only) | Multi-tenant (tenant_id FK everywhere) |
| SKU master | Simple (sku table) | Complex (item + item_variant + item_classification) |
| Inventory buckets | 2 types (OEM, DISTRIBUTION) | 6 buckets (ALLOCATABLE, RESERVED, IN_TRANSIT, etc.) |
| DRP output | `hstk` + `action` | PAB + `net_req` + `planned_order` |
| Order types | Pull Order vs PO (2 separate) | draft_order (order_type enum) |
| Pattern logic | Core feature (tiles) | N/A (UNIS = building materials) |

---

## Implementation Recommendations

### Priority 1: DIRECT Mapping (Use TerraX as-is)

| Step | Action | Owner |
|------|--------|-------|
| Step 4 | Copy TerraX `compute_sku_branch()` algorithm → UNIS DRP plugin | BE |
| Step 7 | Adapt TerraX approval state machine → UNIS execution plugin | BE |
| Step 7 | Register Bravo ERP adapter (field mapping: `MA_HANG`, `SO_LUONG`, `HUY_CHUNG_TU`, etc.) | BE |
| Step 8 | Map TerraX `hstk` KPI → SCP `stockout_days` metric | DA |

### Priority 2: ADAPTED Mapping (Merge concepts)

| Step | Action | Owner |
|------|--------|-------|
| Step 1 | Configure `PlanningCycle` object: `cutoff=23:00`, `frequency=NIGHTLY`, `timezone=Asia/Ho_Chi_Minh` | BE |
| Step 1 | Implement freshness gate (T-240 min pre-check (UNIS), `max_stale_minutes=240 (UNIS Bravo batch)`) | BE |
| Step 1 | Use `drp_export_dec25_q1_2026.csv` columns: `qty_sold_12m_avg` → `demand_mean` | DE |
| Step 2 | Add `is_estimated` + `bucket_type` (ALLOCATABLE/RESERVED/QUARANTINE/SOFT_RESERVED) to `supply_snapshot_line` | BE |
| Step 3 | Compute SS with UNIS CSL (0.975/0.95/0.90) instead of TerraX 90% | DA |
| Step 5 | ETL `Nơi kéo` + Item master → `rtm_rule` table | DE |
| Step 5 | Add `channel_code` + `corporation_id` isolation to allocation engine (unis.py) | BE |
| Step 5 | Map `status=END-YYYY` → `INACTIVE` lifecycle filter before DRP | DE + BE |

### Priority 3: GAPS to Fill

| Gap | TerraX Has | SCP Needs | Action |
|-----|------------|-----------|--------|
| Idempotency key | SHA-256(sku:branch:color:date) | `upload_id` + `snapshot_id` | Use snapshot_id as key |
| Freshness gate | Manual `is_factory_empty` flag | `max_stale_minutes=240 (UNIS Bravo batch)` auto-check | Implement freshness gate at T-240 min before cutoff (UNIS Bravo) |
| Bulk approve (FR32) | FR32 endpoint | NO EQUIVALENT | Implement `POST /orders/bulk-approve` for `SC_MANAGER` |
| Pre-approval edit | FR29 (CN adjust qty) | ~~Strict 403~~ | **RESOLVED —** SCP v3.6: edit + re-approve + AdjustmentReport |
| **SS CSL levels** | 90% fixed | Plugin 97.5%/95%/90% vs Doc 95%/90%/85% | **BA DECISION: Accept +19% inventory cost?** |
| **LCNB execution** | N/A | DETECT_ONLY (no SS reduction) | Roadmap Phase 4 → EXECUTE mode |
| **LT variability tracking** | NO | σ_LT per NM needed | Implement NM lead time variance tracking |
| **HSTK monitoring** | Manual calculation | Auto-compute + alerts | Add to Step 8 dashboard |
| **Branch channel isolation** | N/A (single channel) | `channel_code` scope in allocator | Add `channel_code` to `supply_snapshot_line`; enforce in unis.py |
| **LOTINA entity isolation** | N/A | `corporation_id` in JWT + filter | Add `corporation_id` claim; block cross-corporation allocation |
| **UOM `gross_weight`** | TerraX `weight_kg` (per m²) | `gross_weight` per piece (often 0) | Populate from factory specs; use TerraX `weight_kg` as interim |
| **Item lifecycle filter** | No lifecycle field in `sku` | `item_lifecycle_status` ETL + filter | Map `END-YYYY` → INACTIVE; apply before DRP netting |
| **PlanningCycle config** | `drp_jobs` triggered manually | `PlanningCycle` object (cutoff=23:00, nightly) | Configure FR-v3-016 for UNIS tenant |
| **Freshness gate** | Manual check | `max_stale_minutes=240 (UNIS Bravo batch)` + STALE_DATA error | Add pre-cutoff gate (T-240 min for UNIS) in planning scheduler |
| **Mobile Masking (CN role)** | N/A | CN cannot see NM stock/price | Implement `mobile_masking_policy` + field-level masking in API |
| **AdjustmentReport object** | `audit_log` (implicit) | `AdjustmentReport` first-class (SCP §9.4) | Create AdjustmentReport table; link to approval workflow |
| **Bravo ERP integration** | Manual posting / CSV | `erp_target=BRAVO` + field mapping | Register Bravo adapter; map `MA_HANG/SO_LUONG/HUY_CHUNG_TU` |
| **4-bucket inventory model** | 2 types (OEM, DISTRIBUTION) | ALLOCATABLE/RESERVED/QUARANTINE/SOFT_RESERVED | Add `bucket_type` to `supply_snapshot_line` schema |

---

## Migration Checklist

### Data Preparation (DE + DA)

- [ ] Extract `demand_mean` from `drp_export_dec25_q1_2026.csv` → map to `forecast_qty`
- [ ] Extract `demand_std` → compute `confidence_lower` / `confidence_upper`
- [ ] Map `pattern_group` → `item_variant_id` (if applicable)
- [ ] Classify inventory: NM OEM → `ALLOCATABLE`, NM DISTRIBUTION → `ALLOCATABLE` + `is_estimated=true`
- [ ] Compute ABC classification from `qty_sold_12m_avg` (proxy)
- [ ] **Step 5 — RTM ETL:** Load `Nơi kéo` CSV + Item.`pull_source_code` → `rtm_rule` table (source_location_id + priority)
- [ ] **Step 5 — Lifecycle ETL:** Map Item.`status` (`END-YYYY` → INACTIVE, ACTIVE, etc.) → `item_lifecycle_status` field
- [ ] **Step 5 — UOM validation:** Validate `gross_weight` > 0 per item; flag items with missing weight for factory confirmation
- [ ] **Step 5 — Channel ETL:** Populate `channel_code` + `corporation_id` from Branch master into `supply_snapshot_line`

### Backend Implementation (BE)

- [ ] UNIS DRP plugin: Adapt TerraX 13-week → SCP 12-week horizon
- [ ] UNIS PolicyPlugin: Fix horizon mismatch (set to 12 weeks)
- [ ] UNIS Execution plugin: Set `approval_chain=["CN_WH"]`, `post_approval_edit_allowed=True`, `require_re_approval_after_edit=True`
- [ ] Implement `AdjustmentReport` table + append-only write on every post-approval edit
- [ ] Add `is_estimated` + `bucket_type` to `supply_snapshot_line` (4 buckets)
- [ ] Configure `PlanningCycle`: `cutoff=23:00 ICT`, `frequency=NIGHTLY`, `horizon=12 weeks`
- [ ] Implement freshness gate check (T-240 min before cutoff (UNIS Bravo); `max_stale_minutes=240 (UNIS Bravo batch)`)
- [ ] Implement `mobile_masking_policy` for CN_WH role (hide NM stock, prices, other branches)
- [ ] Register Bravo ERP adapter: field mapping (`MA_HANG` → `item_id`, etc.) + `HUY_CHUNG_TU` reversal API
- [ ] **DECISION 1:** CSL levels - Keep 97.5%/95%/90% (plugin) OR change to 95%/90%/85% (doc)?
- [ ] **DECISION 2 (CLOSED):** Post-approval edit → re-approve required (SCP v3.6 §11.8.2) ✅
- [ ] **DECISION 3:** LCNB mode - Keep DETECT_ONLY (Phase 1) OR enable EXECUTE (Phase 4)?
- [ ] Implement per-variant SS calculation (verify VARIANT mode outputs correctly)
- [ ] Add LT variability (σ_LT) tracking infrastructure per NM supplier
- [ ] **Step 5 — Channel isolation:** Add `channel_code` + `corporation_id` fields to `supply_snapshot_line` schema
- [ ] **Step 5 — Allocation filter:** Implement channel + corporation scope in `unis.py` `get_supply_filter()`
- [ ] **Step 5 — LOTINA JWT:** Add `corporation_id` claim to JWT; enforce in allocation and approval routes
- [ ] **Step 5 — Lifecycle filter:** Add pre-DRP filter: exclude INACTIVE items; suppress new orders for PHASEOUT items
- [ ] **Step 5 — FR32:** Implement `POST /orders/bulk-approve` endpoint for `SC_MANAGER` role
- [ ] **Step 5 — RBAC:** Add `FORECAST_EDITOR` and `DATA_MANAGER` roles to SCP RBAC config for UNIS

### Frontend Adjustments (FE)

- [ ] Map TerraX "STOCKOUT" badge → SCP exception-first UI
- [ ] Display `is_estimated` badge for DISTRIBUTION inventory
- [ ] Build inline edit UI for CN approvers (edit-after-approval → triggers re-approval badge)
- [ ] Apply field-level masking for CN_WH role: hide NM stock columns, price columns, other-branch allocation
- [ ] Multi-UOM display: show demand in m² (sales) and VIEN/HOP (order quantities) per SCP §15.4
- [ ] Deep link tokens for PO/Transfer: signed token + TTL + audit trail (SCP §15.4)

### Testing (QA)

- [ ] TC-01: DRP netting with TerraX `hstk` logic → verify PAB output matches
- [ ] TC-02: CN approval workflow (role=CN_WH) → verify no 403 errors
- [ ] TC-03: Variant matching (color/size) → verify correct allocation
- [ ] TC-04: DISTRIBUTION inventory flag → verify UI badge display
- [ ] **TC-05: Safety Stock calculation** → verify CSL A=97.5% produces SS=385m² (vs doc 324m²)
- [ ] **TC-06: Per-variant SS** → verify GA-300-A4 vs GA-300-B2 have different SS values
- [ ] **TC-07: LT variability impact** → simulate NM delay 5d→12d, verify SS increases
- [ ] **TC-08: LCNB detection** → verify system detects excess/shortage but doesn't auto-transfer
- [ ] **TC-09: HSTK monitoring** → verify alerts when HSTK < SS_days threshold
- [ ] **TC-10: Channel isolation** → verify UNIS demand cannot consume UNIMAX stock at same `warehouseid`
- [ ] **TC-11: LOTINA isolation** → verify `corporation_id=222` user cannot see/approve UNIS (000) orders
- [ ] **TC-12: Lifecycle filter** → verify `END-2020` items are excluded from DRP netting output
- [ ] **TC-13: UOM conversion** → verify 100 m² demand = 1,000 VIEN = 100 HOP; container weight ≤ 28T
- [ ] **TC-14: RTM priority** → verify MB-area branch routes to MB factory first (pull_source_area=MB)
- [ ] **TC-15: Freshness gate** → simulate WMS sync lag > 240 min (UNIS threshold); verify STALE_DATA blocks plan run
- [ ] **TC-16: Post-approval edit** → CN_WH edits order qty after approval; verify status resets to PENDING_APPROVAL and AdjustmentReport created
- [ ] **TC-17: Mobile masking** → CN_WH user calls `/supply/snapshot`; verify NM location qty = null/masked
- [ ] **TC-18: Bravo posting** → approved TO sent to Bravo; verify `MA_HANG`, `SO_LUONG` mapped correctly; verify idempotent on retry
- [ ] **TC-19: 4-bucket isolation** → verify QUARANTINE stock not allocated; SOFT_RESERVED auto-releases after TTL=5min

---

## Glossary

| TerraX Term | SCP Equivalent | Definition |
|-------------|----------------|------------|
| **HSTK** (Holding Stock) | `projected_weeks` or `stockout_days` | Weeks of inventory on hand (begin_stock / forecast_demand) |
| **Pull Order** | Transfer Order (TO) | NM → CN material movement |
| **Purchase Order (PO)** | Soft commitment | Signal to factory (not legal obligation) |
| **Pattern Group** | Variant family | Grouping of related SKUs (TerraX tiles, SCP color/size) |
| **OEM Inventory** | Dedicated stock | Accurate qty (UNIS-owned production) |
| **DISTRIBUTION Inventory** | Shared stock | Estimated qty (multi-customer production) |
| **CN Head** | Branch approver | Role: `CN_WH` in SCP |
| **TCU / VPT Head** | Planner supervisor | Role: `PLANNER` or `SC_MANAGER` in SCP |
| **CSL (Customer Service Level)** | Safety factor | Probability of no stockout (97.5% = z-score 1.96) |
| **σ_demand** | Demand variance | Standard deviation of daily demand (rolling 90d) |
| **σ_LT** | Lead time variance | Standard deviation of supplier lead time variability |
| **ADU (Average Daily Usage)** | Daily demand | Mean daily sales (rolling 90d) |
| **CV (Coefficient of Variation)** | Demand volatility | σ / μ ratio (higher = lumpier demand) |
| **LCNB Factor** | Pooling discount | SS reduction % due to lateral transfer capability (0.25 = 25%) |
| **Đuôi màu** | Color variant | Ceramic tile color batch code (A4, B2, C1) — color matching required |
| **branch_channel** | Sales channel | One of UNIS/UNIMAX/UNILUX/UNICHEMI/LOTINA — must be isolated in allocation |
| **corporation_id** | Legal entity ID | `000`=UNIS HQ; `222`=LOTINA (separate entity, strictly isolated) |
| **Nơi kéo** | Pull source master | Factory/supplier source table; maps `pull_source_code` → `factory_code` + region (= RTM rules) |
| **UOM (Unit of Measure)** | Measurement unit | m² (sales demand) → VIEN (piece) → HOP (box) conversion chain |
| **item_lifecycle_status** | Item state | ACTIVE / PHASEOUT / INACTIVE / LAUNCH — controls allocation eligibility |
| **RTM (Route to Market)** | Source routing rule | Maps destination CN → source NM with priority; derived from Nơi kéo + Item master |
| **VIEN / HOP / PALLET** | Piece / Box / Pallet | Physical packaging units; VIEN=1 tile, HOP=10 VIEN, PALLET=variable |

---

*UNIS-TERRAX-MAPPING.md v1.3 — Updated 2026-04-13*

**Sources:**
- TerraX DRP documentation (data-flow.md, business-rules.md, system-flows.md)
- SCP 8-step pipeline architecture
- **UNIS_Safety_Stock_Analysis.md** (Safety Stock deep-dive, CSL analysis, LCNB impact)
- UNIS plugin implementations (policy_engine, drp_engine, allocation_engine, execution_bridge)
- **UNIS Master Data CSVs:** Branch, Item, Nơi kéo, Warehouse (2026-04-13 review)

**Change Log:**
- v1.0 (2026-04-12): Initial mapping TerraX → SCP 8-step
- v1.1 (2026-04-12): Added Safety Stock analysis findings, CSL conflicts, LCNB gaps, per-variant SS calculations
- v1.2 (2026-04-13): Step 5 major update — RTM rules corrected (Nơi kéo + Item.pull_source_code = data exists); added Branch Channel Isolation, UOM Conversion, Item Lifecycle Filter, RBAC Role Mapping; updated Step 3 RTM note, expanded gaps + checklist + glossary
- v1.3 (2026-04-13): Cross-check vs SCP Master v3.6 + Supplement — Fixed 8 gaps: (1) post_approval_edit corrected to re-approve (not 403) per SCP §11.8.2; (2) AdjustmentReport object added (Step 7); (3) Mobile Masking added (Step 7, UNIS-specific §15.4); (4) Bravo ERP field mapping added (Step 7); (5) PlanningCycle config added (Step 1, FR-v3-016); (6) Freshness Gate added (Step 1, Supplement §B.1); (7) Allocation 6-layer names corrected to SCP §11.6.2; (8) 4-bucket inventory model added (Step 2)
