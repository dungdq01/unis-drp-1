# SCP/DRP SESSION SUMMARY — 12/04/2026

> **Prepared for:** Smartlog Leadership Team (CTO Dũng, CTO Tuấn, CAIO Hạnh, COO Thanh)
> **From:** Kurt Binh — CEO
> **Session:** Claude AI Working Session — SCP/DRP Deep Design
> **Duration:** ~6 giờ, 20+ lượt trao đổi chuyên sâu

---

## TÓM TẮT EXECUTIVE (BLUF)

Session này đã deep-dive vào **quy trình planning thực tế của UNIS** và phát hiện **nhiều gaps quan trọng** trong PRD v3.6 mà nếu không fix trước khi build sẽ dẫn đến sản phẩm không đáp ứng nhu cầu vận hành thực tế. Cụ thể:

1. **Production Booking flow** — quy trình book NM 3 tháng chưa có trong PRD
2. **Hub ảo concept** — UNIS chưa có kho tổng vật lý, cần mapping đặc biệt
3. **Dual lot sizing** — cần lot sizing ở CẢ monthly (production MOQ) VÀ nightly (transport MOQ)
4. **Commitment gap management** — bài toán take-or-pay khi không đạt sản lượng cam kết
5. **B2B pipeline management** — Sales biết deal 1-3 tháng trước Bravo, SCP cần track pipeline với probability
6. **Stitch UI prompts** — 15 prompts cho 17 screens đã rà soát theo DESIGN-v2.2

---

## PHẦN 1: CÁC DELIVERABLES ĐÃ TẠO

### Documents
| File | Trang | Nội dung |
|---|---|---|
| **SCP_v3_6.md/.docx/.pdf** | 114 | PRD v3.6 — 11 FRs mới (forecast 5 tầng, SS 2 tầng, Push-Pull, phasing, FC commitment...) |
| **SCP_Design_System_Prompt.md** | 14 | "Bộ não thiết kế" — 10 nguyên tắc, 7 engines, data model, 6 closed loops, UX rules, test strategy |
| **SCP_Stitch_v4_FINAL.md/.pdf** | 14 | 15 prompts Stitch + 4 global blocks, 100% DESIGN-v2.2 compliant |

### Interactive Widgets (trong chat)
| Widget | Nội dung |
|---|---|
| Production Booking ↔ DRP 8-step mapping | 3 tabs: mapping, timeline, E2E flow |
| Lot sizing MOQ aggregation calculator | 3 phương án + slider simulator |
| Monthly vs Nightly allocation | 2 cột song song, Hub = decoupling point |
| Daily DRP 7 bước (sửa) | Gộp netting+SS, thêm CN demand adjustment |
| Allocation 6-layer UNIS detail | 6 layers × real UNIS data (GA-300 A4/B2) |
| Hub ảo vs Multi-Hub | Phase 1 virtual + Phase 2 multi-hub topology |
| Lot sizing dual-level | Monthly production MOQ vs Nightly transport MOQ |
| Commitment gap scenario planner | 4 kịch bản trade-off + simulator tương tác |
| B2B pipeline management | 6-stage pipeline + change tracking + cascade impact |

---

## PHẦN 2: QUYẾT ĐỊNH QUAN TRỌNG

### QĐ-1: Production Booking = Monthly cycle, KHÔNG CÓ allocation

Production Booking (monthly) chỉ giải quyết "NM nào SX bao nhiêu" (SOURCE selection). Allocation 6-layer CHỈ chạy trong Nightly DRP khi Hub phân phối xuống CN (DESTINATION distribution). Hub HCM = decoupling point.

**Action:** Bổ sung FR-v3.6-012 Production Booking Workflow vào PRD.

### QĐ-2: Daily DRP = 7 bước (không phải 8)

Gộp demand netting + SS check thành 1 bước (SS là dòng TRONG bảng netting). Thêm bước CN demand adjustment (08:00-18:00, cutoff 18:00) để Sales tại CN chỉnh FC dựa trên local intelligence.

**Flow đúng:** Data → CN adjust → Netting (gồm SS) → Hub check → Allocation 6L → Transport lot sizing → PO release + CN approve → Feedback

**Action:** Update DRP flow trong PRD. Bổ sung FR CN Demand Adjustment.

### QĐ-3: Hub ảo (Phase 1) → Multi-Hub (Phase 2)

Phase 1: Hub ảo = planning entity, stock = NM committed − PO released. NM ship thẳng CN. Output DRP = PO Release Confirmation (không phải TO).

Phase 2: 3-4 Hub vật lý (Nam/Trung/Bắc), mỗi Hub phục vụ cluster CN. Allocation chạy parallel per Hub.

**Kiến trúc:** Mọi bảng có `hub_id` FK. Phase 1: 1 hub_id. Phase 2: thêm records. Code logic KHÔNG đổi.

**Action:** Bổ sung FR Hub ảo + Multi-Hub. Design `hub_id` vào data model từ đầu.

### QĐ-4: Lot sizing chạy ở CẢ HAI level

| Level | MOQ type | Mục đích |
|---|---|---|
| Monthly | Production MOQ (NM min run 3.000m²) | NM có chịu SX không? |
| Nightly | Transport MOQ (xe/container) | Ship hiệu quả không? |

Hub ảo phức tạp hơn: phải nói NM routing (CN nào, xe gì, gộp tuyến, hold-or-ship).

**Action:** Bổ sung FR Transport Lot Sizing (route consolidation + vehicle fitting + hold-or-ship).

### QĐ-5: Commitment Gap Management — bài toán take-or-pay

Khi cuối tháng release < committed → NM áp giá cao retroactive. 4 kịch bản:
- A: Mua hết → tồn chất đống nhưng giữ giá
- B: Chịu giá cao → retroactive price uplift
- C: Negotiate rollover → cần NM đồng ý
- D: Hybrid → mua phần bán được + rollover phần còn lại

SCP cần: Gap Monitor (alert ngày 20) + Scenario Simulator (tự tính 4 kịch bản) + AI recommendation.

**Action:** Bổ sung FR Commitment Gap Management + objects CommitmentGap, CommitmentScenario, CommitmentAmendment, PriceTierSchedule.

### QĐ-6: B2B Pipeline Management — 3 gaps CRITICAL trong PRD

PRD giả định PO data từ Bravo. Nhưng Sales biết deal B2B 1-3 tháng trước Bravo. Cần:
- B2B deal entry trong SCP (6 stages: lead→qualified→proposal→committed→confirmed→lost)
- Probability weighting: demand = FC + Σ(B2B × prob) + PO confirmed
- Change cascade: qty/timeline change > ±20% → auto-recalculate S&OP + Production Booking + DRP

**Action:** Bổ sung FR B2B Pipeline Management + objects B2BDeal, B2BDemandImpact.

---

## PHẦN 3: STITCH UI — 15 PROMPTS, DESIGN-v2.2 COMPLIANT

Đã tạo bộ prompt paste thẳng vào Google Stitch (stitch.withgoogle.com) để generate UI. 21 gaps vs DESIGN-v2.2 đã sửa (primary color, Manrope font, No-Line Rule, gradient buttons, semantic tokens...).

| # | Screen | Nội dung chính |
|---|---|---|
| 1 | Dashboard | Exception-first feed + AI recommendations (10-element card) + trust block (8 elements) |
| 2 | DRP Netting | Scenario playground + time fence + PlanningBoard |
| 3 | Demand/Forecast | 5-level hierarchy + phasing + version compare + drift monitor |
| 4 | Supply | Freshness gate + location stock + capacity gauge + dispatch constraint |
| 5 | Inventory/SS | HSTK heatmap + SS 2-tier visualization + σ comparison + slow-move |
| 6 | Allocation | 6-layer funnel + exceptions + customer fill rate |
| 7 | Transport | Vehicle sizing + carrier + consolidation + CO₂ GLEC |
| 8 | Orders + PO | Order bridge + CN approval + PO lifecycle + war room |
| 9 | Plan vs Actual | Variance waterfall + customer breakdown + MAPE 12W trend |
| 10 | Policy Center | 12 policies config + simulate before apply + feature toggles |
| 11 | Admin/RBAC | User management + 7-role permission matrix + mobile masking |
| 12 | Notifications + Audit | Alert preferences + feed + audit log with before→after |
| 13 | S&OP + War Room | Executive consensus view + escalation timeline |
| 14 | Supplier Scorecard | NM performance metrics + network topology diagram |
| + | 4 Global Blocks | Inline editing rules, filter/sort/search, states, role-based views |

---

## PHẦN 4: FRs CẦN BỔ SUNG VÀO PRD v3.6 (BACKLOG)

| FR | Tên | Priority | Source |
|---|---|---|---|
| FR-v3.6-012 | Production Booking Workflow (7 steps) | CRITICAL | Session QĐ-1 |
| FR-v3.6-013 | Hub ảo (Virtual Hub) — planning entity | CRITICAL | Session QĐ-3 |
| FR-v3.6-014 | CN Demand Adjustment Window | HIGH | Session QĐ-2 |
| FR-v3.6-015 | Transport Lot Sizing (route + vehicle + hold) | HIGH | Session QĐ-4 |
| FR-v3.6-016 | Commitment Gap Management + Scenario Simulator | HIGH | Session QĐ-5 |
| FR-v3.6-017 | B2B Pipeline Management (6-stage, probability) | CRITICAL | Session QĐ-6 |
| FR-v3.6-018 | Multi-Hub Network (Phase 2 readiness) | MEDIUM | Session QĐ-3 |
| FR-v3.6-019 | B2B Change Cascade Recalculation | HIGH | Session QĐ-6 |

**Tổng: 8 FRs mới, 3 CRITICAL, 4 HIGH, 1 MEDIUM.**

---

## PHẦN 5: NEXT STEPS

1. **Ngay lập tức:** Share session này cho team review (link chat hoặc file này)
2. **Tuần này:** Bổ sung 8 FRs vào PRD v3.7
3. **Tuần sau:** Team dev review PRD v3.7 + estimate effort
4. **Song song:** Chạy Stitch prompts → generate UI → Figma refine → dev handoff

---

> **Cách xem lại toàn bộ chi tiết:** Mở link share chat trên Claude.ai — tất cả interactive widgets (calculator, simulator, flow diagrams) vẫn hoạt động. Click vào từng bước để xem detail.

*— Hết Session Summary —*
