# Sprint 0 — Bug Fix Plan (1 tuần)

> **Ngày tạo:** 2026-04-17 · **Version:** 1.1 · **Author:** SA/Architect
> **Changelog v1.1:** Fix C1 (.env flag thay feature flag infra), C2 (idempotency_log migration), C3 (DA1 schedule),
> m4 (BUG-01 backfill REQUIRED), m5 (total_qty recompute task), m6 (escalation deadline EOD Day 2).
> **Status:** 🔴 BLOCKING — Sprint 1+ không start được nếu Sprint 0 chưa DONE
> **Rationale:** Code mới M21-M28 sẽ extend schema cũ. Bug trong schema cũ = bug inherited. BUG-03 đang là production risk hôm nay.

---

## §0 — Tại sao Sprint 0 không skip được

| Bug | Nếu skip → hậu quả |
|-----|-------------------|
| **BUG-01** `is_estimated` flag (M2) | M21 Data Sync v2 inherit schema → freshness gate không phân biệt estimated vs actual → DRP gate bằng data sai |
| **BUG-02** `allocation_leg` missing (M5) | M24 LCNB v2 cần multi-source traceability — không có bảng `allocation_leg` thì M24 **không implement được** spec |
| **BUG-03** `createBatch` transaction (M7) | **Production risk NGAY hôm nay** — duplicate/partial orders mỗi ngày không fix |

**Kết luận:** Sprint 0 là **prerequisite tuyệt đối** cho Sprint 1 M00, không phải "nice to have".

---

## §1 — Sprint 0 Timeline (5 ngày)

```
Day:         1     2     3     4     5
             │     │     │     │     │
BUG-01 BE2:  ██████                               ← quick win, unblock QA data
BUG-03 BE3:  ████████████████████                  ← production critical, priority 1
BUG-02 BE1:        ████████████                    ← wait DA1 schema Day 1-2
DA1:         ██████  ██  ████████                  ← BUG-02 schema → BUG-01 verify → BUG-03 integrity
             └BUG02┘ └01┘ └─BUG-03────┘
QA:                                    █████       ← toàn team Day 5
Deploy:                                ██          ← DevOps1 hotfix Day 5
```

### DA1 priority schedule (C3 fix — 1 người, 3 bugs)

| Day | Task | Block | Duration |
|-----|------|-------|----------|
| Day 1-2 | BUG-02 schema design (DA1-1, DA1-2) | Blocks BE1 starting BUG-02 | ~12h |
| Day 3 AM | BUG-01 verify query (DA1-1 from §2) | Light review | ~2h |
| Day 3 PM - Day 5 | BUG-03 integrity check + cleanup (DA1-2, DA1-3 from §4) | Gate for deploy | ~10h |

**Rule:** DA1 không làm parallel 3 bugs — sequential theo priority. BE1 biết trước: không start BUG-02 trước Day 2 afternoon.

---

## §2 — BUG-01: M2 Supply `is_estimated` flag

**Owner:** BE2 · **DA:** DA1 · **Độ phức tạp:** Thấp · **Duration:** 1-2 ngày

### Root cause

Column `is_estimated` đã tồn tại trong `supply_snapshot_line` schema, nhưng service logic không propagate đúng `source_type` → `is_estimated`. Kết quả: tất cả rows có `is_estimated = false` bất kể data từ NM upload hay distribution estimate.

### Tasks

```
BE2-1  [ ] Đọc supply.service.ts → captureSnapshot() method
BE2-2  [ ] Trace source_type: từ lot_attribute (hoặc table tương đương) khi build line
BE2-3  [ ] Sửa logic:
             is_estimated = (source_type === 'DISTRIBUTION' || source_type === 'FALLBACK')
             is_estimated = false khi source_type === 'NM_UPLOAD'
BE2-4  [ ] Đảm bảo API GET /supply/snapshots response có field is_estimated
BE2-5  [ ] Unit test: 3 cases (NM_UPLOAD, DISTRIBUTION, FALLBACK)
BE2-6  [ ] Backfill script (REQUIRED — m4 fix): re-run captureSnapshot cho snapshots 7 ngày gần nhất
           Rationale: QA-1 cần data thật phân biệt estimated/actual. Skip = QA test dùng data toàn false, không detect được bug.
           Scope: 7 ngày đủ cho QA signal; không chạy 30 ngày để tránh tốn thời gian Sprint 0.
DA1-1  [ ] Verify query phân biệt được estimated vs actual sau fix
           SELECT COUNT(*) FROM supply_snapshot_line
           WHERE snapshot_id IN (SELECT id FROM supply_snapshot WHERE captured_at >= NOW() - INTERVAL '7 days')
           GROUP BY is_estimated;
```

### DoD

- [ ] Unit test coverage ≥ 80% cho logic is_estimated
- [ ] Query DA1 trả về cả true và false values
- [ ] API response verify field is_estimated hiện đúng

---

## §3 — BUG-02: M5 Allocation `allocation_leg` table

**Owner:** BE1 + DA1 · **Độ phức tạp:** Trung bình · **Duration:** 3 ngày

### Root cause

Schema `allocation_result` chỉ lưu 1 source per result. Thực tế 1 demand line có thể fulfilled từ nhiều source (Hub + LCNB redistribution + NM). Hiện tại allocation engine flatten thành 1 row duy nhất → mất traceability per source.

### Tasks

#### DA1 (Day 1-2)

```
DA1-1  [ ] Thiết kế bảng allocation_leg:
              CREATE TABLE allocation_leg (
                id                   BIGSERIAL PRIMARY KEY,
                allocation_result_id BIGINT NOT NULL REFERENCES allocation_result(id) ON DELETE CASCADE,
                source_type          VARCHAR(20) NOT NULL,  -- HUB | NM | CN_REDIST
                source_entity_id     BIGINT NOT NULL,       -- polymorphic FK
                source_lot_id        VARCHAR(50) NULL,      -- for FIFO tracking
                allocated_qty        DECIMAL(15,2) NOT NULL,
                fifo_rank            INT NULL,              -- thứ tự FIFO khi pick
                distance_km          DECIMAL(10,2) NULL,    -- distance CN→CN cho LCNB
                created_at           TIMESTAMP DEFAULT NOW()
              );
              CREATE INDEX idx_alloc_leg_result ON allocation_leg(allocation_result_id);
              CREATE INDEX idx_alloc_leg_source ON allocation_leg(source_type, source_entity_id);
DA1-2  [ ] Migration 20260418_bug02_create_allocation_leg.up.sql + .down.sql
DA1-3  [ ] Review trigger/constraint: allocation_result.total_qty = Σ allocation_leg.allocated_qty
             (Option 1: DB trigger · Option 2: service layer recompute · → chọn Option 2 cho Phase 1)
```

#### BE1 (Day 1-3)

```
BE1-1  [ ] Đọc allocation/ module, xác định AllocationService.allocate() logic hiện tại
BE1-2  [ ] Refactor: mỗi lần allocate từ source → insert 1 row vào allocation_leg
BE1-3  [ ] allocation_result giờ là aggregate summary, chi tiết source ở allocation_leg
BE1-3b [ ] (m5 fix) Service layer total_qty recompute:
             - Sau khi insert tất cả legs trong cùng transaction:
               UPDATE allocation_result SET total_qty = (
                 SELECT COALESCE(SUM(allocated_qty), 0) FROM allocation_leg
                 WHERE allocation_result_id = :id
               ) WHERE id = :id;
             - Implement trong AllocationService.allocate() — sau loop insert legs
             - Unit test: sau allocate, assert result.total_qty === sum(legs.allocated_qty)
BE1-4  [ ] Backfill data cũ: script đánh dấu leg = 'UNKNOWN' cho records trước fix
             INSERT INTO allocation_leg (allocation_result_id, source_type, source_entity_id, allocated_qty)
             SELECT id, 'UNKNOWN', 0, total_qty FROM allocation_result WHERE id NOT IN (SELECT allocation_result_id FROM allocation_leg);
BE1-5  [ ] Unit test:
             - 1 demand 100 units từ 2 NM (60+40) → 1 allocation_result + 2 allocation_leg
             - LCNB fallback: Hub 50 + CN redist 30 → 2 leg rows
BE1-6  [ ] Integration test với existing allocation flow
BE1-7  [ ] API response GET /allocation/:id → include legs[] array
```

### DoD

- [ ] Bảng `allocation_leg` deployed staging
- [ ] Backfill script chạy clean (không có orphan `allocation_result`)
- [ ] Unit test ≥ 70% coverage
- [ ] Existing allocation flow không regression

---

## §4 — BUG-03: M7 Order Bridge Transaction Safety

**Owner:** BE3 · **Độ phức tạp:** Cao · **Duration:** 3-4 ngày · **⚠️ PRODUCTION RISK**

### Root cause

`OrderService.createBatch()` có nhiều DB writes (order_batch + order_batch_line N rows + audit log) nhưng không wrap trong transaction. Nếu fail giữa chừng → partial write, data inconsistent, duplicate orders khi retry.

**Impact NGAY:** Mỗi ngày không fix = rủi ro order integrity. Đã có incident report?

### Tasks

```
BE3-1  [ ] Audit createBatch(): liệt kê TẤT CẢ DB writes trong 1 call
             - order_batch insert
             - order_batch_line insert (N rows)
             - audit_log insert
             - (có thể) notification trigger, ERP sync call, etc.
BE3-2  [ ] Bọc toàn bộ writes trong dataSource.transaction(async mgr => { ... })
             KHÔNG include side effects bên ngoài DB (HTTP calls, email send) — chạy SAU khi commit
BE3-3  [ ] Thêm idempotency key:
             - Client gửi idempotency_key header (UUID)
             - Service check: nếu key đã processed trong 24h → return cached result, không re-execute
BE3-3b [ ] (C2 fix) Migration `20260418_bug03_create_idempotency_log.up.sql`:
             CREATE TABLE idempotency_log (
               key          VARCHAR(64) PRIMARY KEY,
               endpoint     VARCHAR(200) NOT NULL,
               result_json  JSONB NOT NULL,
               status_code  INT NOT NULL,
               created_at   TIMESTAMP DEFAULT NOW(),
               expires_at   TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
             );
             CREATE INDEX idx_idempotency_expires ON idempotency_log(expires_at);
           - .down.sql: DROP TABLE idempotency_log;
           - Cleanup job: cron daily DELETE FROM idempotency_log WHERE expires_at < NOW();
BE3-4  [ ] Test rollback scenarios:
             - Simulate DB constraint violation line 5/10 → confirm 0 rows committed
             - Simulate connection loss giữa batch → confirm rollback
             - Simulate retry với cùng idempotency_key → confirm không duplicate
BE3-5  [ ] Unit test: mock DB fail ở line N → rollback toàn bộ
BE3-6  [ ] Integration test: batch 100 lines, fail line 50 → 0 lines committed
BE3-7  [ ] Load test: 100 concurrent createBatch calls → không có duplicate
BE3-8  [ ] Production hotfix deploy script (DevOps1 prepare)
DA1-2  [ ] Check data integrity sau fix — query tìm orphan order_batch không có lines
             SELECT b.id FROM order_batch b
             LEFT JOIN order_batch_line l ON l.batch_id = b.id
             WHERE l.id IS NULL AND b.created_at >= NOW() - INTERVAL '90 days';
DA1-3  [ ] Cleanup script cho orphan data cũ (nếu có)
```

### DoD

- [ ] Tất cả DB writes trong transaction
- [ ] Idempotency key active
- [ ] Load test 100 concurrent calls không duplicate
- [ ] No orphan `order_batch` sau cleanup
- [ ] **Deployed production với zero-downtime** (DevOps1)
- [ ] Monitor 24h post-deploy: không có regression, không có "partial batch" alert

---

## §5 — QA & Deploy (Day 5)

### QA toàn team

```
QA-1  [ ] BUG-01 regression test: upload NM snapshot → is_estimated=false;
          fallback snapshot → is_estimated=true
QA-2  [ ] BUG-02 test: allocation với 2 sources → 2 legs, total_qty = sum
QA-3  [ ] BUG-03 test: createBatch với 50 lines, kill process giữa chừng → 0 rows;
          retry với cùng idempotency_key → thành công không duplicate
QA-4  [ ] Smoke test toàn bộ M1-M10 existing features không regression
QA-5  [ ] Performance: createBatch 500 lines < 5s (transaction overhead acceptable)
```

### DevOps1 Deploy

```
OPS-1  [ ] Backup production DB trước deploy
OPS-2  [ ] Deploy migration BUG-02 (tạo allocation_leg + backfill)
OPS-2b [ ] (C2 fix) Deploy migration BUG-03 (tạo idempotency_log)
OPS-3  [ ] Run backfill script BUG-01 (7 ngày) + BUG-02 (UNKNOWN legs)
OPS-4  [ ] Deploy hotfix code (BUG-01 + BUG-02 + BUG-03) lên production
             Zero-downtime: blue-green hoặc rolling update
             Env: set M7_TRANSACTION_SAFE=true trong production .env TRƯỚC khi deploy code
OPS-5  [ ] Setup cron cleanup idempotency_log (daily delete expired rows)
OPS-6  [ ] Monitor 24h: alert rate, error logs, DB integrity queries
OPS-7  [ ] Rollback plan sẵn sàng:
             - BUG-03 regression → set M7_TRANSACTION_SAFE=false + redeploy (~2 phút)
             - BUG-02 schema issue → down.sql rollback (phải drop legs data)
             - BUG-01 → revert service code (schema không thay đổi)
```

---

## §6 — Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| BUG-03 production hotfix break existing flow | **`.env` variable `M7_TRANSACTION_SAFE=true/false`** (C1 fix — feature flag infra chưa có ở Sprint 0, sẽ migrate sang `system_config` flags ở Sprint 1 Gate 5). Rollback bằng set env=false + redeploy ~2 phút. |
| BUG-02 backfill script slow với > 1M rows | Chạy batch 10K rows/batch, chạy off-peak |
| BUG-01 backfill thay đổi historical data | Backup snapshot trước, script idempotent |
| Team không quen với dataSource.transaction pattern | BE3 pair-program với senior trong Day 1 |
| DA1 overload (review cả BUG-02 schema + chuẩn bị M00) | Tập trung BUG-02 Sprint 0; M00 schema review Sprint 1 |

---

## §7 — Definition of Done (Sprint 0)

- [ ] 3 bugs deployed staging Day 4
- [ ] QA sign-off Day 5 morning
- [ ] Production deploy Day 5 afternoon (BUG-03 critical)
- [ ] Monitor 24h Day 6-7, không có regression
- [ ] DA1 verify data integrity trên production Day 7
- [ ] Sprint retrospective + handover notes cho Sprint 1 team

---

## §8 — Sprint 1 Readiness Gate

Sprint 1 M00 **CHỈ start khi tất cả check passed:**

```
Gate 1  [ ] BUG-01 deployed production, is_estimated query phân biệt đúng
Gate 2  [ ] BUG-02 allocation_leg table live, backfill 100% complete
Gate 3  [ ] BUG-03 production stable 48h không incident
Gate 4  [ ] DA1 confirm không có schema lock, sẵn sàng review M00 migration
Gate 5  [ ] DevOps1 feature flag infra ready cho M00 (system_config flags table)
Gate 6  [ ] Team retrospective + document gotchas cho Sprint 1
```

Nếu bất kỳ Gate nào fail → **DELAY Sprint 1**, không push tiến độ.

---

## §9 — Escalation

- Production incident trong Sprint 0 deploy → rollback ngay, investigate, không push fix vội
- DA1 phát hiện schema conflict giữa BUG-02 và M00 plan → escalate SA, re-design schema trước khi code
- BE3 phát hiện createBatch có race condition phức tạp hơn dự kiến → **phải escalate SA KHÔNG muộn hơn EOD Day 2** (m6 fix). SA quyết định trong 4h: (a) apply lock strategy (pessimistic/optimistic), (b) defer race condition fix sang Sprint 1 với temporary mitigation, (c) extend Sprint 0 thêm 2 ngày. Không escalate quá Day 2 → không còn đủ thời gian fix trong Sprint 0.

---

*Sprint 0 Bug Fix Plan v1.1 — 2026-04-17 (post-review fix)*
*Sprint 0 is BLOCKING — no Sprint 1 until Gate 1-6 passed.*
