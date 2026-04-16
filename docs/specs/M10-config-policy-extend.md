# M10 — Config & Policy Platform (Extend)

> **Ngày:** 2026-04-17 · **Phase:** 0 · **Sprint:** 1-2 (song song M00)
> **Owner:** BE3 · **DA:** DA1 · **FE:** FE2
> **Status:** 🟡 EXTEND — module đã GoLive, thêm ~30 configs mới
> **PRD:** §F0.4 Config & Thresholds

---

## 1. Tại sao làm bài này

Hệ thống hiện có **30 configs** trong `system_config` (Phase 1). PRD v2.0 yêu cầu **60+ configs** để điều khiển toàn bộ hành vi của các module mới M11-M28 **mà không cần deploy lại code**.

SC Manager / Admin phải tự chỉnh được: CSL, tolerance LCNB, cutoff CN, trust score threshold, tolerance FC commitment, v.v. — từ UI.

---

## 2. Scope — Thêm gì, không đụng gì

### ✅ Thêm (do M10 extend)
- **~30 configs mới** chia 6 nhóm (xem §3)
- **Feature Flag infrastructure** (bảng + API) — phục vụ Rule 13 cho toàn bộ module v2
- **Validation bounds** cho configs mới (min/max, enum, cross-field)
- **FE:** thêm tabs mới vào `/system-config` UI hiện có

### ❌ Không đụng
- 30 configs Phase 1 cũ — giữ nguyên key, value, audit history
- Audit log mechanism — reuse
- RBAC role matrix — static Phase 1, không đổi
- Sidebar nav `/system-config` — giữ nguyên route

---

## 3. 7 Nhóm Config mới (~25 keys)

| Nhóm | Config keys | Dùng bởi |
|------|------------|----------|
| **PLANNING** | `planning.max_stale_minutes` (1440), `planning.force_override_allowed` (false) | M21, M23, M26 |
| **LCNB** | `lcnb.enabled`, `lcnb.max_distance_km` (500), `lcnb.min_excess_threshold` (50), `lcnb.max_transfer_pct` (80), `lcnb.ss_reduction_pct` (25), `lcnb.fifo_enabled` | M23, M24 |
| **Trust Score** | `trust.window_weeks` (12), `trust.accuracy_threshold_pct` (20), `trust.auto_approve_threshold_pct` (85), `trust.reduce_tolerance_threshold_pct` (60) | M22, M28 |
| **CN Adjustment** | `cn_adjust.tolerance_pct` (30), `cn_adjust.cutoff_time` ("18:00"), `cn_adjust.reason_codes` (JSON array) | M22 |
| **Transport** | `transport.min_fill_ratio` (0.6), `transport.hold_max_days` (2), `transport.hold_buffer_days` (1) | M25 |
| **FC Commitment** | `commit.hard_tolerance_pct` (5), `commit.firm_tolerance_pct` (15), `commit.soft_tolerance_pct` (30), `commit.gap_alert_day` (20), `commit.gap_alert_pct` (15), `commit.gap_escalate_day` (25), `commit.gap_escalate_pct` (10) | M14, M17 |
| **B2B Pipeline** | `b2b.stage_prob` (JSON `{Lead:10, Qualified:40, Proposal:65, Committed:85, Confirmed:100, Lost:0}`) | M11 |

**Tổng: 26 config keys mới.** Header §1 ghi "~30" là ước lượng sơ bộ — số chính xác sẽ chốt tại bảng này.

> Mỗi config phải có: `key`, `value`, `value_type` (string/number/boolean/json), `group`, `description`, `default_value`, `min/max` (nếu numeric).

---

## 4. Feature Flag Infrastructure (mới, phục vụ Rule 13)

**Business intent:** Bật/tắt module v2 per-environment mà không deploy. Fallback legacy nếu flag off.

### Kiến trúc — chốt 1 nguồn (fix Critical #1)

M00 `FeatureFlagGuard` inject **`SystemConfigService`** (không phải `FeatureFlagService` riêng). Do đó:

- Bảng `feature_flag` là **bảng chuyên biệt** cho flags (không trộn vào `system_config` để query nhanh + separation of concerns).
- `SystemConfigService` **expose method `isEnabled(flagName: string): Promise<boolean>`** đọc từ bảng `feature_flag` theo `flag_name` PK.
- M00 `FeatureFlagGuard` gọi `systemConfigService.isEnabled(flagKey)` — không cần đổi code M00.

**Bảng `feature_flag`:**

| Field | Mô tả |
|-------|-------|
| `flag_name` PK | `m11_demand_v2_enabled`, `m22_cn_adjust_enabled`, ... |
| `enabled` | boolean |
| `description` | ngắn |
| `updated_by`, `updated_at` | audit |

**Index bắt buộc:** PK đã index `flag_name`. Không cần thêm (dung lượng bảng nhỏ ~11 rows).

**Flag keys bắt buộc có khi M10 release:**

```
m00_master_data_enabled       (default: true staging / false prod đến khi M00 ready)
m11_demand_v2_enabled
m12_saop_consensus_enabled
m21_data_sync_v2_enabled
m22_cn_demand_adjust_enabled
m23_drp_netting_v2_enabled
m24_allocation_lcnb_enabled
m25_transport_v2_enabled
m26_nm_atp_enabled
m27_po_rebuild_enabled
m28_feedback_loop_enabled
```

**Guard pattern** — module v2 wrap controller với `@FeatureFlag('m22_cn_demand_adjust_enabled')` + `@UseGuards(FeatureFlagGuard)`. Flag off → trả 503 Service Unavailable.

**Migration từ BUG-03 `.env`:** Sprint 0 dùng `process.env.M7_TRANSACTION_SAFE`. Sprint 1 Day 2 migrate sang `feature_flag` table (1 hotfix deploy).

---

## 5. Validation Rules (Business)

| Rule | Áp dụng |
|------|---------|
| Số phải trong bounds | `lcnb.max_distance_km` ∈ [50, 2000] |
| Percentage 0-100 | Tất cả `*_pct` configs |
| Time format `HH:MM` | `cn_adjust.cutoff_time` |
| JSON schema valid | `b2b.stage_prob` phải có đủ 6 keys Lead/Qualified/Proposal/Committed/Confirmed/Lost |
| Cross-field | `commit.hard_tolerance_pct` < `firm_tolerance_pct` < `soft_tolerance_pct` |
| Cross-field | `commit.gap_alert_day` < `gap_escalate_day` |
| Single-value constraint | `b2b.stage_prob.Confirmed` phải = 100 (đơn đã ký = chắc chắn convert); `b2b.stage_prob.Lost` phải = 0 |
| Range 0-100 từng key | Mỗi key trong `b2b.stage_prob` (Lead/Qualified/Proposal/Committed) ∈ [0, 100]. **KHÔNG** có rule "tổng 6 keys = 100" — đây là probability per stage, không phải phân phối. |

Vi phạm → 400 Bad Request với message rõ ràng tiếng Việt.

---

## 6. User Stories (Acceptance)

### US-1: SC Manager chỉnh CSL tolerance
**As SC Manager**, tôi mở `/system-config` → tab "Replenishment" → thấy field `lcnb.max_distance_km = 500 km`, chỉnh thành `300`, nhấn Save.
**Then:** Audit log ghi `{changed_by, old=500, new=300, timestamp}`. Từ DRP run tiếp theo, M24 dùng 300 km.

### US-2: Validation bounds
**As SC Manager**, nhập `lcnb.max_distance_km = 5000` → hệ thống reject với "Giá trị vượt max 2000". Không save.

### US-3: Feature flag rollback
**As DevOps**, phát hiện M24 LCNB có bug → tắt `m24_allocation_lcnb_enabled` qua UI → trong 60s M24 endpoint trả 503, M5 allocation cũ chạy bình thường.

### US-4: B2B probabilities
**As SC Manager**, mở tab "Demand", chỉnh `b2b.stage_prob.Committed` từ 85 → 90 → Save. Audit log ghi JSON diff.

---

## 7. Non-functional

- Load tất cả configs < 500ms (cache in-memory, invalidate khi có PATCH)
- Flag check < 50ms (mỗi request của module v2 đọc 1 flag)
- Audit log 100% coverage — không có silent update

---

## 8. Dependencies & Integration

| Module | Dùng config |
|--------|-------------|
| M11 | `b2b.stage_prob` |
| M22 | `cn_adjust.*`, `trust.*` |
| M23 | `lcnb.ss_reduction_pct` |
| M24 | Toàn bộ `lcnb.*` |
| M25 | `transport.*` |
| M14, M17 | Toàn bộ `commit.*` |
| M28 | `trust.*` (refresh weekly) |

**Export pattern:** `SystemConfigService` + `FeatureFlagService` export qua `SystemConfigModule`, module khác inject.

---

## 9. DoD (Definition of Done)

- [ ] 26 configs mới seed vào DB với default values (7 nhóm — xem §3)
- [ ] Bảng `feature_flag` + 11 flag keys seed
- [ ] Validation bounds áp dụng đầy đủ (§5)
- [ ] Audit log test pass — mọi PATCH đều log
- [ ] `@FeatureFlag` decorator + `FeatureFlagGuard` class ready cho M00 import
- [ ] FE tabs mới (6 nhóm) hiển thị + edit được
- [ ] BUG-03 `.env` flag migrate sang `feature_flag` table (Sprint 1 Day 2)
- [ ] Load test: 100 modules read configs concurrent < 1s

---

## 10. Out of Scope

- Config lifecycle (draft → approve → active) — Phase 2
- Role-based edit permission (Phase 1: SC Manager full edit, không có approval flow)
- Dry-run preview trước khi apply — Phase 2
- Rollback config version — Phase 2 (hiện tại chỉ có forward audit log)

---

## 11. Lưu ý cho dev

1. **Không đổi schema `system_config` cũ** — chỉ INSERT rows mới. Validation bounds lưu trong 1 bảng phụ `config_bounds` hoặc JSON trong `description` — DA1 chốt.
2. **Feature flag cache:** in-memory với TTL 30s. Flag change không cần instant propagation — 30s delay chấp nhận được. Cache miss (cold start hoặc sau TTL) hit DB — PK `flag_key` đã index, query < 10ms.
3. **BUG-03 env flag migration:** tạo cron 1-lần đọc `M7_TRANSACTION_SAFE` → ghi vào `feature_flag`, sau đó code đọc từ DB. Env variable deprecated sau Sprint 1.
4. **Seed idempotent:** `ON CONFLICT (flag_key) DO NOTHING` — re-run migration không overwrite admin đã chỉnh.

---

*M10 Extend Spec v1.1 — 2026-04-17 (post-review fix: FlagGuard integration, PLANNING group, B2B rule clarify, config count 26)*
