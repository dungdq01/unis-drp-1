# UNIS Module Specs — BA Documentation

**Tenant:** UNIS Group (Vật liệu xây dựng — gạch men, gạch ốp lát)
**Purpose:** Mô tả chi tiết 8 module theo ngôn ngữ BA, dùng cho dev team xây hệ thống mới cho UNIS
**Reference:** UNIS-TERRAX-MAPPING.md, business-rules.md, UNIS_Safety_Stock_Analysis.md

---

## 8-Step Pipeline Overview

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Step 1      │───→│  Step 2      │───→│  Step 3      │───→│  Step 4      │
│  DEMAND      │    │  SUPPLY      │    │  POLICY      │    │  DRP         │
│  Forecast    │    │  Inventory   │    │  SS + RTM    │    │  Netting     │
│  Import      │    │  Snapshot    │    │  + ABC       │    │  PAB calc    │
└─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘
                                                                │
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────▼──────┐
│  Step 8      │←───│  Step 7      │←───│  Step 6      │←───│  Step 5      │
│  MONITOR     │    │  EXECUTION   │    │  TRANSPORT   │    │  ALLOCATION  │
│  KPI + Drift │    │  Bravo ERP   │    │  Bin-pack    │    │  6-Layer     │
│  + Loop      │    │  CN Approval │    │  + Carrier   │    │  Matching    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

## Module Specs

| # | Module | File | Mô tả ngắn |
|---|---|---|---|
| 1 | [Demand Ingestion](01-demand-ingestion.md) | Step 1 | Import forecast từ CSV/Excel, freeze snapshot |
| 2 | [Supply Snapshot](02-supply-snapshot.md) | Step 2 | Chụp tồn kho NM + CN, phân loại bucket |
| 3 | [Inventory Policy](03-inventory-policy.md) | Step 3 | Safety Stock, ABC, RTM rules, planning config |
| 4 | [DRP Netting](04-drp-netting.md) | Step 4 | Tính PAB, net requirements, planned orders |
| 5 | [Allocation Engine](05-allocation-engine.md) | Step 5 | 6-layer matching: RTM → Variant → FEFO → ABC → SS → LCNB |
| 6 | [Transport Planning](06-transport-planning.md) | Step 6 | Bin-pack xe, chọn carrier, tính cost |
| 7 | [Execution Bridge](07-execution-bridge.md) | Step 7 | Tạo đơn, CN duyệt, đẩy Bravo ERP |
| 8 | [Monitor & Learn](08-monitor-learn.md) | Step 8 | KPI, drift, alerts, closed-loop |

## Cross-Module Data Flow

```
Step 1 OUTPUT: demand_snapshot (FROZEN) + demand_snapshot_line
  ↓ feeds Step 4 (gross requirements)
  ↓ feeds Step 8 (forecast accuracy tracking)

Step 2 OUTPUT: supply_snapshot (FROZEN) + supply_snapshot_line + lot_attribute
  ↓ feeds Step 4 (beginning inventory)
  ↓ feeds Step 5 (available lots for allocation)

Step 3 OUTPUT: item_classification (ABC) + safety_stock targets + rtm_rule
  ↓ feeds Step 4 (SS in netting formula)
  ↓ feeds Step 5 (RTM routing + ABC priority + SS guard)

Step 4 OUTPUT: plan_run + planned_order_release
  ↓ feeds Step 5 (demand lines to allocate)

Step 5 OUTPUT: allocation_run + allocation_result + recommendation
  ↓ feeds Step 6 (items to transport)
  ↓ feeds Step 7 (items to order)

Step 6 OUTPUT: transport_plan + transport_plan_trip
  ↓ feeds Step 7 (trips become draft orders)

Step 7 OUTPUT: draft_order + draft_order_line + erp_posting_log
  ↓ feeds Step 8 (order lifecycle tracking)

Step 8 OUTPUT: kpi_link + alerts + drift_detection
  ↓ feeds Step 3 (FC→SS closed loop: MAPE improve → SS reduce)
  ↓ feeds Step 1 (drift alert → planner re-forecast)
```

## UNIS-Specific Context

| Dimension | UNIS Value | Impact |
|---|---|---|
| Sản phẩm | Gạch men, gạch ốp lát, bột trét | Không hết hạn (FEFO=OFF), có đuôi màu (variant) |
| Network | 68 CN + 19 kho + 56 nhà máy | Multi-echelon, LCNB giữa CN |
| ERP | Bravo (SFTP batch CSV) | Không có API real-time |
| Approval | CN bắt buộc duyệt mọi đơn | post_approval_edit = cho phép re-approve |
| Forecast | Team thuật toán cung cấp (84K rows) | Không dùng external Forecast API |
| Lead time | NM 3-7 ngày, Hub→CN 1-3 ngày | Biến thiên theo NM |
| Demand | Mùa xây dựng (Oct-Apr), dự án lẻ | Seasonal + lumpy |
| KPI chính | HSTK (Ngày tồn kho), Fill Rate ≥92%, OTIF ≥90% | |

---

*Created: 2026-04-13 | BA + PM + TechLead*
