# M22 — CN Demand Adjustment & Trust Score

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 3-4
> **Owner:** BE1 · **DA:** DA2 · **FE:** FE1
> **Status:** 🔴 NEW — hoàn toàn mới
> **PRD:** §F2-B2 CN Demand Adjustment · **Flow:** 2 (Daily DRP, cutoff 18:00)
> **Feature flag:** `m22_cn_demand_adjust_enabled`

---

## 1. Tại sao làm bài này

Hôm nay forecast cấp Tổng (FC) chia đều cho CN bằng phương pháp cứng (`/4` hoặc theo lịch sử). CN gần khách hàng hơn → biết deal nào mới, dự án nào delay, đối thủ nào tung khuyến mãi — nhưng **không có cách nào điều chỉnh demand cho CN của mình** trước khi DRP 23:00 chạy.

Hậu quả: DRP đề xuất sai → CN-BD over-stock 30%, CN-ĐN stockout liên tục mỗi tháng.

M22 cho phép:
1. **CN Manager submit adjustment** ±30% so với FC chia đều, kèm reason
2. **Trust Score** đo độ chính xác adjust 12 tuần qua → CN chính xác cao được auto-approve
3. **Cutoff cứng 18:00** — sau giờ này lock, DRP 23:00 dùng demand đã adjust

---

## 2. Scope

### ✅ Thêm
- 3 bảng mới: `cn_demand_adjustment`, `trust_score`, `reason_code`
- CN Portal `/cn-adjust` — submit + history + status
- SC Manager review queue — adjustment vượt tolerance hoặc trust thấp
- Trust Score auto-compute weekly (cron Monday 06:00)
- Feed adjusted demand sang M23 DRP

### ❌ Không đụng
- M1/M11 forecast snapshot — M22 đọc FC, không sửa
- Logic chia FC từ Tổng → CN — Phase 1 dùng phương pháp hiện tại
- M28 actual_sales table — Phase 1 chưa có, trust score grace period (xem §6)

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | CN chỉ adjust được demand của CN mình (RBAC scoped) | Mai Phase 1 dùng `X-CN-Code` header, Phase 2 JWT |
| **R2** | `|adjusted_qty - fc_qty| / fc_qty <= cn_adjust.tolerance_pct` (default 30%) → tự động status `AUTO_APPROVED` nếu trust ≥ 85%, ngược lại `PENDING` | Threshold từ M10 config |
| **R3** | Vượt tolerance → bắt buộc reason + auto đẩy queue SC Manager review | Reason codes từ M10 `cn_adjust.reason_codes` JSON |
| **R4** | **Cutoff cứng 18:00 VN** — sau giờ này submit/edit bị reject | Config `cn_adjust.cutoff_time` |
| **R5** | Force override sau cutoff: chỉ SC Manager, mandatory reason text + audit | Bypass cứng cho emergency |
| **R6** | Adjustment per (cn_id × sku_id × period_date) — chỉ giữ 1 row latest active | Submit lại = update + audit ghi version cũ |
| **R7** | Trust Score Phase 1 default = 100% (grace) cho đến khi có 12w actual_sales từ M28 | Phase 2 unblock khi M28 ready |
| **R8** | Trust < 60% → tolerance giảm còn 15% (siết chặt CN không đáng tin) | Threshold từ M10 |

---

## 4. Trust Score — Cách tính

**Định nghĩa:** Tỷ lệ adjustment "chính xác" trong rolling 12 tuần qua, per CN.

```
adjustment_chinh_xac  = |adjusted_qty - actual_qty| / actual_qty <= 20%
trust_score_per_cn   = COUNT(chinh_xac) / COUNT(all_adjustments_12w) × 100
```

**Phase 1 (chưa có actual_sales):**
- Default `trust_score = 100%` cho mọi CN — grace period
- Cron weekly chạy nhưng không update gì (NULL data → keep 100%)
- KPI dashboard hiển thị badge "Pending Phase 2 actual_sales"

**Phase 2 (sau khi M28 có actual_sales):**
- Cron Monday 06:00 VN tính lại trust cho từng CN
- Update `trust_score.score` + `last_calculated_at`

**Threshold actions:**

| Trust % | Hành động |
|---------|-----------|
| ≥ 85% | Auto-approve mọi adjustment trong tolerance |
| 60-84% | Cần SC Manager review nếu vượt tolerance |
| < 60% | Tolerance giảm còn 15% (R8); mọi adjust phải SC Manager review |

---

## 5. User Stories (Acceptance)

### US-1: CN submit adjustment trong tolerance + trust cao → auto-approve
**Given** CN-BD trust=92%, FC tuần W18 SKU-A001 = 1000m². **When** CN Manager submit `adjusted=1200` (delta +20%, reason "dự án Sunrise đặt thêm"). **Then** status `AUTO_APPROVED` ngay, ghi audit, M23 DRP 23:00 dùng 1200m².

### US-2: Vượt tolerance → SC Manager queue
**Given** CN-ĐN trust=70%. **When** submit delta +45% (vượt 30%). **Then** status `PENDING`, vào queue SC Manager. SC Manager mở dashboard → thấy adjustment + reason → approve/reject với note. CN Manager nhận notification.

### US-3: Cutoff 18:00 hard reject
**Given** 18:30 VN. **When** CN Manager submit. **Then** 400 "Đã quá cutoff 18:00. Liên hệ SC Manager force override nếu khẩn cấp."

### US-4: SC Manager force override sau cutoff
**Given** US-3 state. **When** SC Manager mở queue, click "Force submit for CN-ĐN" + nhập reason min 20 chars. **Then** adjustment được tạo với status `FORCE_APPROVED`, audit log ghi `force_by + reason + cutoff_breach`.

### US-5: CN xem history adjustment
**As CN Manager**, mở `/cn-adjust/history` → table 12 tuần qua: period, sku, fc_qty, adjusted_qty, delta%, status, actual_qty (Phase 2), accuracy badge.

### US-6: Trust score dashboard (SC Manager)
**As SC Manager**, mở `/cn-adjust/trust-overview` → bảng 10 CN × trust score × badge color (green ≥85, yellow 60-84, red <60). Phase 1: tất cả 100% với note "Grace period — chưa có actual_sales".

### US-7: M23 DRP đọc adjusted demand
**Given** DRP 23:00 trigger, hôm nay có 5 adjustments approved cho 3 CN. **When** M23 build demand input. **Then** lấy `adjusted_qty` thay vì `fc_qty` cho 5 records đó. Còn lại dùng FC raw.

---

## 6. Data Contract

### `cn_demand_adjustment` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `cn_id` BIGINT FK channel | RBAC scope check |
| `sku_id` BIGINT FK sku | |
| `period_date` DATE | Tuần adjustment áp dụng (e.g. 2026-04-20 = W17 Mon) |
| `fc_qty` DECIMAL(15,2) | FC gốc tại lúc submit (snapshot, không thay đổi) |
| `adjusted_qty` DECIMAL(15,2) | CN nhập |
| `delta_pct` DECIMAL(7,4) | Tính sẵn để query nhanh |
| `reason_code` VARCHAR(50) | FK `reason_code.code` |
| `reason_text` TEXT | Service-layer validation: (a) mandatory non-empty nếu `delta_pct > tolerance_pct`; (b) mandatory `LENGTH >= 20` khi tạo qua endpoint `/cn-adjust/force`. DB column NULL — enforce ở service. |
| `status` ENUM | `PENDING / AUTO_APPROVED / APPROVED / REJECTED / FORCE_APPROVED / EXPIRED` |
| `submitted_by` VARCHAR(100) | userId |
| `submitted_at` TIMESTAMP | |
| `reviewed_by`, `reviewed_at` | NULL nếu chưa review |
| `actual_qty` DECIMAL(15,2) NULL | Phase 2 — backfill từ M28 weekly |
| `is_accurate` BOOLEAN NULL | Phase 2 — `|adj - actual|/actual <= 20%` |
| `created_at` | |
| Composite UNIQUE | `(cn_id, sku_id, period_date) WHERE status IN ('PENDING','AUTO_APPROVED','APPROVED','FORCE_APPROVED')` — **C1 fix:** chỉ block duplicate ở trạng thái ACTIVE thực sự. EXPIRED/REJECTED không block re-submit. |

> **Re-submit transaction order (R6 detail):** Trong service `submitAdjustment()`:
> 1. `BEGIN TRANSACTION`
> 2. `UPDATE cn_demand_adjustment SET status='EXPIRED' WHERE cn_id=X AND sku_id=Y AND period_date=Z AND status IN ('PENDING','AUTO_APPROVED','APPROVED','FORCE_APPROVED')` — old → EXPIRED **trước**
> 3. `INSERT new row`
> 4. `COMMIT`
>
> Thứ tự UPDATE-trước-INSERT bắt buộc để tránh unique violation. DA2 ghi rõ comment trong migration SQL.

### `trust_score` (mới)
| Field | Mô tả |
|-------|-------|
| `cn_id` BIGINT PK FK channel | 1 row per CN |
| `score` DECIMAL(5,2) NOT NULL DEFAULT 100 | % accuracy 12w |
| `total_adjustments_12w` INT DEFAULT 0 | Counter |
| `accurate_adjustments_12w` INT DEFAULT 0 | Counter |
| `last_calculated_at` TIMESTAMP NULL | Cron timestamp |
| `is_grace_period` BOOLEAN DEFAULT TRUE | Phase 1 = TRUE → display badge |

### `reason_code` (mới — lookup)
| Field | Mô tả |
|-------|-------|
| `code` VARCHAR(50) PK | `NEW_PROJECT`, `PROJECT_DELAY`, `COMPETITOR_PROMO`, `WEATHER`, `OWN_PROMO`, `OTHER` |
| `label_vi` VARCHAR(200) | "Dự án mới", "Dự án delay"... |
| `is_active` BOOLEAN DEFAULT TRUE | |

> **M2 fix — Single source of truth chốt:** `reason_code` table là **source of truth duy nhất** cho M22.
> M10 config `cn_adjust.reason_codes` **chỉ dùng để seed initial 1 lần** khi M22 deploy lần đầu (idempotent INSERT, không sync về sau).
> Sau đó CRUD reason codes làm trên `reason_code` table qua endpoint M22 (Phase 2 — Phase 1 read-only).
> M10 config `cn_adjust.reason_codes` sẽ được **deprecated** sau Sprint 3 — note tech debt cleanup Sprint 4.

### §6b — Period matching rule (C2 fix)

`cn_demand_adjustment.period_date` luôn = **Monday của tuần áp dụng** (e.g. W17 → 2026-04-20). Service đảm bảo khi CN submit:
- Frontend gửi `period_date` bất kỳ trong tuần → service compute `period_date = mondayOf(input)` trước khi insert.
- DB chỉ chứa Monday dates.

**M23 DRP gọi `getEffectiveDemand(weekStart)`:**
- M23 truyền `weekStart = mondayOf(drp_run_date)`.
- Service: `WHERE period_date = $weekStart AND status IN ('AUTO_APPROVED','APPROVED','FORCE_APPROVED')`.
- Match exact, không phải range query → đơn giản, performant.

**Helper:** `mondayOf(date: Date): string` shared utility — exported từ `common/date-utils.ts`.

### API chính

```
POST  /api/v1/cn-adjust                          # Submit adjustment (CN role)
GET   /api/v1/cn-adjust/my                       # CN xem adjustment của mình (filter by cn_id từ header)
GET   /api/v1/cn-adjust/queue                    # SC Manager review queue (PENDING)
PATCH /api/v1/cn-adjust/:id/approve              # SC Manager approve
PATCH /api/v1/cn-adjust/:id/reject               # SC Manager reject + reason
POST  /api/v1/cn-adjust/force                    # SC Manager force submit sau cutoff
GET   /api/v1/cn-adjust/history?cnId=&period=    # History table
GET   /api/v1/cn-adjust/trust                    # Trust score per CN
GET   /api/v1/cn-adjust/effective-demand?weekStart=YYYY-MM-DD   # M23 DRP gọi (internal) — xem §6b period matching
GET   /api/v1/cn-adjust/reason-codes             # Lookup cho FE dropdown
```

---

## 7. Cutoff Logic

```
1. CN submit:
   - Check current time VN. If > cutoff (default 18:00) → 400 reject.
2. After cutoff 18:00:
   - Cron job `lockAdjustments()` mark tất cả PENDING → EXPIRED (đã quá deadline review).
   - Force override endpoint vẫn open cho SC Manager.
3. DRP 23:00 (M23):
   - Đọc adjustments status IN ('AUTO_APPROVED', 'APPROVED', 'FORCE_APPROVED') cho period_date hiện tại.
   - Adjustment EXPIRED không tính → fallback FC raw.
```

**Cutoff cron:** `@Cron('5 18 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })` — chạy 18:05 VN.

---

## 8. Trust Score Cron

```
Schedule: @Cron('0 6 * * 1', { timeZone: 'Asia/Ho_Chi_Minh' })  # Monday 06:00 VN

For each CN:
  IF NOT EXISTS actual_sales rows trong 12w → keep score=100, is_grace_period=TRUE
  ELSE:
    rows = SELECT FROM cn_demand_adjustment
           WHERE cn_id=X AND submitted_at >= NOW() - 12w
             AND actual_qty IS NOT NULL
             AND status IN ('AUTO_APPROVED','APPROVED','FORCE_APPROVED')   -- M1 fix: exclude REJECTED/EXPIRED
    accurate = COUNT(rows WHERE is_accurate=TRUE)
    score = accurate / TOTAL × 100
    UPDATE trust_score SET score, last_calculated_at=NOW(), is_grace_period=FALSE
```

**Backfill `actual_qty` + `is_accurate`:** Phase 2 — M28 cron weekly đọc actual_sales từ ERP, UPDATE rows tương ứng. Phase 1 không có gì.

---

## 9. Non-functional

- Submit adjustment < 500ms (validate + insert + audit)
- Effective demand query (M23 gọi) < 1s cho 10K SKU × 50 CN
- Trust score cron < 30s cho 50 CN
- Cutoff cron < 5s lock all PENDING

---

## 10. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `channel` table | RBAC scope, cn_id FK |
| **M00** `sku` table | sku_id FK |
| **M10** configs `cn_adjust.*`, `trust.*`, `reason_codes` | Tuning + reason lookup |
| **M10** `feature_flag` | `m22_cn_demand_adjust_enabled` |
| **M1/M11** demand snapshot | Đọc `fc_qty` raw để compare |
| **M28** (Phase 2) actual_sales | Trust score input |

| Feeds | Why |
|-------|-----|
| **M23** DRP | `getEffectiveDemand(date)` → adjusted thay vì FC raw |
| **M28** | Backfill actual_qty + recompute trust |

---

## 11. DoD

- [ ] 3 tables migration + .down.sql
- [ ] Seed 6 reason codes default
- [ ] CN submit endpoint với cutoff check + tolerance + auto-approve logic
- [ ] SC Manager review queue + approve/reject endpoints
- [ ] Force override endpoint với mandatory reason min 20 chars
- [ ] Trust score cron Monday 06:00 VN (Phase 1: noop nếu không có actual_sales)
- [ ] Cutoff cron 18:05 VN expire PENDING
- [ ] `getEffectiveDemand(date)` service export cho M23 inject
- [ ] FE: CN portal submit + history + trust badge
- [ ] FE: SC Manager queue + approve flow + trust dashboard
- [ ] Audit log mọi action (submit, approve, reject, force, expire)
- [ ] QA: 7 user stories pass
- [ ] Feature flag wrapper hoạt động — off → 503
- [ ] **M3 fix — Cross-spec contract:** M23 spec PHẢI handle case `getEffectiveDemand()` throw/unavailable → fallback FC raw. Note này gate vào M23 DoD, không phải M22.
- [ ] **C3 fix — FE EXPIRED tooltip:** History page hiển thị status `EXPIRED` với tooltip "Đã quá cutoff 18:00, SC Manager chưa kịp review. Liên hệ SC Manager nếu cần force override."
- [ ] **M4 fix — QA case:** Submit delta vượt tolerance không có `reason_text` → 400 với message rõ "Reason text bắt buộc khi vượt tolerance ±30%". Service-layer validation, không phải DB constraint.
- [ ] **M5 fix — Force reason:** `reason_text` lưu force reason, validate `LENGTH(reason_text) >= 20` chars trong service khi action = force. Audit log ghi `action='FORCE'` để query filter dễ.

---

## 12. Out of Scope

- Bulk adjustment qua CSV upload — Phase 2 (Phase 1 chỉ submit per cell)
- Adjustment cho variant — Phase 2 (Phase 1 grain SKU base × CN × week)
- Notification email/Zalo khi review queue — Phase 2 (Phase 1: in-app alert qua M8)
- Trust score per (CN × SKU group) — Phase 2 (Phase 1: per CN tổng)
- Adjustment forecast horizon > 1 tuần — Phase 2

---

## 13. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| Trust default 100% Phase 1 có rủi ro? | Có. CN có thể abuse 12 tuần đầu mà không bị siết. **Mitigation:** SC Manager dashboard hiển thị "% adjustments / week per CN" — bất thường flag thủ công. Phase 2 trust tự siết. |
| Cutoff 18:00 VN cứng quá? | Giữ Phase 1 vì DRP 23:00 cần lock data 5 tiếng để chạy. Force override luôn có cho emergency. |
| Adjustment giữ history hay overwrite? | History — submit lại = mark old EXPIRED, insert new. UI show timeline. |
| Vùng grace period → hiển thị thế nào? | Badge xám "Trust 100% (grace)" + tooltip "Chưa có actual_sales để tính". Không hiển thị 100% xanh để tránh hiểu nhầm. |
| Composite unique partial — cú pháp PG? | **C1 fix:** `CREATE UNIQUE INDEX uq_active_adj ON cn_demand_adjustment(cn_id, sku_id, period_date) WHERE status IN ('PENDING','AUTO_APPROVED','APPROVED','FORCE_APPROVED');` — chỉ block duplicate ở active states để re-submit không conflict. DA2 verify Sprint 3 Day 1. |
| Period grain match M22↔M23 | **C2 fix:** `period_date` luôn = Monday. M23 truyền `weekStart = mondayOf(drp_date)`, match exact. Helper `mondayOf()` ở `common/date-utils.ts`. |
| Reason codes — 1 hay 2 nguồn? | **M2 fix:** `reason_code` table là source of truth duy nhất. M10 config `cn_adjust.reason_codes` deprecated sau Sprint 3 (tech debt cleanup ticket). |
| EXPIRED không có notification | **C3 fix:** FE history page tooltip giải thích status EXPIRED. Phase 2 có in-app alert qua M8. |
| Force reason validation | **M5 fix:** `reason_text` shared field. Khi gọi `/cn-adjust/force` → service-layer enforce `LENGTH >= 20`. Audit log `action='FORCE'` để filter. |

---

## 14. Lưu ý cho dev

1. **`getEffectiveDemand(weekStart)` là service injectable** — M23 inject `M22Service.getEffectiveDemand(weekStart)`. KHÔNG HTTP call. Method nhận **Monday Date** (xem §6b), trả `Map<"cnId|skuId", adjusted_qty>`; M23 lookup, fallback FC nếu không có entry hoặc service throw (when M22 flag off).
2. **Cutoff cron + trust cron** dùng `@nestjs/schedule` với explicit `timeZone: 'Asia/Ho_Chi_Minh'`.
3. **Audit log** — reuse `master_data_audit_log` (M00) hoặc tạo bảng riêng `cn_adjust_audit_log`? **DA2 chốt Sprint 3 Day 1** — khuyến nghị bảng riêng vì volume cao (dự kiến 500-1000 audit/tuần).
4. **Reason codes seed** từ M10 config: `SELECT config_value FROM system_config WHERE key = 'cn_adjust.reason_codes'` → parse JSON → INSERT vào `reason_code` table. Idempotent.
5. **Trust score grace period flag** — khi M28 ready Phase 2, có 1 lần migration đặt `is_grace_period = FALSE` cho tất cả CN. Cron weekly từ đó tính bình thường.
6. **Composite UNIQUE partial** — TypeORM không support full → declare trong migration SQL trực tiếp, entity chỉ note `@Index()` cơ bản.

---

*M22 CN Demand Adjustment Spec v1.1 — 2026-04-17 (post-review fix: 3 critical + 5 medium issues)*
