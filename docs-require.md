# UNIS Data Requirements — Questions & Confirmations Needed

**Purpose**: Tổng hợp các câu hỏi, thắc mắc, và yêu cầu cần UNIS BA/IT confirm  
**Owner**: R-DE (Data Engineer) + R-BA (Business Analyst)  
**Status**: 🟡 Awaiting UNIS response  
**Priority**: P1, P5, P6 blockers — need response within 2 days  
**Created**: 2026-04-12

---

## Executive Summary

Có **10 items** cần UNIS confirm trước khi load data. Trong đó:
- 🔴 **3 items GẤP** — cần IT gửi thêm data
- 🟡 **7 items CẦN CONFIRM** — cần BA clarify business rules

**Blocking UAT Day 1** nếu không có response.

---

## Part A: GẤP — Cần UNIS IT Gửi Thêm (Items 1-3)

### 1. Sales Data THẬT (3-6 tháng gần nhất)

| Attribute | Detail |
|---|---|
| **What** | Historical sales transaction data |
| **Why Critical** | TC-01 (Demand Freeze) + TC-05 (Load Test) cần real data volume |
| **Format** | `sales_history_YYYYMMDD.xlsx` (template provided) |
| **Volume** | Full catalog × 73 branches × 3-6 months |
| **Columns Required** | `item_id`, `customer_id`, `location_id`, `period`, `qty_sold`, `revenue_vnd` |

**Specific Questions**:
- ✅ Có thể export từ Bravo ERP không?
- ✅ Định dạng period là `YYYY-MM-DD` hay `YYYY-MM`?
- ✅ `customer_id` là mã KH từ Bravo hay mã nội bộ?

**Fallback** nếu không có: Dùng synthetic data → nhưng TC-05 (load test) không valid.

**Deadline**: UAT Day 1 - 3 days

---

### 2. Branch Inventory Hiện Tại (73 CN × Active SKUs)

| Attribute | Detail |
|---|---|
| **What** | Current inventory snapshot tại 73 chi nhánh |
| **Why Critical** | DRP PAB calculation + L1 RTM allocation cần supply data |
| **Format** | `inventory_snapshot_YYYYMMDD.xlsx` |
| **Volume** | 73 branches × active SKUs |
| **Columns Required** | `item_id`, `location_id`, `on_hand_qty`, `bucket` |

**Specific Questions**:
- ✅ CN nào không có inventory? (Vẫn cần include với qty=0 để routing hoạt động)
- ✅ Bucket classification hiện tại: UNIS phân loại như thế nào?
  - Allocable / Quarantine / Reserved / Damaged?
- ✅ Có `in_transit_qty` không? (Hàng đang vận chuyển đến CN)

**Fallback** nếu thiếu: Allocation fail với ERR_NO_SOURCE_AVAILABLE.

**Deadline**: UAT Day 1 - 3 days

---

### 3. Factory Inventory Hiện Tại (Per Factory, Per SKU)

| Attribute | Detail |
|---|---|
| **What** | Inventory tại các nhà máy UNIS |
| **Why Important** | DRP planned orders (make vs transfer decision) |
| **Format** | `inventory_snapshot_YYYYMMDD.xlsx` (same file, type=PLANT) |
| **Columns** | Same as branch inventory |

**Specific Questions**:
- ✅ Có bao nhiêu nhà máy? (HCM, HN, ĐN?)
- ✅ Factory inventory có phân loại bucket không?

**Priority**: 🟡 HIGH (nhưng không blocking — có thể mock với infinite supply)

**Deadline**: UAT Day 1 - 2 days (nice to have)

---

## Part B: CẦN UNIS BA Confirm (Items 4-10)

### 4. Item Status: Chỉ Import status=ACT? Hay Cả NEW?

| Option | Pros | Cons |
|---|---|---|
| **A. ACT only** | Clean dataset, ready for UAT | Thiếu items đang onboarding |
| **B. ACT + NEW** | Full catalog | NEW items chưa có sales history → forecast = 0 |
| **C. ACT + NEW + DISC** | Complete | DISC (discontinued) gây noise |

**Recommendation**: **Option A (ACT only)** cho UAT Phase 1.

**Question for BA**: Confirm OK? Hay có items NEW nào **bắt buộc** phải test?

---

### 5. Primary Key: bravo_sku vs item_code? 🔴 CRITICAL

| Field | Source | Example |
|---|---|---|
| `bravo_sku` | Bravo ERP | `BRV-XM-001` |
| `item_code` | UNIS internal | `UNIS-XM-001` |

**Impact**: 
- Nếu chọn sai → allocation fail (item not found)
- Bravo SFTP export sẽ dùng key nào? **Phải match**

**Question for BA**: 
- ✅ Bravo ERP dùng `bravo_sku` làm canonical identifier?
- ✅ Hay UNIS dùng `item_code` nội bộ, `bravo_sku` chỉ là mapping?

**Technical Solution** (recommend):
- Import **CẢ HAI** vào DB:
  - `item_id` = `item_code` (primary key — UNIS canonical)
  - `external_sku` = `bravo_sku` (for ERP mapping)
- Cần BA confirm approach này OK?

---

### 6. sample_age = Shelf Life (Tháng)?

| Field | Meaning | Impact |
|---|---|---|
| `sample_age` | Thời gian lưu mẫu? | Không rõ |
| `shelf_life_months` | Hạn sử dụng từ NSX | Ảnh hưởng FEFO policy |

**Context**: 
- UNIS plugin: `fefo_enabled = FALSE` (building materials, no expiry)
- Nhưng nếu sau này có perishable items → cần shelf life

**Question for BA**:
- ✅ `sample_age` trong file Item có phải là `shelf_life_months`?
- ✅ Hay là field khác hoàn toàn?
- ✅ Nếu đúng là shelf life → UNIS có items nào cần FEFO không?

**Priority**: 🟡 Medium (không blocking UAT nhưng cần clarify)

---

### 7. branch_channel Trống 52% — Ảnh Hưởng Routing?

| Field | Coverage | Purpose |
|---|---|---|
| `branch_channel` | 48% filled, 52% NULL | Phân loại kênh phân phối |

**Questions**:
- ✅ `branch_channel` dùng để làm gì? (Pricing? Routing? Reporting?)
- ✅ 52% NULL có phải là data quality issue hay expected?
- ✅ Có ảnh hưởng RTM routing không? (VD: CN kênh A → warehouse X, CN kênh B → warehouse Y)

**Technical Assumption** (nếu không confirm):
- `branch_channel` = optional field
- Không dùng trong routing logic (RTM rules handle routing)
- OK to import as NULL

**Priority**: 🟢 Low (không blocking)

---

### 8. 6 Rows Cuối (000, 067, 070, 093, 111, 222) — Có Phải CN Thật?

| branch_id | branch_name | Suspicion |
|---|---|---|
| 000 | ??? | Test data? |
| 067 | ??? | Legacy? |
| 070 | ??? | ??? |
| 093 | ??? | ??? |
| 111 | ??? | Test? |
| 222 | ??? | Test? |

**Context**: UNIS nói có 73 chi nhánh, nhưng file có 79 rows. 6 rows cuối suspicious.

**Questions**:
- ✅ Đây có phải chi nhánh thật đang hoạt động?
- ✅ Hay là test data / chi nhánh đã đóng cửa / chi nhánh dự phòng?

**Recommendation** (nếu không confirm):
- Exclude 6 rows này khỏi import
- Chỉ import 73 CN xác nhận
- Document: "Excluded branch_ids: 000, 067, 070, 093, 111, 222 (pending confirmation)"

**Priority**: 🟡 Medium (data quality)

---

### 9. Nơi Kéo: Duplicate FICO / HOAN MY / MIKADO — Cùng 1 Hay Khác?

| pull_point_id | pull_point_name | Count | Question |
|---|---|---|---|
| FICO | FICO | 2+ | Cùng tên, cùng địa điểm? |
| HOAN MY | Hoàn Mỹ | 2+ | Hay 2 CN khác nhau? |
| MIKADO | Mikado | 2+ | Cần unique IDs? |

**Context**: File "Nơi kéo" có duplicate names nhưng khác IDs?

**Questions**:
- ✅ Đây là cùng 1 nơi kéo (duplicate entry) hay 2+ nơi kéo khác nhau cùng tên?
- ✅ Nếu khác nhau → cần disambiguate (thêm suffix: FICO-01, FICO-02)
- ✅ Nếu duplicate → cần deduplicate trước import

**Priority**: 🟢 Low (pull points ít dùng trong UAT Phase 1)

---

### 10. #N/A Trong File Item — Re-export Hay Confirm Xử Lý NULL?

| Issue | Count | Example |
|---|---|---|
| `#N/A` trong cells | Unknown | `abc_class` = #N/A, `variant_id` = #N/A |

**Impact**:
- Import sẽ fail validation (NULL not allowed cho mandatory fields)
- Hoặc import với NULL → runtime errors

**Questions**:
- ✅ Đây là lỗi export (Excel bug) hay data thực sự missing?
- ✅ Có thể re-export với đầy đủ data?
- ✅ Hay confirm: #N/A = NULL (và chúng tôi xử lý accordingly)?

**Recommendation**:
- Nếu `#N/A` ít (< 5%): Manual fix, re-import
- Nếu `#N/A` nhiều (> 20%): Yêu cầu UNIS re-export từ source

**Priority**: 🟡 Medium (blocking nếu nhiều)

---

## Part C: LÀM NGAY — Không Cần Chờ (Items 11-13)

### 11. ✅ Import Master Data Đã Sạch (Warehouse + Branch Filtered + Item ACT)

**Action**: DE load ngay các data đã clean:
- Items: status = ACT
- Locations: Warehouses + Branches (exclude 6 suspicious CN)
- Suppliers: All

**Rationale**: Không block progress, clarify async.

---

### 12. ✅ Tạo RTM Rules Draft Từ Branch→Warehouse Mapping

**Action**: DE generate draft RTM rules:
```
Logic: Each branch → map to nearest warehouse by region
  P1: Regional warehouse (same region)
  P2: Factory (if same region)
  P3: Cross-region warehouse (fallback)
```

**Output**: `rtm_rules_DRAFT.xlsx` → gửi UNIS BA review.

**Rationale**: Draft giúp BA visualize → faster iteration.

---

### 13. ✅ Validate Gate Trên Master Data Only

**Action**: Chạy validation scripts trên master data đã import:
- Row counts
- Schema compliance
- Referential integrity

**Gate**: P1 partially ✅ (master data loaded, RTM/ABC pending)

---

## Summary: Response Matrix

| Item | To | Priority | Deadline | Blocking? |
|---|---|---|---|---|
| 1. Sales data 3-6 tháng | UNIS IT | 🔴 CRITICAL | -3 days | ✅ YES |
| 2. Branch inventory | UNIS IT | 🔴 CRITICAL | -3 days | ✅ YES |
| 3. Factory inventory | UNIS IT | 🟡 HIGH | -2 days | ⚠️ PARTIAL |
| 4. Item status scope | UNIS BA | 🟡 MEDIUM | -2 days | ❌ NO |
| 5. Primary key (bravo_sku vs item_code) | UNIS BA | 🔴 CRITICAL | -1 day | ✅ YES |
| 6. sample_age = shelf life? | UNIS BA | 🟡 MEDIUM | -3 days | ❌ NO |
| 7. branch_channel NULL | UNIS BA | 🟢 LOW | -5 days | ❌ NO |
| 8. 6 suspicious CN rows | UNIS BA | 🟡 MEDIUM | -2 days | ⚠️ PARTIAL |
| 9. Duplicate nơi kéo | UNIS BA | 🟢 LOW | -5 days | ❌ NO |
| 10. #N/A handling | UNIS BA/IT | 🟡 MEDIUM | -2 days | ⚠️ PARTIAL |

---

## Email Templates (Ready to Send)

### Template A: To UNIS IT (Items 1-3)

```
Subject: [URGENT] Yêu cầu data cho SCP UAT — UNIS

Dear UNIS IT Team,

Để chuẩn bị UAT cho hệ thống SCP (Supply Chain Planning), chúng tôi cần 
các data files sau:

1. SALES DATA (3-6 tháng gần nhất)
   - Format: Excel (.xlsx) — template đính kèm
   - Columns: item_id, customer_id, location_id, period, qty_sold
   - Volume: Full catalog × 73 chi nhánh

2. BRANCH INVENTORY (snapshot hiện tại)
   - Format: Excel (.xlsx) — template đính kèm
   - Columns: item_id, location_id, on_hand_qty, bucket
   - Coverage: 73 chi nhánh × active SKUs

3. FACTORY INVENTORY (snapshot hiện tại)
   - Same format as branch inventory
   - Nhà máy: [HCM, HN, ĐN?]

DEADLINE: [3 ngày trước UAT Day 1]

Liên hệ: [R-DE email/phone]

Thanks,
[R-DE] Data Engineer — SCP Project
```

### Template B: To UNIS BA (Items 4-10)

```
Subject: [UAT Prep] Cần confirm business rules — 10 questions

Dear UNIS BA Team,

Chúng tôi đang chuẩn bị load master data cho UAT. Cần confirm các 
câu hỏi sau:

🔴 CRITICAL (cần trả lời trong 1-2 ngày):
5. Primary key: Chúng tôi nên dùng bravo_sku hay item_code làm 
   canonical ID? (Ảnh hưởng allocation + ERP integration)

🟡 MEDIUM (2-3 ngày):
4. Item status: Chỉ import ACT? Hay cả NEW?
6. sample_age trong file Item có phải shelf life (tháng)?
8. 6 branch IDs cuối (000, 067, 070, 093, 111, 222) có phải 
   chi nhánh thật?
10. #N/A trong file Item: Re-export hay xử lý như NULL?

🟢 LOW (5 ngày):
7. branch_channel trống 52% — có ảnh hưởng routing?
9. Nơi kéo duplicate tên: Cùng 1 nơi hay khác?

Chi tiết: docs-require.md (đính kèm)

Thanks,
[R-BA] + [R-DE]
```

---

## Decision Log

| Date | Item | Decision | Owner | Status |
|---|---|---|---|---|
| TBD | 4. Item status | ACT only | UNIS BA | ⏳ Pending |
| TBD | 5. Primary key | item_code + bravo_sku as external | UNIS BA | ⏳ Pending |
| TBD | 8. 6 suspicious rows | Exclude pending confirmation | UNIS BA | ⏳ Pending |
| 2026-04-12 | 11-13. Load sạch | Proceed without waiting | R-DE | ✅ In Progress |

---

*Last updated: 2026-04-12 | Next review: Daily until all items resolved*
