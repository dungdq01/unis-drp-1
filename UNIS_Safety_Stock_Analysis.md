# PHÂN TÍCH SAFETY STOCK — UNIS GROUP

**Reverse-engineering từ UNIS DRP System Design v2 + PRD SCP v3.5**
**So sánh với MDLZ và Best Practices**

Version 1.0 · 09/04/2026 · Prepared for: Kurt Binh, CEO Smartlog

---

## 1. BLUF

UNIS Group (gạch men, vật liệu xây dựng) có bài toán SS **khác bản chất** so với MDLZ (FMCG). MDLZ bán hàng tiêu dùng có demand tương đối stable (FC accuracy 70-85%), SS dùng Days-of-Supply cố định. UNIS bán vật liệu xây dựng có demand **biến động theo mùa xây dựng + dự án + đuôi màu**, FC accuracy thấp hơn (MAPE hiện tại 18.4%), và quản lý nhiều chi nhánh (CN) phân tán. Do đó UNIS cần **Dynamic SS** (rolling σ × safety factor) thay vì fixed days — đây là quyết định đã được PRD v3.5 ghi nhận.

---

## 2. UNIS — ĐẶC THÙ VẬN HÀNH ẢNH HƯỞNG SS

### 2.1 Khác biệt cơ bản UNIS vs MDLZ

| Dimension | MDLZ (FMCG) | UNIS (Building materials) | Impact lên SS |
|---|---|---|---|
| **Demand pattern** | Tương đối stable, seasonal peaks (Tết) | Biến động theo mùa xây dựng + dự án lẻ | UNIS cần SS phản ánh variance, không fixed days |
| **FC accuracy** | 70-85% (MAPE ~10%) | Thấp hơn (MAPE 18.4% hiện tại, drift) | UNIS cần SS buffer lớn hơn cho FC error |
| **SKU complexity** | ABC standard, ít variant | **Đuôi màu** (A4, B2, C1...) — cùng SKU nhưng khác lot màu | SS phải tính per variant, không per SKU |
| **Network structure** | 3 kho tập trung (BKD1/2/3) | **4+ chi nhánh phân tán** (ĐN, BD, HN, CT) | SS per CN, có thể lateral rebalance |
| **Lead time** | 14d production cycle (cố định) | NM Toko 3-7d, NM Mikado 3d, NM Phú Mỹ 5d (biến thiên) | LT variability phải vào formula SS |
| **Replenishment model** | NM sản xuất → BKD (push) | **Dual model**: forecast-based (push) + order-based (pull from CN) | SS khác nhau cho NM buffer vs CN buffer |
| **Order pattern** | VMI D+2 (GT), weekly (MT) | Đơn B2B lớn (dự án) + bán lẻ đại lý (đều) | Lumpy demand → σ cao → SS cao |
| **Inventory metric** | Không dùng HSTK | **HSTK = Ngày tồn kho** = on_hand / avg_daily_sales | HSTK là KPI chính, SS phải align với HSTK target |

### 2.2 Các yếu tố UNIS-specific ảnh hưởng SS

**① Đuôi màu (Color tail)**
Cùng SKU GA-300x600 nhưng lot sản xuất khác batch có đuôi màu khác (A4, B2, C1...). Khách hàng yêu cầu cùng đuôi màu trong 1 đơn. Hệ quả: SS phải tính **per SKU × đuôi màu**, không phải chỉ per SKU. Nếu tính gộp, có thể tồn 2,000m² nhưng đuôi A4 chỉ còn 200m² → stockout thực tế.

**② LCNB (Lateral Transfer)**
CN dư hàng có thể transfer cho CN thiếu. Đây là "virtual safety stock" — SS hiệu dụng của 1 CN bao gồm cả khả năng kéo hàng từ CN khác. Hệ quả: SS per CN có thể THẤP hơn nếu LCNB enabled, vì network cushion hỗ trợ.

**③ HSTK (Health Score Tồn Kho)**
HSTK = on_hand / avg_daily_sales. PRD ghi: "SKU-X at CN BD: stock=500, avg daily sales=10 → HSTK = 50 days." HSTK không phải SS nhưng là KPI giám sát — SS target phải align: nếu SS = 15d, HSTK nên > 15d. Nếu HSTK < SS → immediate alert.

**④ NM lead time biến thiên**
UNIS hiện tại xin tồn NM qua Zalo, PO overdue phổ biến (ví dụ: NM Toko 8 ngày chưa confirm). LT từ NM không cố định → SS phải bao gồm LT variability buffer.

**⑤ Nightly cycle 23:00**
UNIS chạy DRP lúc 23:00 (vs MDLZ 16:00). Planning cycle dài hơn (data cutoff → execution = overnight → sáng mai). Delay 8-10 giờ → SS cần buffer thêm cho planning latency.

---

## 3. PHƯƠNG PHÁP SS HIỆN TẠI CỦA UNIS

### 3.1 Hiện trạng (AS-IS): Manual + Zalo + Excel

Từ UNIS DRP v2 document và PRD cross-reference:

| Aspect | Cách làm hiện tại | Vấn đề |
|---|---|---|
| Tồn NM | Xin qua Zalo mỗi sáng | Không audit trail, delay, NM quên trả lời |
| Tồn CN | Check WMS/Bravo | Tương đối accurate |
| SS calculation | Manual Excel, dựa trên kinh nghiệm planner | Không systematic, không per variant |
| HSTK | "Bao nhiêu ngày bán được" — tính thủ công | Chỉ biết khi planner check |
| Replenishment trigger | Khi planner thấy hàng sắp hết → PO NM | Reactive, không proactive |
| LCNB decision | Planner gọi CN hỏi có hàng dư không | Ad-hoc, không optimize |

### 3.2 Vấn đề cốt lõi

UNIS **không có formal SS method** — SS là "cảm giác" của planner dựa trên kinh nghiệm. Khi Chị Thùy nghỉ phép, người thay không biết set SS bao nhiêu → stockout hoặc over-stock.

---

## 4. KHUYẾN NGHỊ SS CHO UNIS — DYNAMIC METHOD

### 4.1 Phương pháp đề xuất: Dynamic Rolling σ × Safety Factor

**Công thức:**

```
SS_UNIS = σ_demand × z × √(LT + Review_period)
```

Trong đó:
- `σ_demand` = standard deviation of daily demand (rolling 90 ngày)
- `z` = safety factor theo service level target (1.28 → 90%, 1.65 → 95%)
- `LT` = average lead time từ NM (ngày)
- `Review_period` = planning cycle (1 ngày cho nightly run)

**Tại sao Dynamic mà không phải Days-of-Supply (như MDLZ)?**

| Lý do | Giải thích |
|---|---|
| UNIS demand variance cao | Building materials có lumpy demand (dự án lớn xen kẽ bán lẻ). Fixed days không phản ánh variance. |
| FC accuracy thấp | MAPE 18.4% → FC không đáng tin → SS phải dựa trên actual variance, không FC. |
| Multi-variant (đuôi màu) | Mỗi đuôi màu có demand pattern riêng. Dynamic σ tính per variant. |
| LT biến thiên | NM Toko ≠ NM Mikado ≠ NM Phú Mỹ. √LT factor capture khác biệt này. |

### 4.2 Ví dụ tính cụ thể — GA-300 Đuôi A4 tại CN Bình Dương

**Input data (từ demo flow):**

| Parameter | Value | Source |
|---|---|---|
| Avg daily demand | 90 m²/day | Rolling 90d from WMS outbound |
| σ daily demand | 35 m²/day | Rolling 90d variance (CV = 0.39 — high) |
| Service level target | 95% | UNIS policy for Class A |
| z factor | 1.65 | Corresponding to 95% |
| Avg LT from NM Toko | 5 days | Historical PO tracking |
| σ LT | 2 days | NM Toko variability (3-7d range) |
| Review period | 1 day | Nightly cycle |

**Calculation (full formula with LT variability):**

```
SS = z × √(LT_avg × σ²_demand + ADU² × σ²_LT)
   = 1.65 × √(5 × 35² + 90² × 2²)
   = 1.65 × √(5 × 1,225 + 8,100 × 4)
   = 1.65 × √(6,125 + 32,400)
   = 1.65 × √38,525
   = 1.65 × 196.3
   = 324 m²
```

**Equivalent in days:** 324 / 90 = **3.6 days**

**So sánh nếu UNIS dùng MDLZ method (DoS 14d):**
```
SS_DoS = 90 × 14 = 1,260 m²
```

**Chênh lệch: 1,260 vs 324 = OVER-STOCK 936 m² (gần 4× quá nhiều!)**

Lý do: MDLZ dùng 14d cho mọi SKU. Với demand 90m²/day, 14d = 1,260m² — quá cao cho UNIS vì LT chỉ 5d và variance có thể quản lý bằng σ × z.

### 4.3 Nhưng: LT variability là rủi ro lớn nhất

Nếu NM Toko delay (như case PO-0847 overdue 8d):

```
Scenario: LT tăng từ 5d → 12d (actual delay)
SS_adjusted = 1.65 × √(12 × 1,225 + 8,100 × 16)
           = 1.65 × √(14,700 + 129,600)
           = 1.65 × √144,300
           = 1.65 × 379.9
           = 627 m²
```

SS cần **tăng gấp đôi** (324 → 627m²) khi LT tăng 140%. Đây là lý do UNIS cần **dynamic recalculation**: khi NM trễ → SS tự tăng → allocation engine biết phải reserve nhiều hơn.

### 4.4 SS per variant (đuôi màu)

| Variant | Avg demand/day | σ demand | CV | z (95%) | LT | SS (m²) | SS (days) |
|---|---|---|---|---|---|---|---|
| **A4 (primary)** | 90 | 35 | 0.39 | 1.65 | 5 | 324 | 3.6 |
| **B2 (secondary)** | 25 | 18 | 0.72 | 1.65 | 5 | 154 | 6.2 |
| **C1 (premium)** | 12 | 10 | 0.83 | 1.65 | 5 | 87 | 7.3 |

**Key insight:** B2 và C1 có coefficient of variation (CV) cao hơn A4 → cần NHIỀU ngày SS hơn dù volume thấp hơn. Đây chính xác là điều mà fixed Days-of-Supply method KHÔNG capture được — nếu dùng 14d cho tất cả, A4 over-stock (chỉ cần 3.6d), C1 vẫn có thể under-stock (cần 7.3d).

### 4.5 LCNB adjustment — Network SS

Khi LCNB enabled, SS per CN có thể giảm vì network hoạt động như "shared pool":

```
Effective_SS_CN_BD = SS_local × (1 − LCNB_factor)
```

LCNB factor = 0.2-0.3 (tùy proximity và transfer time). Nếu CN-ĐN có excess 1,920m² và transfer time = 1.5d:

```
SS_CN_BD_with_LCNB = 324 × (1 − 0.25) = 243 m² (giảm 25%)
```

**Điều kiện:** chỉ giảm SS khi LCNB toggle = ON và có ít nhất 1 CN khác có excess > min_threshold (PRD FR-v3.5-004).

---

## 5. SO SÁNH UNIS vs MDLZ vs BEST PRACTICES

| Dimension | MDLZ | UNIS (đề xuất) | Best practice reference |
|---|---|---|---|
| **Method** | Days-of-Supply (14d cố định) | Dynamic σ × z × √(LT + RP) | Silver-Pyke-Thomas; Chopra & Meindl |
| **Granularity** | Per SKU × class ABC | **Per SKU × đuôi màu × CN** | APICS: per SKU-Location |
| **Demand input** | FC monthly | Rolling 90d actual σ | Variance-based > forecast-based |
| **LT input** | Không dùng | Avg LT + σ_LT per NM | √LT factor (standard) |
| **Service level** | Implicit (14d ≈ ?) | Explicit z-score per class | Industry standard |
| **Update freq** | Monthly | **Weekly** (rolling σ recalc) | Weekly minimum |
| **Network effect** | Không (per kho riêng) | **LCNB factor giảm SS** | Risk pooling theory |
| **Variant** | Không | **Per đuôi màu** | SKU-attribute level |
| **Monitoring** | Không | **HSTK = on_hand/ADU** | DOI / weeks-of-supply |

---

## 6. IMPLEMENTATION ROADMAP CHO UNIS

| Phase | Action | SS Method | Expected impact |
|---|---|---|---|
| **Phase 0** (onboard) | Import current "planner judgment" as baseline. Set HSTK target per CN. | DoS cơ bản: HSTK target × ADU | Baseline measurable |
| **Phase 1** (Month 1-2) | Dynamic SS per SKU × CN. Rolling 90d σ. Fixed LT per NM. | σ × z × √LT (no LT variability yet) | Giảm over-stock 15-25% vs planner judgment |
| **Phase 2** (Month 3-4) | Add LT variability (σ_LT per NM). Add LCNB factor. | Full formula: σ × z × √(LT×σ²_d + ADU²×σ²_LT) | Giảm stockout 20-30% từ LT buffer |
| **Phase 3** (Month 5-6) | Per đuôi màu SS. ABC-differentiated z-score. | Per variant dynamic SS | Giảm slow-move đuôi B2/C1 over-stock 25-35% |
| **Phase 4** (Month 7+) | LCNB-aware SS. Network optimization. | SS_local × (1 − LCNB_factor) | Giảm total network SS 15-20% |

### 6.1 Parameters cần configure trong SCP

| Parameter | Config location | UNIS value | Update freq |
|---|---|---|---|
| SS method | §10.3 Policy Platform | `DYNAMIC` | 1 time |
| z-score per ABC | Policy → SS method | A=1.65, B=1.28, C=1.04 | Quarterly |
| Rolling window | Policy → SS method | 90 days | 1 time |
| LT avg per NM | Masterdata → Supplier | Toko=5d, Mikado=3d, PM=5d | Monthly |
| LT σ per NM | Masterdata → Supplier | Toko=2d, Mikado=1d, PM=1.5d | Monthly |
| LCNB factor | Policy → LCNB | 0.25 (if enabled) | Quarterly |
| HSTK min alert | Policy → Inventory | 10d per CN | 1 time |
| HSTK max alert | Policy → Inventory | 30d per CN | 1 time |

### 6.2 Alert rules liên quan SS

| Alert | Trigger | Action |
|---|---|---|
| HSTK < SS_days | CN stock dưới SS | Immediate: escalate + trigger LCNB scan |
| HSTK < 3d | Critical stockout risk | War room trigger |
| HSTK > 30d | Over-stock alert | Review SS parameters + demand pattern |
| σ_LT tăng > 50% | NM lead time deteriorating | Tăng SS tự động + planner review |
| CV > 1.0 per variant | Extreme variance | Flag for manual SS override |

---

## 7. KẾT LUẬN

UNIS cần phương pháp SS **khác bản chất** so với MDLZ:

| MDLZ | UNIS |
|---|---|
| FC-driven, stable demand | Variance-driven, lumpy demand |
| Fixed 14 days, simple | Dynamic σ × z, per variant |
| 3 kho tập trung | 4+ CN phân tán + LCNB |
| No LT variability | LT variability critical (NM unreliable) |
| No variant dimension | Đuôi màu = must-have dimension |

SCP v3.5 đã hỗ trợ cả hai: MDLZ dùng `Days-of-Supply` + `Capacity-Cap`, UNIS dùng `Dynamic (rolling σ × 1.65)`. Đây là policy-level configuration — cùng engine, khác parameter. Đúng principle PRD §10.1: "Cho phép biến thiên theo customer bằng policy, không bằng code fork."

---

*— Hết phân tích —*
