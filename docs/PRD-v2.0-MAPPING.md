# UNIS SCP v2.0 — PRD Mapping & Module Grouping

> **Ngày tạo:** 2026-04-15
> **Nguồn PRD:** UNIS-SCP-v2.0-FULL-PRD.md
> **Mục đích:** So sánh PRD v2.0 với hệ thống M1-M10 hiện tại + phân nhóm module mới

---

## PHẦN 1 — Mapping PRD v2.0 vs Hệ thống hiện tại

### Legend

| Ký hiệu | Nghĩa |
|---------|-------|
| ✅ **DONE** | Đã có trong M1-M10, đủ hoặc gần đủ |
| 🟡 **EXTEND** | Có nền tảng nhưng cần mở rộng đáng kể |
| 🔴 **NEW** | Chưa có, cần xây mới hoàn toàn |
| 🔴 **REBUILD** | Có nhưng domain model sai căn bản, cần thiết kế lại |

---

### F0 — Master Data (Foundation)

| PRD Requirement | ID | Hiện tại | Status | Ghi chú |
|----------------|-----|---------|--------|---------|
| CRUD SKU base + variant | FR-F0-001 | Không có bảng SKU/CN/NM độc lập | 🔴 NEW | M1-M10 dùng code string trong snapshot, không có entity CRUD |
| SKU → NM single-source mapping | FR-F0-002 | Không có | 🔴 NEW | Chỉ có trong demand_snapshot_line |
| Config management screen (60+ params) | FR-F0-003 | M10 có 30 configs | 🟡 EXTEND | Cần thêm ~30 configs mới (B2B prob, trust score, LCNB distance...) |
| Bulk import Master Data | FR-F0-004 | M1 có CSV upload demand | 🔴 NEW | Cần import riêng cho SKU/CN/NM |
| Validation rules + referential integrity | FR-F0-005 | Không có | 🔴 NEW | |
| NM upload template generator | FR-F0-006 | Không có | 🔴 NEW | |
| Auto-update từ F2-B8 (LT, σ, trust score) | FR-F0-007 | Không có | 🔴 NEW | |
| Data quality dashboard | FR-F0-008 | Không có | 🔴 NEW | |

---

### F1-B1 — Demand Aggregation (Monthly)

| PRD Requirement | ID | Hiện tại | Status | Ghi chú |
|----------------|-----|---------|--------|---------|
| Nhận FC cấp Tổng (SKU × tháng, 12M) | FR-F1B1-001 | M1: demand_snapshot upload CSV | 🟡 EXTEND | M1 có 1 cấp, cần thêm 2-cấp + horizon 12M |
| Nhận FC cấp Chi nhánh (CN × SKU group × tháng) | FR-F1B1-002 | Không có | 🔴 NEW | M1 chỉ có 1 flat snapshot |
| Consistency check Σ(CN) vs Tổng | FR-F1B1-003 | Không có | 🔴 NEW | |
| Import validation + log | FR-F1B1-004/005 | M1 có import validation | 🟡 EXTEND | Cần thêm 2-level validation |
| B2B Pipeline 6-stage | FR-F1B1-009 | Không có | 🔴 NEW | |
| B2B deal management (Sales per CN) | FR-F1B1-010 | Không có | 🔴 NEW | |
| Stage transition → weighted demand update | FR-F1B1-011 | Không có | 🔴 NEW | |

---

### F1-B2 — S&OP Consensus (Monthly)

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| 2-tier review: SC Manager adjust Tổng, CN Manager adjust Chi nhánh | Không có | 🔴 NEW | Hoàn toàn mới |
| Variance reconciliation (Σ CN vs Tổng ±10%) | Không có | 🔴 NEW | |
| FVA tracking (Forecast Value Add) | Không có | 🔴 NEW | |
| S&OP deadlines: Day 3/5/7/10 configurable | Không có | 🔴 NEW | |
| Collaborative editing (nhiều user cùng lúc) | Không có | 🔴 NEW | Phase 2 |
| S&OP lock + version freeze | M1 có freeze snapshot | 🟡 EXTEND | M1 chỉ freeze 1 snapshot, S&OP cần lock per cycle |

---

### F1-B3 — Production Lot Sizing (Monthly)

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Hub netting: hub_available = Σ stock_cn + hub_inbound - Σ SS_cn | Không có | 🔴 NEW | |
| SS Hub formula: z × σ × √LT_hub | M3 có Safety Stock basic | 🟡 EXTEND | M3 tính SS CN, cần thêm SS Hub riêng |
| MOQ check + round up per NM×SKU | Không có | 🔴 NEW | |
| Booking suggestion per NM per SKU | Không có | 🔴 NEW | |
| Output: booking_plan table | Không có | 🔴 NEW | |

---

### F1-B4 — FC Commitment 3 Tầng

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Commitment 3 tier: Hard (±5%) / Firm (±15%) / Soft (±30%) | Không có | 🔴 NEW | |
| NM penalty tracking khi vi phạm tolerance | Không có | 🔴 NEW | |
| Commitment version history | Không có | 🔴 NEW | |
| SC Manager confirm commitment per NM | Không có | 🔴 NEW | |

---

### F1-B5 — NM Confirm / Negotiate

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| NM response tracking (Accept/Partial/Reject) | Không có | 🔴 NEW | |
| SLA reminders: 3d / escalate 5d | Không có | 🔴 NEW | |
| NM Portal / upload interface | Không có | 🔴 NEW | Phase 1: email upload |
| Negotiation rounds logging | Không có | 🔴 NEW | |

---

### F1-B6 — Hub ảo Update

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Hub ảo: virtual inventory = NM committed - Σ CN SS | Không có | 🔴 NEW | |
| Hub ảo → input cho F2 DRP nightly | Không có | 🔴 NEW | |
| Hub ảo recalculate khi NM confirm thay đổi | Không có | 🔴 NEW | |

---

### F1-B7 — Commitment Gap & Scenario Simulator

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Gap monitor: committed vs demand per SKU/NM | Không có | 🔴 NEW | |
| Alert Day 20 (>15%), Day 25 (>10%), Day 28 auto | Không có | 🔴 NEW | |
| 4-scenario simulator (cost/risk) | Không có | 🔴 NEW | Phase 2 AI recommendation |

---

### F2-B1 — Data Sync (Nightly)

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| NM upload tồn kho + ATP theo template | M2 supply snapshot | 🟡 EXTEND | M2 có supply upload nhưng không có template per NM |
| Freshness gate: block PO nếu data > 24h | Không có | 🔴 NEW | |
| Sync log + manual sync trigger | M2 có upload log cơ bản | 🟡 EXTEND | |
| 2×/day sync schedule | Không có | 🔴 NEW | |

---

### F2-B2 — CN Demand Adjustment (Nightly)

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| CN submit demand adjustment (±30% tolerance) | Không có | 🔴 NEW | M1 FC là static snapshot |
| Trust score rolling 12 tuần | Không có | 🔴 NEW | |
| Auto-approve nếu trust > 85% | Không có | 🔴 NEW | |
| Hard cutoff 18:00 | M10 có cutoff config | 🟡 EXTEND | M10 chỉ có DRP cutoff 23:00, không có CN cutoff |
| Monthly → weekly phasing (/4.33) | M9 có /4.33 | 🟡 EXTEND | M9 dùng /4.33 cho reporting, F2-B2 cần wire vào DRP demand input — khác context |
| Reason codes cho adjustment | Không có | 🔴 NEW | |
| SC Manager review khi vượt tolerance | Không có | 🔴 NEW | |

---

### F2-B3 — DRP Netting + Safety Stock CN

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| DRP netting per CN (ending_inv, requirements, PO) | M4 có DRP netting | 🟡 EXTEND | M4 netting tổng, cần phân rã per CN |
| SS CN formula: z × σ_demand × √LT_hub | M3 có Safety Stock | 🟡 EXTEND | M3 dùng z cố định, cần dynamic σ + LT_hub |
| LCNB SS reduction 25% khi enabled | M10 có config lcnb_factor | 🟡 EXTEND | Config có nhưng logic giảm SS chưa áp vào M4 |
| Seasonal σ (same-period-last-year, 2yr) | Không có | 🔴 NEW | |
| Variant breakdown suggestion dựa tồn kho CN | Không có | 🔴 NEW | |
| z override per CN×SKU (critical items) | Không có | 🔴 NEW | |

---

### F2-B4 — Allocation

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Allocation basic: Hub pool → CN | M5 có allocation_run | 🟡 EXTEND | M5 rất basic, chưa có LCNB |
| LCNB: NEAREST_FIRST priority | M5 có engine cơ bản | 🟡 EXTEND | engine có logic, output model cần sửa (multi-source flatten) |
| LCNB: max distance 500km | M5 có engine cơ bản | 🟡 EXTEND | engine có logic, output model cần sửa (multi-source flatten) |
| LCNB: FIFO lot ordering | M5 có engine cơ bản | 🟡 EXTEND | engine có logic, output model cần sửa (multi-source flatten) |
| Fair-share khi Hub không đủ | M5 có engine cơ bản | 🟡 EXTEND | engine có logic, output model cần sửa (multi-source flatten) |
| SS guard: allocation không vi phạm SS CN | M5 có engine cơ bản | 🟡 EXTEND | engine có logic, output model cần sửa (multi-source flatten) |
| Variant match: allocation theo variant tồn kho | M5 có engine cơ bản | 🟡 EXTEND | engine có logic, output model cần sửa (multi-source flatten) |

---

### F2-B5 — Transport Lot Sizing

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Transport plan + trips | M6 có transport_plan + transport_trip | 🟡 EXTEND | M6 có cấu trúc, thiếu lot sizing logic |
| Container packing (pallet + tấn limit) | M6 có trip schema | ✅ DONE | Đã có pallet/weight tracking trong transport_trip |
| Hold-or-ship: fill < 60% → hold 2 ngày | M6 có trip schema | 🟡 EXTEND | Logic threshold chưa có, schema có thể support |
| Top-up suggestion cho container chưa đầy | Không có | 🔴 NEW | |
| Multi-drop route consolidation | M6 có multi-stop | ✅ DONE | M6 đã có multi-drop trong transport_trip |
| LT-aware: HSTK > LT + buffer → hold OK | M6 + M3 có LT data | ✅ DONE | LT và HSTK đã có, cần wire logic quyết định |

---

### F2-B6 — NM ATP Check

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| NM ATP check: PASS/PARTIAL/FAIL | Không có | 🔴 NEW | M2 có supply nhưng không có ATP gate |
| Urgency ranking: CN thấp HSTK được ưu tiên | Không có | 🔴 NEW | |
| Honoring rate tracking per NM | Không có | 🔴 NEW | |
| Freshness gate (NM data > 24h → block) | Không có | 🔴 NEW | |

---

### F2-B7 — PO Review & Confirm

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| PO draft → confirm workflow | M7 có order_batch | 🔴 REBUILD | cần redesign domain model — transport_trip bị flatten, không có order-per-trip, không có CN-level approval, thiếu transaction safety |
| PO + TO separate tabs + lifecycle 5 states | M7 có order_batch/line | 🔴 REBUILD | cần redesign domain model — transport_trip bị flatten, không có order-per-trip, không có CN-level approval, thiếu transaction safety |
| Edit logging: planner override với reason | Không có | 🔴 NEW | |
| PO tracking: vehicle, driver, NVT, ETA | M6 có trip tracking cơ bản | 🟡 EXTEND | |
| POD (Proof of Delivery) | Không có | 🔴 NEW | Phase 2 |
| PO overdue alert | M8 có alert system | 🟡 EXTEND | M8 có alert nhưng chưa có PO overdue per NM |

---

### F2-B8 — Feedback & Closed Loop

| PRD Requirement | Hiện tại | Status | Ghi chú |
|----------------|---------|--------|---------|
| Weekly KPI: FC MAPE, trust score, NM honoring | M8 có KPI dashboard | 🟡 EXTEND | M8 có metrics nhưng chưa có FC MAPE, trust score |
| SS auto-adjust từ σ mới (weekly) | Không có | 🔴 NEW | M8 chỉ monitor, không auto-adjust ngược |
| Transit LT auto-update từ actual PO | Không có | 🔴 NEW | |
| Override analysis: top 5 reasons | Không có | 🔴 NEW | |
| Per-CN metrics | M8 có alert per location | 🟡 EXTEND | |
| Closed loop → Flow 1 next month | Không có | 🔴 NEW | |

---

## PHẦN 2 — Tổng hợp Gap

| Category | Count |
|----------|-------|
| ✅ DONE (đủ, không cần làm) | 4 |
| 🟡 EXTEND (mở rộng module hiện tại) | 24 |
| 🔴 NEW (xây mới hoàn toàn) | 37 |
| 🔴 REBUILD (có nhưng domain model sai căn bản) | 2 |
| **Tổng** | **67** |

---

## PHẦN 3 — Module Grouping (Đề xuất)

> **Tổng: 28 module** (M1-M10 hiện tại + M11-M28 mới từ PRD v2.0).
> Gộp thành **7 Group theo business domain**, build trong **4 Phase**.

### Tổng số Module

```
Hiện tại (Phase 1):     M01–M10   = 10 modules
PRD v2.0 thêm mới:      M11–M28   = 18 modules
────────────────────────────────────────────
Tổng cộng:                          28 modules
```

---

### 10 Business Domain (phiên bản chốt — v3, FINAL)

> **Nguyên tắc cuối cùng:** Tổ chức theo **business domain thay vì group kỹ thuật**. Mỗi module chỉ thuộc 1 domain. M1-M10 là **core engine của từng domain**; M11-M28 là **v2 của cùng domain đó** — không tạo domain mới ngoài D8 (Flow 1 hoàn toàn mới) và D10 (Closed-loop).

| Domain | Tên | # Module | Modules | Ghi chú |
|--------|-----|---------|---------|---------|
| **D1** | Foundation | 2 | M00 + M10 | Nền tảng, không có = không chạy |
| **D2** | Demand Planning | 3 | M11 + M12 + M22 | Dự báo + S&OP + CN adjust |
| **D3** | Supply Intake | 2 | M21 + M26 | Đồng bộ NM + ATP gate |
| **D4** | Replenishment | 1 | M23 | DRP + SS CN (gộp M3+M4) |
| **D5** | Allocation | 1 | M24 | LCNB engine |
| **D6** | Transport | 1 | M25 | Lot sizing + hold/ship |
| **D7** | Order Management | 1 | M27 | PO/TO review + tracking |
| **D8** | Production Booking | 5 | M13 + M14 + M15 + M16 + M17 | **Flow 1 monthly — hoàn toàn mới** |
| **D9** | Monitoring | 2 | M8 + M9 | Đang GoLive, giữ nguyên |
| **D10** | Intelligence | 1 | M28 | Closed-loop, feedback về D1/D3/D4 |
| | **Tổng** | **19 module slot** | | +8 module M1-M7 absorbed = 27 + M10 extend = **28** |

---

### Chi tiết từng Domain

#### D1 — Foundation (nền tảng)
| Module | Tên | Status |
|--------|-----|--------|
| M00 | Master Data Platform | 🔴 NEW |
| M10 | Config & Policy Platform | 🟡 EXTEND |

#### D2 — Demand Planning (dự báo + S&OP)
| Module | Tên | Status |
|--------|-----|--------|
| M1 → M11 | Demand Aggregation (2-level FC + B2B) | 🟡 EXTEND |
| M12 | S&OP Consensus | 🔴 NEW |
| M22 | CN Demand Adjustment & Trust Score | 🔴 NEW |

#### D3 — Supply Intake (tồn kho + ATP gate)
| Module | Tên | Status |
|--------|-----|--------|
| M2 → M21 | Data Sync & Freshness Gate | 🟡 EXTEND |
| M26 | NM ATP Check & Urgency Ranking | 🔴 NEW |

#### D4 — Replenishment (DRP + Safety Stock)
| Module | Tên | Status |
|--------|-----|--------|
| M3 + M4 → M23 | DRP Netting + SS CN (σ dynamic, seasonal) | 🟡 EXTEND |

> M3 + M4 **gộp thành M23** — tính SS xong dùng ngay trong cùng run, không tách.

#### D5 — Allocation
| Module | Tên | Status |
|--------|-----|--------|
| M5 → M24 | Allocation Engine LCNB v2 | 🟡 EXTEND |

#### D6 — Transport
| Module | Tên | Status |
|--------|-----|--------|
| M6 → M25 | Transport Lot Sizing v2 | 🟡 EXTEND |

#### D7 — Order Management (PO/TO)
| Module | Tên | Status |
|--------|-----|--------|
| M7 → M27 | PO Review & Confirm | 🔴 REBUILD |

#### D8 — Production Booking (Flow 1 Monthly — hoàn toàn mới)
| Module | Tên | Status |
|--------|-----|--------|
| M13 | Production Lot Sizing & Hub Booking | 🔴 NEW |
| M14 | FC Commitment 3-Tier | 🔴 NEW |
| M15 | NM Response & Negotiation | 🔴 NEW |
| M16 | Hub ảo Virtual Inventory | 🔴 NEW |
| M17 | Commitment Gap & Scenario Simulator | 🔴 NEW |

#### D9 — Monitoring (GoLive, giữ nguyên)
| Module | Tên | Status |
|--------|-----|--------|
| M8 | Monitor & Learn | ✅ DONE |
| M9 | Plan vs Actual | ✅ DONE |

#### D10 — Intelligence (closed-loop tự động)
| Module | Tên | Status |
|--------|-----|--------|
| M28 | Feedback & Closed Loop | 🟡 EXTEND |

---

### Mapping M cũ → Domain mới

| M cũ | Domain | M mới |
|------|--------|-------|
| M1 Demand | D2 Demand Planning | M11 |
| M2 Supply | D3 Supply Intake | M21 |
| M3 Policy/SS | D4 Replenishment | M23 (partial) |
| M4 DRP | D4 Replenishment | M23 (partial) |
| M5 Allocation | D5 Allocation | M24 |
| M6 Transport | D6 Transport | M25 |
| M7 Execution | D7 Order Mgmt | M27 |
| M8 Monitor | D9 Monitoring | M8 (giữ) |
| M9 Plan/Actual | D9 Monitoring | M9 (giữ) |
| M10 Config | D1 Foundation | M10 |

---

### (Legacy — Group kỹ thuật cũ, reference only)

> **Nguyên tắc:** mỗi module chỉ thuộc **1 group duy nhất**. Không có module ảo (M27b/M28b bị loại).
> **Separation:** Flow 1 (Monthly) và Flow 2 (Daily) tách rõ — deploy khác thời điểm, team khác.

| Group | Tên | # Module | Modules | Flow |
|-------|-----|---------|---------|------|
| **G0** | Foundation | 2 | M00 Master Data + M10 Config/Policy | Cross |
| **G1** | Monthly Planning | 2 | M11 Demand v2 + M12 S&OP | Flow 1 đầu |
| **G2** | Production Booking | 5 | M13 Lot Sizing + M14 Commitment + M15 NM Response + M16 Hub ảo + M17 Gap/Scenario | Flow 1 cuối |
| **G3** | Daily Supply Intake | 3 | M21 Data Sync + M22 CN Adjustment + M26 ATP Check | Flow 2 đầu |
| **G4** | DRP & Allocation | 2 | M23 DRP+SS CN + M24 Allocation Engine | Flow 2 engine |
| **G5** | Execution | 2 | M25 Transport + M27 PO/TO Review | Flow 2 cuối |
| **G6** | Intelligence | 2 | M28 Feedback/Closed Loop + M9 Plan vs Actual | Cross |
| | | **18 module mới + M9 + M10 extend** | | |

**Tổng:** 18 module mới (M00, M11–M17, M21–M28) + M9 giữ nguyên + M10 extend = **20 module slot trong 7 group**, plus 8 module M1-M8 cũ được absorbed vào các module v2 tương ứng → **28 module tổng toàn hệ thống**.

#### Đã sửa so với phiên bản cũ

| Sai sót cũ | Cách sửa |
|-----------|----------|
| M23 xuất hiện ở cả G3 và G4 | M23 thuộc duy nhất **G4** — SS CN là phần không tách của DRP netting |
| M27b TO Tracking tự đẻ ra | Bỏ — TO nằm trong M27 (cùng workflow, khác tab UI) |
| M28b Closed Loop tự đẻ ra | Bỏ — Closed Loop là essence của M28, không tách |
| G1 trộn Flow 1 (M11/M12) với Flow 2 (M22) | Tách: G1 chỉ Flow 1 monthly; M22 chuyển sang **G3** daily |

---

### Visual Map — 10 Domain (v3 FINAL)

```
┌─────────────────────────────────┐
│   D1  FOUNDATION                │
│   Master Data · Config/Policy   │
│   (M00, M10)                    │
└──────────────┬──────────────────┘
               │ feeds all
    ┌──────────┴──────────┐
    ▼                     ▼
┌───────────────┐   ┌──────────────────┐
│ D2 DEMAND     │   │ D3 SUPPLY INTAKE │
│ PLANNING      │   │ M21 · M26        │
│ M11 M12 M22   │   │                  │
└───────┬───────┘   └────────┬─────────┘
        └──────────┬─────────┘
                   ▼
            ┌──────────────┐
            │ D4 REPLENISH │
            │ DRP + SS_cn  │
            │ M23          │
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │ D5 ALLOCATION│
            │ LCNB M24     │
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │ D6 TRANSPORT │
            │ M25          │
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │ D7 ORDER MGMT│
            │ PO/TO M27    │
            └──────┬───────┘
                   ▼
    ┌──────────────┴──────────────┐
    ▼                              ▼
┌────────────┐            ┌──────────────────┐
│ D9 MONITOR │            │ D10 INTELLIGENCE │
│ M8 · M9    │◄───────────│ M28 closed loop  │
└────────────┘            └──────┬───────────┘
                                 │ feedback
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
                   D1           D3           D4
              (LT update)   (trust)   (SS refresh)

────────────────────────────────────────────────────
D8 PRODUCTION BOOKING (Monthly — song song)
  M13 → M14 → M15 → M16 ──feeds D4──▶ M23
                  └─ M17 gap monitor
────────────────────────────────────────────────────
```

---

### Visual Map (Legacy v2 — 7 Group, reference only)

```
┌─────────────────────────────────────────────────────┐
│  G0 FOUNDATION                                      │
│  Master Data (M00)   │   Config & Policy (M10)      │
└──────────────────────┬──────────────────────────────┘
                       │
    ┌──────────────────┴──────────────────┐
    │                                      │
    ▼  FLOW 1 MONTHLY                      ▼  FLOW 2 DAILY
┌──────────────────────┐       ┌──────────────────────────┐
│  G1 MONTHLY PLANNING │       │  G3 DAILY SUPPLY INTAKE  │
│  Demand v2    (M11)  │       │  Data Sync     (M21)     │
│  S&OP         (M12)  │       │  CN Adjustment (M22)     │
└──────────┬───────────┘       │  ATP Check     (M26)     │
           │                    └──────────┬───────────────┘
           ▼                               ▼
┌──────────────────────┐       ┌──────────────────────────┐
│  G2 PROD. BOOKING    │       │  G4 DRP & ALLOCATION     │
│  Lot Sizing   (M13)  │       │  DRP + SS CN  (M23)      │
│  Commitment   (M14)  │       │  Allocation   (M24)      │
│  NM Response  (M15)  │       └──────────┬───────────────┘
│  Hub ảo       (M16)──┼──────► Hub ảo    │
│  Gap/Scenario (M17)  │       feeds F2   ▼
└──────────────────────┘       ┌──────────────────────────┐
                                │  G5 EXECUTION            │
                                │  Transport    (M25)      │
                                │  PO/TO Review (M27)      │
                                └──────────┬───────────────┘
                                           ▼
                          ┌──────────────────────────────────┐
                          │  G6 INTELLIGENCE (cross-cutting) │
                          │  Feedback + Closed Loop  (M28)   │
                          │  Plan vs Actual          (M9)    │
                          └──────────────────────────────────┘
```

---

### Build Order theo Phase (v2 — chốt, giải quyết circular dep)

> **Key insight:** Flow 2 sequential vì đang GoLive cần ổn định. Flow 1 chạy **song song** từ Sprint 6 với team BE3+BE4+FE2 — không đợi Flow 2.

| Phase | Sprint | Group | Module | Ghi chú |
|-------|--------|-------|--------|---------|
| **P0** | Sprint 0–2 | G0 + Bug Fix | M00, M10 extend, fix M2/M5/M7 | Song song: BugFix chạy Sprint 0 |
| **P1** | Sprint 3 | G3 (partial) | M21 Data Sync | Data layer Flow 2 |
| **P1** | Sprint 3 | G3 (partial) | M22 CN Adjustment | Input cho G4 — phải xong trước Sprint 4 |
| **P1** | Sprint 4–5 | G4 | M23 DRP+SS, M24 Allocation | Dùng **fallback** cho hub_virtual (M16 chưa có) |
| **P1** | Sprint 5–7 | G5 + G3 | M25 Transport, M26 ATP, M27 PO/TO | M26 hoàn thiện G3; M25/M27 cho G5 |
| **P1** | Sprint 7–8 | G6 | M28 Feedback, M9 minor extend | Closed loop wrap up Flow 2 |
| **P2** | Sprint 6–12 | G1 + G2 | M11, M12, M13–M17 | **Song song Flow 2** từ Sprint 6 — team riêng |
| **P3** | Sprint 13+ | Intelligence | AI Scenario, MAPE, NM Portal, POD | Enhancement layer |

#### Circular dependency đã fix

| Vấn đề cũ | Fix |
|-----------|-----|
| G4 cần `hub_virtual` từ M16 (G2) — nhưng G2 chạy Sprint 12 | G4 dùng **fallback**: hub_virtual = supply_snapshot.qty (Phase 1); khi M16 ready (Sprint 12+) → swap |
| M22 là INPUT cho M23 nhưng xếp Sprint 9 | Kéo M22 lên **Sprint 3** cùng G3 (cùng cutoff 18:00 daily) |
| G1 cũ trộn M22 (Flow 2) với M11/M12 (Flow 1) | M22 sang G3, G1 chỉ còn Flow 1 monthly |

**7 Groups, 2 Flows rõ ràng, 4 Phases, song song hóa Flow 1+2 từ Sprint 6** — deploy độc lập, team scale tốt hơn.

---

### (Cách tổ chức cũ — Layer-based, reference)

---

### LAYER 0 — Foundation (Cơ sở dữ liệu hệ thống)

```
M00 — Master Data Platform
      Mới hoàn toàn. Nền tảng cho 17 module còn lại.

M10* — Policy & Config Platform (ĐANG CÓ — mở rộng)
       Thêm ~30 configs mới từ PRD v2.0 F0.4
```

---

### LAYER 1 — Flow 1: Production Booking (Monthly)

```
M11 — Demand Aggregation v2
      Mở rộng M1. Thêm: 2-level FC (Tổng + CN), B2B pipeline 6-stage.

M12 — S&OP Consensus
      Hoàn toàn mới. Workflow 2-tier review, FVA, deadline lock.

M13 — Production Lot Sizing & Hub Booking
      Hoàn toàn mới. MOQ check, SS Hub formula, booking suggestion.

M14 — FC Commitment Management
      Hoàn toàn mới. 3-tier commitment (Hard/Firm/Soft), NM penalty.

M15 — NM Response & Negotiation
      Hoàn toàn mới. NM portal, SLA tracking, response management.

M16 — Hub ảo Virtual Inventory
      Hoàn toàn mới. Virtual stock = NM committed - Σ CN SS.

M17 — Commitment Gap & Scenario Simulator
      Hoàn toàn mới. Gap monitor, alert Day 20/25/28, 4-scenario.
```

---

### LAYER 2 — Flow 2: Daily DRP (Nightly 23:00)

```
M21 — Data Sync & Freshness Gate
      Mở rộng M2. Thêm: freshness gate, sync log, NM template per NM.

M22 — CN Demand Adjustment & Trust Score
      Hoàn toàn mới. CN submit adjustment, trust score, auto-approve.

M23 — DRP Netting v2 + Safety Stock CN
      Mở rộng M3+M4. Thêm: per-CN netting, SS CN formula dynamic,
      seasonal σ, LCNB SS reduction, variant suggestion.

M24 — Allocation Engine v2 (LCNB)
      Mở rộng M5. Thêm: LCNB NEAREST_FIRST, FIFO, fair-share, SS guard.

M25 — Transport Lot Sizing v2
      Mở rộng M6. Thêm: container packing, hold-or-ship, top-up, multi-drop.

M26 — NM ATP Check & Urgency Ranking
      Hoàn toàn mới. ATP gate PASS/PARTIAL/FAIL, urgency ranking per CN HSTK.

M27 — PO Review & Confirm (Human Gate)
      Mở rộng M7. Thêm: draft review gate, edit logging, PO/TO tabs riêng.

M28 — Feedback & Closed Loop
      Mở rộng M8. Thêm: SS auto-adjust, LT auto-update, override analysis.
```

---

### LAYER 3 — Cross-cutting (Đã có — giữ nguyên hoặc minor update)

```
M09 — Plan vs Actual (ĐANG CÓ)
      Minor extend: thêm FC MAPE khi actual_sales có (Phase 2).

M08* — Monitor & Learn (ĐANG CÓ — tích hợp vào M28)
       Phase 1 giữ nguyên. Phase 2 merge logic vào M28 Feedback.
```

---

## PHẦN 4 — Build Sequence & Phase

> Ưu tiên theo dependency chain và business value.
> **Quy ước Phase:** Phase 0.0 = Bug Fix → Phase 0 = Foundation → **Phase 1 = Flow 2 Daily DRP** → Phase 2 = Flow 1 Monthly S&OP → Phase 3 = Intelligence.

---

### Phase 0.0 — Bug Fix (Sprint 0 — trước khi bắt đầu build mới)
*Unblock các bug nghiêm trọng trong hệ thống hiện tại*

| Fix | Module | Vấn đề |
|-----|--------|--------|
| M2 `is_estimated` flag | M02 | Tồn kho estimated không được đánh dấu, freshness gate không thể phân biệt |
| M5 multi-source output | M05 | Allocation flatten nhiều source thành 1 dòng, mất traceability per NM |
| M7 `createBatch` transaction | M07 | Thiếu transaction safety — partial write không rollback, dữ liệu inconsistent |

---

### Phase 0 — Foundation (Sprint 1-3)
*Không có Foundation → không module nào chạy được*

| Module | Nội dung | Phụ thuộc |
|--------|---------|-----------|
| **M00** Master Data Platform | CRUD SKU/CN/NM/Hub/User, mappings, bulk import, data quality | — |
| **M10** Policy Platform mở rộng | Thêm 30 configs mới (B2B prob, trust score, LCNB params, transport params) | M00 |

---

### Phase 1 — Daily DRP Core (Sprint 4-8)
*Ưu tiên Flow 2 trước vì UNIS đang vận hành nightly DRP — cần nâng cấp ngay*

| Module | Nội dung | Phụ thuộc |
|--------|---------|-----------|
| **M21** Data Sync v2 | Freshness gate, NM template, sync log | M00 |
| **M22** CN Demand Adjustment | Trust score, adjustment UI, auto-approve | M00, M21 |
| **M23** DRP Netting v2 | Per-CN netting, SS CN dynamic, seasonal σ | M21, M22, M10 |
| **M24** Allocation v2 (LCNB) | NEAREST_FIRST, FIFO, fair-share, SS guard | M23 |
| **M25** Transport v2 | Hold-or-ship, container packing, multi-drop | M24 |
| **M26** NM ATP Check | ATP gate, urgency ranking | M21, M24 |
| **M27** PO Review v2 | Draft gate, edit log, PO/TO tabs | M25, M26 |
| **M28** Feedback Loop | SS auto-adjust, LT auto-update, override analysis | M27, M09 |

---

### Phase 2 — Monthly S&OP Booking (Sprint 9-14)
*Flow 1 — xây sau khi Flow 2 ổn định*

| Module | Nội dung | Phụ thuộc |
|--------|---------|-----------|
| **M11** Demand Aggregation v2 | 2-level FC, B2B pipeline 6-stage | M00 |
| **M12** S&OP Consensus | 2-tier review, FVA, deadline workflow | M11 |
| **M13** Production Lot Sizing | MOQ check, SS Hub, booking suggestion | M12, M23 |
| **M14** FC Commitment | 3-tier (Hard/Firm/Soft), penalty | M13 |
| **M15** NM Response | SLA tracking, NM portal | M14 |
| **M16** Hub ảo | Virtual inventory, input for Flow 2 | M15 |
| **M17** Gap & Scenario | Gap monitor Day 20/25/28, 4-scenario | M16 |

---

### Phase 3 — Intelligence & Automation (Sprint 15+)

| Module | Nội dung | Phụ thuộc |
|--------|---------|-----------|
| FC MAPE trong M09 | Unblock khi actual_sales có | M28 |
| Scenario AI recommendation (M17) | AI suggest action per scenario | M17, M28 |
| Collaborative editing real-time (M12) | WebSocket/live collab | M12 |
| NM Portal Phase 2 (M15) | NM mobile app, direct API | M15 |
| POD Proof of Delivery (M27) | Photo upload, driver app | M27 |

---

## PHẦN 5 — Module Map: PRD Section → Module mới

| PRD Section | Module mới | Layer | Phase |
|-------------|-----------|-------|-------|
| F0 Master Data | **M00** | 0 | 0 |
| F0 Config (extended) | **M10** extend | 0 | 0 |
| F1-B1 Demand Aggregation | **M11** | 1 | 2 |
| F1-B2 S&OP Consensus | **M12** | 1 | 2 |
| F1-B3 Production Lot Sizing | **M13** | 1 | 2 |
| F1-B4 FC Commitment | **M14** | 1 | 2 |
| F1-B5 NM Response | **M15** | 1 | 2 |
| F1-B6 Hub ảo | **M16** | 1 | 2 |
| F1-B7 Gap & Scenario | **M17** | 1 | 2 |
| F2-B1 Data Sync | **M21** | 2 | 1 |
| F2-B2 CN Adjustment | **M22** | 2 | 1 |
| F2-B3 DRP Netting v2 | **M23** | 2 | 1 |
| F2-B4 Allocation v2 | **M24** | 2 | 1 |
| F2-B5 Transport v2 | **M25** | 2 | 1 |
| F2-B6 NM ATP Check | **M26** | 2 | 1 |
| F2-B7 PO Review v2 | **M27** | 2 | 1 |
| F2-B8 Feedback Loop | **M28** | 2 | 1 |

---

## PHẦN 6 — Tái sử dụng M1-M10

| Module hiện tại | Fate trong v2.0 |
|----------------|----------------|
| M01 Demand Ingestion | **Absorbed vào M11** — M11 kế thừa logic CSV import, thêm 2-level + B2B |
| M02 Supply Snapshot | **Absorbed vào M21** — M21 kế thừa supply upload, thêm freshness gate |
| M03 Inventory & Policy | **Absorbed vào M23** — SS logic nâng lên SS CN dynamic + SS Hub |
| M04 DRP Netting | **Absorbed vào M23** — rebuild per-CN netting, giữ core netting logic |
| M05 Allocation Engine | **Absorbed vào M24** — rebuild với LCNB full, giữ basic allocation |
| M06 Transport Planning | **Absorbed vào M25** — giữ transport_plan/trip schema, thêm lot sizing |
| M07 Order Bridge | **Absorbed vào M27** — rebuild PO review gate, giữ order_batch/line schema |
| M08 Monitor & Learn | **Giữ nguyên core** — KPI/alert giữ nguyên trong M8; closed-loop build thêm trong M28; Phase 3 có thể merge M8+M28 |
| M09 Plan vs Actual | **Giữ nguyên** — minor extend Phase 3 khi actual_sales có |
| M10 Policy Platform | **Extended** — thêm 30 configs, giữ toàn bộ infrastructure |

---

*PRD v2.0 Mapping — 2026-04-15*
