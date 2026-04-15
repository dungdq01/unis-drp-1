# UNIS SCP v2.0 — Module Reference: Fate of M1-M10

> **Ngày tạo:** 2026-04-15
> **Mục đích:** Tra cứu nhanh — module cũ nào giữ, module nào thay UI, module nào deprecate
> **Liên kết:** [GROUP-MODULE.md](./GROUP-MODULE.md) · [IMPLEMENT-CHECKLIST.md](./IMPLEMENT-CHECKLIST.md)

---

## Tổng quan 3 loại xử lý

| Loại | Backend | Frontend (UI) | Số module |
|------|---------|---------------|-----------|
| **Loại 1** — Giữ nguyên | ✅ Chạy | ✅ Hiển thị | 3 (M8, M9, M10) |
| **Loại 2** — UI thay, BE giữ | ✅ Chạy (extend) | 🔄 Thay bằng UI v2 | 6 (M1-M6) |
| **Loại 3** — Deprecate hoàn toàn | ❌ Tắt sau 1 tháng | ❌ Ẩn khi v2 stable | 1 (M7) |

---

## Loại 1 — Core engine, vẫn chạy, vẫn hiển thị UI ✅

> **Không đụng vào, không ẩn đi.** Đây là module nền tảng đã GoLive, ops team đang dùng hàng ngày.

| Module | Tên | Lý do vẫn giữ UI |
|--------|-----|------------------|
| **M8** | Monitor & Learn | Dashboard KPI, alert — ops team xem hàng ngày |
| **M9** | Plan vs Actual | Report so sánh — vẫn cần cho review monthly |
| **M10** | Config & Policy Platform | Admin config platform — M11-M28 đều đọc config từ đây |

**Thay đổi duy nhất:**
- **M10:** thêm ~30 configs mới (LCNB, trust score, tolerance, cutoff) — **UI screen cũ giữ nguyên**, chỉ thêm tab/section mới cho nhóm configs mới
- **M8, M9:** giữ 100% nguyên. Phase 3 có thể minor extend (FC MAPE vào M9)

**Khi nào ẩn UI?** Không bao giờ, trừ Phase 3 quyết định merge M8 + M28 (sau ≥ 1 tháng stable).

---

## Loại 2 — Core engine vẫn chạy ngầm, UI thay bằng version mới 🔄

> **Backend giữ nguyên chạy, Frontend thay bằng UI mới của Mxx.**
> Schema DB không xóa — module v2 **extend** trên cùng nền tảng.

| Module cũ | Thay bằng | Backend cũ có bị xóa? | Schema cũ |
|-----------|-----------|----------------------|-----------|
| **M1** Demand | M11 UI mới | ❌ Không xóa — M11 extend trên đó | `demand_snapshot` giữ, thêm column `level`, `cn_id`, bảng mới `b2b_deal` |
| **M2** Supply | M21 UI mới | ❌ Không xóa — M21 extend trên đó | `supply_snapshot` giữ, thêm `synced_at`, `source`, bảng `sync_log` |
| **M3** Policy/SS | M23 UI mới | ❌ Không xóa — M23 dùng lại SS logic | Policy tables giữ, thêm bảng `ss_cn`, `policy_run` snapshot |
| **M4** DRP | M23 UI mới | ❌ Không xóa — M23 extend engine | `drp_run` giữ, thêm `policy_run_id`, bảng `drp_cn_line` |
| **M5** Allocation | M24 UI mới | ❌ Không xóa — M24 extend engine | `allocation_result` giữ, thêm bảng con `allocation_leg` |
| **M6** Transport | M25 UI mới | ❌ Không xóa — M25 extend trên đó | `transport_plan`, `transport_trip` giữ, thêm `fill_ratio`, `hold_decision`, `transit_lt_days` |

### UI Transition Strategy

| Giai đoạn | UI cũ (M1-M6) | UI mới (M11-M25) | Ghi chú |
|-----------|---------------|------------------|---------|
| **Phase 1** (đang GoLive) | ✅ Hiển thị | — | Current state |
| **Phase 2** (v2 dev) | ✅ Hiển thị | 🟡 Hiển thị (beta tag) | User chọn UI nào muốn dùng |
| **Phase 3** (v2 stable) | ⚠️ Deprecated badge | ✅ Hiển thị (default) | Ops dần chuyển sang v2 |
| **Phase 4** (≥ 1 tháng stable) | ❌ Ẩn khỏi menu | ✅ Hiển thị | Backend cũ vẫn chạy, chỉ ẩn UI |

**Quan trọng:**
- **Không xóa code M1-M6** — extend chứ không rebuild
- **Không xóa bảng DB cũ** — thêm column/bảng mới vào cùng schema
- **API `/v1/` giữ nguyên** — thêm `/v2/` cho endpoints mới. Cả 2 cùng tồn tại

---

## Loại 3 — Deprecate hoàn toàn (Backend + UI) ❌

> **Chỉ có M7.** Domain model sai căn bản, phải REBUILD từ đầu.

| Module cũ | Thay bằng | Backend cũ có bị xóa? | Timeline |
|-----------|-----------|----------------------|----------|
| **M7** Execution / Order Bridge | **M27** PO Review (REBUILD) | ✅ **Có** — deprecate sau ≥ 1 tháng M27 stable | Phase 1-2 chạy song song, Phase 3 tắt M7 |

### Tại sao REBUILD mà không EXTEND?

Schema cũ `order_batch / order_batch_line` flat, không có:
- Order-per-trip relationship
- CN-level approval workflow
- Transaction safety (BUG-03)
- PO/TO separate lifecycle
- Edit log với reason tracking

→ Không thể "vá" bằng cách thêm column. Phải thiết kế lại domain model.

### Transition Strategy cho M7

```
┌─────────────────────────────────────────────────────────────────┐
│  Sprint 0:  Fix BUG-03 (createBatch transaction) trên M7 cũ     │
│             → M7 tiếp tục chạy production an toàn               │
├─────────────────────────────────────────────────────────────────┤
│  Sprint 7:  Build M27 (folder mới `po-review/`)                 │
│             - 6 bảng mới: po_header, po_line, to_header,        │
│               to_line, po_edit_log, po_tracking                 │
│             - M7 VẪN chạy song song                             │
├─────────────────────────────────────────────────────────────────┤
│  Sprint 8:  M27 hoàn tất, QA                                    │
│             - FE1 deploy UI M27 song song UI M7                 │
│             - Feature flag `m27_po_rebuild_enabled = true` cho  │
│               pilot CN/NM                                       │
├─────────────────────────────────────────────────────────────────┤
│  Sprint 9-12: Mở dần M27 cho toàn bộ users                      │
│               Data MỚI tạo trên M27, data CŨ đọc-only M7        │
├─────────────────────────────────────────────────────────────────┤
│  Sprint 13+: Sau ≥ 1 tháng M27 stable, no critical incident     │
│              - Ẩn UI M7 khỏi menu                               │
│              - Tắt API `/v1/order-batch` (giữ read-only)        │
│              - Sprint 15+: xóa code M7 hoàn toàn                │
└─────────────────────────────────────────────────────────────────┘
```

### Data Migration cho M7

**KHÔNG migrate data** từ `order_batch` sang `po_header` vì domain model khác hẳn.

| Data | Xử lý |
|------|-------|
| `order_batch` cũ (đã SENT/DELIVERED) | Giữ read-only trong DB để tra cứu lịch sử |
| `order_batch` đang DRAFT/REVIEW khi cutover | Hoàn tất trên M7, không migrate |
| Data mới sau cutover | Tạo trên M27 từ đầu |

---

## Bảng tra cứu nhanh — 10 module cũ

| M cũ | Loại | BE Xóa? | FE Xóa? | Extend/Rebuild | Thay bằng | Notes |
|------|------|---------|---------|----------------|-----------|-------|
| **M1** Demand | 2 | ❌ | 🔄 Thay dần | EXTEND | M11 | B2B pipeline thêm mới |
| **M2** Supply | 2 | ❌ | 🔄 Thay dần | EXTEND | M21 | Freshness gate thêm mới |
| **M3** Policy/SS | 2 | ❌ | 🔄 Thay dần | EXTEND | M23 | SS_cn dynamic thêm |
| **M4** DRP | 2 | ❌ | 🔄 Thay dần | EXTEND | M23 | Per-CN netting + policy pin |
| **M5** Allocation | 2 | ❌ | 🔄 Thay dần | EXTEND | M24 | LCNB + allocation_leg |
| **M6** Transport | 2 | ❌ | 🔄 Thay dần | EXTEND | M25 | Hold-or-ship + top-up |
| **M7** Execution | 3 | ✅ Có | ✅ Có | REBUILD | M27 | Domain model mới hoàn toàn |
| **M8** Monitor | 1 | ❌ | ❌ | Giữ nguyên | — | Phase 3 có thể merge M28 |
| **M9** Plan vs Actual | 1 | ❌ | ❌ | Giữ nguyên | — | Phase 3 thêm FC MAPE |
| **M10** Config | 1 | ❌ | ❌ | EXTEND tại chỗ | — | Thêm ~30 configs mới |

---

## Nguyên tắc vàng

1. **Loại 1 (M8, M9, M10):** KHÔNG đụng vào UI cũ. Chỉ extend backend nếu cần.
2. **Loại 2 (M1-M6):** Backend KHÔNG xóa, KHÔNG rebuild. Chỉ extend. UI cũ giữ Phase 1, ẩn khi v2 stable.
3. **Loại 3 (M7):** REBUILD song song, deprecate cũ sau ≥ 1 tháng stable. Không migrate data.
4. **Feature flag BẮT BUỘC** cho mọi UI v2 → rollback về UI cũ ngay nếu incident.
5. **Không xóa code cũ trong Phase 1-2.** Chỉ tắt/ẩn khi v2 đã chứng minh stable.
6. **API versioning:** `/v1/` và `/v2/` cùng tồn tại. Không break `/v1/` đang có client dùng.

---

## FAQ

**Q: User hiện tại dùng UI M1 quen, có phải force chuyển sang M11 không?**
A: Không. Phase 2 cả 2 UI cùng hiển thị, user tự chọn. Phase 3 M11 mặc định nhưng M1 vẫn truy cập được. Phase 4 ẩn M1 khỏi menu nhưng URL vẫn vào được (deprecated badge).

**Q: Nếu M11 có bug critical trên production thì sao?**
A: Feature flag tắt M11 → user tự động fallback về M1. Backend M1 vẫn chạy 100% ổn định.

**Q: M3+M4 gộp thành M23 thì schema DB xử lý sao?**
A: Giữ nguyên cả `policy_*` (M3) và `drp_*` (M4) tables. M23 đọc/ghi vào cả hai + thêm bảng mới `ss_cn`, `drp_cn_line`. Không drop bảng nào.

**Q: Khi nào xóa code M1-M6?**
A: **Không xóa.** Vì M11-M25 extend trên đó — xóa M1 = làm M11 fail. Chỉ ẩn UI, không xóa code.

**Q: Khi nào xóa code M7?**
A: Sau ≥ 1 tháng M27 chạy production không incident + đã đảm bảo không có client/tool nào còn gọi API M7. Sprint 15+.

**Q: Data M7 có mất không?**
A: Không. `order_batch` giữ read-only để tra cứu lịch sử. Chỉ data operations mới tạo trên M27.

---

*MODULE-REFERENCE.md — UNIS SCP v2.0 — 2026-04-15*
