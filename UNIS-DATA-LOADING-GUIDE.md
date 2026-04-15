# UNIS Data Loading Guide — Excel to Database

**Purpose**: Load UNIS masterdata + transactional data từ Excel vào PostgreSQL  
**Target**: R-DE, R-DA, R-BE  
**Status**: 🟡 Implementation in progress  
**Blocking**: P1, P5, P6 in UNIS-UAT-ROADMAP.md  
**Created**: 2026-04-12

---

## I. Folder Structure

```
phase0/data/unis/
├── masterdata/                              # ONE-TIME LOAD
│   ├── items.xlsx                           # Hàng hóa
│   ├── locations.xlsx                       # Chi nhánh + Kho + Nhà máy + Nơi kéo (merged)
│   ├── suppliers.xlsx                       # Nhà cung cấp
│   ├── rtm_rules.xlsx                       # RTM mapping (P5 — BLOCKING)
│   └── abc_classes.xlsx                     # ABC classification (P6 — BLOCKING)
│
└── transactional/                           # DAILY/WEEKLY LOAD
    ├── inventory_snapshot_20260412.xlsx     # Tồn kho
    └── sales_history_20260412.xlsx          # Bán hàng
```

**Naming**: Transactional files use `{type}_{YYYYMMDD}.xlsx` format.

---

## II. Excel Templates (Required Columns)

### A. Masterdata

#### 1. `items.xlsx`
```
item_id | item_name | category | uom | variant_id | abc_class | lead_time_days | min_order_qty
```
**Mandatory**: `item_id`, `item_name`, `category`, `uom`, `variant_id`  
**UNIS-specific**: `variant_id` required for color/size matching

#### 2. `locations.xlsx` (Merged: plants + warehouses + branches + pull_points)
```
location_id | location_name | location_type | address | region | capacity_m3
```
**Mandatory**: `location_id`, `location_name`, `location_type`  
**Types**: `PLANT`, `WAREHOUSE`, `BRANCH`, `PULL_POINT`

#### 3. `rtm_rules.xlsx` (P5 — CRITICAL)
```
customer_id | item_id | priority | source_location_id
```
**All columns mandatory**. Priority must be sequential (1, 2, 3...) per (customer, item).

#### 4. `abc_classes.xlsx` (P6 — CRITICAL)
```
item_id | abc_class
```
**Both columns mandatory**. `abc_class` must be A/B/C.

### B. Transactional

#### 5. `inventory_snapshot_YYYYMMDD.xlsx`
```
item_id | location_id | on_hand_qty | in_transit_qty | bucket | lot_id | production_date
```
**Mandatory**: `item_id`, `location_id`, `on_hand_qty`, `bucket`  
**Buckets**: `ALLOCATABLE`, `QUARANTINE`, `RESERVED`, `DAMAGED`

#### 6. `sales_history_YYYYMMDD.xlsx`
```
item_id | customer_id | location_id | period | qty_sold | revenue_vnd
```
**Mandatory**: `item_id`, `customer_id`, `period`, `qty_sold`

---

## III. Loading Scripts

### A. Masterdata Load (One-time)

**Script**: `phase0/scripts/load_unis_masterdata.py`

```bash
# Dry-run (preview only)
python phase0/scripts/load_unis_masterdata.py --dry-run

# Execute
python phase0/scripts/load_unis_masterdata.py

# Single entity
python phase0/scripts/load_unis_masterdata.py --entity rtm_rules
```

### B. Transactional Load (Daily/Weekly)

**Script**: `phase0/scripts/load_unis_snapshot.py`

```bash
# Load inventory for 2026-04-12
python phase0/scripts/load_unis_snapshot.py --date 20260412 --type inventory

# Load sales
python phase0/scripts/load_unis_snapshot.py --date 20260412 --type sales

# Load both
python phase0/scripts/load_unis_snapshot.py --date 20260412 --type all
```

---

## IV. Validation Rules (Auto-checked by scripts)

### Items
- ❌ No duplicate `item_id`
- ❌ No NULL in required columns
- ✅ `abc_class` in {A, B, C}
- ✅ `lead_time_days` >= 0

### Locations
- ❌ No duplicate `location_id`
- ✅ `location_type` in {PLANT, WAREHOUSE, BRANCH, PULL_POINT}

### RTM Rules (CRITICAL)
- ❌ No duplicate (customer_id, item_id, priority)
- ✅ Priority sequential (1, 2, 3...) per (customer, item)
- ✅ `source_location_id` must exist in locations

### ABC Classes (CRITICAL)
- ❌ No duplicate `item_id`
- ✅ `abc_class` in {A, B, C}

### Inventory Snapshot
- ✅ `on_hand_qty` >= 0
- ✅ `bucket` in {ALLOCATABLE, QUARANTINE, RESERVED, DAMAGED}
- ✅ `production_date` <= snapshot_date

### Sales History
- ✅ `qty_sold` >= 0
- ✅ `period` <= snapshot_date

---

## V. Implementation Tasks (DE — 3 days)

### Phase 1: Setup (0.5 day)
- [ ] Create subfolders `masterdata/` and `transactional/`
- [ ] Extend `SeedDataAdapter` to support Excel (.xlsx)
- [ ] Install: `pip install openpyxl`

### Phase 2: Masterdata Scripts (1 day)
- [ ] Create `load_unis_masterdata.py`
- [ ] Create `validators/unis_validator.py`
- [ ] Create `adapters/unis_adapter.py`
- [ ] Test with dummy data

### Phase 3: Transactional Scripts (1 day)
- [ ] Create `load_unis_snapshot.py`
- [ ] Add inventory/sales validators
- [ ] Test end-to-end

### Phase 4: Documentation (0.5 day)
- [ ] Document workflow for UNIS team
- [ ] Create Excel templates
- [ ] QA verification checklist

---

## VI. Workflow — Step-by-Step

### A. One-Time Masterdata Load (Before UAT)

1. **UNIS**: Prepare Excel files → place in `masterdata/`
2. **R-DE**: Dry-run → `python load_unis_masterdata.py --dry-run`
3. **R-DE**: Fix validation errors with UNIS
4. **R-DE**: Execute → `python load_unis_masterdata.py`
5. **R-QA**: Verify row counts in DB
6. **Gate**: P1, P5, P6 → ✅

### B. Daily/Weekly Transactional Load

1. **UNIS**: Export inventory + sales → place in `transactional/`
2. **R-DE**: Load → `python load_unis_snapshot.py --date YYYYMMDD --type all`
3. **R-DE**: Trigger DRP run via API
4. **Monitor**: Check Kafka events

---

## VII. Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| "Missing column: variant_id" | Excel missing column | Add `variant_id` column (UNIS requirement) |
| "Duplicate item_id" | Duplicate SKUs | Remove duplicates |
| "Invalid bucket: IN_STOCK" | Wrong bucket name | Map to `ALLOCATABLE` |
| "RTM priority not sequential: [1, 3, 5]" | Gaps in priority | Re-number: 1, 2, 3 |
| "Future production_date" | Data quality | Fix date values |

---

## VIII. Verification Checklist (R-QA)

After load, verify:

```sql
-- Row counts
SELECT COUNT(*) FROM item WHERE tenant_id = '00000000-0000-0000-0000-000000000003';
SELECT COUNT(*) FROM location WHERE tenant_id = '00000000-0000-0000-0000-000000000003';
SELECT COUNT(*) FROM rtm_rule WHERE tenant_id = '00000000-0000-0000-0000-000000000003';

-- ABC distribution
SELECT abc_class, COUNT(*) FROM item_abc_class 
WHERE tenant_id = '00000000-0000-0000-0000-000000000003'
GROUP BY abc_class;

-- RTM cascade depth
SELECT customer_id, item_id, MAX(priority) as cascade_depth
FROM rtm_rule 
WHERE tenant_id = '00000000-0000-0000-0000-000000000003'
GROUP BY customer_id, item_id
ORDER BY cascade_depth DESC
LIMIT 10;

-- Inventory buckets
SELECT bucket, COUNT(*), SUM(on_hand_qty) 
FROM supply_snapshot_line
WHERE tenant_id = '00000000-0000-0000-0000-000000000003'
GROUP BY bucket;
```

---

## IX. Feasibility Assessment

**Score**: 8.5/10

**Pros**:
- ✅ Align với existing adapter pattern
- ✅ Simple, safe, audit trail clear
- ✅ Fast to implement (3 days)

**Cons**:
- ⚠️ Manual process (no UI)
- ⚠️ Validation critical

**Recommendation**: Implement immediately for UAT. Add UI automation in Sprint 9+ if needed.

---

## Related Documents

- `UNIS-UAT-ROADMAP.md` — UAT test cases, timeline, risks
- `../phase0/data/unis/` — Data files (CSV/Excel)

---

**Next Action**: DE implement scripts → UNIS prepare Excel → dry-run → load → verify → UAT Day 1 ready.
