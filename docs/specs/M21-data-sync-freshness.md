# M21 — Data Sync & Freshness Gate

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 3-4
> **Owner:** BE1 · **DA:** DA1 · **FE:** FE1
> **Status:** 🟡 EXTEND M2 — giữ schema supply cũ, thêm freshness gate
> **PRD:** §F2-B1 Data Sync · **Flow:** 2 (Daily DRP, 18:00 cutoff)
> **Feature flag:** `m21_data_sync_v2_enabled`

---

## 1. Tại sao làm bài này

M2 Supply hiện tại chỉ có upload CSV ad-hoc, **không biết data stale bao lâu**. Rủi ro: DRP 23:00 chạy trên tồn kho NM cũ 3 ngày → đề xuất PO sai, thiếu hàng hoặc over-order.

M21 thêm 3 thứ:
1. **Gate 24h:** DRP không chạy nếu bất kỳ NM nào có data stale > 24h
2. **Template per-NM:** NM download template đã pre-fill SKU của họ, điền tồn → upload lại
3. **Sync log + schedule:** cron 2×/ngày + manual trigger + history

---

## 2. Scope

### ✅ Thêm
- `supply_snapshot` thêm: `nm_id`, `synced_at`, `source` (`NM_UPLOAD`/`MANUAL`/`ESTIMATED`)
- Bảng mới `sync_log` (mỗi lần sync 1 row)
- Freshness gate service: check trước khi DRP run
- Endpoint NM template generator (reuse từ M00)
- Cron 06:00 + 14:00 auto sync-all
- FE: Dashboard bảng NM × last_sync × status (Fresh/Stale/Missing)

### ❌ Không đụng
- Logic capture snapshot từ M2 (giữ nguyên, chỉ thêm metadata)
- `supply_snapshot_line` schema (đã có `is_estimated` từ BUG-01 fix)
- API upload hiện tại — thêm endpoint mới cạnh nó, không break client cũ

---

## 3. Business Rules

| Rule | Diễn giải |
|------|-----------|
| **R1** | Data "Fresh" = `synced_at` trong 24h gần đây. Config `planning.max_stale_minutes` (M10) default 240 = 4h, nhưng Phase 1 dùng 1440 = 24h (Bravo batch mode). |
| **R2** | Nếu bất kỳ NM active nào có `last_synced_at > threshold` → DRP gate **block**, alert SC Manager. |
| **R3** | SC Manager có thể force override gate (`planning.force_override_allowed = true`) — bắt buộc reason + audit log. |
| **R4** | NM upload template bắt buộc match format (SKU list của NM đó) — sai header → reject, hướng dẫn tải template lại. |
| **R5** | Sync 2×/ngày: **06:00 + 14:00 giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7)** — trước cutoff 18:00 VN để CN có data fresh khi adjust demand. Tất cả cron schedules + CN cutoff + DRP 23:00 đồng bộ timezone VN. |
| **R6** | Manual sync trigger không có cooldown — SC Manager có thể click liên tục nếu cần. |

---

## 4. User Stories (Acceptance)

### US-1: NM upload thành công → DRP chạy được
**As DevOps**, 23:00 DRP run trigger. **Given** tất cả NM active có `synced_at` trong 24h qua. **Then** freshness gate pass, DRP netting chạy tiếp.

### US-2: 1 NM stale → DRP bị block
**Given** NM Mikado last_sync cách đây 30h. **When** DRP 23:00 chạy. **Then** gate block với message "NM Mikado stale 30h > 24h. Sync gấp hoặc SC Manager force override." DRP không netting. Alert gửi SC Manager.

### US-3: SC Manager force override
**Given** US-2 state. **When** SC Manager click "Force run with stale data" + nhập reason "NM đang bảo trì, dùng data cũ acceptable". **Then** DRP chạy, audit log ghi override + reason + user, KPI dashboard mark run này "STALE_OVERRIDE".

### US-4: NM tải template
**As NM user** (Mikado), tôi vào link download → CSV tải về với 50 SKU của Mikado, cột: `sku_code, sku_name, uom, available_qty, atp_qty, last_updated` (cột sau trống để điền). Tôi điền xong → upload lại → hệ thống nhận đúng 50 rows.

### US-5: NM upload sai format
**Given** NM upload CSV có header sai (thiếu cột `atp_qty`). **Then** 400 với message "Header không hợp lệ. Tải template mới tại [link]". Không import partial.

### US-6: Sync dashboard
**As SC Manager**, mở `/supply-intake` → thấy bảng 10 NM × (tên, last_sync, age hours, status badge). Row Mikado = STALE (đỏ). Tôi click "Trigger sync" → 5s sau refresh thấy Fresh (xanh).

### US-7: Cron auto-sync
**Given** 06:00 hàng ngày. **When** cron fire. **Then** gọi sync-all cho tất cả NM active, ghi mỗi NM 1 row vào `sync_log` (success/failure), refresh `synced_at`.

---

## 5. Freshness Gate — Where to call

| Điểm gọi | Ai call | Fail behavior |
|----------|---------|---------------|
| Trước M23 DRP Netting run | DRP service | Block run, alert, ghi plan_run status=BLOCKED_STALE |
| Trước M26 NM ATP Check | ATP service | Block check (không thể check ATP trên tồn cũ) |
| Trong `/supply-intake` dashboard | FE real-time | Hiển thị badge STALE, không block view |

**Override endpoint:** `POST /api/v1/supply/sync/override` body `{ reason, approvedBy }` — chỉ SC Manager role.

---

## 6. Data Contract

### `supply_snapshot` extend
- `nm_id BIGINT NULL FK supplier(id)` — **NULLABLE** để migration không fail trên rows cũ. Rows mới từ M21 NM upload bắt buộc NON-NULL (service-layer validate).
- `synced_at TIMESTAMP NULL` — migration strategy xem §6b bên dưới.
- `source VARCHAR(20)` enum: `NM_UPLOAD` / `MANUAL` / `ESTIMATED` / `FALLBACK` / `LEGACY` (cho rows trước M21).
- `is_legacy_data BOOLEAN DEFAULT FALSE` — flag rows từ M2 để gate skip check.
- Không xóa column cũ.

### §6b. Migration strategy cho data cũ (fix Critical #7)

Transition period khi deploy M21 lần đầu:

1. **Migration step 1:** `ALTER TABLE supply_snapshot ADD COLUMN nm_id BIGINT NULL, synced_at TIMESTAMP NULL, source VARCHAR(20) DEFAULT 'LEGACY', is_legacy_data BOOLEAN DEFAULT FALSE;`
2. **Migration step 2 (one-time backfill):**
   - `UPDATE supply_snapshot SET is_legacy_data = TRUE, synced_at = NOW() WHERE synced_at IS NULL;`
   - **KHÔNG** set `synced_at = captured_at` (sẽ STALE ngay lập tức, block DRP toàn bộ).
3. **Freshness gate logic:**
   - `is_legacy_data = TRUE` → skip stale check, cho phép DRP chạy (grace period cho NM migrate).
   - Sau 3 ngày M21 production, DevOps1 chạy script: `UPDATE supply_snapshot SET is_legacy_data = FALSE WHERE is_legacy_data = TRUE;` → gate bắt đầu enforce toàn bộ.
4. Alert SC Manager trong grace period: "X NM chưa upload qua M21, đang grace period đến [date]."

### `sync_log` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `nm_id` | NM nào |
| `trigger_source` | ENUM: `CRON_06` / `CRON_14` / `MANUAL` (fix Medium #9: tách khỏi user để join audit dễ) |
| `triggered_by_user` | VARCHAR NULL — userId khi `trigger_source = MANUAL`, NULL khi CRON |
| `status` | `SUCCESS` / `FAILED` / `PARTIAL` |
| `rows_imported` | |
| `error_msg` | text nếu FAILED |
| `started_at`, `completed_at` | |

### API chính

**Fix Critical #8 — API route collision:** BE1 verify route M2 cũ trong Sprint 3 Day 1. Nếu M2 đã có `POST /api/v1/supply/upload` → M21 dùng namespace `/nm-upload/` để tránh conflict:

```
POST  /api/v1/supply/nm-upload/:nmId               # NM upload per template (M21 — khác M2)
GET   /api/v1/supply/sync/dashboard                # list NM × freshness status
POST  /api/v1/supply/sync/trigger/:nmId            # manual 1 NM
POST  /api/v1/supply/sync/trigger-all              # manual all
GET   /api/v1/supply/sync/history                  # sync_log paginated
POST  /api/v1/supply/sync/override                 # force DRP run
GET   /api/v1/supply/freshness/check               # gate check (internal)
```

> BE1 task Day 1 Sprint 3: grep existing supply controllers, document route M2 cũ, finalize prefix M21 trước khi code.

---

## 7. Non-functional

- Freshness check < 200ms (cached, query aggregate theo nm_id)
- NM template download < 3s cho NM có 200 SKU
- Dashboard load 50 NM < 1s
- Cron sync tolerant failure — 1 NM fail không block NM khác

---

## 8. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `supplier` table | Biết NM nào active, lead_time |
| **M00** NM upload template generator | Reuse endpoint `/master-data/supplier/:id/upload-template` |
| **M10** config `planning.max_stale_minutes`, `planning.force_override_allowed` | Tuning gate threshold |
| **M10** Feature flag `m21_data_sync_v2_enabled` | Rollback path |

| Feeds | Why |
|-------|-----|
| **M23** DRP | Gate block trước khi netting |
| **M26** ATP Check | Gate block trước ATP |
| **M28** Feedback | Weekly NM honoring rate tracked từ sync pattern |

---

## 9. DoD

- [ ] Migration extend `supply_snapshot` + tạo `sync_log` + `.down.sql`
- [ ] Endpoint NM upload per template — validate header match
- [ ] Endpoint manual sync + cron setup 06:00/14:00
- [ ] Freshness gate service export cho M23, M26 inject
- [ ] Override endpoint với mandatory reason + audit
- [ ] FE Sync Dashboard đầy đủ 10 NM (hoặc số NM thực tế)
- [ ] Alert integration: NM stale → gửi alert vào M8
- [ ] Backfill `synced_at` cho data cũ = `captured_at`
- [ ] Feature flag wrapper hoạt động — off → fallback M2 logic cũ
- [ ] QA: 7 user stories pass

---

## 10. Out of Scope

- NM Portal riêng (nghiệp vụ B2B2) — Phase 2
- Auto-retry sync khi fail — Phase 2 (Phase 1 chỉ log + alert)
- SFTP push tự động lên Bravo — Phase 2 (đã có toggle `feature.bravo_sftp_push.enabled=false` trong M10)
- Differential sync (chỉ sync SKU thay đổi) — Phase 2
- NM upload qua email/Zalo — Phase 2

---

## 11. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| Threshold 24h có quá lỏng? | Giữ 24h Phase 1 vì Bravo batch mode. Phase 2 giảm xuống 4h khi có real-time WMS. |
| Force override có thể bị abuse? | Bắt buộc `reason` text min 20 chars + audit trail + KPI dashboard hiển thị "X% runs dùng override" — team lead review weekly. |
| NM upload qua SFTP hay web? | Phase 1: web upload only. Phase 2: SFTP khi có toggle. |
| Ai gửi alert NM stale? | Phase 1: M8 alert service (in-app). Phase 2: email/Zalo khi toggle bật. |

---

## 12. Lưu ý cho dev

1. **Reuse M00 template generator** — đừng implement lại. `import { SupplierService } from 'master-data/services/supplier.service'` → gọi method `generateUploadTemplate(nmId)`.
2. **Freshness gate là service injectable** — không phải HTTP. M23/M26 inject trực tiếp.
3. **`synced_at` vs `captured_at`:** `captured_at` = lúc build snapshot (có thể từ data cũ). `synced_at` = lúc NM gửi data thật cuối cùng. DRP gate check `synced_at`.
4. **Cron lib:** dùng `@nestjs/schedule` (đã có trong dependencies nếu M8 dùng). **Timezone:** set explicit `timeZone: 'Asia/Ho_Chi_Minh'` trong decorator `@Cron('0 6 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })`. Server OS timezone không quan trọng. DevOps2 verify infra cron trước Sprint 3.
5. **Override audit:** ghi vào audit log chung hoặc bảng riêng `drp_override_log`? DA1 chốt trong Sprint 3 Day 1 — khuyến nghị bảng riêng để query audit dễ hơn.

---

*M21 Data Sync & Freshness Gate Spec v1.1 — 2026-04-17 (post-review fix: nm_id nullable, backfill strategy, route collision, timezone VN, sync_log schema)*
