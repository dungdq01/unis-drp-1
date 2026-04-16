# M11 — Demand Aggregation v2 (2-level FC + B2B Pipeline)

> **Ngày:** 2026-04-17 · **Phase:** 2 · **Sprint:** 6-8 (song song Flow 2)
> **Owner:** BE3 · **DA:** DA2 · **FE:** FE2
> **Status:** 🟡 EXTEND M1 Demand
> **PRD:** §F1-B1 Demand Aggregation · **Flow:** 1 (Monthly Booking, Day 1-3)
> **Feature flag:** `m11_demand_v2_enabled`
> **Folder:** `backend/src/demand/` (EXTEND — KHÔNG tạo folder mới, theo Rule 3)

---

## 1. Tại sao làm bài này

UNIS có ~40% demand từ dự án B2B — không forecast được bằng statistical model. Hiện planner tổng hợp thủ công qua Excel:
- Đếm trùng (B2B deal đã thành PO vẫn nằm trong pipeline)
- Thiếu weighted probability theo stage → demand quá cao hoặc quá thấp
- FC chỉ có 1 cấp Tổng, không phân biệt CN nào sẽ tiêu thụ bao nhiêu

M11 bổ sung:
1. **Nhận FC 2 cấp** từ hệ thống ngoài: Tổng (per SKU × tháng) + Chi nhánh (per CN × SKU group × tháng)
2. **B2B Pipeline 6-stage** với weighted probability — Sales per CN nhập deal của CN mình
3. **Aggregate demand** = FC 2 cấp + Σ(B2B weighted) → READ-ONLY, edit ở M12 S&OP

Horizon 12 tháng (M+1 → M+12).

---

## 2. Scope

### ✅ Thêm
- `demand_snapshot` extend: thêm `level` (TOTAL/CN), `cn_id` (NULL nếu TOTAL), `horizon_months`
- 3 bảng mới: `b2b_deal`, `b2b_deal_stage_history`, `b2b_deal_split` (multi-CN)
- API import FC 2 cấp + consistency check
- B2B Pipeline CRUD (Sales scoped per CN)
- Aggregate view (read-only) per cấp
- Service `getAggregatedDemand()` export cho M12 S&OP đọc

### ❌ Không đụng
- M1 logic upload CSV cũ — endpoint `/demand/upload` giữ nguyên cho backward compat
- `demand_snapshot_line` schema cũ — chỉ thêm column nullable
- Tính FC engine — M11 nhận từ ngoài, KHÔNG build forecast
- Edit FC — M12 S&OP làm

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | FC cấp Tổng grain = `SKU base × Month` (KHÔNG per NM). Hệ thống tự biết SKU → NM qua `sku_nm_mapping` (M00) | M00 single-source |
| **R2** | FC cấp CN grain = `CN × SKU group × Month` (chưa phân variant). Variant gợi ý ở M23 DRP dựa tồn kho CN | |
| **R3** | Σ(CN) vs Tổng — consistency check. Lệch > 10% (config M12) → warning, KHÔNG reject. SC Manager reconcile ở M12. | Threshold từ M10 |
| **R4** | FC nhận nhiều lần — version mới ghi đè, audit log giữ tất cả. Trước S&OP Day 1 chưa có FC → alert Planner | Versioning |
| **R5** | B2B 6-stage: Lead/Qualified/Proposal/Committed/Confirmed/Lost. Probability từ M10 config `b2b.stage_prob` (default 10/40/65/85/100/0) | Configurable |
| **R6** | Stage Lead (10%) **KHÔNG tính** vào weighted demand (uncertainty quá cao) | Filter out |
| **R7** | Sales role scope = own CN only. Không thấy deal CN khác. SC Manager full visibility | RBAC |
| **R8** | 1 deal có thể split nhiều CN (e.g. 60% CN-BD, 40% CN-CT). Weighted demand tính proportional | Multi-CN |
| **R9** | Deal Committed → Lost sau S&OP locked → flag demand reduction, alert SC Manager nếu > 500m² | Rollback alert |
| **R10** | M11 = **read-only aggregation**. UI không có nút Edit/Adjust. Mọi điều chỉnh redirect sang M12 S&OP | Core principle |

---

## 4. B2B Weighted Demand Formula

```
Per CN × SKU base × Month:
  weighted_b2b = Σ over deals matching {cn, sku, month}:
                   deal.qty × stage_prob[deal.stage] × split_pct

Tổng demand = fc_cn(cn, sku, month) + weighted_b2b(cn, sku, month)
```

**Stage Lost (0%) hoặc Lead (filtered):** không cộng vào.

**Recalculate trigger:**
- Khi deal stage transition → recalc weighted_b2b cho cells affected
- Khi deal split thay đổi → recalc cells liên quan
- Real-time, không cache (volume Phase 1 ~500 deals OK)

---

## 5. User Stories (Acceptance)

### US-1: Nhận FC cấp Tổng
**As Planner**, hệ thống ngoài gửi `POST /demand/import/total` với 50 SKU × 12 tháng. **Then** import + log version, hiển thị tab "Tổng" với 50 SKU × 12 cột tháng. Auto-resolve NM cho mỗi SKU qua `sku_nm_mapping`.

### US-2: Nhận FC cấp CN
**As Planner**, hệ thống ngoài gửi `POST /demand/import/cn` với 5 CN × 30 SKU group × 12 tháng. **Then** import + log version. Tab "Chi nhánh" hiển thị bảng pivot CN × tháng, click drill-down SKU group.

### US-3: Consistency check
**Given** Σ(CN) = 9.800 vs Tổng = 10.600 (lệch -7.5%). **When** mở dashboard. **Then** banner warning "Σ(CN) lệch Tổng -7.5%. Reconcile tại S&OP (M12)." Không block flow.

### US-4: Sales nhập B2B deal
**As Sales CN-BD**, mở `/demand/b2b` → click "New Deal" → form: customer (autocomplete từ M00), SKU base, qty, stage (dropdown 6), expected_close_month, optional split CN. **Save** → weighted demand tăng.

### US-5: Stage transition
**As Sales**, deal "Sunrise Project" 8.000m² đổi từ Proposal (65%) → Committed (85%). **Save** → `b2b_deal_stage_history` insert row, weighted demand tăng từ 5.200 → 6.800. Aggregate view refresh.

### US-6: Multi-CN split
**As Sales**, deal "Vinhomes Q1" 10.000m² split 60% CN-BD + 40% CN-CT, stage Committed (85%). **Save** → CN-BD weighted += 5.100, CN-CT weighted += 3.400.

### US-7: Sales scope visibility
**As Sales CN-DN**, mở `/demand/b2b/list` → chỉ thấy deals của CN-DN (do split hoặc primary). KHÔNG thấy deals CN khác. **As SC Manager** → thấy tất cả.

### US-8: Confirmed → Lost rollback
**Given** deal Committed 8.000m², S&OP đã lock cycle này. **When** Sales đổi → Lost. **Then** weighted -= 6.800 (vì Committed=85%), flag alert SC Manager: "Deal Sunrise (8.000m²) Lost sau S&OP lock. Cần re-review."

### US-9: Read-only constraint
**As SC Manager**, mở `/demand/aggregate` → hover bất kỳ ô FC → tooltip "Để chỉnh sửa, vào S&OP Consensus (M12)". Không có nút Edit nào trong M11 UI.

### US-10: M12 S&OP đọc aggregated demand
**Given** M12 S&OP cycle bắt đầu Day 3. **When** M12 service init. **Then** gọi `M11Service.getAggregatedDemand(cycleMonth)` → trả Map per cấp + B2B breakdown.

---

## 6. Data Contract

### `demand_snapshot` extend (giữ M1 schema)
| Field thêm | Mô tả |
|------------|-------|
| `level` VARCHAR(10) NOT NULL DEFAULT 'TOTAL' | `TOTAL` / `CN` |
| `cn_id` BIGINT NULL FK channel | NULL khi level=TOTAL, NOT NULL khi level=CN |
| `horizon_months` INT DEFAULT 12 | Phase 1: 12 |
| `imported_from` VARCHAR(50) NULL | Tên hệ thống ngoài (audit trail) |

> Migration `ADD COLUMN ... NULL/DEFAULT` — không break existing M1 rows. Backfill `level='TOTAL'` cho rows cũ.

### `demand_snapshot_line` extend
| Field thêm | Mô tả |
|------------|-------|
| `sku_group` VARCHAR(50) NULL | Cho cấp CN — group thay vì SKU base. NULL khi level=TOTAL. |

### `b2b_deal` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `deal_code` VARCHAR(50) UNIQUE | E.g. `B2B-2026-0042` |
| `deal_name` VARCHAR(200) | "Sunrise Project Phase 2" |
| `customer_id` BIGINT FK customer (M00) | |
| `primary_cn_id` BIGINT FK channel | CN owner deal (Sales scope) |
| `sku_id` BIGINT FK sku (M00) | SKU base |
| `total_qty` DECIMAL(15,2) | m² total deal value |
| `stage` VARCHAR(20) | enum: Lead/Qualified/Proposal/Committed/Confirmed/Lost |
| `expected_close_month` DATE | YYYY-MM-01 |
| `created_by`, `created_at`, `updated_by`, `updated_at` | Audit |
| `is_active` BOOLEAN DEFAULT TRUE | Soft delete |

### `b2b_deal_stage_history` (mới — audit timeline)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `deal_id` FK | |
| `from_stage`, `to_stage` | |
| `changed_by`, `changed_at` | |
| `notes` TEXT NULL | |

### `b2b_deal_split` (mới — multi-CN)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `deal_id` FK | |
| `cn_id` FK channel | |
| `split_pct` DECIMAL(5,2) | 0-100, total = 100 per deal |

> Khi không có split row → 100% gắn `primary_cn_id`.

### API chính

```
# FC import (từ hệ thống ngoài)
POST  /api/v1/demand/import/total                  # FC cấp Tổng (CSV/JSON)
POST  /api/v1/demand/import/cn                     # FC cấp CN
GET   /api/v1/demand/import/log                    # Import history

# Aggregated view (read-only)
GET   /api/v1/demand/aggregate?level=TOTAL&month=  # Pivot SKU × tháng (group by NM auto)
GET   /api/v1/demand/aggregate?level=CN&cnId=      # Pivot CN × SKU group
GET   /api/v1/demand/aggregate/consistency-check   # Σ(CN) vs Tổng diff

# B2B Pipeline
GET   /api/v1/demand/b2b                            # List deals (Sales scope)
POST  /api/v1/demand/b2b                            # Create deal
PATCH /api/v1/demand/b2b/:id                        # Update qty/expected_close
PATCH /api/v1/demand/b2b/:id/stage                  # Stage transition (audit history)
POST  /api/v1/demand/b2b/:id/split                  # Multi-CN split
GET   /api/v1/demand/b2b/:id/history                # Stage transition timeline
GET   /api/v1/demand/b2b/weighted?month=            # Weighted demand contribution per cell

# Internal (M12 inject)
# Method: M11Service.getAggregatedDemand(cycleMonth: string): AggregatedDemandDto
```

**File mới (Rule 3 — EXTEND folder):**
```
backend/src/demand/
├── demand.service.ts                  ← M1 cũ (giữ nguyên)
├── demand.aggregate.service.ts        ← M11 logic (file mới, capability)
├── demand.b2b.service.ts              ← M11 B2B pipeline
├── demand.controller.ts               ← Cả M1 + M11 routes
└── entities/
    ├── demand-snapshot.entity.ts      ← Extend thêm columns
    ├── b2b-deal.entity.ts             ← Mới
    ├── b2b-deal-stage-history.entity.ts
    └── b2b-deal-split.entity.ts
```

---

## 7. Non-functional

- Import 50 SKU × 12 tháng (600 rows) < 5s
- Aggregated view load < 2s với 50 SKU × 12 tháng
- B2B weighted recalculate khi deal change < 1s
- Consistency check < 3s (aggregate query)

---

## 8. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `sku`, `channel`, `customer`, `sku_nm_mapping` | FK + lookup |
| **M00** `supplier` (BIGSERIAL fix Sprint 2) | Resolve NM cho FC Tổng |
| **M10** config `b2b.stage_prob` | Probability weights |
| **M10** config `consistency_threshold_pct` (mới — đề xuất thêm 0.1 vào M10 next iteration nếu chưa có) | Warning threshold |
| **M10** feature flag | `m11_demand_v2_enabled` |
| **M1** demand schema | Extend, không rebuild |

| Feeds | Why |
|-------|-----|
| **M12** S&OP Consensus | Read-only input để adjust |
| **M22** CN Demand Adjustment | (Phase 2) trust score CN tự adjust trên top FC M11 |
| **M23** DRP (qua M12 lock) | Ultimately demand input cho DRP nightly |
| **M9** Plan vs Actual | Tracking FC accuracy long-term |

---

## 9. RBAC Scope

| Role | Quyền |
|------|-------|
| **Sales (CN-X)** | View deals own CN (primary or split). Create/edit deals own CN. Không thấy CN khác. |
| **CN Manager (CN-X)** | Same as Sales own CN + xem aggregated demand CN mình |
| **SC Manager** | Full read across all CN. Không edit (M11 read-only by design) |
| **Planner** | Trigger import từ hệ thống ngoài. View all aggregated. Không edit deals. |

Phase 1: header `X-User-Role` + `X-CN-Code` (free text, dev test). Phase 2: JWT.

---

## 10. DoD

- [ ] Migration extend `demand_snapshot` (level, cn_id, horizon_months, imported_from) + 3 tables mới
- [ ] Backfill `level='TOTAL'` cho rows M1 cũ
- [ ] Endpoint import 2 cấp với validation (SKU/CN exist trong M00, no duplicates)
- [ ] Consistency check service `getConsistencyDiff()` — banner UI
- [ ] B2B CRUD endpoints với RBAC scope
- [ ] Stage transition ghi `stage_history` audit
- [ ] Multi-CN split — total split = 100% validation
- [ ] Weighted demand recalc service — query inline (no cache Phase 1)
- [ ] `getAggregatedDemand(cycleMonth)` exportable cho M12 inject
- [ ] FE: Tab Tổng + Tab CN read-only (KHÔNG có nút Edit)
- [ ] FE: B2B pipeline list + form + stage transition UI
- [ ] FE: Sales scope filter — Sales chỉ thấy own CN deals
- [ ] FE: Drilldown SKU/CN với tooltip "Edit ở S&OP M12"
- [ ] Alert integration: deal Confirmed → Lost > 500m² → M8 alert
- [ ] Feature flag wrapper — off → 503, M12 fallback đọc M1 cũ raw
- [ ] QA: 10 user stories pass

---

## 11. Out of Scope

- **Forecast engine** (statistical model build FC) — M11 chỉ nhận, không tạo
- **B2B contract management** — chỉ track deal stage, không quản lý hợp đồng
- **CRM lifecycle** customer relationship — chỉ track customer master từ M00
- **Pricing/quote** B2B deals — thuộc Sales system
- **Bulk B2B import** từ ERP — Phase 2 (Phase 1 chỉ form input)
- **Variant breakdown ở M11** — DRP M23 sẽ gợi ý variant từ tồn kho CN
- **Edit FC trong M11** — strict read-only by design (R10)

---

## 12. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| FC source format chuẩn nào (CSV/JSON/API)? | **Phase 1: chấp nhận cả CSV upload + JSON POST.** Nguồn ngoài tự chọn. Validation chung. |
| Stage Lost = 0% — deal Lost có giữ row history không? | **Giữ.** UPDATE stage='Lost', is_active=TRUE. Lý do: trace lý do Lost cho lessons learned. Filter out khỏi weighted nhưng vẫn xem được. |
| Consistency check threshold = ±10% — đúng? | Theo PRD §F1-B2 Day 5 reconcile threshold. M10 config có thể adjust sau Phase 1 review. |
| FC overwrite vs merge khi import lại? | **Overwrite** — version mới ghi đè version cũ trong cycle hiện tại. Lịch sử giữ qua import_log. |
| Multi-CN split — split_pct sum = 100% có required? | **Required.** Migration constraint hoặc service-level validation. DA2 chốt: dùng CHECK constraint trong PG hoặc trigger. |
| Sales scope filter — header hay query param? | Header `X-CN-Code` cho consistency với M22. Phase 2 JWT decode cn_code. |

---

## 13. Lưu ý cho dev

1. **`getAggregatedDemand(cycleMonth)` injectable** — M12 inject trực tiếp, KHÔNG HTTP. Trả về structured DTO: `{ total: Map<sku_id, qty[12]>, byCn: Map<{cn_id, sku_group}, qty[12]>, b2bContribution: Map<{cn_id, sku_id, month}, weighted_qty> }`.

2. **Folder Rule 3:** KHÔNG tạo `src/demand-aggregate/`. File mới đặt thẳng vào `src/demand/` với tên capability: `demand.aggregate.service.ts`, `demand.b2b.service.ts`. Controller chung `demand.controller.ts` thêm routes mới.

3. **Read-only enforce:** Backend KHÔNG có endpoint PATCH `/demand/snapshot/:id/line/:lineId`. M12 sẽ có endpoint riêng `/saop/adjust` với version mới (không sửa M11 snapshot).

4. **Weighted demand recalc strategy:** Real-time query, không cache. Volume Phase 1 ~500 deals × 12 tháng × 50 CN = manageable. Nếu Phase 2 scale lên 5000 deals → materialized view refresh on deal change.

5. **Sales scope filter:** Service method `listDeals(userRole, userCnCode)`:
   - `userRole === 'SC_MANAGER'` → no filter
   - `userRole === 'SALES'` → `WHERE primary_cn_id = X OR EXISTS split WHERE cn_id = X`
   - Forbidden bypass (Sales gửi cnCode khác own CN) → 403.

6. **B2B stage_prob từ M10 config:** Cache local trong M11 service với TTL 60s. Listen flag/config change event nếu M10 implement (Phase 2).

7. **Migration `imported_from`:** NULL acceptable cho rows cũ. Backfill rows M1 cũ với `imported_from='LEGACY_M1'`.

8. **B2B multi-CN split CHECK:** PG constraint `CHECK (split_pct > 0 AND split_pct <= 100)` per row. Total = 100 enforce ở service (TRIGGER trong PG complex, dev không khuyến nghị Phase 1).

---

*M11 Demand Aggregation v2 Spec v1.0 — 2026-04-17*
