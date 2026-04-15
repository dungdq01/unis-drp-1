# UNIS UAT Roadmap — Go-Live Preparation

**Tenant:** UNIS (`00000000-0000-0000-0000-000000000003`)  
**ERP:** Bravo (SFTP batch CSV)  
**Approval model:** CN branch — ALL orders require CN approval, no auto-pass  
**Created:** 2026-04-11  
**Owner:** R-D06 (Logistics Domain Expert) + R-SE + FE1  
**Status:** 🟢 Ready for UAT

---

## Pre-conditions Checklist

| # | Item | Owner | Status |
|---|---|---|---|
| P1 | UNIS master data loaded (items, locations, suppliers) | R-DE | 🟡 Data received — import pending |
| P2 | UNIS tenant UUID registered in DB | BE1 | ✅ `00000000-0000-0000-0000-000000000003` |
| P3 | `.env` SFTP vars set (`SCP_BRAVO_SFTP_*`) | DevOps | ✅ Set in `.env` |
| P4 | `SCP_ENV=uat` in `.env` (disables sandbox mode) | DevOps | ✅ Set |
| P5 | UNIS RTM rules loaded (customer → source location mapping) | R-D06 | 🔴 Pending |
| P6 | UNIS ABC classifications loaded (A/B/C per SKU) | R-D06 | 🔴 Pending |
| P7 | UNIS plugin registered: `UNISPlugin` → tenant `UNIS` | BE1 | ✅ `plugin_loader.py` |
| P8 | `SCP_JWT_SECRET` ≠ default value | DevOps | ✅ Validated at startup |
| P9 | SFTP smoke test to Bravo server (connect + write test file) | BE1 | 🔴 Pending |
| P10 | CN approver account created in system (role=CN_WH) | Admin | 🔴 Pending |
| P11 | URGENT-2 (N+1 batch loading) fixed before load test | BE1+BE2 | ✅ Done |
| P12 | URGENT-3 (rate limiter wired) on supplier endpoint | BE1 | ✅ Done |
| P13 | URGENT-4 (AllocationResultsTable virtualized) | FE1 | ✅ Done |
| P14 | BUG-1 (SFTP trigger) fixed | BE1 | ✅ `_trigger_bravo_batch_export()` |
| P15 | BUG-2 (actor audit) fixed | BE1 | ✅ `get_current_user()` |
| P16 | BUG-3 (post-approval edit guard) fixed | BE1 | ✅ `edit_order()` guard |
| P17 | LIFECYCLE_TRANSITIONS fixed (STATUS_STAGED→POSTED) | BE1 | ✅ Done |

> ⛔ **Gate:** P1–P10 must ALL be ✅ before UAT Day 1 begins.  
> P11–P17 đã ✅ (code fixes complete).

---

## UNIS-Specific Constraints (vs MDLZ)

| Dimension | MDLZ | UNIS |
|---|---|---|
| ERP | SAP/Oracle | **Bravo (SFTP CSV)** |
| Approval | Auto-pass configurable | **CN approval — ALL orders, no exception** |
| Post-approval edit | Allowed | **STRICT — forbidden** |
| Lot sizing | FOQ, 13-week horizon | L4L (Lot-for-Lot), 12-week horizon |
| BOM explosion | Enabled | **Disabled** (building materials) |
| ABC weights | A:3/B:1.5/C:1 | A:2.0/B:1.5/C:1.0 (only A overridden, B/C inherit base defaults) |
| FEFO policy | Enabled | **Disabled** (no expiry) |
| Specs matching | Standard | **VARIANT** (color/size) |
| WMS sync | Real-time | **BATCH** (240min freshness) |
| Transport consolidation | Enabled | **Disabled** (per-project delivery) |

---

## UAT Timeline — 2 Weeks

```
W21 (Prep Week)
  Day 1-2: Data load (P1, P5, P6) + infrastructure smoke test (P9)
  Day 3:   CN approver setup (P10)
  Day 4:   Internal dry run (R-D06 + BE1 run TC-01 to TC-05 solo)
  Day 5:   Fix issues from dry run

W22 (UAT Week — UNIS team present)
  Day 1:   TC-01 + TC-02 (Demand freeze → DRP → Allocation)
  Day 2:   TC-03 + TC-04 (CN Approval workflow + Bravo SFTP E2E)
  Day 3:   TC-05 (Load test — real UNIS data volume)
  Day 4:   Bug fix buffer
  Day 5:   Sign-off meeting + UAT report
```

---

## Test Cases

### TC-01: Demand Freeze → DRP → PAB Chart

| Step | Action | Expected | UNIS-specific check |
|---|---|---|---|
| 1 | `POST /api/v1/demand/snapshot` | 200 snapshot_id | UNIS tenant_id in header |
| 2 | `POST /api/v1/demand/snapshot/{id}/freeze` | status=FROZEN | — |
| 3 | DRP auto-triggers | Kafka event fires `drp.{unis_tid}.run.requested` | — |
| 4 | UNIS DRP plugin applied | `lot_sizing=L4L`, `horizon=12`, `bom_explosion=false` | Verify plugin loads UNISPlugin |
| 5 | Supply lines filtered | `bucket=ALLOCATABLE` only in PAB calc | Bug fix verified |
| 6 | DRP netting result | PAB per item per period | — |
| 7 | PAB chart data | Chart renders with UNIS items | — |

**AC:** DRP completes without error. PAB chart visible with UNIS items. No NEGATIVE_PAB exceptions due to wrong supply bucket.

---

### TC-02: Allocation Run → CN Approval Required

| Step | Action | Expected | UNIS-specific check |
|---|---|---|---|
| 1 | `POST /api/v1/allocation/run` | run_id returned | — |
| 2 | Allocation results | ALLOCATED / PARTIAL / EXCEPTION | — |
| 3 | Orders generated | status = `DRAFT` | — |
| 4 | CN approval check | `requires_approval("TRANSFER") = True` | **ALL order types require CN** |
| 5 | Order NOT auto-posted | status stays `DRAFT` until CN acts | No auto-pass bypass |
| 6 | SHAP explanation | `GET /api/v1/copilot/explain/{order_id}` returns 6 layers | — |

**AC:** No order reaches `POSTING` without CN approval.

---

### TC-03: CN Approval Workflow

| Step | Action | Expected | UNIS-specific check |
|---|---|---|---|
| 1 | CN user logs in (role=CN_WH) | 200 JWT with role=CN_WH | — |
| 2 | `GET /api/v1/orders/drafts?status=DRAFT` | Returns UNIS draft orders | RLS: only UNIS tenant data |
| 3 | CN reviews order | Lifecycle stepper shows `DRAFT → CN_REVIEW → APPROVED` | — |
| 4 | CN_WH approves | `POST /api/v1/orders/{order_id}/approve` | Actor = CN_WH user_id (not tenant_id) |
| 5 | Order status → `APPROVED` | `APPROVED` persisted | Audit trail shows correct actor |
| 6 | Post-approval edit attempt | **403 Forbidden** | `post_approval_edit_allowed = False` STRICT |
| 7 | `POST /api/v1/orders/{order_id}/post-erp` triggers Bravo SFTP | Order → `STAGED` → `_trigger_bravo_batch_export()` | **CRITICAL for UNIS go-live** |

**AC:** CN approval is the sole gate. Audit trail accurate. Post-approval edit blocked. SFTP upload triggered.

---

### TC-04: Bravo SFTP End-to-End

| Step | Action | Expected |
|---|---|---|
| 1 | CN approves order batch | Orders → `APPROVED` |
| 2 | Trigger `POST /post-erp` | Orders → `POSTING` → saga reserve → `STAGED` |
| 3 | `_trigger_bravo_batch_export()` runs | Collects all `STAGED` orders, generates CSV |
| 4 | `sftp_upload()` executes | File uploaded to Bravo SFTP `/incoming/scp/` |
| 5 | Upload success | Orders → `POSTED`, `sftp_filename` in metadata |
| 6 | Check Bravo SFTP `/incoming/scp/` | CSV file present with correct filename format: `bravo_batch_{tenant_id}_{timestamp}.csv` |
| 7 | CSV content validation | Columns: `LOAI_CHUNG_TU, MA_HANG, KHO_XUAT, KHO_NHAP, SO_LUONG, DON_VI_TINH, NGAY_CHUNG_TU, SO_LO, MA_THAM_CHIEU` |
| 8 | SFTP fail scenario (simulate) | Orders stay `STAGED`, alert Kafka published, retry possible via manual `mark-posted` or re-trigger batch export |

**AC:** File appears in Bravo within 30s of `post-erp`. No silent failure. Manual fallback path works via `STATUS_STAGED → STATUS_POSTED` transition.

---

### TC-05: Load Test — Real UNIS Data Volume

| Scenario | Target | Measurement |
|---|---|---|
| Allocation run: UNIS full catalog | Complete < 5 min | Query count < 50 for 100 lines (N+1 fix) |
| DRP netting: all items × all periods | Complete < 3 min | Supply lines filtered `ALLOCATABLE` only |
| Planned Orders Table: 1000+ rows | FPS ≥ 30 (no freeze) | `VirtualTableWrapper` threshold = 100 |
| Allocation Results Table: 500+ rows | FPS ≥ 30 | `VirtualTableWrapper` enabled |
| Concurrent API requests during DRP batch | API response < 500ms p95 | — |
| N+1 query count for allocation 100 lines | < 50 queries total | `TenantDataCache` prefetch working |
| Bravo batch export: 100 orders | CSV generation < 1s, SFTP < 5s | — |

**AC:** System does not timeout. Browser does not freeze on real data. SFTP handles batch size.

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Bravo SFTP credentials wrong / firewall block | Medium | 🔴 BLOCKER | Do smoke test P9 Day 1. Get Bravo IT contact. Have rollback to `SCP_ENV=development` ready. |
| UNIS master data quality (duplicates, missing ABC) | High | 🟡 Medium | Run `GET /api/v1/admin/data-quality/report` before UAT. Fix data before load test. |
| CN approver unavailable during UAT week | Low | 🔴 BLOCKER | Pre-create test CN account, UNIS IT on standby. Document approval workflow for backup approver. |
| N+1 queries timeout on full catalog | High | 🔴 BLOCKER | URGENT-2 done — `TenantDataCache` prefetch verified. Monitor query count in TC-05. |
| SFTP upload fail mid-batch | Medium | 🟡 Medium | `STATUS_STAGED → POSTED` transition added. Operator can manually retry via `mark-posted` or re-trigger batch. |
| Post-approval edit bypass | Low | 🔴 Compliance | BUG-3 fixed — guard enforces `post_approval_edit_allowed()`. Test TC-03 step 6. |

---

## UNIS Go-Live Checklist (Post-UAT)

- [ ] All TC-01 to TC-05 PASS sign-off by UNIS stakeholder
- [ ] Bravo SFTP production credentials set (different from UAT)
- [ ] `SCP_ENV=production` in prod `.env`
- [ ] `SCP_JWT_SECRET` rotated to prod value (not default)
- [ ] Rate limiter wired (URGENT-3) — security requirement
- [ ] UNIS-specific monitoring alerts configured in Monitor Service
- [ ] Rollback plan: revert `SCP_ENV=development` disables real SFTP instantly
- [ ] Runbook for CN approver workflow documented
- [ ] Support contact: UNIS IT + Bravo IT on-call for go-live week

---

## Reference: Key Code Files for UNIS

| Module | File | UNIS-specific Logic |
|---|---|---|
| Execution Bridge | `plugins/unis.py` | CN approval required, Bravo ERP, strict no-edit |
| Execution Bridge | `adapters/bravo_adapter.py` | SFTP upload, CSV batch generation |
| Execution Bridge | `service.py` | `_trigger_bravo_batch_export()` saga integration |
| Execution Bridge | `constants.py` | `STATUS_STAGED`, `LIFECYCLE_TRANSITIONS` |
| Allocation | `plugins/unis.py` | FEFO=off, VARIANT matching, ABC weights |
| DRP | `plugins/unis.py` | L4L lot sizing, 12w horizon, no BOM |
| Demand | `plugins/unis.py` | 90d cutoff, MAX_FORECAST_PO |
| Policy | `plugins/unis.py` | STATISTICAL SS, CSL A/B/C |
| Supply | `plugins/unis.py` | 240min freshness, BATCH sync |
| Transport | `plugins/unis.py` | BEST_SLA, no consolidation |
| Monitor | `plugins/unis.py` | Drift 20%, FC-SS loop enabled |

---

## Related Documents

- `UNIS-DATA-LOADING-GUIDE.md` — Excel import templates & scripts
- `../phase0/data/unis/` — Data files (CSV/Excel)

---

*Next action: R-DE loads master data (P1, P5, P6). BE1 runs SFTP smoke test (P9). Admin creates CN approver (P10).*
