# UNIS SCP v2.0 — Business Domain Structure

> **Ngày tạo:** 2026-04-15 (revised)
> **Mục đích:** Tổ chức 28 module theo 10 business domain. M1-M10 là core engine của từng domain, M11-M28 là v2 của cùng domain.
> **Liên kết:** [PRD-v2.0-MAPPING.md](./PRD-v2.0-MAPPING.md) · [IMPLEMENT-CHECKLIST.md](./IMPLEMENT-CHECKLIST.md)

---

## Triết lý tổ chức

- **M1-M10 KHÔNG biến mất** — chúng là **core engine** của từng domain, v2.0 là extend/rebuild trong chính domain đó
- **Chỉ có 2 domain hoàn toàn mới:** D8 Production Booking (Flow 1 monthly) và D10 Intelligence (closed-loop)
- **Còn lại 8 domain:** chính là cấu trúc cũ được nâng cấp

---

## 10 Business Domain — Tổng quan

| Domain | Tên | Module cũ | Module mới v2 | Flow |
|--------|-----|-----------|---------------|------|
| **D1** | Foundation | M10 | M00 + M10 extend | Cross |
| **D2** | Demand Planning | M1 | M11 + M12 + M22 | Both |
| **D3** | Supply Intake | M2 | M21 + M26 | Flow 2 |
| **D4** | Replenishment | M3 + M4 | M23 (gộp SS + Netting) | Flow 2 |
| **D5** | Allocation | M5 | M24 (LCNB) | Flow 2 |
| **D6** | Transport | M6 | M25 | Flow 2 |
| **D7** | Order Management | M7 | M27 (REBUILD) | Flow 2 |
| **D8** | Production Booking | — | M13 + M14 + M15 + M16 + M17 | Flow 1 |
| **D9** | Monitoring | M8 + M9 | M8 + M9 (giữ nguyên) | Cross |
| **D10** | Intelligence | — | M28 | Cross |

**Tổng module:** 10 cũ + 18 mới = **28 module** trong 10 domain.

---

## D1 — Foundation

> Dữ liệu nền. Không có = không module nào chạy được.

| Module | Tên | Status |
|--------|-----|--------|
| **M00** | Master Data Platform | 🔴 NEW |
| **M10** | Config & Policy Platform | 🟡 EXTEND |

**Scope:**
- CRUD SKU/CN/NM/Hub + mappings (single-source SKU→NM)
- 60+ configs (LCNB, trust score, tolerance, cutoff)
- `transport_lane` extend với `transit_lt_days`

**Phase:** P0 · **Sprint:** 1-2

---

## D2 — Demand Planning

> Dự báo nhu cầu. Input cho cả 2 Flow.

| Module | Tên | Status |
|--------|-----|--------|
| **M1 → M11** | Demand Aggregation v2 (2-level + B2B 6-stage) | 🟡 EXTEND |
| **M12** | S&OP Consensus (2-tier review, FVA, Day 3/5/7/10) | 🔴 NEW |
| **M22** | CN Demand Adjustment & Trust Score | 🔴 NEW |

**Scope:**
- FC cấp Tổng + FC cấp CN (12 tháng horizon)
- B2B pipeline 6-stage → weighted demand
- S&OP consensus cycle với lock Day 10
- CN daily adjustment ±30% với trust score 12w

**Phase:** P2 (M11, M12 — Sprint 6-8) · P1 (M22 — Sprint 3-4, vì cùng Flow 2 cutoff 18:00)

---

## D3 — Supply Intake

> Đồng bộ tồn kho từ NM. Gate trước DRP.

| Module | Tên | Status |
|--------|-----|--------|
| **M2 → M21** | Data Sync & Freshness Gate | 🟡 EXTEND |
| **M26** | NM ATP Check & Urgency Ranking | 🔴 NEW |

**Scope:**
- NM upload per-template, 2x/day sync
- Freshness gate 24h block DRP
- ATP check PASS/PARTIAL/FAIL + urgency per HSTK
- NM honoring rate tracking

**Phase:** P1 · **Sprint:** 3-5

---

## D4 — Replenishment

> Tính nhu cầu bổ sung. Core engine nightly.

| Module | Tên | Status |
|--------|-----|--------|
| **M3 → M23 (partial)** | Safety Stock CN (σ dynamic, seasonal) | 🟡 EXTEND |
| **M4 → M23 (partial)** | DRP Netting per CN | 🟡 EXTEND |

> **M3 + M4 gộp thành M23** — tính SS xong dùng ngay trong cùng run, không tách. Nhưng vẫn coi là 2 engine logic trong cùng 1 domain.

**Scope:**
- SS CN formula: z × σ × √LT_hub
- LCNB SS reduction 25%
- Seasonal σ (same-period-last-year)
- Per-CN netting (thay vì tổng)
- Variant breakdown suggestion
- **Baseline Drift Fix:** pin `policy_run_id` vào `plan_run`

**Phase:** P1 · **Sprint:** 4-6

---

## D5 — Allocation

> Phân bổ hàng từ Hub → CN theo priority.

| Module | Tên | Status |
|--------|-----|--------|
| **M5 → M24** | Allocation Engine LCNB v2 | 🟡 EXTEND |

**Scope:**
- NEAREST_FIRST priority (distance-based)
- FIFO lot ordering
- Fair-share khi hub insufficient
- SS guard (không vi phạm SS_cn)
- Variant match
- **BUG-02 fix:** bảng mới `allocation_leg` (multi-source per result)

**Phase:** P1 · **Sprint:** 5-6

---

## D6 — Transport

> Lên kế hoạch vận chuyển, đóng container, hold/ship.

| Module | Tên | Status |
|--------|-----|--------|
| **M6 → M25** | Transport Lot Sizing v2 | 🟡 EXTEND |

**Scope:**
- Container packing (pallet + tấn) ✅ đã có
- Hold-or-ship: fill < 60% → hold 2 ngày
- Top-up suggestion cho container chưa đầy
- Multi-drop route ✅ đã có
- LT-aware hold decision ✅ đã có

**Phase:** P1 · **Sprint:** 6-7

---

## D7 — Order Management

> Tạo, duyệt, tracking PO/TO với NM và CN.

| Module | Tên | Status |
|--------|-----|--------|
| **M7 → M27** | PO Review & Confirm (REBUILD) | 🔴 REBUILD |

**Scope:**
- Domain model mới (6 bảng): `po_header`, `po_line`, `to_header`, `to_line`, `po_edit_log`, `po_tracking`
- Draft → Review → Confirmed → Sent → Delivered lifecycle
- Planner override với mandatory reason
- PO/TO tabs riêng biệt
- PO overdue alert
- **Chạy song song M7 cũ**, deprecate sau khi stable

**Phase:** P1 · **Sprint:** 7-8 (2 sprint riêng — không gộp với M28)

---

## D8 — Production Booking

> Booking tháng với NM. **Domain hoàn toàn mới — Flow 1 Monthly.**

| Module | Tên | Status |
|--------|-----|--------|
| **M13** | Production Lot Sizing & Hub Booking | 🔴 NEW |
| **M14** | FC Commitment 3-Tier | 🔴 NEW |
| **M15** | NM Response & Negotiation | 🔴 NEW |
| **M16** | Hub ảo Virtual Inventory | 🔴 NEW |
| **M17** | Commitment Gap & Scenario Simulator | 🔴 NEW |

**Scope:**
- M13: Hub netting, SS Hub, MOQ, booking suggestion per NM
- M14: Commitment Hard ±5% / Firm ±15% / Soft ±30%
- M15: NM response Accept/Partial/Reject, SLA 3d/5d, negotiation rounds
- M16: virtual = Σ NM committed - Σ SS_cn → **feeds D4 M23**
- M17: Gap alert Day 20/25/28, 4-scenario simulator

**Phase:** P2 · **Sprint:** 8-12 (song song Flow 2 từ Sprint 6 bắt đầu M13 planning)

---

## D9 — Monitoring

> KPI, alert, plan vs actual. Đang GoLive — giữ nguyên.

| Module | Tên | Status |
|--------|-----|--------|
| **M8** | Monitor & Learn | ✅ DONE |
| **M9** | Plan vs Actual | ✅ DONE |

**Scope:**
- Giữ nguyên toàn bộ M8 + M9 core
- Phase 3: thêm FC MAPE vào M9 khi actual_sales từ ERP có
- Phase 3: merge M8 + M28 thành unified Monitor+Feedback (**chỉ sau ≥ 1 tháng stable**)

**Phase:** Đã có (không cần build lại) · Minor extend P3

---

## D10 — Intelligence

> Closed-loop tự động. **Domain mới** — feedback về D1/D2/D3/D4.

| Module | Tên | Status |
|--------|-----|--------|
| **M28** | Feedback & Closed Loop | 🟡 EXTEND |

**Scope:**
- SS auto-adjust weekly (recalculate σ → update ss_cn)
- Transit LT auto-update từ actual PO → update `supplier.lead_time_days` (feedback D1)
- Override analysis top 5 reasons từ `po_edit_log`
- Weekly KPI report (FC MAPE, trust score, honoring rate, SS accuracy)
- Trust score refresh (feedback D2.M22)

**Phase:** P1 · **Sprint:** 9

---

## Visual — 10 Domain Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        D1 — FOUNDATION                               │
│         M00 Master Data       │       M10 Config & Policy            │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ feeds all
            ┌──────────────────────┴──────────────────────┐
            ▼                                             ▼
   ┌────────────────────┐                       ┌────────────────────┐
   │  D2 DEMAND PLAN    │                       │  D3 SUPPLY INTAKE  │
   │  M11 Demand v2     │                       │  M21 Data Sync     │
   │  M12 S&OP          │                       │  M26 NM ATP        │
   │  M22 CN Adjust     │                       │                    │
   └──────────┬─────────┘                       └──────────┬─────────┘
              │                                            │
              └────────────────────┬───────────────────────┘
                                   ▼
                       ┌────────────────────────┐
                       │  D4 REPLENISHMENT      │
                       │  M23 (SS_cn + Netting) │
                       │  + policy_run_id pin   │
                       └────────────┬───────────┘
                                    ▼
                       ┌────────────────────────┐
                       │  D5 ALLOCATION         │
                       │  M24 LCNB Engine       │
                       │  + allocation_leg      │
                       └────────────┬───────────┘
                                    ▼
                       ┌────────────────────────┐
                       │  D6 TRANSPORT          │
                       │  M25 Lot Sizing v2     │
                       └────────────┬───────────┘
                                    ▼
                       ┌────────────────────────┐
                       │  D7 ORDER MGMT         │
                       │  M27 PO/TO (REBUILD)   │
                       └────────────┬───────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
        ┌──────────────────┐                 ┌──────────────────────┐
        │  D9 MONITORING   │                 │  D10 INTELLIGENCE    │
        │  M8 Monitor      │                 │  M28 Closed Loop     │
        │  M9 Plan/Actual  │◄────────────────│                      │
        └──────────────────┘    feedback     └──────────┬───────────┘
                                                        │
                          ┌─────────────────────────────┼─────────────────────┐
                          ▼                             ▼                     ▼
                     D1 (LT update)              D3 (trust refresh)    D4 (SS refresh)
                     supplier.lead_time_days     trust_score           ss_cn weekly


┌──────────────────────────────────────────────────────────────────────┐
│      D8 — PRODUCTION BOOKING (Flow 1 Monthly, song song)             │
│                                                                      │
│  M13 Lot Sizing ──▶ M14 Commitment ──▶ M15 NM Response               │
│                                            │                         │
│                                            ▼                         │
│                        M16 Hub ảo ──feeds D4 M23──▶                  │
│                                            │                         │
│                                            ▼                         │
│                        M17 Gap Monitor (Day 20/25/28)                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Mapping nhanh — M cũ → Domain

| M cũ | Domain | M v2.0 | Ghi chú |
|------|--------|--------|---------|
| M1 Demand | D2 Demand Planning | M11 | Extend 2-level FC + B2B |
| M2 Supply | D3 Supply Intake | M21 | Extend freshness gate |
| M3 Policy/SS | D4 Replenishment | M23 (part SS) | Gộp cùng M4 |
| M4 DRP | D4 Replenishment | M23 (part netting) | Gộp cùng M3 |
| M5 Allocation | D5 Allocation | M24 | Extend LCNB + allocation_leg |
| M6 Transport | D6 Transport | M25 | Extend hold-or-ship + top-up |
| M7 Execution | D7 Order Management | M27 | **REBUILD** domain model mới |
| M8 Monitor | D9 Monitoring | M8 giữ | Phase 3 có thể merge M28 |
| M9 Plan/Actual | D9 Monitoring | M9 giữ | Phase 3 thêm FC MAPE |
| M10 Config | D1 Foundation | M10 extend | Thêm ~30 configs mới |

**Kết luận:** M1-M10 là core engine của từng domain. M11-M28 là v2 của cùng domain. Chỉ có **2 domain hoàn toàn mới**: D8 Production Booking (Flow 1) và D10 Intelligence (closed-loop).

---

## Build Order theo Domain

### Phase 0.0 — Bug Fix (Sprint 0 · Toàn team)

| Fix | Module | Domain |
|-----|--------|--------|
| M2 `is_estimated` logic (service fix) | M02 | D3 |
| M5 multi-source → bảng `allocation_leg` mới | M05 | D5 |
| M7 `createBatch` transaction safety | M07 | D7 |

### Phase 0 — Foundation (Sprint 1-2)

| Domain | Module | Owner |
|--------|--------|-------|
| D1 | M00 Master Data + `transport_lane.transit_lt_days` | BE3 + DA1 + FE2 |
| D1 | M10 Config extend | BE3 + DA1 |
| DevOps | Feature flag infrastructure | DevOps1 |

### Phase 1 — Flow 2 Daily DRP (Sprint 3-9)

| Sprint | Domain | Module | Owner |
|--------|--------|--------|-------|
| 3-4 | D3 | M21 Data Sync | BE1 + FE1 |
| 3-4 | D2 | M22 CN Adjustment + Trust Score | BE1 + FE1 + DA2 |
| 4-5 | D4 | M23 SS_cn + DRP Netting + policy_run_id pin | BE1 + DA1 |
| 5-6 | D5 | M24 Allocation LCNB | BE2 + DA1 |
| 5 | D3 | M26 NM ATP Check | BE2 + DA2 |
| 6-7 | D6 | M25 Transport v2 | BE2 + FE1 |
| 7 | D7 | M27 PO REBUILD (part 1: PO workflow) | BE4 + FE1 + DA1 |
| 8 | D7 | M27 PO REBUILD (part 2: TO + deprecate M7) | BE4 + FE1 |
| 9 | D10 | M28 Feedback & Closed Loop | BE1 + DA2 |

### Phase 2 — Flow 1 Monthly Booking (Sprint 6-12, song song Phase 1)

| Sprint | Domain | Module | Owner |
|--------|--------|--------|-------|
| 6-7 | D2 | M11 Demand Aggregation v2 | BE3 + FE2 |
| 7-8 | D2 | M12 S&OP Consensus | BE3 + FE2 + DA2 |
| 8-9 | D8 | M13 Production Lot Sizing | BE3 + DA1 |
| 9-10 | D8 | M14 FC Commitment | BE4 + FE2 |
| 10 | D8 | M15 NM Response | BE4 + FE2 |
| 10-11 | D8 | M16 Hub ảo | BE4 + DA1 |
| 11-12 | D8 | M17 Gap & Scenario | BE4 + FE2 + DA2 |

### Phase 3 — Intelligence Enhancement (Sprint 13+)

| Enhancement | Domain | Module | Ghi chú |
|-------------|--------|--------|---------|
| FC MAPE | D9 | M9 | Khi actual_sales từ ERP có |
| AI scenario recommendation | D8 | M17 | LLM suggest best action |
| Collaborative real-time | D2 | M12 | WebSocket S&OP |
| NM Portal v2 | D8 | M15 | NM direct API |
| POD | D7 | M27 | Photo upload, driver app |
| Merge M8 + M28 | D9+D10 | — | **Chỉ sau ≥ 1 tháng stable, no critical incidents** |

---

## Dependency Rules (theo Domain)

1. **D1 là hard prerequisite** cho 9 domain còn lại
2. **Flow 2 sequence:** D3 → D4 → D5 → D6 → D7 → D10
3. **Flow 1 sequence:** D2 (partial M11+M12) → D8
4. **Cross-flow integration:**
   - D8.M16 Hub ảo → D4.M23 DRP (fallback nếu D8 chưa deploy)
   - D10.M28 feedback loops:
     - → D4.M23 (SS refresh weekly)
     - → D1.M00 (supplier.lead_time_days update)
     - → D2.M22 (trust score refresh)
     - → D2.M11 (FC MAPE — Phase 3)
5. **Feature flag** cho mọi cross-domain integration → rollback ngay nếu incident

---

## Team Assignment theo Domain

| Team | Members | Domain chính |
|------|---------|--------------|
| **Flow 2 Core** | BE1 + FE1 | D3, D4, D10 |
| **Flow 2 Engine** | BE2 | D5, D6 |
| **Flow 2 Rebuild** | BE4 + FE1 | D7 (M27) |
| **Flow 1** | BE3 + BE4 + FE2 | D2, D8 |
| **Foundation** | BE3 + DA1 + FE2 | D1 |
| **Data** | DA1 + DA2 | Schema (DA1) · Analytics (DA2) across all |
| **Infra** | DevOps1 + DevOps2 | Feature flag, cron, CI/CD, alerts |

---

*GROUP-MODULE.md — UNIS SCP v2.0 — 10 Business Domain — 2026-04-15 (revised)*
