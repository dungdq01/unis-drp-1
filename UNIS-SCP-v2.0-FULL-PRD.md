# UNIS SCP v2.0 — Full PRD (All Modules)

**Source:** UNIS_SCP_v2.0_Interactive.html + UNIS_PRD_v3.7.md
**Generated:** 2026-04-14
**Cấu trúc:** 2 Flow chính + 15 Module Steps + 1 Foundation

---

## Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                      DASHBOARD                               │
│   KPIs: NM committed | PO released | Hub ảo avail | Exceptions │
└─────────────┬───────────────────────────────┬───────────────┘
              │                               │
   ┌──────────▼──────────┐         ┌──────────▼──────────┐
   │  FLOW 1              │         │  FLOW 2              │
   │  Production Booking  │         │  Daily DRP           │
   │  (Monthly, Day 1-7)  │ ──────► │  (Nightly, 23:00)    │
   │                      │ Hub ảo  │                      │
   │  7 Bước              │ output  │  8 Bước              │
   └──────────────────────┘         └──────────────────────┘
```

---

## Mục lục

- [F0 — Master Data (Foundation)](#f0--master-data)
- **Flow 1: Production Booking (Monthly)**
  - [F1-B1 — Demand Aggregation](#f1-b1--demand-aggregation)
  - [F1-B2 — S&OP Consensus](#f1-b2--sop-consensus)
  - [F1-B3 — Production Lot Sizing](#f1-b3--production-lot-sizing)
  - [F1-B4 — FC Commitment 3 Tầng](#f1-b4--fc-commitment-3-tầng)
  - [F1-B5 — NM Confirm / Negotiate](#f1-b5--nm-confirm--negotiate)
  - [F1-B6 — Hub ảo Update](#f1-b6--hub-ảo-update)
  - [F1-B7 — Commitment Gap & Scenario Simulator](#f1-b7--commitment-gap--scenario-simulator)
- **Flow 2: Daily DRP (Nightly 23:00)**
  - [F2-B1 — Data Sync](#f2-b1--data-sync)
  - [F2-B2 — CN Demand Adjustment](#f2-b2--cn-demand-adjustment)
  - [F2-B3 — DRP Netting + Safety Stock CN](#f2-b3--drp-netting--safety-stock-cn)
  - [F2-B4 — Allocation](#f2-b4--allocation)
  - [F2-B5 — Transport Lot Sizing](#f2-b5--transport-lot-sizing)
  - [F2-B6 — NM ATP Check](#f2-b6--nm-atp-check)
  - [F2-B7 — PO Review & Confirm](#f2-b7--po-review--confirm)
  - [F2-B8 — Feedback & Closed Loop](#f2-b8--feedback--closed-loop)
- [Cross-Flow Dependency](#cross-flow-dependency)
- [Build Sequence](#build-sequence)
- [FR Traceability: PRD v3.7 → Module PRD](#fr-traceability)

---

## Data Flow tổng quan

**Flow 1:**
```
B1 Demand → B2 S&OP lock → B3 MOQ round → B4 Commitment tiers
  → B5 NM confirm → B6 Hub ảo update → B7 Gap monitor
                                  │
                                  ▼
                         Flow 2 DRP input
```

**Flow 2:**
```
B1 Data sync → B2 CN adjust → B3 DRP netting (23:00)
  → B4 Allocation → B5 Transport → B6 ATP check
    → B7 PO release + tracking + POD → B8 Feedback → (loop)
                                              │
                                              ▼
                                     Flow 1 next month
```

---
---

# F0 — Master Data

**Foundation Module**
**Version:** 1.0 | **Updated:** 2026-04-14 | **Status:** Draft
**Owner:** Smartlog Product & Technology Team

---

## F0.1. Overview

Master Data là **nền tảng cho toàn bộ hệ thống DRP**. Tất cả 15 modules (Flow 1 + Flow 2) phụ thuộc vào Master Data. Module này định nghĩa tất cả entities, mappings, và config cần thiết.

**Phân loại Master Data:**

| Loại | Mô tả | Ví dụ |
|------|-------|-------|
| **Core Entities** | Đối tượng nghiệp vụ chính | SKU, CN, NM, Customer, Hub, User |
| **Mappings** | Quan hệ giữa entities | SKU → NM, SKU variant → SKU base, Hub → CN cluster |
| **Operational Parameters** | Thông số vận hành per entity | MOQ, Lead Time, Transit LT, Price tiers |
| **Config & Thresholds** | Cấu hình hệ thống configurable | Tolerance %, z-factor, cutoff time, alert thresholds |

---

## F0.2. Core Entities

### 2.1 SKU (Mã hàng)

| Field group | Fields | Notes |
|-------------|--------|-------|
| **SKU base (không đuôi)** | Mã SKU, tên, đơn vị tính, nhóm sản phẩm | GA-300, GA-400... Dùng cho: FC, booking (F1-B3), netting (F2-B3), PO (F2-B7) |
| **SKU variant (có đuôi)** | Mã variant, đuôi màu/grade | GA-300-A4, GA-300-B2, GA-300-C1... Dùng cho: tồn kho CN, allocation (F2-B4) |
| **SKU variant → base mapping** | Variant thuộc base nào | GA-300-A4 → GA-300. **Bắt buộc khai báo** |
| **SKU → NM mapping** | SKU base sản xuất ở NM nào | GA-300 → Mikado. **1 SKU = 1 NM (single-source). Bắt buộc** |

**Business Rules:**
- Khi khai báo SKU mới → bắt buộc: NM (nhà máy sản xuất), ít nhất 1 variant
- Khi khai báo variant mới → bắt buộc: thuộc SKU base nào
- Không tồn tại SKU base mà không có NM
- Không tồn tại variant mà không thuộc SKU base

### 2.2 CN (Chi nhánh)

| Field group | Fields | Notes |
|-------------|--------|-------|
| **Định danh** | Mã CN, tên, khu vực | CN-BD, CN-ĐN, CN-HN, CN-CT... |
| **Vị trí** | Tọa độ / địa chỉ | Dùng cho: LCNB distance (F2-B4), route planning (F2-B5) |
| **Nhân sự** | CN Manager, Sales per CN | Dùng cho: RBAC (F1-B2, F2-B2) |
| **Kết nối** | Chất lượng kết nối (tốt/trung bình/yếu) | Dùng cho: offline mode planning (Phase 2) |

### 2.3 NM (Nhà máy / Supplier)

| Field group | Fields | Notes |
|-------------|--------|-------|
| **Định danh** | Mã NM, tên, liên hệ | Mikado, Toko, Phú Mỹ... |
| **Năng lực** | Capacity monthly, production cycle | Dùng cho: booking (F1-B3) |
| **MOQ per SKU** | Minimum order quantity per NM × SKU base | Dùng cho: F1-B3 MOQ check. **Per cặp NM-SKU** |
| **Lead Time** | LT trung bình (ngày), σ_LT | Dùng cho: SS Hub formula (F1-B3), SS CN (F2-B3) |
| **Giá** | Price tier 1, Price tier 2 | Dùng cho: gap scenario (F1-B7) |
| **Performance** | NM honoring rate, relationship score | Cập nhật từ F2-B8 feedback. Dùng cho: F2-B6 ATP warning |

### 2.4 Hub

| Field group | Fields | Notes |
|-------------|--------|-------|
| **Định danh** | Mã Hub, tên, loại (virtual / physical) | Phase 1: virtual. Sau này: physical |
| **Hub → CN cluster** | Hub phục vụ nhóm CN nào | Hub HCM → [CN-BD, CN-CT, CN-ĐN]... |
| **Hub → NM assignment** | NM nào cung cấp cho Hub | Hub HCM → [Mikado, Toko, Phú Mỹ] |

### 2.5 Customer (Khách hàng)

| Field group | Fields | Notes |
|-------------|--------|-------|
| **Định danh** | Mã KH, tên, liên hệ | Dùng cho: B2B pipeline (F1-B1) |
| **CN gắn** | Khách hàng thuộc CN nào | Dùng cho: B2B deal per CN |

### 2.6 User / Role

| Field group | Fields | Notes |
|-------------|--------|-------|
| **User** | Tên, CN gắn, role | Dùng cho: RBAC toàn hệ thống |
| **Roles** | Planner, SC Manager, CN Manager, Sales per CN, Finance, NM user | Quyền xem/edit/approve khác nhau per module |

---

## F0.3. Mappings & Routes

### 3.1 Transit Lead Time

| Route type | Fields | Dùng cho |
|------------|--------|----------|
| **NM → CN** | Transit LT (ngày), σ_LT per cặp NM×CN | F2-B5 hold-or-ship, F2-B7 ETA, F1-B3 SS Hub |
| **CN → CN (LCNB)** | Transit LT (ngày) per cặp CN×CN | F2-B4 LCNB distance, F2-B5 LCNB transport |

**Auto-update:** F2-B8 feedback cập nhật transit LT rolling average từ actual PO/TO data. Alert khi actual LT khác config > 30%.

### 3.2 Route Definitions

| Field | Notes |
|-------|-------|
| Tuyến (route) | Nhóm CN cùng tuyến (cùng hướng). Dùng cho: F2-B5 multi-drop consolidation |
| CN per tuyến | CN-BD + CN-CT = tuyến Nam. CN-HN = tuyến Bắc... |

### 3.3 LCNB Distance

| Field | Notes |
|-------|-------|
| Khoảng cách per CN×CN | Tính từ tọa độ CN. Dùng cho: F2-B4 NEAREST_FIRST + max_distance check |

---

## F0.4. Config & Thresholds (Configurable)

Tất cả thông số dưới đây **configurable** — SC Manager / Admin có thể thay đổi.

### 4.1 Safety Stock Config

| Config | Default | Dùng cho | Module |
|--------|---------|----------|--------|
| Safety factor z | 1.65 (95%) | SS Hub + SS CN calculation | F1-B3, F2-B3 |
| z override per CN × SKU | — | Critical items dùng z cao hơn | F2-B3 |
| LCNB enabled | ON | SS CN giảm 25% khi enabled | F2-B3, F2-B4 |
| LCNB SS reduction factor | 25% | SS CN discount khi LCNB on | F2-B3 |
| Hub available mode | Gross (default) | Gross = Σ CN stock. Net = trừ reserved | F1-B3 |
| Seasonal σ history | 2 năm | Same-period-last-year cho building materials | F2-B3 |

### 4.2 Demand & S&OP Config

| Config | Default | Dùng cho | Module |
|--------|---------|----------|--------|
| B2B stage probabilities | 10/40/65/85/100/0 | Weighted demand | F1-B1 |
| S&OP deadlines | Day 3 (input), Day 5 (reconcile), Day 7 (lock), Day 10 (auto-lock) | S&OP workflow | F1-B2 |
| Variance threshold (top-down vs bottom-up) | ±10% | Highlight khi lệch | F1-B2 |
| FC phasing method | Chia đều /4 | Monthly → weekly | F2-B2 |

### 4.3 CN Adjustment Config

| Config | Default | Dùng cho | Module |
|--------|---------|----------|--------|
| Adjustment tolerance | ±30% | Vượt → SC Manager review | F2-B2 |
| Cutoff time | 18:00 | Lock adjustment | F2-B2 |
| Trust score rolling window | 12 tuần | Đo accuracy CN adjust | F2-B2 |
| Trust score threshold | ±20% | Sai > 20% = incorrect | F2-B2 |
| Trust auto-approve threshold | 85% | Trust > 85% → auto-approve | F2-B2 |
| Trust reduce-tolerance threshold | 60% | Trust < 60% → tolerance ±15% | F2-B2 |
| Reason codes | nhà thầu mới, dự án delay, đối thủ, thời tiết, promotion, khác | CN chọn khi adjust | F2-B2 |

### 4.4 Allocation & LCNB Config

| Config | Default | Dùng cho | Module |
|--------|---------|----------|--------|
| LCNB priority | NEAREST_FIRST | CN gần nhất transfer trước | F2-B4 |
| Max LCNB distance | 500km | CN quá xa → skip → Hub pool | F2-B4 |
| Min excess threshold | 50 units | Excess < 50 → skip transfer | F2-B4 |
| Max transfer % | 80% | Donor giữ 20% buffer | F2-B4 |

### 4.5 Transport Config

| Config | Default | Dùng cho | Module |
|--------|---------|----------|--------|
| Container size (Pallet) | — (setup per type) | Pallet limit per container | F2-B5 |
| Container size (Tấn) | — (setup per type) | Weight limit per container | F2-B5 |
| Hold-or-ship fill threshold | 60% | Fill < 60% → consider hold | F2-B5 |
| Hold max days | 2 ngày | Sau 2d → ship dù fill thấp | F2-B5 |
| Hold buffer = transit LT + X days | X = configurable | CN HSTK > LT + buffer → hold OK | F2-B5 |

### 4.6 NM & PO Config

| Config | Default | Dùng cho | Module |
|--------|---------|----------|--------|
| NM freshness threshold | 24h | NM data stale → block PO release | F2-B1, F2-B6 |
| NM response SLA | 3d reminder, 5d escalate | NM chưa response commitment | F1-B5 |
| PO overdue alert | 7 ngày | PO SENT quá X ngày → alert | F2-B7 |
| Commitment tier tolerance | Hard ±5%, Firm ±15%, Soft ±30% | FC commitment | F1-B4 |
| Gap alert thresholds | Day 20/15%, Day 25/10%, Day 28 auto | Commitment gap monitor | F1-B7 |

---

## F0.5. Data Written Back (Auto-update từ Operations)

Các field Master Data được **tự động cập nhật** từ F2-B8 Feedback:

| Field | Source | Frequency | Logic |
|-------|--------|-----------|-------|
| Transit LT per NM×CN | PO actual (ship→receive) | Per PO closed | Rolling average |
| Transit LT per CN×CN | TO actual (ship→receive) | Per TO closed | Rolling average |
| σ_fc (forecast error) | FC vs actual sales | Weekly | Rolling 12 tuần |
| σ_demand per CN×SKU | Actual sales variance | Weekly | Rolling 12 tuần |
| σ_LT per NM | Actual NM LT variance | Per PO closed | Rolling |
| NM honoring rate | Actual delivered vs ATP | Per PO closed | Rolling 12 tuần |
| CN trust score | CN adjusted vs actual | Weekly | Rolling 12 tuần |

---

## F0.6. Danh sách Master Data

### 6.1 Core Entities — Danh mục chính

| # | Master Data | Fields chính | Bắt buộc | Dùng bởi Module |
|---|------------|-------------|----------|-----------------|
| 1 | **SKU base (không đuôi)** | Mã SKU, tên, đơn vị tính (m²), nhóm sản phẩm, NM sản xuất | Mã + NM bắt buộc | F1-B1→B3, F2-B2→B8 |
| 2 | **SKU variant (có đuôi)** | Mã variant, đuôi màu/grade (A4, B2, C1...), thuộc SKU base nào | Mã + base bắt buộc | F2-B1, F2-B3, F2-B4 |
| 3 | **CN (Chi nhánh)** | Mã CN, tên, khu vực, tọa độ/địa chỉ, CN Manager, Sales | Mã + tọa độ bắt buộc | Toàn hệ thống |
| 4 | **NM (Nhà máy)** | Mã NM, tên, liên hệ, capacity monthly, production cycle | Mã bắt buộc | F1-B1→B7, F2-B5→B7 |
| 5 | **Hub** | Mã Hub, tên, loại (virtual/physical) | Mã + loại bắt buộc | F1-B3, F1-B6, F2-B4 |
| 6 | **Customer (Khách hàng)** | Mã KH, tên, liên hệ, CN gắn | Mã bắt buộc | F1-B1 (B2B pipeline) |
| 7 | **User** | Tên, email, CN gắn, Role | Tất cả bắt buộc | Toàn hệ thống (RBAC) |
| 8 | **Role** | Planner, SC Manager, CN Manager, Sales per CN, Finance, NM user, Admin | — | Toàn hệ thống |

### 6.2 Mappings — Quan hệ giữa entities

| # | Mapping | Quan hệ | Bắt buộc | Dùng bởi Module |
|---|---------|---------|----------|-----------------|
| 9 | **SKU base → NM** | 1 SKU = 1 NM (single-source) | Bắt buộc khi tạo SKU | F1-B3, F2-B5, F2-B7 |
| 10 | **SKU variant → SKU base** | Nhiều variant thuộc 1 base | Bắt buộc khi tạo variant | F2-B1, F2-B3, F2-B4 |
| 11 | **Hub → CN cluster** | 1 Hub phục vụ nhóm CN | Config | F1-B6 |
| 12 | **Hub → NM assignment** | NM nào cung cấp cho Hub | Config | F1-B6 |
| 13 | **User → CN** | User gắn CN nào (RBAC) | Bắt buộc per user | F1-B2, F2-B2 |
| 14 | **Customer → CN** | KH thuộc CN nào | Config | F1-B1 |
| 15 | **Route (tuyến)** | Nhóm CN cùng tuyến giao hàng | Config | F2-B5 multi-drop |

### 6.3 Operational Parameters — Per entity pair

| # | Parameter | Per | Fields | Dùng bởi Module |
|---|-----------|-----|--------|-----------------|
| 16 | **MOQ** | NM × SKU base | Qty minimum per lần SX | F1-B3 |
| 17 | **NM Lead Time (production)** | NM | LT trung bình (ngày), σ_LT | F1-B3 SS Hub |
| 18 | **Transit LT (NM → CN)** | NM × CN | Thời gian vận chuyển NM tới CN (ngày) | F2-B5, F2-B6, F2-B7 |
| 19 | **Transit LT (CN → CN)** | CN × CN | Thời gian vận chuyển LCNB (ngày) | F2-B4, F2-B5 |
| 20 | **LT Hub → CN** | CN | Transit Hub tới CN (ngày), σ_LT | F2-B3 SS CN |
| 21 | **NM Price tiers** | NM | Price tier 1, Price tier 2 | F1-B7 scenario |
| 22 | **NM relationship score** | NM | Score (0-100) | F1-B7 scenario |
| 23 | **Container size** | Per loại container | Pallet limit, Tấn limit | F2-B5 |
| 24 | **Vehicle frame** | Per loại xe | Max weight, max volume | F2-B5 LCNB |
| 25 | **CN distance matrix** | CN × CN | Khoảng cách (km) — tính từ tọa độ | F2-B4 LCNB nearest |

### 6.4 Config & Thresholds — Configurable

#### Safety Stock

| # | Config key | Default | Module |
|---|-----------|---------|--------|
| 26 | Safety factor z | 1.65 (95%) | F1-B3, F2-B3 |
| 27 | z override per CN × SKU | — (per item) | F2-B3 |
| 28 | LCNB enabled | ON | F2-B3, F2-B4 |
| 29 | LCNB SS reduction factor | 25% | F2-B3 |
| 30 | Hub available mode | Gross | F1-B3 |
| 31 | Seasonal σ history window | 2 năm | F2-B3 |

#### Demand & S&OP

| # | Config key | Default | Module |
|---|-----------|---------|--------|
| 32 | B2B stage probabilities | 10/40/65/85/100/0 | F1-B1 |
| 33 | S&OP deadline: input | Day 3 | F1-B2 |
| 34 | S&OP deadline: reconcile | Day 5 | F1-B2 |
| 35 | S&OP deadline: lock | Day 7 | F1-B2 |
| 36 | S&OP deadline: auto-lock fallback | Day 10 | F1-B2 |
| 37 | Variance threshold (top-down vs bottom-up) | ±10% | F1-B2 |
| 38 | FC phasing method | Chia đều /4 | F2-B2 |

#### CN Adjustment

| # | Config key | Default | Module |
|---|-----------|---------|--------|
| 39 | Adjustment tolerance | ±30% | F2-B2 |
| 40 | Cutoff time | 18:00 | F2-B2 |
| 41 | Trust score rolling window | 12 tuần | F2-B2 |
| 42 | Trust score threshold | ±20% | F2-B2 |
| 43 | Trust auto-approve | 85% | F2-B2 |
| 44 | Trust reduce-tolerance | 60% | F2-B2 |
| 45 | Reason codes | nhà thầu mới, dự án delay, đối thủ, thời tiết, promotion, khác | F2-B2 |

#### Allocation & LCNB

| # | Config key | Default | Module |
|---|-----------|---------|--------|
| 46 | LCNB priority | NEAREST_FIRST | F2-B4 |
| 47 | Max LCNB distance | 500km | F2-B4 |
| 48 | Min excess threshold | 50 units | F2-B4 |
| 49 | Max transfer % | 80% | F2-B4 |

#### Transport

| # | Config key | Default | Module |
|---|-----------|---------|--------|
| 50 | Hold-or-ship fill threshold | 60% | F2-B5 |
| 51 | Hold max days | 2 ngày | F2-B5 |
| 52 | Hold buffer (thêm sau transit LT) | configurable | F2-B5 |

#### NM & PO

| # | Config key | Default | Module |
|---|-----------|---------|--------|
| 53 | NM freshness threshold | 24h | F2-B1, F2-B6 |
| 54 | NM response SLA (reminder) | 3 ngày | F1-B5 |
| 55 | NM response SLA (escalate) | 5 ngày | F1-B5 |
| 56 | PO overdue alert | 7 ngày | F2-B7 |
| 57 | Commitment tier: Hard tolerance | ±5% | F1-B4 |
| 58 | Commitment tier: Firm tolerance | ±15% | F1-B4 |
| 59 | Commitment tier: Soft tolerance | ±30% | F1-B4 |
| 60 | Gap alert: Day threshold | Day 20 | F1-B7 |
| 61 | Gap alert: % threshold | 15% | F1-B7 |
| 62 | Gap escalate: Day threshold | Day 25 | F1-B7 |
| 63 | Gap escalate: % threshold | 10% | F1-B7 |

### 6.5 Auto-update Fields (cập nhật từ Operations)

| # | Field | Update từ | Frequency | Logic |
|---|-------|-----------|-----------|-------|
| 64 | Transit LT per NM×CN | F2-B8 (PO actual) | Per PO closed | Rolling average |
| 65 | Transit LT per CN×CN | F2-B8 (TO actual) | Per TO closed | Rolling average |
| 66 | σ_fc (forecast error) | F2-B8 (FC vs actual) | Weekly | Rolling 12 tuần |
| 67 | σ_demand per CN×SKU | F2-B8 (actual variance) | Weekly | Rolling 12 tuần |
| 68 | σ_LT per NM | F2-B8 (NM LT variance) | Per PO closed | Rolling |
| 69 | NM honoring rate | F2-B8 (delivered vs ATP) | Per PO closed | Rolling 12 tuần |
| 70 | CN trust score | F2-B8 (adjusted vs actual) | Weekly | Rolling 12 tuần |

---

**Tổng: 8 core entities + 7 mappings + 10 operational parameters + 38 configs + 7 auto-update = 70 data points.**

---

## F0.7. Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F0-001 | **CRUD cho tất cả Core Entities:** tạo, xem, sửa, xóa (soft delete) SKU, CN, NM, Hub, Customer, User/Role | CRITICAL |
| FR-F0-002 | **SKU khai báo bắt buộc:** khi tạo SKU base → bắt buộc NM. Khi tạo variant → bắt buộc thuộc SKU base nào | CRITICAL |
| FR-F0-003 | **Config management screen:** tất cả configs (section 4) quản lý tập trung. SC Manager / Admin chỉnh. Audit log mọi thay đổi | CRITICAL |
| FR-F0-004 | **Import / bulk upload:** hỗ trợ import Master Data từ file (SKU list, CN list, NM list...) cho onboarding ban đầu | HIGH |
| FR-F0-005 | **Validation rules:** bắt buộc fields, unique constraints, referential integrity (variant phải có base, SKU phải có NM...) | CRITICAL |
| FR-F0-006 | **NM upload template generator:** per NM, generate template pre-fill danh sách SKU NM đó sản xuất. NM download → điền tồn → upload (F2-B1) | HIGH |
| FR-F0-007 | **Auto-update từ F2-B8:** transit LT, σ values, honoring rate, trust score tự động cập nhật. Alert khi thay đổi > threshold | HIGH |
| FR-F0-008 | **Data quality dashboard:** hiển thị completeness — entity nào thiếu field bắt buộc, mapping nào chưa khai báo | HIGH |

## F0.8. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F0-001 | **SKU không có NM → block.** Hệ thống không cho tạo SKU base mà không gán NM | Gate check |
| BR-F0-002 | **Variant không có base → block.** Variant bắt buộc thuộc 1 SKU base | Gate check |
| BR-F0-003 | **1 SKU base = 1 NM (single-source).** Không multi-source | Đã quyết F1-B3 |
| BR-F0-004 | **Config thay đổi → audit log:** ai, khi nào, giá trị cũ → mới | Compliance |
| BR-F0-005 | **Auto-update có threshold alert:** transit LT actual khác config > 30% → alert SC Manager review. Không auto-overwrite — SC Manager confirm | Safety |
| BR-F0-006 | **Soft delete:** không xóa vật lý. Deactivate entity → không xuất hiện trong dropdown/selection nhưng data lịch sử giữ nguyên | Data integrity |

## F0.9. User Stories & Acceptance Criteria

### US-F0-001: Khai báo SKU

As a **Admin**, I want **tạo SKU base + variant + gán NM**, so that **DRP có đủ data để tính toán**.

**Acceptance Criteria:**
- Given Admin tạo SKU base "GA-300", When bắt buộc chọn NM, Then chọn "Mikado" → save OK
- Given Admin tạo SKU base mà không chọn NM, When save, Then blocked: "NM bắt buộc"
- Given Admin tạo variant "GA-300-A4", When chọn thuộc "GA-300", Then save OK. Mapping GA-300-A4 → GA-300 tự động

### US-F0-002: Config Management

As a **SC Manager**, I want **thay đổi config (tolerance, threshold, z-factor...) từ 1 screen**, so that **tôi điều chỉnh hành vi hệ thống mà không cần IT**.

**Acceptance Criteria:**
- Given SC Manager mở Config, When thay đổi "CN adjustment tolerance" từ 30% → 25%, Then save + audit log: "tolerance changed 30%→25% by [user] at [timestamp]"
- Given Config thay đổi, When hiệu lực, Then tất cả modules dùng config mới từ lần chạy tiếp theo

### US-F0-003: Data Quality Check

As a **Admin**, I want **biết Master Data thiếu gì trước khi go-live**, so that **DRP không chạy trên data thiếu**.

**Acceptance Criteria:**
- Given 500 SKU imported, 20 SKU chưa gán NM, When mở Data Quality, Then hiển thị: "20 SKU thiếu NM mapping. DRP sẽ skip 20 SKU này"

## F0.10. Dependencies

| Depends on | Data |
|-----------|------|
| ERP (Bravo) | Import ban đầu: SKU list, CN list |
| F2-B8 | Auto-update: transit LT, σ values, honoring, trust |

| Feeds into | |
|-----------|---|
| **Tất cả 15 modules** | Mọi module đều đọc Master Data |

## F0.11. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F0-001 | Config change propagation | < 60 giây |
| NFR-F0-002 | Entity search/filter | < 2 giây |
| NFR-F0-003 | Bulk import 500 SKU | < 30 giây |
| NFR-F0-004 | Data quality check | < 10 giây |

## F0.12. Out of Scope

- ERP replacement (chỉ import data từ ERP, không thay thế)
- User authentication / SSO (thuộc platform)
- Financial master data (giá bán, AP/AR — thuộc ERP)
- Production master data tại NM (thuộc NM internal)

## F0.13. Open Questions

- [x] ~~SKU → NM~~ → **Resolved:** 1 base = 1 NM (single-source). Bắt buộc khi khai báo
- [x] ~~SKU variant mapping~~ → **Resolved:** Variant bắt buộc thuộc base. Master Data khai báo
- [x] ~~Config scope~~ → **Resolved:** Tất cả thresholds configurable. SC Manager / Admin quản lý

---
---

# FLOW 1: PRODUCTION BOOKING (MONTHLY)

**Nhịp:** Ngày 1-7 mỗi tháng. SC Manager book NM.

---

# F1-B1 — Demand Aggregation

**Flow:** 1 — Production Booking (Monthly)
**Step:** 1/7
**Version:** 1.1 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B1.1. Overview

Bước đầu tiên của Production Booking hàng tháng. Nhận **demand forecast 2 cấp** từ hệ thống bên ngoài, kết hợp với B2B pipeline. Module này chỉ **nhận, validate và hiển thị** — không cho phép chỉnh sửa. Mọi điều chỉnh thuộc F1-B2 (S&OP Consensus).

**Demand forecast 2 cấp:**
- **Cấp Tổng:** demand forecast toàn hệ thống UNIS **per mã hàng (SKU) × tháng**, horizon tối đa 12 tháng (M+1 → M+12)
- **Cấp Chi nhánh:** demand forecast **per CN × SKU group × tháng**, horizon tối đa 12 tháng. Chưa phân rã Variant — DRP (F2-B3) sẽ gợi ý variant breakdown dựa trên tồn kho hiện tại của CN

Cả 2 cấp đều nhận từ hệ thống bên ngoài. Cả 2 cấp đều có thể điều chỉnh tại B2.

**Lưu ý:** Cấp Tổng per mã hàng, **không per NM**. Việc phân bổ demand → NM dựa trên sourcing rules thuộc bước sau (allocation/lot sizing).

Output là demand 2 cấp + B2B pipeline → đưa vào S&OP consensus (B2) để review và adjust.

## F1B1.2. Problem Statement

UNIS có ~40% demand từ dự án B2B — không forecast được bằng statistical model. Hiện planner tổng hợp thủ công qua Excel, dễ đếm trùng (B2B deal đã thành PO vẫn nằm trong pipeline), thiếu weighted probability → demand quá cao hoặc quá thấp.

## F1B1.3. Functional Requirements

### Demand Forecast Input — 2 cấp

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B1-001 | **Nhận FC cấp Tổng:** nhận demand forecast toàn UNIS từ hệ thống bên ngoài. Data: **per mã hàng (SKU) × tháng**, horizon tối đa 12 tháng (M+1→M+12). Không gắn NM | CRITICAL |
| FR-F1B1-002 | **Nhận FC cấp Chi nhánh:** nhận demand forecast per CN từ hệ thống bên ngoài. Data: **per CN × SKU group × tháng**, horizon tối đa 12 tháng. Chưa phân rã Variant (variant do DRP gợi ý tại F2-B3) | CRITICAL |
| FR-F1B1-003 | **Consistency check:** khi nhận cả 2 cấp, hệ thống kiểm tra Σ(CN) vs Tổng. Nếu lệch → warning (không reject) — SC Manager sẽ reconcile tại B2 | HIGH |
| FR-F1B1-004 | **Import validation:** kiểm tra data: không trùng, SKU group/CN tồn tại trong Master Data. Reject dòng lỗi + báo cáo chi tiết | HIGH |
| FR-F1B1-005 | **Import log:** ghi nhận mỗi lần nhận data: nguồn, cấp (Tổng/CN), thời gian, số dòng success/fail, version | HIGH |

### Demand Aggregation

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B1-006 | Tổng hợp demand: `Demand = FC (2 cấp) + Σ(B2B deal qty × stage probability)`. B2B pipeline là nguồn duy nhất cho đơn hàng — stage Confirmed = 100% (tương đương PO đã ký). Không cần double-count adjustment | CRITICAL |
| FR-F1B1-007 | Hiển thị demand 2 cấp: **Tab Tổng** (per mã hàng × tháng, horizon 12M) + **Tab Chi nhánh** (per CN × SKU group × tháng). **Read-only** — không chỉnh tại đây | HIGH |
| FR-F1B1-008 | Per mã hàng view: demand per SKU × 12 tháng (M+1 → M+12) | HIGH |

### B2B Pipeline

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B1-009 | B2B Pipeline 6-stage: Lead → Qualified → Proposal → Committed → Confirmed → Lost. **Probability per stage configurable**. Default: 10/40/65/85/100/0 | HIGH |
| FR-F1B1-010 | B2B deal management: thêm deal mới, import từ ERP, update stage/qty. **Sales per CN chỉ nhập/xem deal của CN mình** | HIGH |
| FR-F1B1-011 | Stage transition tracking: khi deal chuyển stage (vd: Proposal→Committed), weighted demand tự cập nhật. Deal đạt Confirmed (100%) = đơn hàng chắc chắn | MEDIUM |
| FR-F1B1-012 | Multi-CN split: 1 deal B2B split delivery nhiều CN | MEDIUM |

## F1B1.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B1-001 | **B1 là read-only aggregation.** Không cho phép user chỉnh sửa total demand tại bước này. Mọi điều chỉnh thuộc F1-B2 (S&OP Consensus) | Core principle |
| BR-F1B1-002 | **FC nhận nhiều lần:** version mới ghi đè version cũ, audit log giữ lại tất cả. Tối thiểu phải có data trước S&OP Day 1, nếu chưa có → alert Planner | Versioning |
| BR-F1B1-003 | **Validation fail:** dòng lỗi bị reject, dòng đúng vẫn import. Báo cáo lỗi gửi user ngay lập tức | Partial import OK |
| BR-F1B1-004 | Stage Lead (10%) KHÔNG tính vào demand — uncertainty quá cao | Filter out |
| BR-F1B1-005 | Deal thay đổi qty/timeline > ±20% → auto-cascade S&OP + DRP + NM commitment | Change cascade |
| BR-F1B1-006 | Deal Committed→Lost sau S&OP locked → flag demand reduction, alert SC Manager nếu > 500m² | Rollback |
| BR-F1B1-007 | Pipeline review frequency: hàng tuần (configurable) | Weekly refresh |

## F1B1.5. User Stories & Acceptance Criteria

### US-F1B1-001: Nhận FC 2 cấp

As a **Planner**, I want **demand forecast 2 cấp (Tổng + Chi nhánh) được nhận từ hệ thống bên ngoài**, so that **tôi không phải nhập thủ công và dữ liệu luôn từ nguồn chính thức**.

**Acceptance Criteria:**
- Given hệ thống bên ngoài gửi **cấp Tổng** (GA-300 M+1=8.000, GA-400 M+1=3.200 → Total=11.200), When SCP nhận, Then import + log ghi nhận. Hệ thống tự biết GA-300 → Mikado, GA-400 → Phú Mỹ qua Master Data (SKU→NM)
- Given hệ thống bên ngoài gửi **cấp Chi nhánh** (CN-BD × GA-300 = 400, CN-BD × GA-400 = 120, CN-ĐN × GA-300 = 350...), When SCP nhận, Then import + log ghi nhận
- Given cả 2 cấp đã nhận, Σ(CN) = 9.800 vs Tổng = 10.600 (lệch 800m²), When consistency check, Then warning: "Σ(CN) lệch Tổng −7.5%. SC Manager reconcile tại B2" — **không reject**
- Given S&OP Day 1 đến mà chưa có FC data, When deadline check, Then alert Planner + SC Manager

### US-F1B1-002: Xem demand 2 cấp (read-only)

As a **SC Manager**, I want **xem demand 2 cấp (Tổng + per CN) mà không chỉnh được**, so that **tôi thấy raw data trước khi vào S&OP điều chỉnh**.

**Acceptance Criteria:**
- Given FC 2 cấp + B2B pipeline đã nhận, When mở Demand Aggregation, Then hiển thị: **Tab Tổng** (per mã hàng × tháng, group được per NM nhờ Master Data SKU→NM) + **Tab Chi nhánh** (per CN × SKU group). **Không có nút Edit/Adjust**
- Given Per mã hàng drill down, When click GA-300, Then thấy demand M+1→M+12 + NM sản xuất (Mikado) từ Master Data
- Given SC Manager muốn điều chỉnh, When tìm cách edit, Then hệ thống hướng dẫn: "Điều chỉnh demand tại S&OP Consensus (Bước 2)"

### US-F1B1-003: Quản lý B2B Pipeline

As a **Sales**, I want **nhập và update B2B deals với stage/probability**, so that **weighted demand phản ánh đúng pipeline thực tế**.

**Acceptance Criteria:**
- Given Sales nhập deal "Dự án Sunrise" 8.000m² stage Committed (85%), When save, Then weighted demand += 6.800m²
- Given 1 deal split 60% CN-A + 40% CN-B, When save, Then weighted demand tính proportional per CN
- Given deal chuyển Proposal → Committed (85%), When update stage, Then weighted demand tăng từ 65% → 85% tự động
- Given deal chuyển → Confirmed (100%), When update, Then demand = full qty (đơn chắc chắn)
- Given deal chuyển → Lost (0%), When update, Then demand giảm về 0

## F1B1.6. Dependencies

| Depends on | Data |
|-----------|------|
| Master Data | Item/SKU group, CN, NM, Customer |
| Hệ thống Forecast bên ngoài | Monthly FC 2 cấp (Tổng + Chi nhánh) |

| Feeds into | |
|-----------|---|
| F1-B2 | S&OP Consensus (demand 2 cấp → review + adjust) |

## F1B1.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B1-001 | Demand aggregation hiển thị | < 5 giây |
| NFR-F1B1-002 | B2B weighted demand recalculate khi deal thay đổi | < 5 giây |
| NFR-F1B1-003 | Consistency check (Σ CN vs Tổng) | < 3 giây |

## F1B1.8. Out of Scope

- CRM / quản lý quan hệ khách hàng (chỉ track deal, không quản lý customer lifecycle)
- Tự tạo demand forecast (FC đến từ hệ thống bên ngoài, SCP không build FC engine)
- Pricing / báo giá cho B2B deals (thuộc Sales)
- Sales order processing (thuộc ERP)
- B2B deal financial terms / contract management

## F1B1.9. Open Questions

- [x] ~~FC source system~~ → **Resolved:** Hệ thống bên ngoài cung cấp demand forecast. SCP không tự tạo FC
- [x] ~~B2B stage probabilities~~ → **Resolved:** Configurable per stage. Default: 10/40/65/85/100/0, UNIS tùy chỉnh theo kinh nghiệm thực tế
- [x] ~~Import deals từ ERP~~ → **Resolved:** Đồng bộ từ ERP + manual input. Cả 2 phương thức
- [x] ~~FC granularity~~ → **Resolved:** Cấp Tổng per mã hàng (SKU), KHÔNG per NM. Cấp CN per SKU group (chưa phân Variant). Variant do DRP gợi ý tại F2-B3 dựa trên tồn kho CN
- [x] ~~Horizon~~ → **Resolved:** Tối đa 12 tháng (M+1 → M+12)
- [x] ~~B2B Sales RBAC~~ → **Resolved:** Sales per CN — mỗi CN có Sales riêng, chỉ nhập/xem deal của CN mình
- [x] ~~PO confirmed~~ → **Resolved:** Gom vào B2B pipeline. PO confirmed = stage Confirmed (100%) trong cùng pipeline. Không tách riêng, không cần double-count adjustment

---

# F1-B2 — S&OP Consensus

**Flow:** 1 — Production Booking (Monthly)
**Step:** 2/7
**Version:** 1.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B2.1. Overview

Demand forecast UNIS có **2 cấp**, cả 2 đều nhận từ hệ thống bên ngoài tại B1:
- **Cấp Tổng:** demand forecast toàn hệ thống UNIS **per mã hàng (SKU) × tháng**, horizon 12 tháng
- **Cấp Chi nhánh:** demand forecast **per CN × SKU group × tháng**, horizon 12 tháng

B1 cũng nhận **B2B pipeline** (deal × stage probability) — đã gom PO confirmed vào pipeline.

S&OP Consensus là nơi **cả 2 cấp được review và điều chỉnh**:
- SC Manager adjust cấp Tổng (tăng/giảm per mã hàng)
- CN Manager adjust cấp Chi nhánh (tăng/giảm per SKU group trong CN mình)
- SC Manager reconcile variance giữa 2 cấp → lock

Output là approved demand 2 cấp — cơ sở để tính production lot sizing (B3) và FC commitment gửi NM (B4).

## F1B2.2. Problem Statement

UNIS hiện làm S&OP thủ công qua nhiều công cụ rời rạc. Không có quy trình chuẩn, không lock deadline, số thay đổi liên tục → NM commitment dựa trên số không ổn định.

## F1B2.3. Functional Requirements

### 2-Level Demand View

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B2-001 | **Cấp Tổng — adjust:** SC Manager xem và điều chỉnh demand forecast cấp Tổng **per mã hàng × tháng** (data gốc từ B1). Mọi adjustment logged với lý do | CRITICAL |
| FR-F1B2-002 | **Cấp Chi nhánh — adjust:** CN Manager xem và điều chỉnh demand forecast cấp CN **per SKU group × tháng** cho CN mình (data gốc từ B1). Aggregate tự động: CN → Region → Company | CRITICAL |
| FR-F1B2-003 | **Variance view:** hiển thị gap giữa Tổng (adjusted) vs Σ(CN adjusted). Highlight khi variance > ±10% | CRITICAL |

### S&OP Consensus Workflow

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B2-004 | Multi-stakeholder input: **Sales per CN** (adjust FC + B2B pipeline), CN Managers (adjust cấp CN), Finance (AOP target, view-only), SC Manager (reconciliation + lock) | CRITICAL |
| FR-F1B2-005 | Version compare: v0 (FC gốc 2 cấp từ B1) → v1 (Sales adjust FC + B2B) → v2 (CN Manager adjust) → v3 (SC Manager reconcile) → v4 (Locked). **Review focus M+1/M+2/M+3** (data 12M có nhưng S&OP chỉ review 3 tháng gần nhất) | HIGH |
| FR-F1B2-006 | Approval workflow: DRAFT → SUBMITTED → REVIEWED → ADJUSTED → APPROVED → LOCKED | CRITICAL |
| FR-F1B2-007 | Auto-lock Day 7. Nếu chưa lock → escalate. Day 10 → auto-lock v0 (top-down) fallback | HIGH |
| FR-F1B2-008 | Hiển thị: Proposed vs Approved vs Adjusted (delta) với lý do adjustment — cả cấp Tổng lẫn per CN | HIGH |
| FR-F1B2-009 | Forecast Value-Add (FVA): đo human adjustment có cải thiện FC không, per user/CN/SKU group | HIGH |
| FR-F1B2-010 | RBAC: CN Manager chỉ xem/adjust CN mình. SC Manager có quyền lock. Finance view-only | CRITICAL |
| FR-F1B2-011 | **Collaborative editing real-time (Phase 1):** nhiều user edit cùng lúc → thấy nhau real-time (cursor, highlight, thay đổi hiện ngay). Change log ghi nhận mọi thay đổi (who, when, old/new value, lý do) | HIGH |

## F1B2.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B2-001 | Input deadline: Sales adjust + CN adjust trước Day 3. SC Manager reconcile Day 3-5. Lock Day 7. **S&OP review focus M+1/M+2/M+3** (data 12M hiển thị nhưng chỉ review/lock 3 tháng gần nhất) | Configurable |
| BR-F1B2-002 | SC Manager là decision authority cuối cùng — quyết định chọn số Tổng, số CN, hay blend | Final say |
| BR-F1B2-003 | **Top-down vs Bottom-up variance > ±10%** → highlight đỏ, SC Manager PHẢI giải thích trước khi lock | Core rule |
| BR-F1B2-004 | AOP (Finance) vs Σ(CN inputs) variance > ±10% → highlight đỏ, yêu cầu giải thích | Budget alignment |
| BR-F1B2-005 | FVA > 0 → adjustment cải thiện FC. FVA < 0 → cần training | Track quality |
| BR-F1B2-006 | S&OP disagreement (vd: Sales 6.000 vs Ops 4.500): SC Manager quyết định, decision logged, FVA tracks | Conflict resolution |
| BR-F1B2-007 | **Approved demand phải tồn tại ở CẢ 2 cấp:** Tổng UNIS (per mã hàng) + per CN (per SKU group). Nếu chỉ có Tổng mà CN chưa adjust → dùng FC gốc từ B1 làm default | Completeness |
| BR-F1B2-008 | **Reconciliation direction:** SC Manager có thể adjust top-down xuống (giảm tổng), adjust bottom-up lên (tăng CN), hoặc redistribute giữa các CN. Mọi adjustment logged | Flexibility |
| BR-F1B2-009 | **B2B pipeline editable tại B2:** Sales và SC Manager có thể adjust B2B deal (stage/probability/qty) tại B2. Thay đổi tự động phản ánh ngược B1 demand aggregation. B2B sửa ở đâu cũng được (B1 hoặc B2), data đồng bộ | Single source of truth |
| BR-F1B2-010 | **Sales per CN có thể adjust FC:** Sales per CN adjust demand forecast cấp CN (ngoài B2B). Sales chỉ adjust CN mình, tương tự CN Manager RBAC | Sales empowerment |

## F1B2.5. User Stories & Acceptance Criteria

### US-F1B2-001: Xem Variance 2 cấp

As a **SC Manager**, I want **xem gap giữa Tổng (top-down từ B1) và Σ(CN bottom-up)**, so that **tôi biết 2 nguồn lệch bao nhiêu trước khi reconcile**.

**Acceptance Criteria:**
- Given Top-down total (B1) = 14.600m², Σ(CN bottom-up) = 13.200m², When mở Variance view, Then hiển thị: gap = −1.400m² (−9.6%), highlight vàng (gần ngưỡng 10%)
- Given Top-down = 14.600m², Σ(CN) = 12.000m² (gap −17.8%), When mở, Then highlight ĐỎ: "Variance > 10%. SC Manager phải giải thích trước khi lock"
- Given Tổng per mã hàng: GA-300 top-down = 8.000m² vs Σ(CN for GA-300) = 7.200m², When drill per SKU, Then hiển thị gap per mã hàng

### US-F1B2-002: CN Manager Adjust FC Chi nhánh

As a **CN Manager (CN-BD)**, I want **điều chỉnh demand forecast của CN tôi (data gốc từ 3rd-party)**, so that **local intelligence (nhà thầu mới, dự án delay) được phản ánh**.

**Acceptance Criteria:**
- Given FC gốc cho CN-BD: GA-300 = 500m², GA-400 = 150m², When CN-BD Manager mở B2, Then thấy FC gốc per SKU group. Có thể adjust: GA-300: 500 → 580 (+16%, lý do: "nhà thầu mới"), GA-400: 150 → 120 (−20%, lý do: "dự án delay")
- Given CN-BD adjust xong, When save, Then CN-BD total = 700m² (adjusted), hiển thị delta vs FC gốc per SKU group. Aggregate lên Region → Company
- Given CN-BD cố xem CN-HN, When truy cập, Then bị chặn (chỉ xem/adjust CN mình)

### US-F1B2-003: SC Manager Reconcile & Lock

As a **SC Manager**, I want **reconcile 2 cấp (top-down vs bottom-up), adjust, và lock consensus**, so that **NM nhận được số ổn định**.

**Acceptance Criteria:**
- Given Top-down = 14.600m², Σ(CN) = 13.200m², SC Manager giảm top-down 800m² (loại B2B Phú Thịnh probability thấp), When approve, Then Approved Tổng = 13.800m², per CN giữ nguyên bottom-up. Lý do logged
- Given SC Manager redistribute: tăng CN-BD từ 650 → 700, giảm CN-HN từ 500 → 450, When save, Then Σ(CN) vẫn = tổng approved. Adjustment per CN logged
- Given Day 7, When lock, Then v4 locked cả 2 cấp (Tổng + per CN). Không ai edit. Feed B3 lot sizing

## F1B2.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B1 | Demand aggregation (total demand input) |
| Master Data | CN, SKU, User/Role |

| Feeds into | |
|-----------|---|
| F1-B3 | Production Lot Sizing (approved demand) |
| F1-B4 | FC Commitment (approved demand → commitment tiers) |

## F1B2.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B2-001 | S&OP aggregate (50 CN × 500 SKU) | < 5 giây |
| NFR-F1B2-002 | Version compare (2 versions × 25K cells) | < 3 giây |
| NFR-F1B2-003 | Collaborative editing: real-time presence | < 1 giây update |
| NFR-F1B2-004 | FVA calculation per user/CN/SKU | < 10 giây |

## F1B2.8. Out of Scope

- Statistical forecast engine / AI-ML model (chỉ consume v0 output, không build FC engine)
- NM commitment generation (thuộc F1-B4)
- DRP consumption of consensus (thuộc F2-B3)
- Financial planning / budget tools (thuộc Finance system)
- Video/call integration cho S&OP meeting (chỉ data pack, không communication tool)

## F1B2.9. Open Questions

- [x] ~~S&OP horizon~~ → **Resolved:** Data 12M hiển thị, S&OP chỉ review/lock M+1/M+2/M+3
- [x] ~~Sales role tại B2~~ → **Resolved:** Sales per CN có thể adjust FC + B2B pipeline tại B2
- [x] ~~B2B pipeline edit~~ → **Resolved:** B2B sửa ở B1 hoặc B2 đều được, data đồng bộ
- [x] ~~Collaborative editing~~ → **Resolved:** Làm luôn Phase 1 — real-time presence, thấy nhau live
- [x] ~~FVA baseline~~ → **Resolved:** Đo từ Demand Forecast gốc (v0 từ B1 — data 3rd-party). FVA = accuracy(v0) − accuracy(adjusted). FVA > 0 → adjust cải thiện. FVA < 0 → adjust làm tệ hơn

---

# F1-B3 — Production Lot Sizing

**Flow:** 1 — Production Booking (Monthly)
**Step:** 3/7
**Version:** 4.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B3.1. Overview

Tính lượng cần **đặt hàng nhà máy (NM)** per mã hàng để đảm bảo kho tổng đủ hàng cho 3 tháng tới + duy trì buffer an toàn (SS Hub).

**Hub hiện tại = tổng tồn kho toàn bộ chi nhánh** (sum tồn kho tất cả CN). Sau này có thể chuyển thành **kho tổng vật lý** (1 hoặc nhiều kho tổng). Logic không thay đổi — chỉ thay đổi data source (sum CN → tồn kho tổng thực).

**Logic tính Booking (3 bước):**

```
Bước 1: Tồn dự kiến = Hub_available + Pipeline − FC_3tháng
Bước 2: Tồn dự kiến < SS_Hub? → Cần đặt NM
Bước 3: Booking = SS_Hub − Tồn dự kiến
```

Mục đích: **đảm bảo sau 3 tháng CN kéo hàng, Hub vẫn duy trì SS Hub.**

Trong đó:
- **Hub available** = tồn kho Hub hiện tại (= tổng tồn kho tất cả CN, sau này = tồn kho tổng vật lý)
- **Pipeline** = hàng **đã ship từ NM, đang trên đường, chưa tới CN**. Không tính: hàng NM confirm chưa ship, booking chưa confirm
- **FC 3 tháng** = **tổng approved demand từ B2** (FC adjusted + B2B weighted). Lượng CN sẽ kéo trong M+1/M+2/M+3
- **SS Hub** = buffer an toàn chống sai số FC + lead time NM (con số nhỏ, KHÔNG phải 3 tháng demand)

Input: approved demand 3 tháng (B2) + Hub available + Pipeline + SS Hub.
Output: booking qty per NM × mã hàng → đưa vào FC Commitment (B4).

## F1B3.2. Problem Statement

UNIS cần đảm bảo kho tổng luôn đủ hàng cho CN kéo + duy trì buffer an toàn. Nếu đặt NM thiếu → stockout. Nếu đặt thừa → tồn kho cao, kẹt vốn. Hiện planner ước lượng bằng kinh nghiệm ("cảm giác"), không có tính toán chính xác dựa trên FC + SS + tồn thực tế.

## F1B3.3. Functional Requirements

### Booking Calculation

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B3-001 | **Booking netting per mã hàng:** (1) Tính tồn dự kiến = Hub + Pipeline − FC 3 tháng. (2) Nếu tồn dự kiến ≥ SS Hub → đủ, booking = 0. (3) Nếu tồn dự kiến < SS Hub → booking = SS Hub − tồn dự kiến. Mục đích: sau 3 tháng CN kéo hàng, Hub vẫn giữ SS Hub | CRITICAL |
| FR-F1B3-002 | **SS Hub formula:** `SS_Hub = z × √(LT_nm × σ²_fc + ADU² × σ²_LT_nm)`. Trong đó: z = safety factor (default 1.65 = 95%), LT_nm = lead time NM, σ_fc = sai số forecast, **ADU = FC 3 tháng / 90 ngày**, σ_LT_nm = sai số lead time NM. **Khi FC = 0 → ADU = 0 → SS Hub = 0** (không có demand thì không cần buffer) | CRITICAL |
| FR-F1B3-003 | **Source mapping:** Master Data: **1 SKU (không đuôi) = 1 NM** (single-source). Booking per SKU không đuôi (vd: GA-300). Master Data khai báo SKU có đuôi (GA-300-A4, GA-300-B2...) thuộc SKU không đuôi nào | CRITICAL |
| FR-F1B3-004 | **MOQ check:** mỗi cặp NM × mã hàng có MOQ (lượng nhỏ nhất NM chấp nhận). Đặt bất kỳ số ≥ MOQ đều OK (không cần bội số). Booking < MOQ → **cảnh báo** SC Manager (không tự round) | CRITICAL |
| FR-F1B3-005 | **Booking = 0:** khi Hub available + Pipeline ≥ FC 3 tháng + SS Hub → đủ hàng. Hiển thị "Đủ hàng, không cần đặt" | HIGH |

### Views

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B3-006 | **Netting summary view:** per mã hàng hiển thị: FC 3 tháng, SS Hub (buffer), Hub available, Pipeline, Booking need, NM (từ Master Data), MOQ, trạng thái (đủ / cần đặt / dưới MOQ) | HIGH |
| FR-F1B3-007 | **SC Manager override:** adjust booking qty per NM × mã hàng với lý do. Warning nếu kết quả < MOQ | HIGH |

## F1B3.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B3-001 | **Booking logic:** (1) Tồn dự kiến = Hub + Pipeline − FC 3 tháng. (2) Tồn dự kiến ≥ SS Hub → đủ hàng, booking = 0. (3) Tồn dự kiến < SS Hub → booking = SS Hub − tồn dự kiến. **Mục đích: đảm bảo Hub giữ SS Hub sau 3 tháng** | Core formula |
| BR-F1B3-002 | **SS Hub là buffer nhỏ**, KHÔNG phải 3 tháng demand. SS Hub chỉ chống sai số FC + NM lead time variance. Ví dụ: FC 3 tháng = 11.300m², SS Hub chỉ ~500m². Sau đặt + 3 tháng kéo: Hub = SS Hub (500m²) | Tránh nhầm |
| BR-F1B3-003 | **SS Hub dynamic:** recalculate khi σ_fc hoặc σ_LT thay đổi. FC accuracy improve → σ giảm → SS Hub giảm → booking giảm → tiết kiệm vốn. NM trễ nhiều → σ_LT tăng → SS Hub tăng | Closed loop từ F2-B8 |
| BR-F1B3-004 | **Booking per SKU không đuôi màu** (vd: GA-300, không phải GA-300-A4). Master Data khai báo: SKU có đuôi → thuộc SKU không đuôi nào. 1 SKU không đuôi = 1 NM. Hub available + FC 3 tháng cũng aggregate lên level SKU không đuôi khi tính booking | Granularity |
| BR-F1B3-005 | **MOQ per NM × mã hàng:** minimum 1 lần sản xuất. Booking < MOQ → CẢNH BÁO (không tự round). SC Manager quyết định: đặt MOQ (chấp nhận excess), hoặc chờ, hoặc negotiate NM | Warning, không auto |
| BR-F1B3-006 | **Excess (khi SC Manager chọn đặt MOQ dù cần ít hơn):** hàng dư giữ Hub làm buffer tháng sau | Hub buffer |
| BR-F1B3-007 | **Booking = 1 con số tổng per mã hàng.** B4 (FC Commitment) sẽ tách thành commitment tiers M+1/M+2/M+3 gửi NM | B3 tính tổng, B4 tách |
| BR-F1B3-008 | **Hub available mode (configurable):** (1) **Gross mode** (default — Hub ảo): Hub = Σ(tồn vật lý CN), không trừ reserved. Dùng khi Hub là ảo (chưa có kho tổng). (2) **Net mode** (sau này — Hub vật lý): Hub = tồn vật lý − reserved/committed bởi Flow 2. Dùng khi có kho tổng thực. SC Manager chọn mode trong config | Configurable |
| BR-F1B3-009 | **Hub HIỆN TẠI < SS Hub → CẢNH BÁO KHẨN CẤP** ngay lập tức, không chờ kỳ booking. Alert đỏ cho SC Manager + Planner | Urgent alert |
| BR-F1B3-010 | **Pipeline = chỉ hàng đã ship đang trên đường, chưa tới CN.** NM confirm chưa ship = KHÔNG tính. Cuối tháng: NM giao rồi → Hub available. NM chưa giao → không tính, booking tháng sau bù | Định nghĩa rõ |
| BR-F1B3-011 | **FC 3 tháng = tổng approved demand từ B2** (FC adjusted + B2B weighted). Aggregate lên SKU không đuôi (vd: FC GA-300-A4 + FC GA-300-B2 + FC GA-300-C1 = FC GA-300 tổng). NM nhận booking theo SKU không đuôi, NM tự quyết đuôi màu theo lot sản xuất | Demand source |
| BR-F1B3-012 | **B3 chỉ chạy đầu tháng** (sau B2 lock). Không re-run giữa tháng. Sự kiện lớn giữa tháng → chờ kỳ booking đầu tháng sau. BR-009 (urgent alert) vẫn hoạt động real-time | Monthly only |

## F1B3.5. User Stories & Acceptance Criteria

### US-F1B3-001: Booking Netting

As a **Planner**, I want **hệ thống tính lượng cần đặt NM dựa trên FC 3 tháng + SS Hub buffer − tồn hiện tại**, so that **Hub luôn đủ hàng cho CN kéo + duy trì buffer an toàn**.

**Acceptance Criteria:**
- Given GA-300 (NM: Mikado): Hub = 6.800m², Pipeline = 500m², FC 3 tháng = 11.300m², SS Hub = 500m². When netting, Then: Tồn dự kiến = 6.800 + 500 − 11.300 = **−4.000** (âm = thiếu). Booking = 500 − (−4.000) = **4.500m²**. Kiểm tra: 6.800 + 500 + 4.500 − 11.300 = 500 = SS Hub ✓
- Given GA-400 (NM: Phú Mỹ): Hub = 3.000m², Pipeline = 0, FC 3 tháng = 2.500m², SS Hub = 200m². When netting, Then: Tồn dự kiến = 3.000 + 0 − 2.500 = **500** (> SS Hub 200). Booking = **0**. Trạng thái: "Đủ hàng"

### US-F1B3-002: MOQ Warning

As a **SC Manager**, I want **nhận cảnh báo khi booking < MOQ**, so that **tôi quyết định đặt MOQ hay chờ**.

**Acceptance Criteria:**
- Given GA-400 booking = 800m², MOQ Phú Mỹ = 2.000m²/lần SX, When check, Then cảnh báo: "Booking 800 < MOQ 2.000. Options: (1) Đặt MOQ 2.000 — excess 1.200 giữ Hub buffer, (2) Chờ tháng sau, (3) Negotiate NM"
- Given GA-300 booking = 4.500m², MOQ Mikado = 3.000m², When check, Then OK — 4.500 ≥ MOQ. Không cảnh báo

### US-F1B3-003: SS Hub Dynamic

As a **Planner**, I want **SS Hub tự động thay đổi khi FC accuracy hoặc NM lead time thay đổi**, so that **buffer luôn phù hợp thực tế, không quá cao (kẹt vốn) hay quá thấp (stockout)**.

**Acceptance Criteria:**
- Given FC MAPE improve 18% → 12%, σ_fc giảm, When SS Hub recalculate, Then SS Hub giảm (vd: 500 → 380m²). Booking giảm tương ứng
- Given NM Mikado trễ liên tục, σ_LT tăng 1d → 3d, When SS Hub recalculate, Then SS Hub tăng (vd: 500 → 720m²). Booking tăng tương ứng. Alert: "SS Hub tăng do NM lead time deteriorating"

## F1B3.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B2 | Approved demand 2 cấp (FC 3 tháng M+1/M+2/M+3) |
| F1-B6 | Hub available + Pipeline stock |
| Master Data | SKU → NM mapping **(bắt buộc khi khai báo SKU)**, MOQ per NM × mã hàng, LT per NM, σ_LT per NM |
| F2-B8 | σ_fc (từ Feedback closed loop → SS Hub recalculate) |

| Feeds into | |
|-----------|---|
| F1-B4 | FC Commitment (booking qty per NM → tách commitment tiers M+1/M+2/M+3) |
| F1-B6 | Hub (projected stock update) |

## F1B3.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B3-001 | Booking netting calculation (all SKU × all NM) | < 10 giây |
| NFR-F1B3-002 | SS Hub recalculate per mã hàng | < 3 giây |
| NFR-F1B3-003 | Netting summary view load | < 3 giây |

## F1B3.8. Out of Scope

- NM production scheduling (thuộc NM internal)
- Procurement negotiation / giá mua (thuộc Purchasing)
- Variant-level breakdown (chưa phân variant ở bước này — variant do F2-B3 gợi ý dựa trên tồn kho CN)
- SS CN (safety stock tại chi nhánh — thuộc F2-B3, tầng 2)
- Tự round up MOQ (chỉ cảnh báo, SC Manager quyết định)

## F1B3.9. Open Questions

- [x] ~~Bản chất B3~~ → **Resolved:** Tính booking = FC 3 tháng + SS Hub buffer − Hub available − Pipeline
- [x] ~~SS Hub~~ → **Resolved:** Buffer nhỏ chống sai số FC + LT NM. Formula: `z × √(LT × σ²_fc + ADU² × σ²_LT)`. Dynamic recalculate. KHÔNG phải toàn bộ demand 3 tháng
- [x] ~~Demand → NM~~ → **Resolved:** Master Data: SKU → NM (1 mã = 1 NM)
- [x] ~~MOQ handling~~ → **Resolved:** Booking < MOQ → CẢNH BÁO (không auto round). SC Manager quyết định
- [x] ~~Excess~~ → **Resolved:** Giữ Hub buffer
- [x] ~~Per tháng hay gộp~~ → **Resolved:** 1 booking tổng per mã hàng. B4 tách thành M+1/M+2/M+3 commitment tiers

---

# F1-B4 — FC Commitment 3 Tầng

**Flow:** 1 — Production Booking (Monthly)
**Step:** 4/7
**Version:** 1.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B4.1. Overview

Từ qty đã round MOQ (B3), tạo FC commitment matrix 3 tầng gửi NM: Hard (M+1 ±5%), Firm (M+2 ±15%), Soft (M+3 ±30%). Mỗi tầng có tolerance và penalty rule khác nhau. NM dùng commitment để lên kế hoạch sản xuất.

## F1B4.2. Problem Statement

UNIS hiện gửi FC cho NM không phân tầng — NM không biết mức độ chắc chắn → hoặc sản xuất dư (lãng phí) hoặc sản xuất thiếu (stockout). Không có penalty rule → UNIS cancel thoải mái, NM mất trust.

## F1B4.3. Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B4-001 | Commitment matrix per NM × 3 horizons: M+1 (Hard), M+2 (Firm), M+3 (Soft) | CRITICAL |
| FR-F1B4-002 | Tolerance per tier: Hard ±5%, Firm ±15%, Soft ±30% | CRITICAL |
| FR-F1B4-003 | Status tracking per NM × tier: locked / negotiate / pending | HIGH |
| FR-F1B4-004 | Auto-generate commitment từ approved demand + MOQ rounding | HIGH |
| FR-F1B4-005 | Penalty flag: khi actual vs committed vượt tolerance → penalty trigger | MEDIUM |

## F1B4.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B4-001 | Hard (M+1): UNIS chịu take-or-pay. NM sản xuất chính thức. Cancel > 5% → penalty | Nghiêm ngặt nhất |
| BR-F1B4-002 | Firm (M+2): NM xếp line sản xuất. Cancel > 15% → penalty | Trung bình |
| BR-F1B4-003 | Soft (M+3): Chỉ indicative. NM dùng mua nguyên liệu. Không penalty | Tham khảo |
| BR-F1B4-004 | Commitment lock theo S&OP cycle: khi S&OP lock (B2) → commitment auto-generate → SC Manager review → lock gửi NM | Sequence |

## F1B4.5. User Stories & Acceptance Criteria

### US-F1B4-001: Commitment Matrix

As a **SC Manager**, I want **xem và lock commitment matrix per NM**, so that **NM nhận số chính thức để sản xuất**.

**Acceptance Criteria:**
- Given MOQ rounded: Mikado 6.000, Toko 6.000, Phú Mỹ 2.000, When generate commitment, Then matrix hiển thị:

| NM | M+1 Hard | M+2 Firm | M+3 Soft | Status |
|----|----------|----------|----------|--------|
| Mikado | 6.000 | 5.500 | 5.000 | locked |
| Toko | 6.000 | 3.500 | 3.000 | negotiate |
| Phú Mỹ | 2.000 | 2.000 | 1.800 | locked |

- Given SC Manager lock all, When gửi NM, Then NM nhận notification với commitment detail

### US-F1B4-002: Penalty Trigger

As a **CFO**, I want **biết khi UNIS vượt tolerance commitment**, so that **tôi chuẩn bị tài chính cho penalty**.

**Acceptance Criteria:**
- Given M+1 Hard committed Mikado = 6.000, actual released cuối tháng = 5.500 (−8.3% > 5%), When tháng kết thúc, Then penalty flag triggered. Alert CFO + SC Manager. Chi tiết: tier Hard, tolerance 5%, actual −8.3%, delta 500m²
- Given M+3 Soft committed = 5.000, actual released = 3.000 (−40%), When check, Then KHÔNG penalty (Soft tier = indicative, no penalty)

## F1B4.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B3 | Rounded qty per NM |
| F1-B2 | Approved demand (horizon M+2, M+3) |

| Feeds into | |
|-----------|---|
| F1-B5 | NM Confirm / Negotiate (commitment → NM response) |
| F1-B7 | Commitment Gap (committed qty → gap tracking) |

## F1B4.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B4-001 | Commitment matrix generation | < 5 giây cho 3 NM × 3 tiers |
| NFR-F1B4-002 | NM notification delivery | < 5 giây |

## F1B4.8. Out of Scope

- NM contract negotiation / legal terms (thuộc Procurement + Legal)
- Invoice / payment processing khi penalty trigger (thuộc Finance AP)
- Multi-currency commitment (UNIS chỉ VND)
- NM production capacity validation (NM tự validate, UNIS chỉ gửi commitment)

## F1B4.9. Open Questions

- [ ] Penalty rules chi tiết: financial terms, enforcement mechanism? — Needs answer from: CFO + Legal
- [ ] FC commitment gửi NM qua kênh nào? — Needs answer from: SC Manager

---

# F1-B5 — NM Confirm / Negotiate

**Flow:** 1 — Production Booking (Monthly)
**Step:** 5/7
**Version:** 1.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B5.1. Overview

Theo dõi phản hồi NM đối với FC commitment đã gửi (B4). NM có thể: Confirm (full accept), Counter (đề xuất qty khác), hoặc Pending (chưa phản hồi). Output là NM confirmed qty → cập nhật Hub ảo (B6).

## F1B5.2. Problem Statement

UNIS gửi commitment cho NM, NM phản hồi không structured, không tracking. Không biết NM nào chưa respond, NM nào counter. Response time không SLA → delay cả cycle.

## F1B5.3. Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B5-001 | NM response tracking: hiển thị per NM: Committed qty, Status (confirmed/counter/pending), Response detail | CRITICAL |
| FR-F1B5-002 | 3 response types: Confirmed (full accept), Counter (max qty khác), Pending (awaiting) | CRITICAL |
| FR-F1B5-003 | NM response SLA: reminder sau 3 ngày, escalate sau 5 ngày | HIGH |
| FR-F1B5-004 | Counter negotiation: khi NM counter, SC Manager decide accept/reject/re-negotiate | HIGH |
| FR-F1B5-005 | NM Portal/Mobile: NM login → xem commitment → respond (confirm/counter/reject) | HIGH |
| FR-F1B5-006 | Multi-layer input: NM respond qua API (Mikado), file upload (Phú Mỹ), hoặc manual (Toko) | HIGH |

## F1B5.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B5-001 | NM confirmed → Hub ảo committed tăng. NM counter → SC Manager quyết định | State transition |
| BR-F1B5-002 | NM response SLA: 3 ngày → reminder. 5 ngày → escalate SC Manager | Configurable |
| BR-F1B5-003 | NM counter qty < committed: SC Manager option: accept counter / find alternative NM / split order | Negotiation |
| BR-F1B5-004 | NM chỉ thấy data liên quan NM mình. Không thấy NM khác hoặc internal UNIS data | Data isolation |

## F1B5.5. User Stories & Acceptance Criteria

### US-F1B5-001: NM Response Tracking

As a **SC Manager**, I want **xem status response tất cả NM trên 1 màn hình**, so that **tôi biết NM nào chưa respond và follow up**.

**Acceptance Criteria:**
- Given commitment đã gửi, When mở NM Response, Then hiển thị:

| NM | Committed | Status | Response |
|----|-----------|--------|----------|
| Mikado | 6.000 | confirmed | Full accept |
| Toko | 6.000 | counter | Max 5.000 |
| Phú Mỹ | 2.000 | pending | Awaiting |

- Given Toko counter 5.000 (thiếu 1.000), When SC Manager xem, Then options: accept 5.000 / find alternative NM cho 1.000 / re-negotiate

### US-F1B5-002: NM Confirm qua Portal

As a **NM (Mikado) Ops**, I want **confirm commitment trên portal/mobile**, so that **tôi respond nhanh mà không cần email qua lại**.

**Acceptance Criteria:**
- Given NM Mikado login, When xem commitment M+1 = 6.000m², Then thấy detail per SKU group. Buttons: Confirm / Counter / Reject
- Given NM confirm, When submit, Then UNIS system auto-update Hub ảo (B6)

## F1B5.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B4 | FC Commitment (committed qty gửi NM) |
| Master Data | NM contact, integration method |

| Feeds into | |
|-----------|---|
| F1-B6 | Hub ảo Update (NM confirmed → committed stock) |
| F1-B7 | Commitment Gap (confirmed vs committed → gap tracking) |

## F1B5.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B5-001 | NM response status dashboard load | < 2 giây |
| NFR-F1B5-002 | NM Portal page load (mobile) | < 3 giây |
| NFR-F1B5-003 | Reminder/escalation delivery | < 5 giây |

## F1B5.8. Out of Scope

- NM Portal full ERP integration (chỉ commitment confirm, không quản lý NM operations)
- NM performance review meeting workflow (chỉ trigger alert, meeting là offline)
- Multi-language NM Portal (Phase 2 — Vietnamese only Phase 1)
- NM self-registration (UNIS invite-only Phase 1)

## F1B5.9. Open Questions

- [ ] NM Portal: self-service hay UNIS invite-only? — Needs answer from: CISO
- [ ] NM manual response: ai nhập vào hệ thống khi NM respond ngoài portal? — Needs answer from: SC Manager

---

# F1-B6 — Hub ảo Update

**Flow:** 1 — Production Booking (Monthly)
**Step:** 6/7
**Version:** 1.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B6.1. Overview

Cập nhật Hub stock dựa trên NM confirmed (B5).

**Hub hiện tại = tổng tồn kho toàn bộ chi nhánh** (sum tồn kho tất cả CN). Sau này có thể chuyển thành **kho tổng vật lý** (1 hoặc nhiều kho tổng). Logic không đổi, chỉ thay đổi data source.

Dashboard hiển thị: NM confirmed / Đã release / Hub available.

## F1B6.2. Problem Statement

UNIS không có physical Hub. NM ship thẳng CN. Nhưng DRP cần "supply pool" để netting. Không có Hub ảo → DRP không biết supply available → allocation sai.

## F1B6.3. Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B6-001 | Hub ảo stock formula: `Available = Σ(NM confirmed) − Σ(PO released) − Hub SS` | CRITICAL |
| FR-F1B6-002 | Hub ảo dashboard: NM confirmed / Đã release / Available + progress bar (% released) | HIGH |
| FR-F1B6-003 | Real-time recalculate khi: NM confirm thay đổi, PO released (từ Flow 2 B7), SS thay đổi | HIGH |
| FR-F1B6-004 | Hub ảo cluster: mỗi Hub phục vụ nhóm CN. Phase 1: 1 Hub ảo. Phase 2: 3-4 physical Hub | HIGH |
| FR-F1B6-005 | Hub ảo NM assignment: danh sách NM per Hub. 1 NM có thể serve nhiều Hub | MEDIUM |
| FR-F1B6-006 | Allocatable = Available − SS protected. Chỉ allocatable mới vào DRP | CRITICAL |

## F1B6.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B6-001 | Hub ảo Phase 1: stock "nằm tại NM". PO Release → NM ship thẳng CN | Không qua kho vật lý |
| BR-F1B6-002 | Phase 1→2: chỉ thêm data records (hub_type virtual→physical), không thay đổi logic | Architecture decision |
| BR-F1B6-003 | NM confirmed giảm bất ngờ (vd: 5.000→3.000) → Hub ảo giảm 2.000. CRITICAL alert. DRP urgent re-run. NM reliability score giảm | Edge case quan trọng |
| BR-F1B6-004 | Hub ảo available là cross-reference chính giữa Flow 1 và Flow 2 | Bridge point |
| BR-F1B6-005 | **Hub ảo available < 0** (released > committed, vd: NM giảm commitment sau khi PO đã release) → CRITICAL alert. Freeze PO release cho NM đó. SC Manager phải resolve (NM re-confirm hoặc cancel PO) trước khi unfreeze | Edge case quan trọng |
| BR-F1B6-006 | Hub ảo allocatable = 0 nhưng CN có urgent demand → escalate SC Manager. Options: emergency NM call, LCNB scan, accept delay | Zero allocatable |

## F1B6.5. User Stories & Acceptance Criteria

### US-F1B6-001: Hub ảo Dashboard

As a **SC Manager**, I want **xem Hub ảo available real-time**, so that **tôi biết supply pool đủ cho CN demand không**.

**Acceptance Criteria:**
- Given NM confirmed = 13.000m², PO đã release = 6.200m², Hub SS = protected, When xem dashboard, Then hiển thị:
  - NM confirmed: 13.000
  - Đã release: 6.200
  - Hub ảo available: 6.800
  - Progress bar: 48% released
- Given Hub ảo available 6.800, SS protected 2.000, When DRP check, Then Allocatable = 4.800

### US-F1B6-002: NM Giảm Commitment

As a **SC Manager**, I want **nhận CRITICAL alert khi NM giảm commitment đột ngột**, so that **tôi ưu tiên xử lý trước khi CN bị stockout**.

**Acceptance Criteria:**
- Given NM Mikado confirmed giảm 5.000→3.000 (−2.000m²), When update, Then CRITICAL alert. Hub ảo available giảm. DRP urgent re-run. NM reliability score giảm. Nếu breach > 2 lần/quý → NM review

## F1B6.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B5 | NM confirmed qty |
| F2-B7 | PO released qty (feedback từ Daily DRP) |
| Safety Stock | Hub SS values |

| Feeds into | |
|-----------|---|
| **F2-B3** | **DRP Netting (Hub ảo allocatable = supply pool chính)** |
| F1-B7 | Commitment Gap (committed vs released tracking) |

## F1B6.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B6-001 | Hub ảo stock recalculate | < 2 giây cho 3 NM × 500 SKU |
| NFR-F1B6-002 | Dashboard refresh after PO release | Near real-time (< 5 giây) |
| NFR-F1B6-003 | Phase 1 → Phase 2 transition | Zero code change, data-only |

## F1B6.8. Out of Scope

- Physical warehouse management tại Hub — Phase 2
- Physical Hub location selection / real estate
- Cross-hub transfer optimization (Phase 3)
- NM production tracking detail (chỉ track committed qty, không track NM internal production)
- Hub inventory counting / cycle count (thuộc hệ thống kho)

## F1B6.9. Open Questions

- [ ] Hub ảo Phase 1: 1 Hub HCM hay cần Hub HN ngay? — Needs answer from: COO
- [ ] Hub SS: formula hay fixed days? — Needs answer from: SC Manager

---

# F1-B7 — Commitment Gap & Scenario Simulator

**Flow:** 1 — Production Booking (Monthly)
**Step:** 7/7
**Version:** 1.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F1B7.1. Overview

Giám sát gap giữa NM committed vs PO released trong tháng. Khi release pace chậm → auto-alert theo ngưỡng escalation. Scenario Simulator mô phỏng 4 kịch bản xử lý gap với cost/risk để SC Manager quyết định.

## F1B7.2. Problem Statement

UNIS gửi commitment NM đầu tháng nhưng không monitor release pace. Cuối tháng phát hiện gap → NM áp giá tier 2 (retroactive), hoặc hàng rollover. Không có tool so sánh trade-off → quyết định bằng cảm tính.

## F1B7.3. Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F1B7-001 | Gap tracker per NM: Committed / Released / % / Pace / Alert status | CRITICAL |
| FR-F1B7-002 | Alert escalation: Day 20 gap > 15% → SC Manager. Day 25 gap > 10% → CEO. Day 28 → auto-trigger scenario | CRITICAL |
| FR-F1B7-003 | Scenario Simulator 4 kịch bản: A (Buy all), B (Higher price), C (Negotiate rollover), D (Hybrid) | HIGH |
| FR-F1B7-004 | Cost/risk per scenario: hiển thị VND cost, risk description | HIGH |
| FR-F1B7-005 | AI recommendation: suggest scenario tối ưu dựa trên gap size, demand trend, NM relationship | HIGH |
| FR-F1B7-006 | SC Manager reject all 4 → escalate CEO → custom Scenario E. Day 30 unresolved → force carry-forward + penalty | HIGH |

## F1B7.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F1B7-001 | Gap formula: `gap_pct = (committed − released) / committed × 100` | Daily track |
| BR-F1B7-002 | Scenario A: cost = gap × price_tier_1. Risk: tồn chất đống | Full buy |
| BR-F1B7-003 | Scenario B: cost = committed × (price_tier_2 − price_tier_1). Risk: retroactive TOÀN BỘ hàng bị uplift | Expensive |
| BR-F1B7-004 | Scenario C: cost = negotiation effort. Risk: NM phải đồng ý | Recommended khi NM relationship tốt |
| BR-F1B7-005 | Scenario D: 50% buy + 50% rollover. Balance risk | Default fallback |
| BR-F1B7-006 | SC Manager chọn C nhưng NM reject → auto-recalculate, highlight A hoặc D | Fallback chain |

## F1B7.5. User Stories & Acceptance Criteria

### US-F1B7-001: Gap Tracker

As a **SC Manager**, I want **xem gap per NM real-time**, so that **tôi hành động sớm trước deadline**.

**Acceptance Criteria:**
- Given Mikado: committed 6.000, released 4.100, When xem tracker, Then gap = 31% (1.900m²), pace = "Need 1.900 in 8d", alert = "at risk"
- Given Toko: committed 5.000, released 4.500, When xem, Then gap = 10%, pace = "Need 500 in 8d", alert = "on track"

### US-F1B7-002: Scenario Simulator

As a **SC Manager**, I want **so sánh 4 kịch bản xử lý gap Mikado 1.900m²**, so that **tôi chọn option tối ưu cost/risk**.

**Acceptance Criteria:**
- Given gap Mikado 1.900m², When simulator run, Then hiển thị:

| Kịch bản | Cost | Risk |
|----------|------|------|
| A: Mua hết | 171M VND | Tồn chất đống |
| B: Chịu giá cao | 50M VND | Retroactive |
| **C: Negotiate (recommended)** | **17M VND** | **NM agree** |
| D: Hybrid | 99M VND | Balance |

- Given SC Manager chọn C, When NM reject, Then auto-show A và D alternatives. Alert SC Manager

## F1B7.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B4 | Committed qty per NM |
| F1-B6 | Hub ảo released qty |
| F2-B7 | PO release data (daily update from DRP) |
| Master Data | NM price tiers, relationship score |

| Feeds into | |
|-----------|---|
| F2-B6 | NM ATP adjustment (gap → adjust effective commitment) |
| F1-B6 | Hub ảo (scenario decision → commitment update) |

## F1B7.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F1B7-001 | Gap monitor daily check | < 30 giây toàn network |
| NFR-F1B7-002 | Scenario calculation (4 scenarios × 1 NM × 3 price tiers) | < 10 giây |
| NFR-F1B7-003 | Alert delivery | < 5 giây end-to-end |

## F1B7.8. Out of Scope

- NM contract renegotiation workflow (chỉ trigger scenario, negotiation là offline)
- NM payment / invoice processing khi penalty (thuộc Finance AP)
- Multi-NM combined gap optimization (Phase 2 — xử lý per NM Phase 1)
- Deep AI autonomous scenario selection (Phase 3 — AI chỉ recommend, human decide Phase 1)

## F1B7.9. Open Questions

- [ ] Gap alert thresholds (Day 20/15%, Day 25/10%): phù hợp UNIS? — Needs answer from: SC Manager
- [ ] Scenario B retroactive price: NM nào áp dụng? — Needs answer from: CFO
- [ ] Custom Scenario E: structured input hay free-form? — Needs answer from: CPO

---
---

# FLOW 2: DAILY DRP (NIGHTLY 23:00)

**Nhịp:** 23:00 hàng đêm. Engine phân bổ Hub ảo → CN.

---

# F2-B1 — Data Sync

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 1/8
**Version:** 2.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F2B1.1. Overview

Đồng bộ dữ liệu tồn kho từ **2 nguồn** + **1 derived calculation**:

| # | Nguồn | Data | Phục vụ | Sync từ đâu |
|---|-------|------|---------|-------------|
| 1 | **Tồn kho CN** | Per CN × SKU có đuôi (variant) | F2-B3 netting, F2-B4 allocation | Tích hợp từ Bravo per CN |
| 2 | **NM snapshot** | Tồn NM per SKU | F2-B6 ATP check (NM có hàng ship không?) | NM cung cấp (nhiều hình thức) |
| — | **Hub ảo** (derived) | = Σ(tồn kho tất cả CN) per SKU không đuôi | F1-B3 booking (so với SS Hub → đặt NM) | Tính toán từ data CN, không sync riêng |

**2 lần sync/ngày:**
- **Sync sáng (trước giờ làm việc):** cho Planner xem dashboard, chuẩn bị ngày làm việc
- **Sync tối (trước DRP 23:00):** data fresh nhất cho DRP netting. Đảm bảo DRP không chạy trên data 17h cũ

Data freshness gate bắt buộc — NM data stale sẽ BLOCK PO Release ở bước B6.

## F2B1.2. Problem Statement

DRP netting chạy trên data không fresh → allocation sai → PO sai. Một số NM báo cáo thủ công → data có thể stale 24-48h. Không có freshness gate → hệ thống vẫn chạy trên data cũ mà không ai biết. Hiện không có log/audit cho việc sync → không biết data lần cuối update khi nào.

## F2B1.3. Functional Requirements

### Data Sync

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B1-001 | **Tồn kho CN từ Bravo:** sync tồn kho per CN × SKU có đuôi (variant level). Master Data biết SKU có đuôi thuộc SKU không đuôi nào. Aggregate lên SKU không đuôi → Hub ảo | CRITICAL |
| FR-F2B1-002 | **NM snapshot via upload:** NM upload tồn kho per SKU qua file template chuẩn (SCP build template cho NM). Template gồm: SKU, qty on-hand, ngày cập nhật. Validate khi upload: format đúng, SKU tồn tại trong Master Data | CRITICAL |
| FR-F2B1-002b | **NM upload template:** SCP cung cấp template tải về cho NM. NM điền tồn kho → upload lên SCP. Template per NM (pre-fill danh sách SKU NM đó sản xuất) | HIGH |
| FR-F2B1-003 | **Hub ảo = derived:** tự động tính Σ(tồn CN) per SKU không đuôi sau mỗi lần sync CN. Không phải source riêng — là kết quả tính toán | HIGH |
| FR-F2B1-004 | **Pipeline stock:** sync trạng thái shipment đang trên đường (đã ship, chưa tới CN). Phục vụ F2-B3 netting (trừ hàng đang về, tránh kéo thừa) | HIGH |
| FR-F2B1-005 | **2 lần sync/ngày:** sync sáng (cho dashboard) + sync tối trước DRP (cho netting fresh data) | CRITICAL |

### Freshness Gate

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B1-006 | **Freshness dashboard:** hiển thị per source — last sync, age, phương thức, status (fresh/stale) | HIGH |
| FR-F2B1-007 | **Freshness gate NM:** NM data quá hạn → flag STALE. PO Release cho NM đó bị BLOCK tại F2-B6 | CRITICAL |
| FR-F2B1-008 | **Stale alert:** notification Planner + SC Manager khi source bị stale | HIGH |

### Sync Log & Manual Sync

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B1-009 | **Sync log:** ghi nhận mỗi lần sync — source, thời gian, số records success/fail, status, error detail (nếu có). Xem được lịch sử sync | HIGH |
| FR-F2B1-010 | **Nút Sync Manual:** trên dashboard có nút trigger sync thủ công per source (CN hoặc NM). Dùng khi cần data fresh ngoài lịch 2 lần/ngày, hoặc khi sync tự động fail | HIGH |
| FR-F2B1-011 | **Sync failure handling:** sync fail → dùng data lần sync gần nhất + flag "data outdated, last sync [timestamp]" + alert Planner. DRP vẫn chạy nhưng cảnh báo kết quả dựa trên data cũ | HIGH |

## F2B1.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B1-001 | **Tồn CN từ Bravo:** data per CN × SKU có đuôi (variant level). Ví dụ: CN-BD × GA-300-A4 = 500m², CN-BD × GA-300-B2 = 200m². Master Data map: GA-300-A4 → thuộc GA-300 (không đuôi) | Variant detail |
| BR-F2B1-002 | **Hub ảo = Σ(CN):** Hub ảo GA-300 = CN-BD(700) + CN-ĐN(450) + CN-HN(350) + CN-CT(200) = 1.700m². Tự tính sau mỗi sync CN, không phải source riêng | Derived |
| BR-F2B1-003 | **NM freshness gate:** tính từ thời điểm NM upload file. Freshness threshold configurable per NM (default 24h). Quá threshold → STALE | Configurable |
| BR-F2B1-004 | **NM data stale + CN HSTK < 3 ngày (urgent)** → BLOCK auto-release NHƯNG alert SC Manager cho manual override | Safety vs urgency |
| BR-F2B1-005 | **2 sync/ngày:** sync sáng (cho dashboard) + sync tối ~22:00 (cho DRP 23:00). DRP PHẢI dùng data từ sync tối, không phải sync sáng | Fresh data cho DRP |
| BR-F2B1-006 | **Sync fail → graceful degradation:** dùng data cũ + flag outdated + alert. DRP vẫn chạy nhưng output marked "based on stale data [timestamp]" | Không block DRP |

## F2B1.5. User Stories & Acceptance Criteria

### US-F2B1-001: Data Freshness Dashboard

As a **Planner**, I want **xem freshness tất cả sources**, so that **tôi biết data nào stale trước DRP chạy**.

**Acceptance Criteria:**
- Given sync tối 22:00 xong, When mở dashboard, Then hiển thị per source: last sync, age, method, status (fresh/stale)
- Given NM-X data stale quá threshold, When alert, Then Planner + SC Manager nhận notification "NM-X data stale. PO Release bị BLOCK"

### US-F2B1-002: Sync Log

As a **Planner**, I want **xem lịch sử sync**, so that **tôi biết data sync thành công hay fail, bao nhiêu records**.

**Acceptance Criteria:**
- Given sync tối 22:00 chạy xong, When mở Sync Log, Then thấy: source, timestamp, records success/fail, status, error (nếu có)
- Given sync CN fail (hệ thống kho CN down), When xem log, Then thấy: status = FAILED, error = "connection timeout", last successful sync = 06:00 sáng

### US-F2B1-003: Manual Sync

As a **Planner**, I want **trigger sync thủ công khi cần**, so that **tôi không phải chờ lịch sync tự động**.

**Acceptance Criteria:**
- Given Planner nhấn "Sync Now" cho NM-X, When trigger, Then sync chạy ngay, log ghi nhận "manual trigger by [user]", dashboard refresh
- Given sync manual thành công, When xem dashboard, Then NM-X freshness update, status = fresh

### US-F2B1-004: Sync Failure

As a **Planner**, I want **DRP vẫn chạy khi sync fail**, so that **planning không bị block hoàn toàn**.

**Acceptance Criteria:**
- Given sync tối CN fail, When DRP 23:00 chạy, Then DRP dùng data sync sáng (06:00). Output marked: "DRP based on stale CN data (last sync 06:00). Review results"
- Given sync CN fail 2 ngày liên tiếp, When check, Then alert CRITICAL cho SC Manager

## F2B1.6. Dependencies

| Depends on | Data |
|-----------|------|
| Bravo (ERP) | Tồn kho per CN × SKU có đuôi |
| NM systems | NM inventory snapshot per SKU |
| Master Data | SKU có đuôi → SKU không đuôi mapping |

| Feeds into | |
|-----------|---|
| F2-B3 | DRP Netting (tồn CN + Hub ảo + Pipeline) |
| F2-B6 | NM ATP Check (NM snapshot) |
| F1-B3 | Hub ảo available (= Σ CN) cho booking calculation |

## F2B1.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B1-001 | Full sync (tất cả CN + tất cả NM) | < 5 phút |
| NFR-F2B1-002 | Freshness dashboard load | < 2 giây |
| NFR-F2B1-003 | Stale alert delivery | < 5 giây sau phát hiện |
| NFR-F2B1-004 | Manual sync trigger → complete | < 3 phút |

## F2B1.8. Out of Scope

- Triển khai hệ thống kho tại CN (chỉ consume data từ Bravo)
- NM internal inventory management (chỉ consume snapshot)
- Historical inventory warehousing (chỉ snapshot hiện tại)
- Data transformation phức tạp (chỉ sync + validate)

## F2B1.9. Open Questions

- [x] ~~Sync timing~~ → **Resolved:** 2 lần/ngày: sáng (dashboard) + tối 22:00 (DRP). Tích hợp tồn kho từ Bravo per CN
- [x] ~~Hub ảo source~~ → **Resolved:** Hub ảo = derived (Σ CN), không phải source riêng
- [x] ~~Data scope~~ → **Resolved:** CN per SKU có đuôi (variant) từ Bravo. NM per SKU. Pipeline stock
- [x] ~~Sync failure~~ → **Resolved:** Graceful degradation — dùng data cũ + flag + alert. DRP vẫn chạy
- [x] ~~Manual sync~~ → **Resolved:** Nút Sync Manual per source trên dashboard + sync log view
- [x] ~~NM data method~~ → **Resolved:** NM upload tồn kho qua file template chuẩn (SCP build template per NM, pre-fill danh sách SKU). Freshness tính từ thời điểm upload

---

# F2-B2 — CN Demand Adjustment

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 2/8
**Version:** 2.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F2B2.1. Overview

CN Manager điều chỉnh demand **per SKU không đuôi** trước DRP run hàng đêm (08:00-18:00). CN có local intelligence (nhà thầu mới, dự án delay) mà demand forecast từ B1 không capture.

**Lưu ý:**
- Demand forecast từ B1 (3rd-party upload/tích hợp) chỉ tới **SKU không đuôi** (GA-300, không phải GA-300-A4)
- B2 (S&OP) adjust trên SKU không đuôi → approved demand per CN × SKU không đuôi
- F2-B2 (module này) CN adjust trên **approved demand từ B2**, cũng per **SKU không đuôi**
- Variant breakdown (đuôi màu) do F2-B3 DRP gợi ý dựa trên tồn kho CN

Cutoff 18:00 cứng. Trust score đo accuracy adjustment của mỗi CN.

## F2B2.2. Problem Statement

DRP gross requirement từ approved demand (B2) — không phản ánh thay đổi local trong ngày. CN hiện liên hệ Planner ngoài hệ thống → không audit, chậm, dễ sai.

## F2B2.3. Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B2-001 | **Auto-phasing:** FC monthly (B2 approved) tự động chia đều 4 tuần. Ví dụ: tháng 5 = 4.000m² → tuần = 1.000m². Chạy tự động đầu tháng, không cần user action | CRITICAL |
| FR-F2B2-002 | CN Manager adjust demand **per SKU không đuôi per tuần** cho CN mình qua mobile form (08:00-18:00). Base demand = weekly demand đã phasing | CRITICAL |
| FR-F2B2-003 | Tolerance constraint: ± tolerance % (default ±30%). Vượt → SC Manager review | CRITICAL |
| FR-F2B2-004 | Cutoff 18:00: lock adjustment. Sau cutoff → chỉ SC Manager emergency override (SC Manager đủ quyền, không cần CEO) | HIGH |
| FR-F2B2-005 | Reason code bắt buộc: nhà thầu mới, dự án delay, đối thủ, thời tiết, promotion, khác | HIGH |
| FR-F2B2-006 | Trust score per CN: tính per tuần. `trust = Σ(tuần |adjusted − actual| < ±20%) / tổng số tuần × 100`. Rolling 12 tuần. Configurable | HIGH |
| FR-F2B2-007 | Trust-based rules: trust > 85% → auto-approve. Trust < 60% → tolerance giảm ±15% | HIGH |
| FR-F2B2-008 | **Final demand = Weekly phased demand + CN adjustment (approved) → gross requirement cho DRP 23:00** | CRITICAL |

## F2B2.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B2-001 | 08:00-18:00: CN adjust. 18:00: cutoff lock. 18:00-18:30: SC Manager review vượt tolerance. 23:00: DRP dùng adjusted demand | Daily timeline |
| BR-F2B2-002 | CN adjust 18:01 → rejected. Hiển thị lý do: quá hạn cutoff | Hard cutoff |
| BR-F2B2-003 | CN adjust demand = 0 → accept (valid). DRP skip CN đó cho SKU đó. Warning nếu actual > 0 trong lead time. Trust penalized | Zero valid |
| BR-F2B2-004 | +30% = tolerance limit → cần SC Manager approve trước 18:00 | Boundary case |
| BR-F2B2-005 | **Adjust per SKU không đuôi** (GA-300). Không per variant (GA-300-A4). Variant do F2-B3 DRP gợi ý dựa trên tồn kho CN | Granularity |
| BR-F2B2-006 | **Base demand = approved demand từ B2 đã phasing xuống tuần.** FC monthly (B2) → phasing weekly → CN adjust per tuần. Không phải FC gốc từ B1 | Base demand source |

## F2B2.5. User Stories & Acceptance Criteria

### US-F2B2-001: CN Demand Adjustment

As a **CN Manager (CN-BD)**, I want **điều chỉnh demand per SKU không đuôi trước DRP chạy**, so that **thông tin local phản ánh vào planning đêm nay**.

**Acceptance Criteria:**
- Given approved demand (B2) cho CN-BD: GA-300 = 500m², GA-400 = 100m², When CN-BD Manager mở adjust form, Then thấy base demand per SKU không đuôi. Có thể adjust: GA-300: 500 → 650 (+30%, reason: "nhà thầu mới")
- Given CN-BD adjust GA-300 +30% (= tolerance limit), When submit 17:30, Then saved nhưng status = "review". SC Manager nhận approval request
- Given CN-BD adjust 18:01, When submit, Then rejected: "Quá hạn cutoff 18:00"
- Given CN-ĐN trust 91% (> 85%), adjustment within tolerance, When submit, Then auto-approved

### US-F2B2-002: SC Manager Review

As a **SC Manager**, I want **review adjustments vượt tolerance trước cutoff**, so that **DRP 23:00 dùng số đã approved**.

**Acceptance Criteria:**
- Given CN-BD +30% cần review, When SC Manager mở review 18:00-18:30, Then thấy: CN, SKU, base demand, adjusted, delta%, reason, trust score. Approve/Reject
- Given SC Manager không review trước 18:30, When DRP 23:00, Then adjustment chưa approved → DRP dùng base demand (B2) cho CN-BD GA-300 = 500 (không phải 650)

## F2B2.6. Dependencies

| Depends on | Data |
|-----------|------|
| F1-B2 | Approved demand per CN × SKU không đuôi (base demand) |
| Master Data | CN, SKU không đuôi |

| Feeds into | |
|-----------|---|
| F2-B3 | DRP Netting (final demand = B2 approved + CN adjustment) |

## F2B2.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B2-001 | CN adjustment aggregate | < 1 giây |
| NFR-F2B2-002 | Mobile form load | < 2 giây |
| NFR-F2B2-003 | Trust score recalculate | < 5 giây per CN |
| NFR-F2B2-004 | Cutoff lock enforcement | Exact 18:00 |

## F2B2.8. Out of Scope

- Demand forecasting / FC engine (FC từ B1, adjust tại B2. Module này chỉ adjust daily)
- CN sales order management (thuộc ERP)
- Variant-level adjustment (variant do F2-B3 DRP gợi ý, không phải CN chọn)
- Offline adjustment mode (Phase 2)

## F2B2.9. Open Questions

- [x] ~~Adjust level~~ → **Resolved:** Per SKU không đuôi (GA-300). Variant do F2-B3
- [x] ~~Base demand~~ → **Resolved:** Approved demand từ B2 (đã lock)
- [x] ~~Trust score window~~ → **Resolved:** Tính per tuần (vì FC phased xuống tuần). Rolling 12 tuần. Threshold ±20%. Configurable
- [x] ~~Emergency override~~ → **Resolved:** SC Manager đủ quyền override sau cutoff (đã là decision authority từ B2). Không cần CEO
- [x] ~~Phasing~~ → **Resolved:** Phasing monthly → weekly nằm trong F2-B2 (bước đầu tự động). **Chia đều:** FC monthly / 4 = weekly. Ví dụ: FC tháng 5 = 4.000m² → mỗi tuần = 1.000m². CN adjust trên số weekly này

---

# F2-B3 — DRP Netting + Safety Stock CN

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 3/8
**Version:** 2.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F2B3.1. Overview

Netting **per CN** — mỗi CN có đủ hàng cho tuần này không? Chạy 23:00 hàng đêm.

```
Per CN × SKU không đuôi:
  Net req = Gross req (weekly từ F2-B2) − On-hand (tồn CN) − Pipeline (đang về CN) + SS CN guard
```

Sau netting per SKU không đuôi → **variant suggestion** phân rã thành SKU có đuôi dựa trên tỷ trọng tồn kho CN.

**Phân biệt với F1-B3:**
- F1-B3 = netting cấp Hub (đặt NM, monthly, SS Hub)
- F2-B3 = netting **cấp CN** (kéo hàng về CN, nightly, **SS CN**)

Output: net requirement per CN × SKU (không đuôi + variant suggestion) → đưa vào Allocation (F2-B4).

## F2B3.2. Problem Statement

Planner hiện tính netting thủ công. Không tính variant (ship sai đuôi màu), không tính pipeline (đặt trùng hàng đang về), không có SS CN tự động (dùng cảm giác).

## F2B3.3. Functional Requirements

### DRP Netting per CN

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B3-001 | **Netting per CN × SKU không đuôi**, 23:00 nightly | CRITICAL |
| FR-F2B3-002 | **Netting formula:** `Net req = Gross req − On-hand − Pipeline + SS CN`. Per CN × SKU không đuôi | CRITICAL |
| FR-F2B3-003 | **Gross req** = weekly phased demand + CN adjustment (output F2-B2). Per CN × SKU không đuôi | CRITICAL |
| FR-F2B3-004 | **On-hand** = tồn kho CN per SKU không đuôi = Σ(tất cả variant của SKU đó tại CN). Data từ F2-B1 sync tối | CRITICAL |
| FR-F2B3-005 | **Pipeline** = hàng đã ship đang trên đường **tới CN cụ thể** (từ NM hoặc LCNB từ CN khác). Trừ khỏi net req tránh kéo trùng | HIGH |
| FR-F2B3-006 | **Netting = 0 khi đủ:** On-hand + Pipeline ≥ Gross req + SS CN → CN đủ hàng, net req = 0 | HIGH |

### Variant Suggestion

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B3-007 | **Variant suggestion:** net req per SKU không đuôi → phân rã thành SKU có đuôi (variant) dựa trên **tỷ trọng tồn kho hiện tại của CN**. Ví dụ: CN-BD tồn GA-300: A4=80%, B2=15%, C1=5% → net req 500m² phân rã: A4=400, B2=75, C1=25 | CRITICAL |
| FR-F2B3-008 | **Planner override variant:** Planner có thể điều chỉnh tỷ trọng variant nếu biết CN cần đuôi cụ thể | HIGH |

### Safety Stock CN (Tầng 2)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B3-009 | **SS CN formula:** `SS_CN = z × √(LT_hub_cn × σ²_demand + ADU² × σ²_LT_hub_cn)`. LT Hub→CN = 1-2 ngày. σ_demand từ actual sales per CN × SKU. SS CN protect against demand variance + transit variance | CRITICAL |
| FR-F2B3-010 | **LCNB factor:** SS CN giảm 25% khi LCNB enabled (network effect — CN hỗ trợ nhau). Configurable | HIGH |
| FR-F2B3-011 | **SS CN per SKU không đuôi per CN.** Mỗi CN × SKU có SS riêng (demand pattern khác nhau) | HIGH |

### Views

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B3-012 | **Netting tổng view:** per CN: Gross req / On-hand / Pipeline / SS CN / Net req / Status | HIGH |
| FR-F2B3-013 | **Per SKU drill-down:** per SKU × Variant cho từng CN với status (shortage/tight/ok) | HIGH |

## F2B3.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B3-001 | **Netting per CN × SKU không đuôi.** On-hand tại CN = Σ(variant). Variant suggestion sau netting | Granularity |
| BR-F2B3-002 | **Variant strict khi allocation (F2-B4):** A4 ≠ B2. Nhưng netting ở F2-B3 tính per SKU không đuôi trước, variant suggestion sau | Sequence |
| BR-F2B3-003 | **Pipeline per CN = hàng đang về CN đó.** Bao gồm: shipment từ NM + LCNB transfer từ CN khác. Chỉ hàng đã ship, đang trên đường | Giống F1-B3 definition |
| BR-F2B3-004 | **SS CN ≠ SS Hub.** SS CN protect transit Hub→CN (1-2d, nhỏ). SS Hub protect NM LT (14-20d, lớn hơn). SS Hub thuộc F1-B3, không tính lại ở đây | 2 tầng tách rõ |
| BR-F2B3-005 | **Service level z:** default 1.65 (95%). SC Manager override per CN × SKU cho critical items. Configurable | z factor |
| BR-F2B3-006 | **DRP run failure:** rollback toàn batch, giữ kết quả run trước. Alert admin + Planner. Auto-retry 1 lần sau 15 phút. Retry fail → manual | Failure handling |
| BR-F2B3-007 | **Variant suggestion dựa trên tồn kho hiện tại**, KHÔNG dựa trên lịch sử bán. Vì tồn kho phản ánh đuôi nào CN đang thiếu/dư | Logic suggestion |
| BR-F2B3-008 | **DRP dùng data sync tối (F2-B1)**, không dùng sync sáng. Đảm bảo data fresh nhất | Data source |

## F2B3.5. User Stories & Acceptance Criteria

### US-F2B3-001: DRP Netting per CN

As a **Planner**, I want **xem netting per CN sáng hôm sau**, so that **tôi biết CN nào thiếu hàng tuần này**.

**Acceptance Criteria:**
- Given DRP 23:00 hoàn thành, When mở netting view, Then hiển thị per CN:

| | CN-BD | CN-ĐN | CN-HN | CN-CT | Total |
|--|-------|-------|-------|-------|-------|
| Gross req (weekly) | 250 | 100 | 125 | 25 | 500 |
| Pipeline | 50 | 0 | 40 | 0 | 90 |
| On-hand | 80 | 450 | 50 | 200 | 780 |
| SS CN | 37 | 42 | 38 | 35 | 152 |
| **Net req** | **157** | **0** | **73** | **0** | **230** |

- Given CN-ĐN on-hand 450 > gross req 100 + SS 42, Then net req = 0, status "Đủ hàng"
- Given CN-BD on-hand 80 < gross req 250, Then net req > 0, status "Shortage"

### US-F2B3-002: Variant Suggestion

As a **Planner**, I want **xem variant breakdown cho net req**, so that **tôi biết CN cần đuôi màu nào**.

**Acceptance Criteria:**
- Given CN-BD net req GA-300 = 157m², tồn CN-BD: GA-300-A4=60m²(75%), GA-300-B2=15m²(19%), GA-300-C1=5m²(6%), When variant suggestion, Then: A4=118m², B2=30m², C1=9m²
- Given Planner biết CN-BD cần thêm B2 (khách đặt cụ thể), When override, Then adjust B2 tăng, A4 giảm. Logged

### US-F2B3-003: SS CN

As a **Planner**, I want **SS CN tự động tính per CN × SKU**, so that **mỗi CN có buffer phù hợp demand pattern của CN đó**.

**Acceptance Criteria:**
- Given CN-BD demand GA-300 variance cao (CV=0.39), LT Hub→CN = 1.5 ngày, When SS calc, Then SS CN-BD GA-300 = 37m²
- Given LCNB enabled, When recalculate, Then SS CN-BD giảm 25% → 28m²

## F2B3.6. Dependencies

| Depends on | Data |
|-----------|------|
| F2-B1 | Tồn CN per SKU có đuôi (sync tối) + Pipeline per CN |
| F2-B2 | Weekly phased demand + CN adjustment (gross requirement) |
| Master Data | SKU có đuôi → SKU không đuôi mapping, LT Hub→CN per CN |

| Feeds into | |
|-----------|---|
| F2-B4 | Allocation (net req per CN × SKU + variant suggestion → allocate source) |

## F2B3.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B3-001 | DRP netting batch (all CN × all SKU) | < 10 phút |
| NFR-F2B3-002 | SS CN recalculation toàn network | < 2 phút |
| NFR-F2B3-003 | Netting summary view load | < 3 giây |
| NFR-F2B3-004 | Variant suggestion per CN × SKU | < 5 giây |

## F2B3.8. Out of Scope

- Netting cấp Hub / đặt NM (thuộc F1-B3 — Flow 1)
- SS Hub calculation (thuộc F1-B3)
- Allocation / quyết định lấy từ đâu (thuộc F2-B4)
- Full MEIO optimization (Phase 3)
- Concurrent optimizer (Phase 3)

## F2B3.9. Open Questions

- [x] ~~Netting level~~ → **Resolved:** Per CN × SKU không đuôi. Variant suggestion sau netting
- [x] ~~SS scope~~ → **Resolved:** F2-B3 chỉ SS CN (tầng 2). SS Hub thuộc F1-B3
- [x] ~~Gross req source~~ → **Resolved:** F2-B2 output (weekly phased + CN adjusted)
- [x] ~~Data source~~ → **Resolved:** Sync tối F2-B1 (data fresh trước DRP 23:00)
- [x] ~~Seasonal σ history~~ → **Resolved:** 2 năm (đủ 2 mùa xây dựng để so sánh). Configurable — tăng lên 3 năm khi có thêm data

---

# F2-B4 — Allocation

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 4/8
**Version:** 2.0 | **Updated:** 2026-04-13 | **Status:** Draft

---

## F2B4.1. Overview

Nhận net requirement per CN (từ F2-B3). Quyết định **CN thiếu thì lấy từ đâu** theo thứ tự ưu tiên:

1. **LCNB trước:** CN dư ở gần nhất chuyển cho CN thiếu (lateral transfer). Ưu tiên theo khoảng cách (vị trí CN từ Master Data)
2. **Hub ảo pool sau:** hàng đã booking NM nhưng chưa release cho CN nào (= NM confirmed − PO đã released). Sau này Hub pool = tồn kho tổng vật lý

Cả 2 nguồn đều chạy qua constraints: **Variant match → FIFO → Fair-share → SS guard.**

Output: LCNB Transfer Orders + PO Release list → F2-B5 (Transport).

## F2B4.2. Problem Statement

UNIS allocate bằng kinh nghiệm → sai variant (A4 cấp cho đơn B2), không FIFO (hàng mới ship trước hàng cũ), không scan excess CN khác trước khi đặt NM (mua mới trong khi CN khác dư).

## F2B4.3. Functional Requirements

### Allocation Logic

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B4-001 | **LCNB ưu tiên trước:** scan tất cả CN có excess (tồn vượt SS CN) → ưu tiên **CN gần nhất** trong phạm vi **max_distance** (configurable). Chỉ lấy phần vượt SS CN, không drain donor dưới SS. Vị trí CN từ Master Data | CRITICAL |
| FR-F2B4-002 | **Hub ảo pool sau:** hàng còn lại trong Hub pool (NM confirmed − PO released) allocate cho CN còn thiếu sau LCNB | CRITICAL |
| FR-F2B4-003 | **Shortage flag:** sau cả LCNB + Hub pool vẫn thiếu → flag SHORTAGE. Alert Planner + SC Manager | HIGH |

### Constraints (áp dụng cho cả LCNB và Hub pool)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B4-004 | **Variant match strict:** A4↔A4, B2↔B2. Không cross-match đuôi màu | CRITICAL |
| FR-F2B4-005 | **FIFO:** lot cũ xuất trước (55d trước 6d). Tránh hàng tồn lâu. Lot > 60 ngày → slow-moving alert | HIGH |
| FR-F2B4-006 | **Fair-share:** khi supply < tổng net req (nhiều CN thiếu) → allocate proportional theo net req | HIGH |
| FR-F2B4-007 | **SS guard:** CN donor sau transfer phải giữ ≥ SS CN. Không drain donor dưới SS | CRITICAL |

### LCNB Rules

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B4-008 | **Excess = phần vượt SS CN:** `Excess = on-hand − SS CN − reserved − committed`. Chỉ excess > 0 mới eligible donor. **CN donor luôn giữ ≥ SS CN** | CRITICAL |
| FR-F2B4-009 | **Priority = CN gần nhất** (NEAREST_FIRST) trong phạm vi **max_distance** (configurable, vd: 500km). CN dư nhưng quá xa → skip, dùng Hub pool. Vị trí CN từ Master Data | HIGH |
| FR-F2B4-010 | **Min excess threshold:** excess < threshold (default 50 units) → skip. Tránh micro-transfer. Configurable | HIGH |
| FR-F2B4-011 | **Max transfer:** tối đa 80% excess per CN donor (giữ 20% buffer). Configurable | HIGH |

### Views & Override

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B4-012 | **Per CN view:** LCNB + Hub pool + Total + Fill% + Role (receiver/donor/shortage) | HIGH |
| FR-F2B4-013 | **Per SKU × Variant × Lot detail:** lot ID, age, alloc qty, source (LCNB từ CN nào / Hub pool) | HIGH |
| FR-F2B4-014 | **Planner override:** accept/override source với reason code + audit. Ripple recalculate affected CN | HIGH |

## F2B4.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B4-001 | **Thứ tự ưu tiên: LCNB trước → Hub pool sau.** Lý do: LCNB nhanh hơn (CN→CN 1-2d), Hub pool chậm hơn (NM ship 3-20d). Giảm mua NM không cần thiết | Core priority |
| BR-F2B4-002 | **LCNB priority = NEAREST_FIRST** (default) trong phạm vi **max_distance** (configurable). CN dư quá xa → skip → dùng Hub pool. Lý do: gạch nặng/cồng kềnh, ship xa có thể đắt hơn mua NM | Default |
| BR-F2B4-003 | **Variant strict:** GA-300-A4 chỉ allocate từ lot A4. Không cross-match B2→A4 | Building materials |
| BR-F2B4-004 | **FIFO bắt buộc:** lot 55d xuất trước lot 6d. Lot > 60 ngày → slow-moving alert | Age management |
| BR-F2B4-005 | **SS guard cho donor:** excess = phần VƯỢT SS CN. Transfer chỉ từ excess. CN donor sau transfer luôn ≥ SS CN. Không bao giờ drain dưới SS | Protect donor |
| BR-F2B4-006 | **Min excess < 50 → skip.** Tránh chuyển lượng quá nhỏ (chi phí vận chuyển > giá trị hàng) | Global default, configurable |
| BR-F2B4-007 | **Max transfer 80% excess.** Donor giữ 20% buffer phòng demand đột xuất | Safety margin |
| BR-F2B4-008 | **Hub ảo pool = NM confirmed − PO released.** Sau này = tồn kho tổng vật lý. Logic không đổi | Future-proof |
| BR-F2B4-009 | **Shortage sau cả LCNB + Hub pool:** flag SHORTAGE, alert Planner + SC Manager. Options: chờ NM ship, expedite, hoặc accept stockout risk | Escalation |

## F2B4.5. User Stories & Acceptance Criteria

### US-F2B4-001: LCNB Allocation

As a **Planner**, I want **hệ thống ưu tiên lấy từ CN dư gần nhất**, so that **hàng về nhanh và giảm mua NM không cần thiết**.

**Acceptance Criteria:**
- Given CN-BD thiếu GA-300-A4 = 100m². CN-ĐN excess 150m² (cách 50km). CN-HN excess 200m² (cách 1.500km). When LCNB scan, Then ưu tiên CN-ĐN (gần hơn) → transfer 100m². Không dùng CN-HN
- Given CN-BD thiếu 200m². CN-ĐN excess 80m² (< min threshold 50? không, 80 > 50 OK). Max 80% = 64m². When transfer, Then LCNB 64m² từ CN-ĐN. Còn thiếu 136m² → lấy Hub pool

### US-F2B4-002: Hub Pool + LCNB Combined

As a **Planner**, I want **xem allocation per CN: bao nhiêu từ LCNB, bao nhiêu từ Hub pool**, so that **tôi biết source mix**.

**Acceptance Criteria:**

| CN | LCNB | Hub pool | Total | Fill% | Role |
|----|------|----------|-------|-------|------|
| CN-BD | +64 (từ ĐN) | +93 | 157 | 100% | receiver |
| CN-ĐN | −64 | 0 | −64 | — | donor |
| CN-HN | 0 | +73 | 73 | 100% | receiver |
| CN-CT | 0 | 0 | 0 | — | đủ hàng |

### US-F2B4-003: Variant + FIFO + Lot Detail

As a **Planner**, I want **xem lot chi tiết per allocation**, so that **verify variant đúng và FIFO đúng**.

**Acceptance Criteria:**
- Given CN-BD allocation GA-300, When drill down, Then:

| Variant | Lot | Age | Qty | Source |
|---------|-----|-----|-----|--------|
| A4 | MK-2601-01 | 55d | 64 | LCNB từ CN-ĐN |
| A4 | MK-2602-05 | 35d | 50 | Hub pool |
| A4 | TK-2603-01 | 18d | 43 | Hub pool |

- FIFO: lot 55d trước. Variant strict: chỉ A4. Source rõ (LCNB vs Hub)

### US-F2B4-004: Shortage

As a **Planner**, I want **biết khi cả LCNB + Hub pool không đủ**, so that **tôi escalate sớm**.

**Acceptance Criteria:**
- Given CN-HN thiếu 200m² GA-400-C1. Không CN nào dư C1. Hub pool GA-400 = 50m² only. When allocation, Then: Hub 50m² (partial). SHORTAGE 150m². Alert: "GA-400-C1 CN-HN: thiếu 150m². LCNB + Hub không đủ"

## F2B4.6. Dependencies

| Depends on | Data |
|-----------|------|
| F2-B3 | Net requirement per CN × SKU không đuôi + variant suggestion |
| F2-B1 | Tồn CN per variant (for excess calculation + lot detail) |
| F1-B6 | Hub ảo pool (NM confirmed − PO released) |
| Master Data | Vị trí CN (khoảng cách cho LCNB priority), LCNB toggle, lot data |

| Feeds into | |
|-----------|---|
| F2-B5 | Transport (LCNB transfer orders + PO release list → shipment plan) |

## F2B4.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B4-001 | Allocation batch (all CN × all SKU) | < 15 phút |
| NFR-F2B4-002 | Per CN view load | < 3 giây |
| NFR-F2B4-003 | Per Lot detail load | < 2 giây |
| NFR-F2B4-004 | Override ripple recalculate | < 30 giây |

## F2B4.8. Out of Scope

- Deep AI autonomous allocation (Phase 3)
- Variant Attribute Engine nâng cao (Phase 2 — Phase 1 strict match)
- Outbound allocation / customer order allocation
- Hệ thống kho slotting / bin assignment

## F2B4.9. Open Questions

- [x] ~~LCNB priority~~ → **Resolved:** NEAREST_FIRST (default). Vị trí CN từ Master Data. Configurable
- [x] ~~LCNB vs Hub order~~ → **Resolved:** LCNB ưu tiên trước (nhanh hơn), Hub pool sau
- [x] ~~Min excess threshold~~ → **Resolved:** Global 50 units (default). Configurable
- [x] ~~Layer order~~ → **Resolved:** Fixed Phase 1. LCNB → Hub pool → Constraints (variant/FIFO/fair-share/SS guard)

---

# F2-B5 — Transport Lot Sizing

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 5/8
**Version:** 2.0 | **Updated:** 2026-04-14 | **Status:** Draft

---

## F2B5.1. Overview

Nhận output F2-B4 (PO Release list + LCNB Transfer Orders), gom hàng vào container per NM, quyết định ship hay hold.

**Quy định:** 1 xe/container đi từ **1 NM duy nhất**. Không mix hàng nhiều NM trên 1 xe.

**2 loại shipment:**
- **NM → CN:** gom hàng per NM thành container. 1 container có thể multi-drop nhiều CN (cùng tuyến). Hold-or-ship decision áp dụng
- **LCNB (CN → CN):** lateral transfer riêng, ship ngay (CN receiver đang thiếu)

Container size configurable: **per Pallet và per Tấn** (setup trong system).

## F2B5.2. Problem Statement

UNIS ship rời rạc — mỗi PO 1 chuyến, xe chạy fill 40-50%. Cùng NM ship nhiều CN nhưng tách chuyến riêng. Không có hold logic → ship xe chưa đầy khi CN vẫn đủ hàng.

## F2B5.3. Functional Requirements

### Container Packing (NM → CN)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B5-001 | **Gom container per NM:** group tất cả PO Release từ F2-B4 theo NM. Mỗi container chỉ chứa hàng từ 1 NM | CRITICAL |
| FR-F2B5-002 | **Container size configurable:** setup per Pallet (số pallet tối đa) và per Tấn (weight tối đa). Hàng gom vào container đến khi đạt limit Pallet HOẶC Tấn (whichever first) | CRITICAL |
| FR-F2B5-003 | **Multi-drop:** 1 container từ NM có thể giao nhiều CN cùng tuyến. Ví dụ: Mikado → CN-BD (drop 1) → CN-CT (drop 2) | HIGH |
| FR-F2B5-004 | **Hold-or-ship (NM → CN):** container fill < threshold AND CN HSTK > (transit LT + buffer days) AND hold < max days → HOLD gom thêm. Else → SHIP | CRITICAL |

### Top-up Container (gợi ý thêm hàng cho đủ cont)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B5-005 | **Top-up suggestion khi container chưa đầy:** nếu container từ 1 NM chưa đạt limit, hệ thống gợi ý thêm mã hàng theo 2 tiêu chí ưu tiên: (1) Mã có SS gần tới ngưỡng — sắp cần bổ sung, kéo trước. (2) Mã có demand forecast bán đều — sẽ cần sớm, không risk tồn | CRITICAL |
| FR-F2B5-006 | **Top-up priority:** ưu tiên (1) trước (SS gần tới = urgent hơn), sau đó (2) (demand đều = safe top-up). Gợi ý qty per mã để đủ container limit | HIGH |
| FR-F2B5-007 | **Planner review top-up:** hệ thống gợi ý, Planner approve/reject/adjust per mã. Không auto-add | HIGH |

### LCNB Transport

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B5-008 | **LCNB ship ngay:** lateral transfer (CN → CN) từ F2-B4 luôn ship ngay, không hold. CN receiver đang shortage | HIGH |
| FR-F2B5-009 | **LCNB vehicle riêng:** xe nhỏ hơn, route CN→CN (không từ NM) | HIGH |

### Lead Time & ETA

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B5-013 | **Transit LT per NM × CN:** thời gian vận chuyển từ NM tới CN. Config trong Master Data per cặp NM-CN. Ví dụ: Mikado → CN-BD = 2 ngày, Mikado → CN-HN = 5 ngày | CRITICAL |
| FR-F2B5-014 | **Transit LT per CN × CN (LCNB):** thời gian vận chuyển lateral transfer. Config per cặp CN-CN. Ví dụ: CN-ĐN → CN-BD = 1.5 ngày | HIGH |
| FR-F2B5-015 | **ETA per shipment:** ETA = ngày ship + transit LT. Hiển thị trên shipment plan | HIGH |
| FR-F2B5-016 | **Hold-or-ship dựa trên LT:** CN HSTK > transit LT + buffer days → có thể hold. CN HSTK ≤ transit LT + buffer → SHIP ngay (CN sẽ hết hàng trước khi xe tới) | CRITICAL |

### Views

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B5-010 | **Shipment plan view:** per shipment — NM, route (CN drops), qty (m² + pallet + tấn), container size, fill%, status (ship/hold/top-up suggested) | HIGH |
| FR-F2B5-011 | **Top-up suggestion view:** per container chưa đầy — mã gợi ý, qty gợi ý, lý do (SS gần tới / demand đều), Planner approve/reject | HIGH |
| FR-F2B5-012 | **LCNB plan view:** per transfer — CN source → CN dest, qty, vehicle, ETA | HIGH |

## F2B5.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B5-001 | **1 container = 1 NM.** Không mix hàng nhiều NM trên 1 xe | Quy định |
| BR-F2B5-002 | **Container limit = min(Pallet limit, Tấn limit).** Hàng gom đến khi đạt 1 trong 2 limit | Whichever first |
| BR-F2B5-003 | **Hold-or-ship (chỉ NM → CN):** fill < 60% AND CN HSTK > (transit LT + buffer days) AND hold < 2d → HOLD. Ví dụ: Mikado→BD transit 2d + buffer 3d = 5d. CN-BD HSTK 8d > 5d → hold OK. CN-BD HSTK 4d < 5d → SHIP ngay. Các thresholds configurable | LT-based |
| BR-F2B5-004 | **Hold max 2 ngày.** Sau 2d → ship dù fill thấp. Configurable | Hard limit |
| BR-F2B5-005 | **CN HSTK ≤ transit LT + buffer → SHIP ngay** dù container chưa đầy. CN sẽ hết hàng trước khi xe tới nếu hold thêm | Safety override |
| BR-F2B5-006 | **LCNB luôn ship ngay.** Không hold. CN receiver đang shortage → cần hàng gấp | LCNB = immediate |
| BR-F2B5-007 | **Multi-drop order:** CN urgent (HSTK thấp) nhận trước trên cùng tuyến | Priority drop |
| BR-F2B5-008 | **Container size setup:** configurable per Pallet count + Tấn weight. SC Manager setup trong system | Config |
| BR-F2B5-009 | **Top-up khi container chưa đầy:** gợi ý thêm mã hàng (cùng NM) theo ưu tiên: (1) Mã có tồn CN gần SS → sắp cần bổ sung anyway. (2) Mã có demand forecast đều → kéo trước không risk tồn. Top-up qty = phần trống container còn lại | Fill optimization |
| BR-F2B5-010 | **Top-up chỉ gợi ý, Planner quyết.** Hệ thống không auto-add. Planner xem suggestion → approve/reject per mã. Lý do: tránh kéo hàng không cần thiết | Human decision |
| BR-F2B5-011 | **Top-up chỉ gợi ý mã cùng NM.** 1 container = 1 NM → chỉ top-up mã mà NM đó sản xuất (từ Master Data SKU → NM) | Same NM only |

## F2B5.5. User Stories & Acceptance Criteria

### US-F2B5-001: Gom Container per NM

As a **Planner**, I want **hệ thống gom hàng per NM vào container**, so that **tối ưu fill rate, giảm số chuyến**.

**Acceptance Criteria:**
- Given F2-B4 output: Mikado → CN-BD 93m² (8 pallet) + Mikado → CN-CT 30m² (3 pallet). Container limit = 20 pallet / 18 tấn. When gom, Then 1 container Mikado: 11 pallet, fill 55%, multi-drop BD→CT
- Given cùng NM nhưng 2 CN khác tuyến (BD tuyến Nam, HN tuyến Bắc), When gom, Then 2 container riêng (không gom cross-tuyến)

### US-F2B5-002: Hold-or-Ship

As a **Planner**, I want **hệ thống quyết hold hay ship dựa trên fill rate + tồn CN**, so that **xe chạy hiệu quả nhưng CN không stockout**.

**Acceptance Criteria:**
- Given container Mikado→HN: fill 45%, CN-HN HSTK 12d (> 7d), hold = 0d. When decision, Then HOLD 1 ngày gom thêm
- Given container Mikado→BD: fill 55%, CN-BD HSTK 3d (< 7d). When decision, Then SHIP ngay dù fill thấp (CN urgent)
- Given hold 2 ngày rồi, fill vẫn 50%. When decision, Then SHIP (max hold reached)

### US-F2B5-003: Top-up Container

As a **Planner**, I want **hệ thống gợi ý thêm mã hàng khi container chưa đầy**, so that **tối ưu fill rate, kéo trước hàng sẽ cần sớm thay vì ship nửa xe**.

**Acceptance Criteria:**
- Given container Mikado: fill 11/20 pallet (55%), còn trống 9 pallet. Cùng NM Mikado có: GA-400 tồn CN-BD gần SS (tồn 210, SS 200 → chênh 10m²), GA-500 demand đều 100m²/tuần. When top-up suggest, Then gợi ý: (1) GA-400 ưu tiên (SS gần tới) qty 50m² = 4 pallet, (2) GA-500 (demand đều) qty 60m² = 5 pallet. Tổng fill = 20/20 pallet (100%)
- Given Planner reject GA-500 (không cần gấp), approve GA-400 only. When confirm, Then container 15/20 pallet (75%). GA-400 50m² added vào PO Release
- Given container đã full (20/20 pallet), When check, Then không hiện top-up suggestion

### US-F2B5-004: LCNB Ship Ngay

As a **Planner**, I want **LCNB transfer luôn ship ngay**, so that **CN receiver nhận hàng sớm nhất**.

**Acceptance Criteria:**
- Given LCNB: CN-ĐN → CN-BD 64m² GA-300-A4. When transport plan, Then ship ngay, không hold. Vehicle nhỏ (phù hợp qty)

## F2B5.6. Dependencies

| Depends on | Data |
|-----------|------|
| F2-B4 | PO Release list (Hub pool → CN) + LCNB Transfer Orders (CN → CN) |
| Master Data | Container size config (Pallet/Tấn), CN location, route data, **transit LT per NM×CN và per CN×CN** |
| F2-B3 | CN HSTK (cho hold-or-ship decision) |

| Feeds into | |
|-----------|---|
| F2-B6 | NM ATP Check (shipment plan → PO qty per NM để check NM có hàng) |
| F2-B7 | PO Release + Tracking (confirmed shipments) |

## F2B5.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B5-001 | Container packing (all NM × all CN) | < 30 giây |
| NFR-F2B5-002 | Hold-or-ship decision | < 5 giây per container |
| NFR-F2B5-003 | Shipment plan view load | < 3 giây |

## F2B5.8. Out of Scope

- Fleet management / vehicle dispatching (xe thuộc carrier/NM)
- Driver management / scheduling (thuộc carrier)
- Real-time GPS tracking (Phase 2 — thuộc F2-B7)
- Last-mile delivery to end customers
- Return logistics / reverse shipments

## F2B5.9. Open Questions

- [x] ~~Transport rule~~ → **Resolved:** 1 container = 1 NM. Gom per NM. Multi-drop nhiều CN cùng tuyến
- [x] ~~Container size~~ → **Resolved:** Configurable per Pallet + Tấn. Setup trong system
- [x] ~~Hold-or-ship scope~~ → **Resolved:** Chỉ NM → CN. LCNB luôn ship ngay
- [x] ~~Vehicle frames~~ → **Resolved:** Configurable trong system
- [x] ~~Fill threshold~~ → **Resolved:** 60% default, configurable

---

# F2-B6 — NM ATP Check

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 6/8
**Version:** 2.0 | **Updated:** 2026-04-14 | **Status:** Draft

---

## F2B6.1. Overview

Xem per NM: NM nào cần ship hàng gì cho CN nào. Check tồn kho NM (upload manual từ F2-B1) vs plan từ F2-B5.

**3 kết quả:**
- **PASS:** NM đủ hàng → proceed PO Release
- **PARTIAL:** NM chỉ đáp ứng 1 phần → **ưu tiên CN urgent nhất (HSTK thấp nhất) nhận trước**
- **FAIL:** NM không có hàng → backup (LCNB hoặc chờ NM SX)

## F2B6.2. Problem Statement

UNIS đặt PO mà không biết NM có đủ hàng → PO fail, CN chờ, stockout. Tồn NM không visible → phải gọi điện hỏi. Khi NM thiếu, không có rule ai nhận trước → CN urgent stockout trong khi CN đủ hàng lại nhận.

## F2B6.3. Functional Requirements

### ATP Check

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B6-001 | **ATP view per NM:** hiển thị per NM × CN × SKU: plan qty (từ F2-B5), NM tồn kho (upload từ F2-B1), result (PASS/PARTIAL/FAIL) | CRITICAL |
| FR-F2B6-002 | **ATP calculation:** `ATP = NM tồn kho per SKU không đuôi`. So sánh ATP vs tổng plan qty per SKU. PASS khi ATP ≥ plan. PARTIAL khi 0 < ATP < plan. FAIL khi ATP = 0 | CRITICAL |
| FR-F2B6-003 | **Freshness gate:** NM data upload quá threshold (configurable, default 24h) → BLOCKED. Không cho release PO cho NM đó. Alert Planner + SC Manager | CRITICAL |

### Partial Fulfillment (NM chỉ đáp ứng 1 phần)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B6-004 | **PARTIAL → ưu tiên CN urgent nhất:** khi NM không đủ hàng cho tất cả CN, CN có **HSTK thấp nhất nhận trước** (sắp hết → cứu trước). CN HSTK cao hơn chờ hoặc nhận phần còn lại | CRITICAL |
| FR-F2B6-005 | **Partial allocation view:** hiển thị per CN: plan qty, actual allocated, shortage, HSTK, priority rank | HIGH |
| FR-F2B6-006 | **Shortage handling:** phần NM không đáp ứng → 2 options hiển thị: (1) Chờ NM SX thêm → ship đợt sau (ETA?). (2) Scan LCNB: CN khác dư → lateral transfer bù | HIGH |

### NM Honoring Tracking

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B6-007 | **NM honoring rate:** track actual delivered vs ATP tại thời điểm check. `honoring = actual_delivered / ATP_at_check × 100`. Per NM, rolling | HIGH |
| FR-F2B6-008 | **NM honoring < 80% over 3 tháng** → auto-adjust: hiển thị warning "NM không reliable" khi ATP check. Planner cân nhắc khi quyết định | HIGH |

## F2B6.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B6-001 | **PASS:** NM ATP ≥ tổng plan per SKU → proceed PO Release cho tất cả CN | Happy path |
| BR-F2B6-002 | **PARTIAL → CN HSTK thấp nhất ưu tiên.** Ví dụ: plan BD 200 + HN 150 = 350. ATP = 250. CN-BD HSTK 3d, CN-HN HSTK 10d → BD nhận đủ 200 (urgent). HN nhận 50 (còn thiếu 100) | Core rule |
| BR-F2B6-003 | **PARTIAL shortage → 2 options:** (1) Chờ NM SX → ship đợt sau. (2) LCNB: scan CN dư (quay lại F2-B4 logic) → lateral transfer bù. Planner quyết định | Shortage handling |
| BR-F2B6-004 | **FAIL:** NM ATP = 0 per SKU → không release PO. Alert SC Manager. Options: chờ NM, alternative action | Full block |
| BR-F2B6-005 | **Freshness gate:** NM data stale > threshold → BLOCKED. Không release PO cho NM đó dù ATP có thể đủ. Lý do: data cũ không tin cậy | Safety gate |
| BR-F2B6-006 | **ATP per SKU không đuôi.** NM upload tồn per SKU không đuôi (GA-300 tổng). Không per variant — NM tự quyết đuôi khi SX | Match F2-B1 upload |
| BR-F2B6-007 | **NM honoring < 80% → warning** hiển thị cạnh ATP result. Planner biết NM này hay giao thiếu → cân nhắc order thêm buffer hoặc tìm alternative | Trust tracking |
| BR-F2B6-008 | **Lead time NM → CN ảnh hưởng urgency.** CN HSTK tính coverage days. Nếu HSTK < transit LT (từ F2-B5) → CN sẽ hết hàng trước khi xe tới → CRITICAL priority | LT-aware |

## F2B6.5. User Stories & Acceptance Criteria

### US-F2B6-001: ATP Check per NM

As a **Planner**, I want **xem NM có đủ hàng ship theo plan không**, so that **tôi biết PO nào proceed, PO nào partial/fail**.

**Acceptance Criteria:**
- Given plan: Mikado → CN-BD 93m² + CN-HN 73m² = 166m². Mikado ATP (upload) = 200m². When check, Then: **PASS** (200 ≥ 166). Proceed tất cả
- Given plan: Mikado → CN-BD 200m² + CN-HN 150m² = 350m². Mikado ATP = 250m². When check, Then: **PARTIAL** (250 < 350). Thiếu 100m²

### US-F2B6-002: Partial — CN Urgent Nhận Trước

As a **Planner**, I want **CN sắp hết hàng nhận ưu tiên khi NM không đủ**, so that **CN urgent không stockout**.

**Acceptance Criteria:**
- Given PARTIAL Mikado 250m² cho 2 CN: CN-BD plan 200 (HSTK 3d), CN-HN plan 150 (HSTK 10d). When allocate, Then: CN-BD nhận đủ 200 (urgent, HSTK thấp). CN-HN nhận 50 (còn thiếu 100)
- Given CN-HN thiếu 100m², When shortage options, Then hiển thị: (1) Chờ Mikado SX → ETA based on production LT. (2) Scan LCNB: CN-ĐN dư 80m² → lateral transfer 80m². Còn thiếu 20m²

### US-F2B6-003: NM Data Stale → Block

As a **Planner**, I want **PO bị block khi NM data cũ**, so that **không release PO dựa trên data không tin cậy**.

**Acceptance Criteria:**
- Given NM-X upload tồn kho 28h trước (> threshold 24h). When ATP check, Then: **BLOCKED**. "NM-X data stale 28h. PO Release blocked. Request NM upload lại"
- Given NM-X upload lại (fresh), When re-check, Then ATP check proceed bình thường

### US-F2B6-004: NM Honoring Warning

As a **Planner**, I want **biết NM nào hay giao thiếu**, so that **tôi cân nhắc khi quyết định**.

**Acceptance Criteria:**
- Given NM-Y honoring rate 72% (< 80%) over 3 tháng. When ATP check NM-Y, Then warning hiển thị: "NM-Y honoring 72% — hay giao thiếu so với tồn báo cáo. Cân nhắc order buffer"

## F2B6.6. Dependencies

| Depends on | Data |
|-----------|------|
| F2-B5 | Shipment plan (plan qty per NM × CN × SKU) |
| F2-B1 | NM tồn kho (upload manual, freshness tracked) |
| F2-B3 | CN HSTK per SKU (cho partial priority) |
| F2-B5 | Transit LT per NM × CN (cho urgency assessment) |

| Feeds into | |
|-----------|---|
| F2-B7 | PO Release (PASS/PARTIAL → release. FAIL/BLOCKED → hold) |

## F2B6.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B6-001 | ATP check per NM | < 5 giây |
| NFR-F2B6-002 | Partial allocation (priority ranking) | < 5 giây |
| NFR-F2B6-003 | ATP results dashboard load | < 2 giây |
| NFR-F2B6-004 | Honoring rate recalculate | < 10 giây per NM |

## F2B6.8. Out of Scope

- NM inventory management (chỉ consume upload, không quản lý NM stock)
- NM production planning (chỉ check available, không plan NM SX)
- Alternative NM selection tự động (Phase 2 — Phase 1 manual)
- Tự động adjust ATP dựa trên honoring rate (Phase 2 — Phase 1 chỉ warning)

## F2B6.9. Open Questions

- [x] ~~Partial handling~~ → **Resolved:** CN HSTK thấp nhất ưu tiên nhận trước. Phần thiếu → chờ NM SX hoặc LCNB bù
- [x] ~~ATP granularity~~ → **Resolved:** Per SKU không đuôi (match NM upload template từ F2-B1)
- [x] ~~NM data source~~ → **Resolved:** Upload manual qua template (F2-B1). Freshness gate configurable
- [x] ~~Lead time~~ → **Resolved:** Transit LT (từ F2-B5) ảnh hưởng urgency. CN HSTK < transit LT → CRITICAL priority

---

# F2-B7 — PO Review & Confirm

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 7/8
**Version:** 3.0 | **Updated:** 2026-04-14 | **Status:** Draft

---

## F2B7.1. Overview

Các bước F2-B1 → F2-B6 hệ thống **gợi ý** số lượng kéo hàng per NM. Bước F2-B7 là nơi **User review, điều chỉnh và xác nhận tạo PO**.

```
F2-B1→B6: Hệ thống gợi ý (auto)
F2-B7:    User review → edit (SKU, qty) → confirm → TẠO PO
```

Input: draft PO per NM × CN × SKU (từ F2-B5 transport plan + F2-B6 ATP result).
Output: PO confirmed → gửi NM / đồng bộ ERP.

## F2B7.2. Problem Statement

Hiện Planner tạo PO thủ công (nhập tay vào ERP). Không có draft PO từ system → dễ sai qty/SKU. Không có review screen → không ai double-check trước khi gửi NM.

## F2B7.3. Functional Requirements

### PO Draft Review

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B7-001 | **Draft PO per NM:** hiển thị per NM: danh sách CN × SKU không đuôi × qty gợi ý (từ F2-B5/B6). Bao gồm: source (Hub pool / LCNB), ATP result (PASS/PARTIAL), transit LT, ETA | CRITICAL |
| FR-F2B7-002 | **Edit PO:** User (Planner) có thể điều chỉnh trước khi confirm: thêm/bớt SKU, thay đổi qty, thay đổi CN nhận. Mọi edit logged (original vs edited, lý do) | CRITICAL |
| FR-F2B7-003 | **Validation khi edit:** qty edit > NM ATP → warning "vượt tồn NM". Qty edit = 0 → xóa dòng khỏi PO. SKU không thuộc NM đó (Master Data) → reject | HIGH |

### PO Confirm & Release

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B7-004 | **Confirm PO:** User xác nhận → PO chuyển DRAFT → CONFIRMED. PO không thể sửa sau confirm (trừ khi cancel + tạo lại) | CRITICAL |
| FR-F2B7-005 | **PO đồng bộ ERP:** sau confirm, PO gửi sang ERP. Retry-safe (retry không tạo PO duplicate). Audit logged | CRITICAL |
| FR-F2B7-006 | **PO gửi NM:** NM nhận thông tin PO (SKU, qty, CN nhận, ETA yêu cầu). Qua kênh đã setup | HIGH |

### Tab TO — Transfer Order (LCNB)

Tách tab riêng cho TO. Không gộp chung PO.

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B7-007 | **Tab TO riêng biệt với Tab PO.** User chuyển qua lại giữa 2 tab. Mỗi tab có logic/trạng thái riêng | CRITICAL |
| FR-F2B7-008 | **Draft TO list:** hiển thị per TO: CN source → CN dest, SKU × Variant × qty, transit LT, ETA | HIGH |
| FR-F2B7-009 | **TO edit:** User adjust qty, cancel TO. CN donor + receiver được thông báo | HIGH |
| FR-F2B7-010 | **TO confirm:** User xác nhận → TO chuyển DRAFT → CONFIRMED. CN donor chuẩn bị hàng | HIGH |

#### Bộ trạng thái TO (LCNB)

| # | Trạng thái | Ý nghĩa | Ai chuyển |
|---|-----------|---------|-----------|
| 1 | **DRAFT** | Hệ thống gợi ý từ F2-B4 LCNB | System |
| 2 | **CONFIRMED** | User confirm transfer | Planner |
| 3 | **SHIPPED** | Hàng đã lên xe (nhập Số xe, NVT, tài xế) | CN donor Manager |
| 4 | **RECEIVED** | CN receiver đã nhận (nhập qty thực tế) | CN receiver Manager |
| 5 | **CLOSED** | TO hoàn tất | Planner |
| — | **CANCELLED** | Hủy (trước SHIPPED). Reason bắt buộc | Planner / SC Manager |

#### Trường tracking TO

| Field | Bắt buộc khi | Ai nhập |
|-------|-------------|---------|
| TO number | CONFIRMED | System |
| CN source → CN dest | CONFIRMED | System |
| SKU × Variant × qty | CONFIRMED | System + User edit |
| Số xe | SHIPPED | CN donor |
| Nhà vận tải | SHIPPED | CN donor |
| Tên tài xế / SĐT | SHIPPED | CN donor |
| Ngày xuất CN donor | SHIPPED | CN donor |
| ETA CN receiver | SHIPPED | System (transit LT) |
| Qty nhận thực tế | RECEIVED | CN receiver |
| Chênh lệch / ghi chú | RECEIVED | CN receiver |

### PO Lifecycle & Tracking

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B7-011 | **PO states:** DRAFT → CONFIRMED → SHIPPED → RECEIVED → CLOSED (+CANCELLED). Chi tiết bên dưới | CRITICAL |
| FR-F2B7-012 | **PO tracking fields:** mỗi PO track thông tin vận chuyển (Số xe, NVT, Số cont...). Chi tiết bên dưới | CRITICAL |
| FR-F2B7-013 | **PO alerts:** PO_OVERDUE (NM chưa ship quá X ngày), SHIPMENT_LATE (quá ETA), DELIVERY_INCOMPLETE (nhận thiếu) | HIGH |
| FR-F2B7-014 | **PO history:** xem tất cả PO, filter by NM/CN/SKU/status/date. Export | MEDIUM |
| FR-F2B7-015 | **TO history:** xem tất cả TO (LCNB), filter by CN/SKU/status/date. Export | MEDIUM |

#### Bộ trạng thái PO

| # | Trạng thái | Ý nghĩa | Ai chuyển |
|---|-----------|---------|-----------|
| 1 | **DRAFT** | Hệ thống gợi ý, chờ User review | System |
| 2 | **CONFIRMED** | User đã review + confirm. PO gửi NM + ERP | Planner |
| 3 | **SHIPPED** | NM đã giao lên xe (nhập Số xe, NVT, Số cont) | NM |
| 4 | **RECEIVED** | CN đã nhận hàng (nhập qty thực tế) | CN Manager |
| 5 | **CLOSED** | PO hoàn tất | Planner |
| — | **CANCELLED** | Hủy (trước SHIPPED). Reason bắt buộc | Planner / SC Manager |

#### Trường thông tin tracking per PO

| Nhóm | Field | Bắt buộc khi | Ai nhập |
|-------|-------|-------------|---------|
| **PO cơ bản** | PO number | CONFIRMED | System (auto) |
| | NM | CONFIRMED | System |
| | CN nhận | CONFIRMED | System |
| | SKU × qty | CONFIRMED | System + User edit |
| | ETA yêu cầu | CONFIRMED | System (tính từ transit LT) |
| **NM phản hồi** | NM confirm date | NM_ACCEPTED | NM |
| | Dự kiến ngày SX xong | IN_PRODUCTION | NM |
| **Vận chuyển** | **Số xe (biển số)** | SHIPPED | NM |
| | **Nhà vận tải (NVT)** | SHIPPED | NM |
| | **Số container (cont)** | SHIPPED | NM |
| | Tên tài xế | SHIPPED | NM |
| | SĐT tài xế | SHIPPED | NM |
| | Ngày xuất kho NM (actual) | SHIPPED | NM |
| | ETA CN (tính lại từ actual departure + transit LT) | SHIPPED | System |
| **Nhận hàng** | Ngày CN nhận (actual) | RECEIVED | CN Manager |
| | Qty nhận thực tế | RECEIVED | CN Manager |
| | Chênh lệch (nếu có) | RECEIVED | CN Manager |
| | Ghi chú (hư hỏng, thiếu) | RECEIVED | CN Manager |

## F2B7.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B7-001 | **F2-B7 = human decision point.** Hệ thống gợi ý (F2-B1→B6), User quyết định. PO chỉ tạo khi User confirm | Core principle |
| BR-F2B7-002 | **Edit trước confirm:** User tự do edit (thêm/bớt SKU, thay qty). Sau confirm → không sửa (cancel + tạo lại nếu cần) | Workflow |
| BR-F2B7-003 | **Mọi edit logged:** original qty (system suggest) vs edited qty (user decision) + lý do. Dùng để đo "system accuracy" sau này | Audit trail |
| BR-F2B7-004 | **PO per NM × CN:** 1 PO = 1 NM → 1 CN. Nếu cùng NM multi-drop (BD+CT), tạo 1 PO per CN nhưng gom transport (F2-B5) | PO granularity |
| BR-F2B7-005 | **ERP posting retry-safe:** gửi lại cùng PO → ERP trả bản ghi đã tồn tại, không duplicate | Chống trùng lặp |
| BR-F2B7-006 | **Tab PO và Tab TO tách riêng.** PO (NM → CN) và TO (CN → CN) có bộ trạng thái khác, tracking fields khác, lifecycle khác. Không gộp | UX clarity |
| BR-F2B7-006b | **TO cũng cần confirm.** Lateral transfer không auto-execute. User review trước | Human control |
| BR-F2B7-007 | **PO OVERDUE alert:** NM nhận PO nhưng quá X ngày chưa ship → alert Planner. X configurable (default 7 ngày) | Follow-up |
| BR-F2B7-008 | **Lead time tracking:** mỗi PO ghi nhận: confirm date, NM ship date, CN receive date → tính actual LT → feed back F2-B5 transit LT | LT accuracy |
| BR-F2B7-009 | **Thông tin vận chuyển bắt buộc khi SHIPPED:** NM phải nhập Số xe, Nhà vận tải (NVT), Số container trước khi chuyển trạng thái SHIPPED. Thiếu → không chuyển được | Gate check |
| BR-F2B7-010 | **Nhận hàng bắt buộc khi RECEIVED:** CN Manager nhập qty nhận thực tế. Nếu qty nhận < qty PO → flag DELIVERY_INCOMPLETE. Ghi chú bắt buộc (thiếu/hư hỏng) | Reconciliation |
| BR-F2B7-011 | **Actual LT = ngày CN nhận − ngày NM ship.** Tính per PO → aggregate per NM × CN route → cập nhật transit LT Master Data (rolling average) | LT learning |

## F2B7.5. User Stories & Acceptance Criteria

### US-F2B7-001: Review Draft PO

As a **Planner**, I want **xem draft PO per NM với số gợi ý từ hệ thống**, so that **tôi review trước khi tạo PO chính thức**.

**Acceptance Criteria:**
- Given F2-B6 kết quả: Mikado PASS (ATP đủ). Draft PO:

| CN | SKU | Qty gợi ý | Source | ATP | ETA |
|----|-----|-----------|--------|-----|-----|
| CN-BD | GA-300 | 93m² | Hub pool | PASS | 2 ngày |
| CN-BD | GA-300 (LCNB) | 64m² | LCNB từ ĐN | — | 1.5 ngày |
| CN-HN | GA-300 | 73m² | Hub pool | PASS | 5 ngày |

- Given Planner xem, When review, Then thấy rõ: qty gợi ý, source, ATP status, ETA per dòng

### US-F2B7-002: Edit PO

As a **Planner**, I want **điều chỉnh PO trước khi confirm**, so that **tôi sửa được khi có thông tin mới**.

**Acceptance Criteria:**
- Given draft PO CN-BD GA-300 = 93m², Planner biết CN-BD vừa nhận đơn lớn, When edit qty 93 → 150, Then warning: "Vượt qty gợi ý +61%. Lý do?" Planner nhập lý do. Logged: original 93, edited 150, reason "đơn hàng mới"
- Given Planner muốn thêm GA-400 (cùng NM Mikado), When add SKU, Then system check Master Data: GA-400 thuộc Mikado? → Yes → add. Check ATP: Mikado GA-400 tồn? → hiển thị
- Given Planner edit qty = 0 cho CN-HN GA-300, When save, Then dòng xóa khỏi PO. Logged: "Planner removed CN-HN GA-300, reason: CN đủ hàng"

### US-F2B7-003: Confirm PO

As a **Planner**, I want **confirm PO để gửi NM + ERP**, so that **PO chính thức được tạo**.

**Acceptance Criteria:**
- Given Planner review + edit xong, When click Confirm, Then: PO status DRAFT → CONFIRMED. Đồng bộ ERP (retry-safe). NM nhận thông tin PO
- Given PO đã CONFIRMED, When Planner cố edit, Then blocked: "PO đã confirm. Cancel PO để tạo mới nếu cần sửa"

### US-F2B7-004: PO Lifecycle Tracking

As a **Planner**, I want **theo dõi PO sau confirm**, so that **tôi biết NM đã ship chưa, hàng đang ở đâu**.

**Acceptance Criteria:**
- Given PO SENT 7 ngày, NM chưa ship, When alert, Then PO_OVERDUE notification Planner: "PO-001 Mikado→BD: 7 ngày chưa ship"
- Given PO SHIPPED, ETA 2 ngày, When quá ETA 1 ngày, Then SHIPMENT_LATE alert

## F2B7.6. Dependencies

| Depends on | Data |
|-----------|------|
| F2-B5 | Transport plan (draft PO per NM × CN × SKU, container grouping) |
| F2-B6 | ATP result (PASS/PARTIAL per NM × SKU) |
| F2-B4 | LCNB Transfer Orders (draft TO) |
| Master Data | SKU → NM mapping (validate edit), transit LT |

| Feeds into | |
|-----------|---|
| F1-B6 | Hub ảo update (PO released → Hub pool giảm) |
| F1-B7 | Commitment gap (released vs committed tracking) |
| F2-B8 | Feedback (actual LT, PO completion) |
| ERP | PO đồng bộ |

## F2B7.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B7-001 | Draft PO view load | < 2 giây |
| NFR-F2B7-002 | PO confirm + ERP sync | < 10 giây, retry-safe |
| NFR-F2B7-003 | PO lifecycle view load | < 3 giây |
| NFR-F2B7-004 | Edit validation (Master Data check) | < 1 giây |

## F2B7.8. Out of Scope

- Shipment tracking chi tiết (GPS, driver info) — Phase 2 hoặc module riêng
- POD (Proof of Delivery) — Phase 2 hoặc module riêng
- Procurement negotiation / giá mua (thuộc Purchasing)
- Invoice / payment (thuộc Finance)
- NM production scheduling (thuộc NM internal)

## F2B7.9. Open Questions

- [x] ~~Bản chất F2-B7~~ → **Resolved:** Human review + edit + confirm. Hệ thống gợi ý (B1-B6), User quyết định (B7)
- [x] ~~PO granularity~~ → **Resolved:** 1 PO = 1 NM × 1 CN. Multi-drop gom ở transport (F2-B5)
- [x] ~~Edit after confirm~~ → **Resolved:** Không cho sửa. Cancel + tạo lại
- [x] ~~Lead time~~ → **Resolved:** Mỗi PO track actual LT (confirm → ship → receive) → feed back F2-B5

---

# F2-B8 — Feedback & Closed Loop

**Flow:** 2 — Daily DRP (Nightly)
**Step:** 8/8
**Version:** 2.0 | **Updated:** 2026-04-14 | **Status:** Draft

---

## F2B8.1. Overview

**Central feedback hub** — thu thập actual data, so sánh vs planned, feed back cho tất cả modules. Closed loop tự động: khi FC accuracy improve → SS giảm → tồn kho giảm → vốn lưu động giảm.

F2-B8 feed back cho:

| Feed back cho | Data | Tần suất |
|---------------|------|----------|
| F1-B3 (SS Hub) | σ_fc → SS Hub recalculate | Weekly |
| F2-B3 (SS CN) | σ_demand → SS CN recalculate | Weekly |
| F2-B2 (Trust score) | CN adjusted vs actual → trust per CN | Weekly |
| F2-B6 (NM honoring) | Actual delivered vs ATP → honoring rate per NM | Per PO closed |
| F2-B5 (Transit LT) | Actual LT (ship→receive) → update Master Data | Per PO closed |
| F2-B7 (System accuracy) | Planner edit vs system suggest → % system đúng | Weekly |

## F2B8.2. Problem Statement

UNIS không có closed loop: FC sai → SS không adjust → tồn kho cao/stockout lặp lại. Không đo accuracy ở bất kỳ bước nào → không biết cải thiện chỗ nào. Không track NM reliability → NM hay trễ nhưng không data.

## F2B8.3. Functional Requirements

### Feedback Metrics

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B8-001 | **FC MAPE:** so sánh FC weekly (F2-B2 phased) vs actual sales weekly. Per SKU không đuôi. Rolling 12 tuần | CRITICAL |
| FR-F2B8-002 | **CN Trust score update:** so sánh CN adjusted demand vs actual sales per tuần. Feed F2-B2 trust score. Rolling 12 tuần, threshold ±20% | CRITICAL |
| FR-F2B8-003 | **NM honoring rate:** actual delivered qty vs ATP tại thời điểm check. Per NM. Feed F2-B6 | HIGH |
| FR-F2B8-004 | **Actual transit LT:** ngày CN receive − ngày NM/CN ship. Per PO/TO. Update transit LT Master Data (rolling average per route) | HIGH |
| FR-F2B8-005 | **System accuracy:** % PO mà Planner KHÔNG edit vs total PO (system gợi ý đúng). Per tuần | MEDIUM |
| FR-F2B8-006 | **Fill rate:** actual qty delivered vs planned qty per CN. Per tuần | HIGH |
| FR-F2B8-007 | **LCNB utilization:** lateral transfer qty vs total allocation qty. Trend tăng = network hiệu quả hơn | MEDIUM |
| FR-F2B8-008 | **Transport fill rate:** actual container fill % per shipment. Trend | MEDIUM |

### Closed Loop — SS Auto-Adjust

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B8-009 | **FC→SS Hub loop (weekly):** MAPE thay đổi → σ_fc recalculate → SS Hub (F1-B3) auto-adjust | CRITICAL |
| FR-F2B8-010 | **Demand→SS CN loop (weekly):** σ_demand thay đổi → SS CN (F2-B3) auto-adjust | CRITICAL |
| FR-F2B8-011 | **NM LT→SS Hub loop:** actual NM LT thay đổi → σ_LT recalculate → SS Hub (F1-B3) auto-adjust | HIGH |

### Dashboard & Reporting

| ID | Requirement | Priority |
|----|------------|----------|
| FR-F2B8-012 | **Feedback dashboard:** tất cả metrics trên 1 screen. Trend tuần trước vs tuần này (up/down/stable) | HIGH |
| FR-F2B8-013 | **Per CN × SKU drill-down:** identify chronic forecast misses, CN trust thấp, SKU hay shortage | HIGH |
| FR-F2B8-014 | **Planner override analysis:** top 5 lý do Planner edit PO (F2-B7). Insight: system suggestion cần cải thiện chỗ nào | MEDIUM |

## F2B8.4. Business Rules

| ID | Rule | Notes |
|----|------|-------|
| BR-F2B8-001 | **Closed loop frequency: weekly.** Match F2-B2 phasing cadence (FC phased tuần). Monthly quá chậm, daily quá noisy | Weekly |
| BR-F2B8-002 | **MAPE improve → SS giảm tự động.** Ví dụ: MAPE 18%→16% → σ giảm → SS Hub giảm ~11% → booking giảm → tiết kiệm vốn | Auto-reduce |
| BR-F2B8-003 | **MAPE tệ hơn → SS tăng tự động.** Protect service level. Bidirectional | Auto-increase |
| BR-F2B8-004 | **Fill rate < 85% liên tục 2 tuần → alert SC Manager.** Review allocation rules + NM performance | Guard rail |
| BR-F2B8-005 | **NM honoring < 80% over 12 tuần → flag NM unreliable.** Warning hiển thị khi ATP check (F2-B6) | NM trust |
| BR-F2B8-006 | **Actual transit LT update Master Data:** rolling average per route (NM×CN, CN×CN). Khi actual LT khác config > 30% → alert: "Transit LT thay đổi, review config" | LT learning |
| BR-F2B8-007 | **Override analysis: auto-generate top 5 reasons.** Planner review manually. Không auto-adjust rules | Human review |

## F2B8.5. User Stories & Acceptance Criteria

### US-F2B8-001: Feedback Dashboard

As a **SC Manager**, I want **xem tất cả feedback metrics trên 1 screen**, so that **tôi biết hệ thống perform ra sao và cần adjust gì**.

**Acceptance Criteria:**
- Given tuần này xong, When xem dashboard, Then:

| Metric | Tuần trước | Tuần này | Trend |
|--------|------------|----------|-------|
| FC MAPE | 18% | 16% | ↓ better |
| Fill rate | 88% | 92% | ↑ better |
| LCNB util | 5% | 8% | ↑ better |
| Transport fill | 62% | 74% | ↑ better |
| System accuracy | 78% | 82% | ↑ better |
| NM honoring (avg) | 85% | 87% | ↑ better |

### US-F2B8-002: FC→SS Auto-Adjust

As a **Planner**, I want **SS tự động adjust khi FC accuracy thay đổi**, so that **tồn kho luôn phù hợp — không quá cao (kẹt vốn) không quá thấp (stockout)**.

**Acceptance Criteria:**
- Given MAPE GA-300 improve 18%→16%, When weekly loop, Then σ_fc giảm → SS Hub GA-300 giảm (500→440m²). SS CN per CN cũng adjust tương ứng
- Given MAPE GA-400 tệ hơn 12%→18%, When weekly loop, Then SS tăng tự động. Alert: "SS GA-400 tăng do FC accuracy giảm"

### US-F2B8-003: Transit LT Auto-Update

As a **Planner**, I want **transit LT tự động cập nhật từ actual delivery data**, so that **hold-or-ship decision (F2-B5) dùng LT chính xác**.

**Acceptance Criteria:**
- Given 10 PO gần nhất Mikado→BD: actual LT trung bình = 2.3 ngày (config hiện tại = 2 ngày). When update, Then Master Data transit LT Mikado→BD update 2 → 2.3 ngày
- Given actual LT thay đổi > 30% (config 2d, actual avg 3.5d), When alert, Then: "Mikado→BD transit LT tăng 75%. Review config"

### US-F2B8-004: Override Analysis

As a **SC Manager**, I want **biết Planner hay sửa gì ở PO draft**, so that **tôi cải thiện system suggestion**.

**Acceptance Criteria:**
- Given 50 PO tuần này, Planner edit 12 PO (24%), When view analysis, Then top 5 reasons: (1) "Đơn hàng mới" 5 lần, (2) "CN đủ hàng" 3 lần, (3) "NM báo thiếu" 2 lần... System accuracy = 76%

## F2B8.6. Dependencies

| Depends on | Data |
|-----------|------|
| F2-B7 | PO/TO actual: ship date, receive date, qty delivered, Planner edits |
| F2-B2 | Weekly phased demand + CN adjustments (forecast để so sánh actual) |
| F2-B1 | Actual sales data (tồn kho thay đổi = sales) |
| F2-B6 | ATP at check time (cho NM honoring) |

| Feeds into | |
|-----------|---|
| **F1-B3** | σ_fc + σ_LT → SS Hub recalculate |
| **F2-B3** | σ_demand → SS CN recalculate |
| **F2-B2** | Trust score per CN |
| **F2-B5** | Transit LT update Master Data |
| **F2-B6** | NM honoring rate |

## F2B8.7. Non-functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-F2B8-001 | Feedback dashboard load | < 3 giây |
| NFR-F2B8-002 | Weekly closed loop (all SS recalculate) | < 2 phút toàn network |
| NFR-F2B8-003 | Transit LT update per route | < 5 giây |
| NFR-F2B8-004 | Override analysis | < 10 giây |

## F2B8.8. Out of Scope

- BI / analytics engine (chỉ dashboard cơ bản, không BI phức tạp)
- AI auto-adjust rules (Phase 3 — Phase 1 chỉ report, human review)
- Financial impact chi tiết (chỉ directional: SS giảm → vốn giảm)
- Planner performance KPI (thuộc HR)

## F2B8.9. Open Questions

- [x] ~~FC→SS frequency~~ → **Resolved:** Weekly (match F2-B2 phasing cadence)
- [x] ~~SS floor~~ → **Resolved:** Không cần. FC=0 → SS=0 (consistent F1-B3)
- [x] ~~Override analysis~~ → **Resolved:** Auto-generate top 5 reasons. Planner manual review

---
---

# APPENDIX

---

## Cross-Flow Dependency

```
Flow 1 B6 (Hub ảo) ──► Flow 2 B3 (DRP netting input)
Flow 1 B7 (Gap)     ──► Flow 2 B6 (ATP adjustment)
Flow 2 B7 (PO release) ──► Flow 1 B6 (Hub ảo released update)
Flow 2 B7 (PO release) ──► Flow 1 B7 (Gap released tracking)
Flow 2 B8 (Feedback)   ──► Flow 1 B1 (Demand accuracy next cycle)
```

---

## Build Sequence

| Wave | Modules | Duration | Rationale |
|------|---------|----------|-----------|
| Wave 0 | Master Data + Policy (nền tảng chung) | 4-6w | Foundation cho cả 2 Flow |
| Wave 1 | F1-B1 → F1-B7 (Production Booking) | 8-10w | Monthly cycle hoàn chỉnh |
| Wave 2 | F2-B1 → F2-B4 (DRP core) | 6-8w | Nightly engine + allocation |
| Wave 3 | F2-B5 → F2-B7 (Execution) | 4-6w | Transport + ATP + PO + Tracking |
| Wave 4 | F2-B8 + Dashboard + Mobile UX | 4-6w | Closed loop + UI layer |

---

## FR Traceability

### PRD v3.7 → Module PRD

| FR gốc (v3.7) | Description | Module |
|----------------|-------------|--------|
| FR-v3.6-001 | Forecast Hierarchy 5-Level | F1-B1 (demand input), F2-B3 (FC phased) |
| FR-v3.6-002 | σ_fc_error-based SS | F2-B3 (FR-F2B3-008) |
| FR-v3.6-003 | 2-Tier Safety Stock | F2-B3 (FR-F2B3-009) |
| FR-v3.6-004 | Push-Pull Hybrid | F1-B6 (Hub ảo) |
| FR-v3.6-005 | FC Commitment Tiers | F1-B4 (FR-F1B4-001..002) |
| FR-v3.6-006 | Seasonal σ Adjustment | F2-B3 (FR-F2B3-010) |
| FR-v3.6-007 | Pipeline Stock | F2-B3 (FR-F2B3-007) |
| FR-v3.6-008 | NM/Supplier Profile | F1-B5 (NM data) |
| FR-v3.6-009 | Cross-CN MOQ Aggregation | F1-B3 (FR-F1B3-001) |
| FR-v3.6-010 | FC→SS Closed Loop | F2-B8 (FR-F2B8-003) |
| FR-v3.6-011 | Monthly-to-Weekly Phasing | F2-B3 (gross req input) |
| FR-v3.7-001 | S&OP Per-CN Bottom-up Input | F1-B2 (FR-F1B2-002) |
| FR-v3.7-002 | S&OP Per-SKU Drill-down | F1-B2 (FR-F1B2-002) |
| FR-v3.7-003 | S&OP Version Compare | F1-B2 (FR-F1B2-003) |
| FR-v3.7-004 | S&OP Approval Workflow | F1-B2 (FR-F1B2-004) |
| FR-v3.7-005 | Collaborative Editing | F1-B2 (FR-F1B2-009) |
| FR-v3.7-006 | S&OP Meeting Workflow | F1-B2 (part of pre-meeting data pack) |
| FR-v3.7-007 | Forecast Value-Add (FVA) | F1-B2 (FR-F1B2-007) |
| FR-v3.7-009 | B2B Pipeline Management | F1-B1 (FR-F1B1-002..007) |
| FR-v3.7-010 | B2B Double-count Adjustment | F1-B1 (FR-F1B1-006) |
| FR-v3.7-011 | Hub ảo Entity | F1-B6 (FR-F1B6-001..006) |
| FR-v3.7-012 | Hub ảo Dashboard | F1-B6 (FR-F1B6-002) |
| FR-v3.7-013 | Commitment Gap Monitor | F1-B7 (FR-F1B7-001..002) |
| FR-v3.7-014 | Commitment Scenario Simulator | F1-B7 (FR-F1B7-003..005) |
| FR-v3.7-016 | CN Demand Adjustment | F2-B2 (FR-F2B2-001..007) |
| FR-v3.7-017 | CN Trust Score | F2-B2 (FR-F2B2-005..006) |
| FR-v3.7-018 | Transport Lot Sizing Engine | F2-B5 (FR-F2B5-001..005) |
| FR-v3.7-020 | NM ATP Check | F2-B6 (FR-F2B6-001..006) |
| FR-v3.7-021 | NM Inventory Snapshot | F2-B1 (FR-F2B1-004) |
| FR-v3.7-022 | Shipment Tracking | F2-B7 (FR-F2B7-007..010) |
| FR-v3.7-023 | POD Mandatory Workflow | F2-B7 (FR-F2B7-011..015) |
| FR-v3.7-024 | Reporting & Export | Cross-cutting (embedded per module) |
| FR-v3.7-025 | Notification System | Cross-cutting (embedded per module) |
| FR-v3.7-028 | Master Data Management | Foundation (Wave 0) |
| FR-v3-008 | PO Auto-Generation | F2-B7 (FR-F2B7-001) |
| FR-v3-013 | PO Lifecycle Tracker | F2-B7 (FR-F2B7-004..005) |
| FR-v3.5-004 | Lateral Transfer Gate | F2-B4 (FR-F2B4-007) |
| FR-v3.2-008 | Feature Toggle | Foundation Policy (Wave 0) |
| FR-v3.2-009 | Mobile Permission Masking | Foundation Policy (Wave 0) |
| FR-v3.2-010 | Post-Approval Edit Governance | F2-B7 (FR-F2B7-003) |
