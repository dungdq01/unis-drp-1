# UNIS SCP Frontend — Baseline UI Report

**Project:** Supply Chain Planning System — UNIS Group  
**Status:** ✅ Baseline Complete  
**Date:** 2026-04-13  
**Dev Server:** `http://localhost:3001` (`npm run dev`)

---

## Tóm tắt

Đây là baseline UI cho hệ thống SCP (Supply Chain Planning) của UNIS Group — gồm toàn bộ 8 module theo pipeline 8-step. Giao diện được xây dựng theo chuẩn Smartlog UX Design Implementation Guidelines vNext với dark theme chuyên nghiệp, scientific.

---

## Tech Stack

| Layer | Công nghệ | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 14.2.3 |
| UI Library | React | 18.3.1 |
| Styling | Tailwind CSS | 3.4.3 |
| Components | shadcn/ui pattern (custom) | — |
| Icons | Lucide React | 0.378.0 |
| Class utility | clsx + tailwind-merge | 2.1.1 / 2.3.0 |
| Language | TypeScript | 5.4.5 |

---

## Cấu trúc thư mục

```
unis/frontend/
│
├── package.json                  ← Dependencies + scripts (port 3001)
├── next.config.mjs               ← Next.js config
├── tailwind.config.ts            ← Custom color palette (sl.*)
├── tsconfig.json                 ← TypeScript strict config
├── postcss.config.mjs            ← PostCSS (Tailwind + autoprefixer)
│
├── app/
│   ├── globals.css               ← Base styles, semantic tokens, scrollbar
│   ├── layout.tsx                ← Root layout (Sidebar + PipelineBar + main)
│   ├── page.tsx                  ← Exception Dashboard (COCKPIT home)
│   │
│   ├── demand/page.tsx           ← Step 01: Demand Ingestion
│   ├── supply/page.tsx           ← Step 02: Supply Snapshot
│   ├── policy/page.tsx           ← Step 03: Inventory & Policy
│   ├── drp/page.tsx              ← Step 04: DRP Netting
│   ├── allocation/page.tsx       ← Step 05: Allocation Engine
│   ├── transport/page.tsx        ← Step 06: Transport Planning
│   ├── execution/page.tsx        ← Step 07: Order Bridge (Execution)
│   ├── monitor/page.tsx          ← Step 08: Monitor & Learn
│   ├── plan-actual/page.tsx      ← Plan vs Actual
│   └── config/page.tsx           ← Policy Platform / Config
│
├── components/
│   ├── sidebar.tsx               ← Sidebar navigation (5 groups)
│   ├── pipeline-bar.tsx          ← 8-step pipeline progress bar
│   ├── module-shell.tsx          ← Module placeholder layout (reusable)
│   └── ui/
│       ├── badge.tsx             ← Badge component (shadcn pattern)
│       ├── card.tsx              ← Card components (shadcn pattern)
│       └── separator.tsx         ← Separator component
│
└── lib/
    └── utils.ts                  ← cn() utility (clsx + twMerge)
```

---

## Design System

### Color Palette (`sl.*` tokens)

| Token | Hex | Usage |
|-------|-----|-------|
| `sl-bg` | `#080c14` | App background (deepest) |
| `sl-sidebar` | `#0b1020` | Sidebar background |
| `sl-card` | `#0f1728` | Card / panel background |
| `sl-elevated` | `#141e30` | Elevated surfaces, icon boxes |
| `sl-border` | `#1e2e48` | Default border |
| `sl-border-hi` | `#243660` | Hover / active border |
| `sl-green` | `#16a34a` | Primary accent (logo, active) |
| `sl-green-l` | `#22c55e` | Green light (completed steps, metrics) |
| `sl-green-dim` | `#0d2e1a` | Green tinted background |
| `sl-text` | `#e4eaf5` | Primary text |
| `sl-text-2` | `#8b97ad` | Secondary text |
| `sl-text-3` | `#4a5568` | Muted / section headers |
| `sl-amber` | `#f59e0b` | Warning / active step |
| `sl-amber-dim` | `#2e1f06` | Amber tinted background |
| `sl-red` | `#ef4444` | Error / exception badge |
| `sl-red-dim` | `#2e0a0a` | Red tinted background |
| `sl-blue` | `#3b82f6` | Info |
| `sl-blue-dim` | `#0c1e40` | Blue tinted background |

### Semantic Status Classes

```css
.status-success  → color: #22c55e
.status-warning  → color: #f59e0b
.status-error    → color: #ef4444
.status-info     → color: #3b82f6
.status-blocked  → color: #4a5568
.status-neutral  → color: #8b97ad
```

---

## Components chính

### 1. `Sidebar` — Navigation

**Cấu trúc 5 groups:**

| Group | Items |
|-------|-------|
| **COCKPIT** | Exception Dashboard (badge: 7 red) |
| **PLANNING** | 01 Demand, 02 Supply, 03 Inventory & Policy, 04 DRP Netting, 05 Allocation (badge: 3 amber) |
| **EXECUTION** | 06 Transport, 07 Order Bridge (badge: 12 amber) |
| **MONITOR** | 08 Monitor & Learn, Plan vs Actual |
| **CONFIG** | Policy Platform |

**Features:**
- Active state: green left bar + green-tinted background + green icon
- Hover state: subtle background lift
- Step number badge (monospace) trong icon box cho PLANNING/EXECUTION/MONITOR items
- Badge counts (red/amber/green) với colored background

### 2. `PipelineBar` — 8-step Progress

**Step states:**

| Step | Name | Status | Subtext |
|------|------|--------|---------|
| 1 | Demand | ✅ COMPLETED | Synced |
| 2 | Supply | ✅ COMPLETED | 4-bucket |
| 3 | Inventory | ✅ COMPLETED | SS+ABC |
| 4 | DRP | ✅ COMPLETED | 4,218 |
| 5 | Alloc | ⚡ ACTIVE | 3 exc |
| 6 | Transport | ⬜ PENDING | — |
| 7 | Execution | ⬜ PENDING | 12 draft |
| 8 | Monitor | ⬜ PENDING | — |

**Features:**
- Completed: green circle + checkmark
- Active: amber pulsing circle + amber text
- Pending: gray circle + number
- SVG arrow connectors (green khi completed, gray khi pending)
- Progress bar `4/8` (50%) linear gradient green
- Right: "4/8 · Alloc running · Run #247"

### 3. `ModuleShell` — Module Placeholder

Reusable component cho tất cả module pages, nhận props:
- `step`: "01"–"08"
- `name`, `subtitle`, `description`
- `status`: `draft | in_progress | ready | active`
- `docRef`: e.g., "SCP-UNIS-01"
- `version`: e.g., "v1.0"
- `metrics[]`: array `{ label, value, status }` — hiện 4 KPI cards
- `owner`: team owner

---

## Pages

| Route | Page | Step | Status |
|-------|------|------|--------|
| `/` | Exception Dashboard | COCKPIT | ✅ |
| `/demand` | Demand Ingestion | 01 | READY |
| `/supply` | Supply Snapshot | 02 | READY |
| `/policy` | Inventory & Policy | 03 | READY |
| `/drp` | DRP Netting | 04 | READY |
| `/allocation` | Allocation Engine | 05 | ACTIVE |
| `/transport` | Transport Planning | 06 | DRAFT |
| `/execution` | Order Bridge | 07 | DRAFT |
| `/monitor` | Monitor & Learn | 08 | DRAFT |
| `/plan-actual` | Plan vs Actual | — | DRAFT |
| `/config` | Policy Platform | — | DRAFT |

---

## Exception Dashboard (`/`)

Home page hiện thị:
1. **Header** — "Exception Dashboard" + count 7 exceptions
2. **KPI strip** — 4 cards: Fill Rate, HSTK, OTIF, MAPE (placeholder dashes)
3. **8-Step Pipeline Status grid** — 8 cards, mỗi card: step số, tên, sub-label, status badge, exception badge
4. **System Health** — 4 items: Bravo ERP Sync, Freshness Gate, PlanningCycle, Last DRP Run

---

## Smartlog UX Compliance

| Principle | Áp dụng |
|-----------|---------|
| **P1 Workflow-first nav** | Sidebar theo workflow pipeline (không theo database entity) |
| **P3 Exception-first** | Dashboard default hiện exceptions trước, KPI sau |
| **P6 Visual-first state** | Mọi status = màu + icon + text label |
| **P10 Accessibility** | Semantic HTML, WCAG-compatible contrast, scroll 4px |
| **P12 One language** | Semantic tokens `sl.*` nhất quán xuyên ecosystem |
| **No hardcode colors** | Tất cả màu qua Tailwind tokens hoặc CSS utilities |

---

## Chạy dự án

```bash
# Install dependencies (lần đầu)
cd unis/frontend
npm install

# Start dev server (port 3001)
npm run dev

# Build production
npm run build
```

**Dev server:** `http://localhost:3001`

---

## Các bước đã thực hiện

1. ✅ **Khởi tạo project** — `package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`
2. ✅ **Tailwind config** — Custom color palette `sl.*`, keyframes, animations
3. ✅ **Global CSS** — Base styles, semantic token utilities, scrollbar
4. ✅ **lib/utils.ts** — `cn()` utility
5. ✅ **UI components** — `badge.tsx`, `card.tsx`, `separator.tsx` (shadcn pattern)
6. ✅ **Sidebar** — 5 groups, active state, badges, step numbers
7. ✅ **PipelineBar** — 8-step horizontal pipeline, progress bar, SVG connectors
8. ✅ **ModuleShell** — Reusable module placeholder với metrics + content area
9. ✅ **Root layout** — Sidebar + PipelineBar + scrollable main
10. ✅ **Exception Dashboard** — Home page với KPI + module grid + system health
11. ✅ **10 module pages** — demand, supply, policy, drp, allocation, transport, execution, monitor, plan-actual, config
12. ✅ **npm install + dev server** — Running at `http://localhost:3001`

---

## Next Steps (Content Phase)

Baseline hoàn tất. Các bước tiếp theo để điền content thực:

- [ ] **Step 01 Demand:** Upload CSV UI, Forecast matrix table, snapshot list
- [ ] **Step 02 Supply:** Bravo sync status, inventory matrix, freshness widget
- [ ] **Step 03 Policy:** SS table per item × location, RTM rules view, ABC chart
- [ ] **Step 04 DRP:** PAB timeline chart, planned orders table, 12-week horizon
- [ ] **Step 05 Allocation:** 6-layer trace view, LCNB recommendations panel, shortfall list
- [ ] **Step 06 Transport:** Trip list, vehicle bin-pack view, carrier selection
- [ ] **Step 07 Execution:** CN approval queue, order detail + edit, ERP posting log
- [ ] **Step 08 Monitor:** KPI cards live, drift alerts, closed-loop feedback panel
- [ ] **Global:** Real API integration (replace `—` placeholders with live data)

---

*REPORT.md — Generated 2026-04-13 | UNIS SCP Frontend Baseline v1.0*
