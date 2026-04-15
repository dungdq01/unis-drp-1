# CODING RULES — PRJ-SCP-001 (Smartlog SCP/DRP)

**Version:** 1.0 | **Date:** 2026-04-10
**Authority:** R-SA (Solution Architect) + R-PM
**Applies to:** EVERY agent, EVERY file, NO exceptions

> Đọc file này TRƯỚC KHI bắt đầu bất kỳ task coding nào.
> Vi phạm rule = code bị reject tại PR review.

---

## RULE 1 — Agent Reading Flow (H1→H5 Protocol)

Mọi agent PHẢI load context theo thứ tự trước khi code. **Không skip bước nào.**

```
H1 — Universal (luôn load)
  └─ maestro-knowledge-graph/docs/SOP-AGENT-PROCESS.md
  └─ .agent/R-{role}.md  (project skill card của mình)

H2 — Project (luôn load)
  └─ _metadata/project-memory.md
  └─ architecture/architecture.md  (chỉ section liên quan)

H3 — Module (load theo task)
  └─ flows/module-specs/{module}.md  (spec module đang build)
  └─ flows/data-flow.md §{step}      (data lineage của module)

H4 — Task (load theo sprint)
  └─ _metadata/kickoff-sprint{N}-scp-001.md §{role} assignment
  └─ design/api-design.md §{endpoints} liên quan

H5 — Session (context đang làm)
  └─ File code đang viết + test file tương ứng
```

**Checklist trước khi code:**
- [ ] H1 đọc xong — biết mình là ai, làm gì
- [ ] H2 đọc xong — biết project state, ADRs nào liên quan
- [ ] H3 đọc xong — biết module spec, interface, constraints
- [ ] H4 đọc xong — biết AC sprint, forbidden actions
- [ ] Viết test skeleton TRƯỚC implementation (Rule 9)

---

## RULE 2 — Hermess H1-H5 Memory Discipline

Agent KHÔNG được dump toàn bộ docs vào context. Load đúng tầng, đúng lúc.

| Level | Khi nào load | Ví dụ |
|---|---|---|
| H1 | Lúc bắt đầu phiên làm việc | SOP + skill card |
| H2 | Lúc bắt đầu sprint | project-memory.md |
| H3 | Lúc bắt đầu 1 module | demand-service.md |
| H4 | Lúc nhận task cụ thể | kickoff-sprint1 §BE1 |
| H5 | Lúc đang code 1 file | routes.py đang viết |

> **Rule:** Khi context H5 đầy → summarize → lưu vào docs/modules/{module}/REPORT.md → reset H5.
> Không để 1 session chứa > 3 module contexts cùng lúc.

---

## RULE 3 — Folder Structure (Coding Folder)

```
SupplyChain-Planing-System/
├── src/                          ← TẤT CẢ code ở đây. Không để code ngoài src/
│   ├── shared/                   ← cross-cutting, dùng bởi mọi module
│   │   ├── auth/                 ← JWT, RLS middleware, tenant extraction
│   │   ├── kafka/                ← base producer/consumer, idempotency
│   │   ├── db/                   ← session factory, base repository
│   │   ├── errors/               ← error codes (Supplement E), base exceptions
│   │   ├── cache/                ← Redis patterns, TTL constants
│   │   └── logging/              ← structured JSON logger
│   ├── demand_service/
│   ├── supply_service/
│   ├── policy_engine/
│   ├── drp_engine/
│   ├── allocation_engine/
│   ├── transport_service/
│   ├── execution_bridge/
│   └── monitor_service/
├── tests/
│   ├── unit/                     ← mirror src/ structure
│   ├── contract/                 ← Kafka schema + API contract tests
│   ├── load/                     ← Locust scenarios
│   └── chaos/                    ← ERP timeout, Kafka lag mocks
├── docs/
│   └── modules/                  ← Rule 5: docs per module
│       ├── demand-service/
│       │   ├── README.md
│       │   └── REPORT.md
│       └── {module}/...
└── .agent/                       ← agent skill cards
```

**Cấu trúc mỗi module (`src/{module}/`):**

```
{module}/
├── __init__.py         ← exports public API of module
├── routes.py           ← FastAPI router ONLY — no business logic
├── service.py          ← business logic ONLY — no DB, no HTTP
├── repository.py       ← DB queries ONLY — no business logic
├── models.py           ← Pydantic schemas ONLY (request/response)
├── entities.py         ← SQLAlchemy models ONLY
├── kafka.py            ← Kafka publish/consume ONLY
├── constants.py        ← module-level constants, error codes
└── plugins/            ← tenant-specific overrides (Rule 4)
    ├── base.py         ← abstract plugin interface
    ├── mdlz.py
    ├── ttc.py
    └── unis.py
```

---

## RULE 4 — Plugin Design Pattern (Tenant-Specific Logic)

Logic chung = core. Logic riêng từng tenant = plugin. **Không if/else tenant_id trong core.**

```python
# ✅ ĐÚNG — Plugin pattern
# src/allocation_engine/plugins/base.py
class BaseAllocationPlugin(ABC):
    @abstractmethod
    def fefo_policy(self) -> FEFOPolicy: ...
    @abstractmethod
    def rtm_priority_override(self, customer_id: str, item_id: str) -> int | None: ...
    def pre_allocation_hook(self, lots): return lots   # default: no-op
    def post_allocation_hook(self, result): return result

# src/allocation_engine/plugins/mdlz.py
class MDLZPlugin(BaseAllocationPlugin):
    def fefo_policy(self): return FEFOPolicy(enabled=True, strict=True)
    def rtm_priority_override(self, customer_id, item_id): return None  # use DB rules

# src/allocation_engine/plugins/unis.py
class UNISPlugin(BaseAllocationPlugin):
    def fefo_policy(self): return FEFOPolicy(enabled=False)  # building materials
    def rtm_priority_override(self, customer_id, item_id): return None

# src/allocation_engine/service.py — CORE không biết tenant
def run_allocation(tenant_id: str, lots: list, plugin: BaseAllocationPlugin):
    filtered = plugin.pre_allocation_hook(lots)
    filtered = apply_l3_fefo(filtered, plugin.fefo_policy())  # plugin inject policy
    ...

# ❌ SAI — hardcode tenant logic trong core
def run_allocation(tenant_id: str, lots: list):
    if tenant_id == "mdlz": fefo = True
    elif tenant_id == "unis": fefo = False  # FORBIDDEN
```

**Plugin registry — inject tại startup:**

```python
# src/shared/plugin_registry.py
PLUGINS: dict[str, BaseAllocationPlugin] = {
    "mdlz-uuid": MDLZPlugin(),
    "ttc-uuid":  TTCPlugin(),
    "unis-uuid": UNISPlugin(),
}
def get_plugin(tenant_id: str) -> BaseAllocationPlugin:
    return PLUGINS.get(tenant_id, DefaultPlugin())
```

> **Rule:** Mỗi khách hàng mới = tạo 1 file plugin mới. Không sửa core.

---

## RULE 5 — Module Documentation

Mỗi module phải có 2 files trong `docs/modules/{module}/`:

**README.md** — mô tả tĩnh (không thay đổi thường xuyên):
```markdown
# Module: {name}
## Responsibility
## Interfaces (Input / Output / Kafka / DB tables)
## Configuration
## Performance SLA
## ADRs Applied
```

**REPORT.md** — trạng thái động (cập nhật sau mỗi sprint):
```markdown
# Report: {name} — Sprint {N}
## Status: 🟡 In Progress / ✅ Done
## Endpoints implemented: X / Y total (from api-design.md)
## Kafka topics active: X / Y (from data-flow.md)
## Plugin coverage: MDLZ ✅ | TTC ⏳ | UNIS ❌
## Known issues / TODOs
## Test coverage: {%}
## Last updated: {date}
```

> **Rule:** REPORT.md phải có entry sau mỗi sprint. Không có REPORT = module chưa done.

**Bộ docs đầy đủ mỗi module (6 files bắt buộc):**

```
docs/modules/{module}/
├── README.md          ← R-DO tạo lúc scaffold (D0)
├── REPORT.md          ← R-PM update SAU mỗi sprint
├── USER-STORIES.md    ← R-BA tạo TRƯỚC hoặc SONG SONG sprint build
├── UX-SPEC.md         ← R-UX tạo SAU R-BA, TRƯỚC FE build
├── QA-REVIEW-S{N}.md  ← R-QA tạo SAU sprint build (review code)
└── BA-REVIEW-S{N}.md  ← R-BA tạo SAU sprint build (review vs stories)
```

**Timing rule:**
- **USER-STORIES.md** — bắt buộc có TRƯỚC khi FE bắt đầu build screen cho module đó
- **UX-SPEC.md** — bắt buộc có TRƯỚC khi FE bắt đầu implement component
- **QA-REVIEW + BA-REVIEW** — bắt buộc có TRƯỚC khi PM sign-off sprint AC
- Module chưa đến sprint build → chỉ cần README.md + REPORT.md (scaffold)
- Module đang build → phải có đủ 6 files trước khi sprint kết thúc

**Sprint dispatch rule:**
- Mỗi sprint coding dispatch PHẢI có ít nhất: 1 dispatch R-BA (user stories) + 1 dispatch R-UX (UX spec) cho module đang build trong sprint đó
- R-QA review + R-BA review dispatch SAU khi code xong, TRƯỚC khi sprint sign-off

**Checklist khi PM sign-off sprint:**
```
[ ] docs/modules/{module}/USER-STORIES.md exists (R-BA)
[ ] docs/modules/{module}/UX-SPEC.md exists (R-UX)
[ ] docs/modules/{module}/REPORT.md updated (R-PM)
[ ] docs/modules/{module}/QA-REVIEW-S{N}.md exists (R-QA)
[ ] docs/modules/{module}/BA-REVIEW-S{N}.md exists (R-BA)
→ Thiếu bất kỳ file nào = sprint CHƯA DONE
```

---

## RULE 6 — Context & Size Limits

| File type | Max lines | Nếu vượt |
|---|---|---|
| Code file (`.py`, `.ts`, `.tsx`) | **500 lines** | Split thành `{name}_core.py` + `{name}_helpers.py` |
| Routes file | **200 lines** | Split theo feature group |
| Test file | **400 lines** | Split theo test family |
| Report/REPORT.md | **300 lines** | REPORT-part1.md + REPORT-part2.md |
| Memory file | **400 lines** | Split theo topic section |
| Flow/spec doc | **600 lines** (module specs: **900 lines** max) | Split theo phase/section. Module specs phức tạp hơn flow docs. |
| Plugin file | **150 lines** | Nếu > 150L → plugin quá phức tạp → review lại design |

> **Rule:** File > 80% limit = trigger split trong PR. Reviewer từ chối merge nếu vượt.

---

## RULE 7 — Naming Conventions

```python
# Files & folders: snake_case
demand_service/routes.py        ✅
demandService/Routes.py         ❌

# Classes: PascalCase
class DemandSnapshot:           ✅
class demand_snapshot:          ❌

# Functions/variables: snake_case
def freeze_snapshot():          ✅
def FreezeSnapshot():           ❌

# Constants: UPPER_SNAKE_CASE
MAX_RETRY = 3                   ✅
maxRetry = 3                    ❌

# Kafka topics: scp.{tenant_id}.{service}.{event}
"scp.mdlz-uuid.demand.ingested"   ✅
"demand_ingested_mdlz"            ❌

# DB columns: snake_case
tenant_id, created_at, plan_run_id  ✅
tenantId, CreatedAt                 ❌

# API endpoints: /api/v1/{resource}/{action}
POST /api/v1/demand/snapshot     ✅
POST /api/v1/createDemandSnapshot ❌
```

---

## RULE 8 — Layered Architecture (No Bypass)

```
Request → Router → Service → Repository → DB
               ↓
           Kafka Producer
               ↓
           Cache (Redis)
```

| Layer | Được làm | Không được làm |
|---|---|---|
| `routes.py` | Validate input, call service, return response | Query DB trực tiếp, business logic |
| `service.py` | Business logic, orchestrate, call repo | HTTP request, raw SQL |
| `repository.py` | SQL queries, ORM operations | Business logic, Kafka |
| `kafka.py` | Publish events | Business logic, DB write |
| `plugins/` | Tenant behavior override | Direct DB access, Kafka |

```python
# ✅ ĐÚNG
# routes.py
@router.post("/demand/snapshot")
async def create_snapshot(data: SnapshotRequest, svc: DemandService = Depends()):
    return await svc.freeze_snapshot(data)

# service.py
async def freeze_snapshot(data: SnapshotRequest) -> SnapshotResponse:
    snapshot = await self.repo.create(data)
    await self.kafka.publish_ingested(snapshot)
    return SnapshotResponse.from_orm(snapshot)

# ❌ SAI — DB trong route
@router.post("/demand/snapshot")
async def create_snapshot(db: AsyncSession = Depends()):
    snapshot = await db.execute(...)  # FORBIDDEN in routes
```

---

## RULE 9 — Test-First Discipline

Viết test skeleton **TRƯỚC** khi implement. Không có test = không merge.

```python
# Bước 1: Viết test trước (fail là đúng)
# tests/unit/test_demand_service.py
async def test_freeze_snapshot_returns_frozen_status():
    # Arrange
    ...
    # Act
    result = await demand_service.freeze_snapshot(data)
    # Assert
    assert result.status == "FROZEN"
    assert result.snapshot_id is not None

# Bước 2: Implement cho test pass
# src/demand_service/service.py
async def freeze_snapshot(data) -> SnapshotResponse:
    ...  # implement here
```

**Coverage rules:**
- Unit test: ≥ 80% coverage mỗi module trước khi handoff sprint
- Contract test: 100% endpoints trong api-design.md phải có test
- Error code test: mỗi error code trong Supplement E có ≥ 1 test case
- Golden tests: PHẢI dùng seed CSV fixtures từ `phase0/data/seeds/` (conftest.py pattern — xem dev-guide-ml.md §7.1b). Không tự bịa test data riêng.

---

## RULE 10 — Error Handling Standard

Dùng error codes từ `Supplement E` (28 codes). **Không throw raw string.**

```python
# src/shared/errors/codes.py
class SCPError(Exception):
    def __init__(self, code: str, message: str, tenant_id: str = None):
        self.code = code      # e.g., "SCP-ERR-001"
        self.message = message
        self.tenant_id = tenant_id

# ✅ ĐÚNG
raise SCPError("SCP-ERR-012", "Snapshot already frozen", tenant_id=tenant_id)

# ❌ SAI
raise ValueError("snapshot is frozen")  # FORBIDDEN — không traceable

# FastAPI exception handler (trong shared/errors/)
@app.exception_handler(SCPError)
async def scp_error_handler(request, exc: SCPError):
    return JSONResponse(
        status_code=422,
        content={"error_code": exc.code, "message": exc.message}
    )
```

---

## RULE 11 — Idempotency Everywhere

Mọi write operation phải idempotent. Retry phải safe.

```python
# Kafka producer — luôn có idempotency_key
await producer.send(
    topic=f"scp.{tenant_id}.demand.ingested",
    value=payload,
    headers={"idempotency_key": f"{tenant_id}:{snapshot_id}:{timestamp}"}
)

# DB upsert — dùng ON CONFLICT DO NOTHING / DO UPDATE
await db.execute("""
    INSERT INTO demand_snapshot (id, tenant_id, ...)
    VALUES (:id, :tenant_id, ...)
    ON CONFLICT (id) DO NOTHING
""")

# Kafka consumer — check trước khi process
if await repo.already_processed(idempotency_key):
    return  # skip duplicate message
```

---

## RULE 12 — Multi-Tenant Safety

```python
# ✅ BẮT BUỘC — Set RLS context trước mọi DB operation
async def get_db(tenant_id: str = Depends(extract_tenant)):
    async with AsyncSession() as session:
        await session.execute(
            text("SET LOCAL app.tenant_id = :tid"), {"tid": tenant_id}
        )
        yield session

# ✅ Mọi Kafka topic = có tenant_id trong topic name
topic = f"scp.{tenant_id}.demand.ingested"   ✅
topic = "scp.demand.ingested"                 ❌ (không tách tenant)

# ✅ Mọi log phải có tenant_id + trace_id
logger.info("snapshot_frozen", extra={
    "tenant_id": tenant_id,
    "trace_id": request.headers.get("X-Trace-ID"),
    "snapshot_id": snapshot_id
})
```

---

## RULE 13 — No Cross-Module Import

Modules communicate qua **Kafka**, không qua direct Python import.

```python
# ✅ ĐÚNG — DRP Netting consume từ Kafka
# src/drp_engine/kafka.py
async def on_supply_ready(message):
    snapshot_id = message["snapshot_id"]
    await drp_service.trigger_netting(snapshot_id)

# ❌ SAI — DRP import Supply Service trực tiếp
# src/drp_engine/service.py
from supply_service.service import get_snapshot  # FORBIDDEN
```

**Exception:** `src/shared/` được import bởi mọi module. Đây là utility layer, không phải domain module.

---

## RULE 14 — Configuration Externalization

Không hardcode giá trị magic. Mọi config = env var hoặc constants file.

```python
# ✅ ĐÚNG
# src/shared/config.py
KAFKA_BROKER = os.getenv("KAFKA_BROKER", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# src/allocation_engine/constants.py
MAX_RETRY_OPTIMISTIC_LOCK = 3
LCNB_MODE = "DETECT_ONLY"  # Phase 1 — never change to EXECUTE without Gate C

# ❌ SAI
redis_client = Redis(host="10.0.1.5", port=6379)  # hardcoded IP = FORBIDDEN
if retry_count > 3:  # magic number = FORBIDDEN
```

---

## RULE 15 — Structured Logging

```python
# src/shared/logging/logger.py
import structlog

log = structlog.get_logger()

# Mọi log entry phải có: tenant_id, trace_id, module, event
log.info("allocation_started",
    tenant_id=tenant_id,
    trace_id=trace_id,
    module="allocation_engine",
    demand_lines=len(lines),
    lot_count=len(lots)
)

# Log levels:
# DEBUG: algorithm step detail (dev only)
# INFO:  business event (snapshot frozen, order posted)
# WARNING: soft failure (retry attempt, fallback activated)
# ERROR: hard failure (ERP timeout, saga aborted)
# CRITICAL: data integrity issue (RLS breach attempt, duplicate posting)
```

---

## Summary Checklist — PR Review Gate

Trước khi submit PR, check:

```
Code quality:
  [ ] File < 500 lines (code), < 200 lines (routes), < 400 lines (tests)
  [ ] 1 file = 1 responsibility (routes / service / repo / kafka / plugin)
  [ ] Không cross-module import (chỉ shared/)
  [ ] Tenant logic trong plugin, không trong core

Multi-tenant safety:
  [ ] RLS SET LOCAL trong mọi DB session
  [ ] Kafka topic = scp.{tenant_id}.{service}.{event}
  [ ] Structured log có tenant_id + trace_id

Error & test:
  [ ] Error codes từ Supplement E (không raw string)
  [ ] Test coverage ≥ 80% (unit)
  [ ] Test skeleton viết trước implementation

Docs:
  [ ] docs/modules/{module}/REPORT.md updated
  [ ] Constants không hardcode giá trị magic
  [ ] Idempotency key cho mọi write operation
```

---

## RULE 16 — Frontend Coding Standards (R-FE + R-UX)

> **UX Reference:** `Smartlog_UX_Design_Implementation_Guidelines_vNext.md` — 12 principles, pattern rules, PR gates.
> R-FE + R-UX PHẢI đọc file này trước khi design/code bất kỳ workbench nào.

### 16.1 Project Structure (Next.js 14 App Router)

```
src/frontend/
├── app/                        ← Next.js App Router pages
│   ├── (auth)/                 ← layout group: login, auth callback
│   ├── (dashboard)/            ← layout group: sidebar + top nav
│   │   ├── planner/            ← Planner Workbench (P1-P3 screens)
│   │   ├── buyer/              ← Buyer Workbench (B1-B3)
│   │   ├── supplier/           ← Supplier Portal (S1-S2)
│   │   ├── admin/              ← Admin Hub (A1-A3)
│   │   ├── executive/          ← Executive Cockpit (E1)
│   │   └── control-tower/      ← Control Tower (CT1)
│   └── api/                    ← Next.js API routes (BFF if needed)
├── components/
│   ├── shared/                 ← cross-workbench components
│   │   ├── ExceptionBadge.tsx
│   │   ├── FreshnessIndicator.tsx
│   │   ├── ShapExplanation.tsx
│   │   ├── MobileApprovalCard.tsx
│   │   ├── RBACGate.tsx        ← role-based show/hide
│   │   ├── MaskedField.tsx     ← field-level masking (UNIS CN)
│   │   ├── MultiUOMDisplay.tsx ← box/pallet/ton/m² toggle
│   │   ├── FeatureGate.tsx     ← feature toggle check
│   │   └── PolicyFormGroup.tsx ← progressive disclosure
│   └── {workbench}/            ← workbench-specific components
├── hooks/
│   ├── useSSE.ts               ← Server-Sent Events subscription
│   ├── useTenant.ts            ← tenant context from JWT
│   └── useRBAC.ts              ← permission checks
├── stores/                     ← Zustand stores
│   ├── authStore.ts
│   ├── tenantStore.ts
│   └── sseStore.ts
├── lib/
│   ├── api-client.ts           ← typed fetch wrapper (from api-design.md)
│   └── tenant-ui-config.ts    ← tenant-specific UI config (Rule 16.3)
└── types/                      ← shared TypeScript types
```

### 16.2 Component Rules

```tsx
// ✅ ĐÚNG — 1 component = 1 file = 1 responsibility
// components/shared/ExceptionBadge.tsx
export function ExceptionBadge({ severity, count }: ExceptionBadgeProps) {
  // max 100 lines per component file
}

// ❌ SAI — multiple components in 1 file
// components/Dashboard.tsx
export function ExceptionBadge() { ... }
export function KPICard() { ... }        // SPLIT into separate files
export function AllocationTable() { ... } // SPLIT
```

**Size limits (FE):**

| File type | Max lines | Split strategy |
|---|---|---|
| Component `.tsx` | **200 lines** | Extract hooks, split sub-components |
| Page `.tsx` | **300 lines** | Extract sections into components |
| Hook `.ts` | **150 lines** | Split by concern |
| Store `.ts` | **200 lines** | Split by domain slice |
| API client functions | **100 lines per function** | Split per service |

### 16.3 Tenant-Aware UI (Plugin Pattern — Frontend)

```typescript
// src/frontend/lib/tenant-ui-config.ts
// ✅ ĐÚNG — config-driven tenant UI, NO if/else in components

interface TenantUIConfig {
  fefo: { showExpiryColumn: boolean; mandatory: boolean };
  lcnb: { showToggle: boolean; locked: boolean; tooltip?: string };
  uom: { displayUnits: string[] };  // ["box", "pallet", "ton"]
  masking: { hideCost: boolean; hideOrigin: boolean };
  columns: { allocationTable: string[] };  // visible columns per tenant
}

const TENANT_CONFIGS: Record<string, TenantUIConfig> = {
  "mdlz": {
    fefo: { showExpiryColumn: true, mandatory: true },
    lcnb: { showToggle: false, locked: true },
    uom: { displayUnits: ["box", "pallet"] },
    masking: { hideCost: false, hideOrigin: false },
    columns: { allocationTable: ["item", "lot", "expiry", "qty", "source", "cost"] },
  },
  "unis": {
    fefo: { showExpiryColumn: false, mandatory: false },
    lcnb: { showToggle: true, locked: true, tooltip: "Requires Gate C sign-off" },
    uom: { displayUnits: ["box", "m²", "ton"] },
    masking: { hideCost: true, hideOrigin: true },  // CN role
    columns: { allocationTable: ["item", "variant", "qty", "branch"] },
  },
  // ... TTC config
};

// ❌ SAI — hardcode tenant check in component
function AllocationTable({ tenantId }) {
  if (tenantId === "mdlz") showExpiry = true;   // FORBIDDEN
  if (tenantId === "unis") hideCost = true;      // FORBIDDEN — use config
}
```

### 16.4 UX Principles Enforcement (from Smartlog UX Guidelines)

| Principle | Rule | Enforcement |
|---|---|---|
| **Exception-first** | Default view = only items needing attention | PR blocker: landing page shows "all items" by default |
| **One-screen ops** | Core task ≤ 3 clicks on single workbench | PR blocker: task requires 10+ steps across screens |
| **Progressive disclosure** | Advanced settings collapsed by default | PR blocker: all 22 policy fields visible at once |
| **AI explainability** | Every recommendation shows SHAP top 3 factors | PR blocker: recommendation without rationale |
| **Reversibility** | Every destructive action has undo/rollback | PR blocker: approve button without confirmation |

### 16.5 AI Recommendation Card (mandatory anatomy)

```tsx
// Per UX Guidelines §5.4 — minimum 7 fields
<RecommendationCard
  recommendation="Allocate 500 units from WH-BKD1"
  rationale="FEFO: lot L7 expires in 15 days, threshold 75%"
  evidence={<ShapExplanation factors={top3} />}
  riskLevel="MEDIUM"
  actions={["Approve", "Adjust", "Reject"]}
  recovery="Undo within 5 min (reservation TTL)"
  freshness="Data: 2 min ago | Model: v3.2.1"
/>

// ❌ SAI — recommendation without rationale
<Button onClick={approve}>Approve</Button>  // WHERE IS THE "WHY"?
```

### 16.6 SSE Real-Time Pattern

```typescript
// hooks/useSSE.ts — Server-Sent Events (NOT WebSocket per ADR-v3-006)
function useSSE(eventTypes: string[]) {
  useEffect(() => {
    const source = new EventSource(`/api/v1/monitor/events`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (eventTypes.includes(data.type)) {
        sseStore.getState().handleEvent(data);
      }
    };
    return () => source.close();
  }, [eventTypes]);
}

// Usage in Planner Workbench:
useSSE(["PLAN_STATUS", "ALERT", "ALLOCATION_COMPLETE"]);
```

### 16.7 RBAC + Field Masking

```tsx
// components/shared/RBACGate.tsx
function RBACGate({ required, children }: { required: Permission; children: ReactNode }) {
  const { permissions } = useRBAC();
  if (!permissions.includes(required)) return null;  // server-side ALSO enforces
  return <>{children}</>;
}

// components/shared/MaskedField.tsx — UNIS CN cannot see cost
function MaskedField({ value, masked }: { value: any; masked: boolean }) {
  if (masked) return <span className="text-muted">•••</span>;
  return <span>{value}</span>;
}

// ❌ SAI — FE-only masking without server enforcement
// Server MUST also omit masked fields from API response (defense in depth)
```

### 16.8 Accessibility (WCAG 2.2 AA)

Per UX Guidelines §4.10:
- Touch targets: minimum 44×44px
- Tablet support: ≥ 768px
- Vietnamese diacritics: search must handle có/không dấu
- Color: never sole indicator (always icon + text + color)
- Keyboard: all actions reachable via keyboard
- Offline: approval queue works offline, sync when online

---

## RULE 17 — Frontend Test Standards

```typescript
// tests/frontend/
// ├── components/     ← React Testing Library
// ├── hooks/          ← renderHook tests
// ├── e2e/            ← Playwright per user journey
// └── a11y/           ← axe-core accessibility tests

// Component test example:
import { render, screen } from '@testing-library/react';
test('ExceptionBadge shows correct severity', () => {
  render(<ExceptionBadge severity="RED" count={5} />);
  expect(screen.getByText('5')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveClass('badge-red');
});

// E2E: 1 test per user journey (from user-flow.md)
// tests/frontend/e2e/planner-journey.spec.ts
// tests/frontend/e2e/buyer-journey.spec.ts
// tests/frontend/e2e/supplier-journey.spec.ts
// tests/frontend/e2e/admin-journey.spec.ts
// tests/frontend/e2e/cn-mobile-journey.spec.ts  ← masking test

// Accessibility: axe-core scan per page
test('Planner dashboard passes a11y', async () => {
  const { container } = render(<PlannerDashboard />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

---

## RULE 18 — Raw SQL tenant_id Handling

Khi viết raw SQL (sqlalchemy `text()`), tenant_id phải xử lý đúng type:

```python
# ✅ ĐÚNG — WHERE clause: CAST to UUID
query = text("SELECT * FROM item WHERE tenant_id = CAST(:tid AS uuid)")
await db.execute(query, {"tid": tenant_id})

# ✅ ĐÚNG — SET LOCAL: NO CAST (GUC accepts string)
await db.execute(text("SET LOCAL app.tenant_id = :tid"), {"tid": tenant_id})

# ❌ SAI — WHERE without CAST (string vs UUID mismatch)
query = text("SELECT * FROM item WHERE tenant_id = :tid")  # FAILS on PostgreSQL

# ❌ SAI — SET LOCAL with CAST (unnecessary, can cause issues)
await db.execute(text("SET LOCAL app.tenant_id = CAST(:tid AS uuid)"), {"tid": tenant_id})

# ✅ ORM queries: SQLAlchemy auto-handles UUID mapping
stmt = select(Item).where(Item.tenant_id == tenant_id)  # Works correctly
```

**Summary:**

| Context | Pattern | Cast? |
|---|---|---|
| `WHERE tenant_id = ...` (raw SQL) | `CAST(:tid AS uuid)` | ✅ YES |
| `SET LOCAL app.tenant_id = ...` | `:tid` (plain) | ❌ NO |
| ORM `where()` clause | Auto-handled by SQLAlchemy | N/A |
| `INSERT` tenant_id | Auto-handled by pandas/ORM | N/A |

> **Why:** PostgreSQL UUID columns require explicit cast when comparing with string bind params.
> SET LOCAL sets a GUC variable (text type), so no cast needed.

---

## Summary Checklist — PR Review Gate

Trước khi submit PR, check:

```
Code quality (Backend):
  [ ] File < 500 lines (code), < 200 lines (routes), < 400 lines (tests)
  [ ] 1 file = 1 responsibility (routes / service / repo / kafka / plugin)
  [ ] Không cross-module import (chỉ shared/)
  [ ] Tenant logic trong plugin, không trong core

Code quality (Frontend):
  [ ] Component < 200 lines, Page < 300 lines, Hook < 150 lines
  [ ] Tenant UI via TenantUIConfig — NO if/else tenant check in components
  [ ] RBAC + MaskedField: server-side primary, FE secondary (defense in depth)
  [ ] AI recommendation card: 7 mandatory fields (rationale, evidence, actions, recovery)
  [ ] Exception-first default view (NOT "show all items" landing)
  [ ] SSE pattern (NOT WebSocket) per ADR-v3-006
  [ ] Accessibility: axe-core pass, 44px touch targets, keyboard navigable

Multi-tenant safety:
  [ ] RLS SET LOCAL trong mọi DB session
  [ ] Kafka topic = scp.{tenant_id}.{service}.{event}
  [ ] Structured log có tenant_id + trace_id

Error & test:
  [ ] Error codes từ Supplement E (không raw string)
  [ ] Test coverage ≥ 80% (unit), golden tests dùng seed CSV fixtures
  [ ] Test skeleton viết trước implementation

Docs:
  [ ] docs/modules/{module}/REPORT.md updated (endpoints X/Y, plugin coverage, Kafka topics)
  [ ] Constants không hardcode giá trị magic
  [ ] Idempotency key cho mọi write operation
```

---

*CODING-RULES.md — PRJ-SCP-001 | v1.2 | 2026-04-11*
*Đọc cùng với: `.agent/R-XX-xxx.md` + `flows/module-specs/{module}.md`*
*FE + UX reference: `Smartlog_UX_Design_Implementation_Guidelines_vNext.md` (12 principles)*
