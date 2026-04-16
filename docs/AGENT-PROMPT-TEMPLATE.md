# AGENT PROMPT TEMPLATE — UNIS SCP v2.0
> **Dùng bởi:** Tech Lead khi dispatch task cho Agent dev (BA / DA / BE / FE / QA)
> **Ngày tạo:** 2026-04-16

---

## CÁCH DÙNG

Copy block bên dưới, điền vào `{{ }}`, xóa phần không dùng, gửi cho Agent.

---

## TEMPLATE

```
# TASK: BẠN LÀ TECHLEAD SAAS logistics 20 năm, bạn chỉ huy đội quân gồm BA- data - BE - FE - Qa dev implement module trên.

## 1. CONTEXT (đọc trước, không skip)

Dự án: UNIS SCP v2.0 — Supply Chain Planning System
Tech stack: NestJS 10 + TypeORM + PostgreSQL (BE) | Next.js 14 + TailwindCSS (FE)
Repo path: C:\Users\Admin\Desktop\my_learning\experience\workspace\projects\SupplyChain-Planing-System\unis

Đọc theo thứ tự H1→H5 trước khi code:
- H2 PRD chính thức:      unis/UNIS-SCP-v2.0-FULL-PRD.md  §{{ PRD_SECTION }}
- H3 Module spec:          unis/docs/specs/{{ SPEC_FILE }}
- H3 Implement checklist:  unis/docs/IMPLEMENT-CHECKLIST.md  §{{ CHECKLIST_SECTION }}
- H3 Phase 2 dev rules:    unis/rules/PHASE2-DEV-RULES.md    ← folder/file/zone rules
- H4 Coding rules:         unis/rules/CODING-RULES.md        ← quality/layer/test rules

## 2. TASK

**Module:** {{ MODULE_CODE }} — {{ MODULE_NAME }}
**Role:** {{ ROLE }}  (BA | DA | BE | FE | QA)
**Phase/Sprint:** {{ PHASE }} / Sprint {{ SPRINT }}
**Zone:** {{ PROTECTED | BUILD | EXTEND }}

Làm đúng checklist task sau — tick [ ] khi xong từng item:

{{ PASTE CHECKLIST ITEMS TỪ IMPLEMENT-CHECKLIST.md }}

## 3. CONSTRAINTS

- **Không sửa** bất kỳ file nào ngoài scope task này
- **Không thêm** feature ngoài checklist
- Zone PROTECTED: chỉ add method/column mới, không sửa/xóa cái cũ
- API endpoint convention (PHASE2-DEV-RULES Rule 3):
  - EXTEND module: `/api/{domain}/{capability}`  vd: `/api/demand/aggregate`
  - NEW/REBUILD module: `/api/{domain}/{action}`  vd: `/api/po-review/confirm`
  - Backward compat only: `/api/{domain}/v2/{action}` — không tạo folder /v2/
- Migration: file mới `{{ YYYYMMDD }}_{{ description }}.up.sql` + `.down.sql`
- Test: viết test skeleton TRƯỚC implementation (CODING-RULES Rule 9)
- Coverage: ≥ 80% unit test trước handoff
- Flow check (PHASE2-DEV-RULES Rule 4): biết module này thuộc Flow 1 / Flow 2 / Cross?
  Input từ module nào? Output đi module nào?

## 4. DEFINITION OF DONE

- [ ] Code pass lint + build (0 error)
- [ ] Unit test ≥ 80% coverage, test skeleton viết TRƯỚC implementation
- [ ] Swagger/OpenAPI doc đầy đủ cho endpoint mới
- [ ] Migration file có cả .up và .down
- [ ] docs/modules/{{ module }}/REPORT.md updated (endpoints X/Y, plugin coverage, test %)
- [ ] PR checklist trong CODING-RULES.md §Summary passed (toàn bộ)
- [ ] Không có hardcode magic number / tenant if/else trong core
- [ ] Docs module 6 files checklist (CODING-RULES Rule 5):
  - BA task: USER-STORIES.md ✅
  - UX task: UX-SPEC.md ✅ (FE build chỉ start khi có file này)
  - QA task: QA-REVIEW-S{{ SPRINT }}.md ✅
  - BA review: BA-REVIEW-S{{ SPRINT }}.md ✅

## 5. OUTPUT

Trả về:
1. Danh sách file đã tạo/sửa (path đầy đủ)
2. Checklist items đã tick ✅ / chưa làm ⏳ / blocked 🚫
3. Nếu blocked: lý do + file/info cần thiết
4. Test coverage % đạt được
```

---

## VÍ DỤ ĐÃ ĐIỀN — Sprint 0 BUG-03

```
# TASK: M07 — BE — BUG-03 createBatch Transaction Safety

## 1. CONTEXT

Dự án: UNIS SCP v2.0 — Supply Chain Planning System
Tech stack: NestJS 10 + TypeORM + PostgreSQL
Repo path: C:\Users\Admin\Desktop\my_learning\experience\workspace\projects\SupplyChain-Planing-System\unis

Đọc trước khi code:
- H3 Sprint 0 spec:        unis/docs/specs/SPRINT-0-BUG-FIX.md  §4 BUG-03
- H4 Implement checklist:  unis/docs/IMPLEMENT-CHECKLIST.md §PHASE 0.0 BUG-03
- H4 Coding rules:         unis/rules/CODING-RULES.md  (Rule 8 layered arch, Rule 11 idempotency)

## 2. TASK

Module: M07 — Order Bridge
Role: BE
Phase/Sprint: Phase 0.0 / Sprint 0
Zone: PROTECTED (bug fix only — không add feature)

Làm đúng checklist:
- [ ] BE3-1: Audit createBatch() — liệt kê TẤT CẢ DB writes trong 1 call
- [ ] BE3-2: Bọc toàn bộ writes trong dataSource.transaction(async mgr => {...})
            KHÔNG include side effects ngoài DB (HTTP, email) — chạy SAU commit
- [ ] BE3-3: Thêm idempotency key (bảng idempotency_log, TTL 24h)
- [ ] BE3-4: Test rollback scenarios (fail line 5/10 → 0 rows committed)
- [ ] BE3-5: Unit test mock DB fail ở line N → rollback
- [ ] BE3-6: Integration test batch 100 lines, fail line 50 → 0 committed
- [ ] BE3-7: Load test 100 concurrent createBatch → không duplicate
- [ ] DA1-2: Query check orphan order_batch (xem spec §4)
- [ ] DA1-3: Cleanup script orphan data cũ

## 3. CONSTRAINTS

- Chỉ sửa file liên quan createBatch() trong backend/src/orders/
- Không thay đổi API endpoint, response schema
- Không thêm feature mới
- side effects (HTTP calls, email) phải chạy SAU khi DB transaction commit

## 4. DEFINITION OF DONE

- [ ] Code pass lint + build
- [ ] Unit test ≥ 80% coverage cho createBatch()
- [ ] Load test 100 concurrent calls không duplicate
- [ ] No orphan order_batch sau cleanup
- [ ] REPORT.md updated
- [ ] Feature flag: m7_transaction_safety_enabled

## 5. OUTPUT

Trả về file đã sửa, checklist tick, coverage %.
```

---

## QUICK REFERENCE — ROLE → TASK TYPE

| Role | Làm gì | File output bắt buộc |
|------|--------|---------------------|
| **BA** | User stories, AC, business rules | `docs/modules/{M}/USER-STORIES.md`, `BA-REVIEW-S{N}.md` |
| **UX** | Wireframe, interaction spec | `docs/modules/{M}/UX-SPEC.md` — FE KHÔNG build khi thiếu file này |
| **DA** | Schema design, migration, seed, analytics query | `*.up.sql`, `*.down.sql`, `*.csv`, `REPORT.md` |
| **BE** | Service logic, API endpoint, unit test | `*.service.ts`, `*.controller.ts`, `*.spec.ts` |
| **FE** | UI component, screen, hook | `*.tsx`, `*.ts`, component test |
| **QA** | Review code vs spec, write test cases | `docs/modules/{M}/QA-REVIEW-S{N}.md` |

## QUICK REFERENCE — ZONE RULE

| Zone | Module | Folder BE | Được làm | Không được làm |
|------|--------|-----------|----------|----------------|
| PROTECTED | M1-M10 | folder cũ (demand/, supply/...) | Add method/column mới, fix bug | Rename, delete, sửa behavior cũ |
| EXTEND | M11, M21, M23, M24, M25 | folder domain cũ (demand/, supply/, drp/, allocation/, transport/) | Thêm file mới (tên theo capability) | Sửa file cũ của M1-M10 |
| BUILD | M00, M12-M17, M22, M26, M27, M28 | folder mới trong `src/` (tên domain, không có v2/) | Tạo full module mới | — |

> **Cách phân biệt EXTEND vs BUILD:** EXTEND = module v2 nằm trong *cùng domain* với module cũ (vd: M24 LCNB cùng domain allocation/ với M5). BUILD = module *mới hoàn toàn* hoặc REBUILD domain model (vd: M27 rebuild M7, M22 domain mới cn-demand-adjust/).

## QUICK REFERENCE — CHECKLIST LOCATION

| Module | Checklist section |
|--------|------------------|
| Sprint 0 bugs | `IMPLEMENT-CHECKLIST.md §PHASE 0.0` |
| M00, M10 | `IMPLEMENT-CHECKLIST.md §PHASE 0` |
| M21-M28 | `IMPLEMENT-CHECKLIST.md §PHASE 1` |
| M11-M17 | `IMPLEMENT-CHECKLIST.md §PHASE 2` |

---

*AGENT-PROMPT-TEMPLATE.md — UNIS SCP v2.0 — 2026-04-16*
