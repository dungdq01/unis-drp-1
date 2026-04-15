# UNIS Tenant — Data & Execution Package

**Tenant:** UNIS (Công Ty Cổ Phần Tập Đoàn UNIS — Vật liệu xây dựng)
**UUID:** `c0000000-0000-0000-0000-000000000003`
**ERP:** Bravo (SFTP batch CSV)
**Approval:** CN_WH — ALL orders require branch approval, no auto-pass
**Status:** CONDITIONAL GO — UAT ready với synthetic inventory

---

## Folder Layout

```
unis/
│
├── 📊 RAW DATA (from UNIS)
│   ├── [Masterdata] Item - Sheet1.csv          14,935 SKUs (filter → 2,412 eligible)
│   ├── [Masterdata] Branch - Sheet1.csv        73 chi nhánh (filter → 68 valid)
│   ├── [Masterdata] Warehouse - Sheet1.csv     18 kho hub
│   ├── [Masterdata] Nơi kéo - Sheet1.csv       72 pull sources (dedup → 56)
│   ├── Forecast_30032026.csv                   1,660 FSKUs × 4 months (aggregate)
│   ├── drp_export_dec25_q1_2026.csv            84,764 rows (69 CN × 1,582 FSKUs)
│   └── [Template] *.csv                        Templates (chờ UNIS IT điền real data)
│
├── 📁 output/                     TRANSFORMED DATA (seed format, ready for backend)
│   ├── items.csv                  2,412 items
│   ├── locations.csv              143 locations
│   ├── suppliers.csv              56 suppliers
│   ├── rtm_rules.csv              108,028 RTM rules (A cascade + B P1)
│   ├── lot_attributes.csv         11,424 synthetic lots (UAT)
│   └── pipeline/                  Pipeline step CSV outputs (runtime)
│
├── 📋 report/                     ANALYSIS & STATUS REPORTS
│   ├── README.md                  Report index + key numbers
│   ├── 01-DATA-ANALYSIS.md        Data quality, gaps, structure
│   ├── 02-IMPLEMENTATION.md       Scripts, transforms, API mapping
│   ├── 03-UAT-READINESS.md        Readiness matrix, blockers, verdict
│   ├── 04-FE-HOTFIX.md            21 FE issues fixed
│   ├── 05-REVIEW-TRACKER.md       3 rounds, 21 issues resolved
│   └── 06-PHASE2-PIPELINE.md      Endpoints, CSV output, compliance
│
├── 📖 PLANS & SPECS
│   ├── UNIS-MASTER-PLAN.md        8-step checklist (~80 tasks, reviewed 3 rounds)
│   ├── UNIS-UAT-ROADMAP.md        7 test cases (TC-01→TC-07)
│   ├── UNIS-DATA-LOADING-GUIDE.md DE/DA technical guide
│   └── docs-require.md            10 questions for UNIS BA/IT
│
└── 📚 REFERENCE (from TerraX DRP project)
    ├── business-rules.md           44 FRs — UNIS DRP business rules
    ├── data-flow.md                Data flow architecture
    └── system-flows.md             System architecture + flows
```

---

## Quick Start

```bash
# 1. Transform UNIS raw CSV → seed format + install into backend
python phase0/scripts/transform_unis_to_seeds.py --install

# 2. Load into PostgreSQL
python phase0/scripts/seed_tenant.py --tenant unis --source seed

# 3. Validate all gates
python phase0/scripts/validate_unis_gates.py

# 4. Test full pipeline (dry-run)
python phase0/scripts/test_unis_api_flow.py --dry-run

# 5. Test full pipeline (live against running server)
python phase0/scripts/test_unis_api_flow.py --base-url http://localhost:8000/api/v1 --token <JWT>
```

---

## UNIS-Specific Config (Plugin Settings)

| Setting | Value | Why |
|---|---|---|
| FEFO | **OFF** | Building materials — no expiry |
| Specs matching | **VARIANT** | Color/size matching (tile variants) |
| LCNB | **DETECT_ONLY** | Scan siblings, recommend only (no auto-transfer) |
| ABC weights | A:2.0 / B:1.5 / C:1.0 | A overridden, B/C inherit defaults |
| Lot sizing | **L4L** (Lot-for-Lot) | Exact qty, no FOQ/POQ |
| BOM explosion | **OFF** | Not applicable for building materials |
| Horizon | **12 weeks** | |
| Freshness | **240 min** | BATCH sync mode |
| Carrier | **BEST_SLA** | |
| Consolidation | **OFF** | Per-project delivery |
| ERP | **Bravo SFTP** | CSV batch upload |
| Approval | **CN_WH — ALL orders** | No auto-pass, no post-approval edit |
| Drift threshold | **20%** | Higher than default 15% (building materials more volatile) |
| PO overdue | **10 days** | Longer than default 7 days |

---

## Key Discovery

**FSKU = `item_code`, NOT `bravo_sku`**

Forecast team dùng `item_code` (mã cơ sở, VD: `05.L1.3060.KAG36900`).
Item master `bravo_sku` có suffix variant (VD: `05.L1.3060.KAG36900.I`).
Match rate: 42% (bravo_sku) → **100% (item_code)**.

---

## Blocking Items

| # | What | Who | Status |
|---|---|---|---|
| 1 | Branch inventory (73 CN × active SKUs) | UNIS IT | ⏳ Pending |
| 2 | Factory inventory | UNIS IT | ⏳ Pending |
| 3 | Bravo SFTP credentials (UAT) | UNIS IT + OPS | ⏳ Pending |
| ~~4~~ | ~~CN_WH accounts~~ | — | ✅ **Done** (3 accounts: HCM/MT-TNG/TNB) |

**Workaround:** Synthetic lots (11,424) cho UAT. Replace khi có real inventory.

---

*Created: 2026-04-12 | Smartlog AI Division | PRJ-SCP-001*
