# M00 Master Data Platform — API Endpoint Registry

> **Version:** 1.0 · **Date:** 2026-04-16
> **Base URL:** `http://localhost:3002/api/v1/master-data`
> **Auth:** Header `x-user-id: <user_id>` bắt buộc cho tất cả write operations
> **Feature Flag:** Tất cả endpoints behind `FeatureFlagGuard('m00_master_data_enabled')`

---

## Global Notes

- Tất cả IDs (`id`) là `string` (BIGSERIAL → PostgreSQL bigint → JavaScript string)
- Supplier dùng `supplier_code` (VARCHAR) làm identifier, không phải numeric id
- Soft delete: tất cả DELETE đặt `active = false`, không xóa row
- Audit log: tất cả write operations tự động ghi vào `master_data_audit_log`
- Paginated responses: `{ data: T[], total: number, page: number, pageSize: number }`

---

## 1. SKU Endpoints

### POST `/skus`
**Mô tả:** Tạo SKU mới kèm NM mapping bắt buộc và variants (optional). Atomic transaction.

**Headers:**
```
Content-Type: application/json
x-user-id: admin
```

**Request Body (`CreateSkuDto`):**
```json
{
  "skuCode": "SKU-001",
  "skuName": "Gạch 600x600 A4",
  "uom": "m2",
  "productGroup": "CERAMIC",
  "nmCode": "NM01",
  "moq": 500,
  "variants": [
    {
      "variantCode": "SKU-001-A4",
      "variantSuffix": "A4",
      "variantName": "Grade A4",
      "attrs": { "color": "white", "size": "600x600" }
    }
  ]
}
```

**Response 201:**
```json
{
  "id": "42",
  "skuCode": "SKU-001",
  "skuName": "Gạch 600x600 A4",
  "uom": "m2",
  "productGroup": "CERAMIC",
  "active": true,
  "createdBy": "admin",
  "createdAt": "2026-04-16T08:00:00Z"
}
```

**Errors:**
- `400` — Supplier `nmCode` not found or inactive
- `409` — `skuCode` already exists

---

### GET `/skus`
**Mô tả:** List SKUs với pagination + search + filter.

**Query params:**
| Param | Type | Default | Mô tả |
|-------|------|---------|--------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Rows per page |
| `search` | string | - | Search trên `sku_code` hoặc `sku_name` (ILIKE) |
| `activeOnly` | boolean | - | Filter `active = true` |
| `productGroup` | string | - | Filter theo product group |

**Response 200:**
```json
{
  "data": [
    {
      "id": "42",
      "skuCode": "SKU-001",
      "skuName": "Gạch 600x600 A4",
      "uom": "m2",
      "productGroup": "CERAMIC",
      "active": true,
      "nmCode": "NM01"
    }
  ],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

---

### GET `/skus/:id`
**Mô tả:** Get SKU detail kèm `nmCode`, `moq`, `variants`.

**Response 200:**
```json
{
  "id": "42",
  "skuCode": "SKU-001",
  "skuName": "Gạch 600x600 A4",
  "uom": "m2",
  "active": true,
  "nmCode": "NM01",
  "moq": 500,
  "variants": [
    {
      "id": "10",
      "variantCode": "SKU-001-A4",
      "variantSuffix": "A4",
      "active": true
    }
  ]
}
```

**Errors:**
- `404` — SKU not found

---

### PATCH `/skus/:id`
**Mô tả:** Update SKU fields (không thay đổi NM — dùng `change-nm` endpoint).

**Request Body (`UpdateSkuDto`):** Tất cả optional
```json
{
  "skuName": "Gạch 600x600 A4 New",
  "uom": "m2",
  "productGroup": "PREMIUM"
}
```

**Response 200:** Updated SKU object

---

### PATCH `/skus/:id/change-nm`
**Mô tả:** Thay đổi NM mapping — deactivate old mapping, insert new mapping. Spec M2 fix.
**Audit:** ghi `action: UPDATE` với `reason` vào audit log.

**Request Body (`ChangeNmDto`):**
```json
{
  "nmCode": "NM02",
  "reason": "Lead time improvement Q2",
  "moq": 300
}
```

**Response 200:** `{ message: "NM changed from NM01 to NM02" }`

**Errors:**
- `400` — SKU đã mapping với cùng supplier
- `400` — New supplier not found or inactive
- `404` — SKU not found

---

### DELETE `/skus/:id`
**Mô tả:** Soft delete SKU — sets `active = false`, deactivates all active NM mappings. Atomic.

**Response 204:** No Content

**Errors:**
- `400` — SKU already inactive
- `404` — SKU not found

---

## 2. Channel (CN) Endpoints

### POST `/channels`
**Request Body (`CreateChannelDto`):**
```json
{
  "cnCode": "CN-HCM-01",
  "cnName": "Chi nhánh Hồ Chí Minh 01",
  "region": "Nam",
  "address": "123 Nguyễn Văn Linh, Q7",
  "lat": 10.7326,
  "lng": 106.6972,
  "connectivity": "GOOD"
}
```

**Response 201:** Created Channel object

**Errors:**
- `400` — `lat`/`lng` missing (mandatory)
- `409` — `cnCode` already exists

---

### GET `/channels`
**Query params:** `page`, `pageSize`, `search`
**Response 200:** Paginated Channel list

---

### GET `/channels/:id`
**Response 200:** Channel object
**Errors:** `404` — Channel not found

---

### PATCH `/channels/:id`
**Request Body (`UpdateChannelDto`):** Optional fields: `cnName`, `region`, `address`, `lat`, `lng`, `connectivity`, `active`
**Response 200:** Updated Channel

---

### DELETE `/channels/:id`
**Response 204:** No Content (soft delete)

---

## 3. Supplier (NM) Endpoints

> **IMPORTANT:** Supplier dùng `supplier_code` (string) làm :code param — không phải numeric id.

### GET `/suppliers`
**Query params:** `page`, `pageSize`, `search`
**Response 200:** Paginated Supplier list (field: `supplierCode`, `supplierName`, `leadTimeDays`, `ltDriftCount`, etc.)

---

### GET `/suppliers/upload-template`
**Mô tả:** Download CSV template để bulk import suppliers.
> **CRITICAL:** Route này khai báo TRƯỚC `/:code` — không thay đổi thứ tự. M21 depends on this.

**Response 200:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="supplier_template.csv"

supplier_code,supplier_name,lead_time_days,region,factory_code
```

---

### GET `/suppliers/:code`
**Mô tả:** Get supplier by `supplier_code`.
**Response 200:** Supplier object
**Errors:** `404` — Supplier not found

---

### PATCH `/suppliers/:code`
**Request Body (`UpdateSupplierDto`):** Optional: `supplierName`, `leadTimeDays`, `region`, `factoryCode`, `status`
**Response 200:** Updated Supplier

---

### POST `/suppliers/:code/lt-override`
**Mô tả:** SC Manager escape hatch — force override `lead_time_days` với reason.
Tự động: increment `lt_drift_count` + set `lt_drift_last_at = NOW()` + ghi audit log.

**Request Body (`LtOverrideDto`):**
```json
{
  "ltDays": 10,
  "reason": "Nhà máy báo thiếu nguyên liệu — giảm LT khẩn"
}
```

**Response 200:**
```json
{
  "supplierCode": "NM01",
  "leadTimeDays": 10,
  "ltDriftCount": 3,
  "ltDriftLastAt": "2026-04-16T09:30:00Z"
}
```

**Errors:**
- `404` — Supplier not found

---

## 4. Hub Endpoints

### POST `/hubs`
**Request Body (`CreateHubDto`):**
```json
{
  "hubCode": "HUB-HCM",
  "hubName": "Hub Hồ Chí Minh",
  "hubType": "VIRTUAL",
  "lat": 10.8231,
  "lng": 106.6297,
  "capacity": 5000
}
```

**Response 201:** Created Hub

---

### GET `/hubs`
**Query params:** `page`, `pageSize`, `search`
**Response 200:** Paginated Hub list

---

### PATCH `/hubs/:id`
**Request Body (`UpdateHubDto`):** Optional fields
**Response 200:** Updated Hub

---

## 5. SKU-CN Mapping Endpoints

### POST `/sku-cn-mappings`
**Mô tả:** Upsert — creates hoặc updates `(sku_id, cn_id)` mapping.

**Request Body (`UpsertSkuCnMappingDto`):**
```json
{
  "skuId": "42",
  "cnId": "5",
  "ssOverride": 150.5,
  "zOverride": 1.6449,
  "isCritical": false
}
```

**Response 200:** Upserted mapping object

---

### GET `/sku-cn-mappings`
**Query params (`QuerySkuCnMappingDto`):** `skuId`, `cnId`, `page`, `pageSize`
**Response 200:** Paginated mapping list

---

### PATCH `/sku-cn-mappings/:id`
**Request Body (`PatchSkuCnMappingDto`):** Optional: `ssOverride`, `zOverride`, `isCritical`, `active`
**Response 200:** Updated mapping

---

## 6. Import Endpoints

### POST `/import/:entityType`
**Mô tả:** Bulk CSV import. Supports dry-run preview.

**Path param:** `entityType` = `supplier` | `sku` | `channel` | `hub`
**Query param:** `dryRun=true|false` (default: false)

**Headers:**
```
Content-Type: text/csv
x-user-id: admin
```

**Request Body:** Raw CSV text (max 500 rows)
```
supplier_code,supplier_name,lead_time_days
NM01,Nhà máy 01,14
NM02,Nhà máy 02,7
```

**Response 200:**
```json
{
  "total": 2,
  "valid": 2,
  "errors": [],
  "imported": 2
}
```

**Dry-run Response (dryRun=true):**
```json
{
  "total": 2,
  "valid": 1,
  "errors": [
    { "row": 2, "message": "supplier_code is required" }
  ],
  "imported": 0
}
```

**Errors:**
- `400` — Empty CSV / no data rows
- `400` — Unknown `entityType`

---

### GET `/import/:entityType/template`
**Mô tả:** Download CSV template cho bất kỳ entity type nào.

**Response 200:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="{entityType}_template.csv"
```

---

## 7. Audit Log Endpoint

### GET `/audit`
**Mô tả:** Paginated audit trail — filtered by entity, action, user.

**Query params (`AuditQueryDto`):**
| Param | Type | Mô tả |
|-------|------|--------|
| `entityType` | string | `SKU`, `CHANNEL`, `SUPPLIER`, `HUB`, `CUSTOMER` |
| `entityId` | string | ID (hoặc code) của entity |
| `action` | string | `CREATE`, `UPDATE`, `DELETE`, `IMPORT` |
| `changedBy` | string | User ID |
| `page` | number | default 1 |
| `pageSize` | number | default 50 |

**Response 200:**
```json
{
  "data": [
    {
      "id": "1001",
      "entityType": "SKU",
      "entityId": "42",
      "action": "CREATE",
      "changedFields": { "skuCode": "SKU-001", "nmCode": "NM01" },
      "changedBy": "admin",
      "source": "UI",
      "changedAt": "2026-04-16T08:00:00Z"
    }
  ],
  "total": 250,
  "page": 1,
  "pageSize": 50
}
```

---

## 8. Data Quality Endpoint

### GET `/quality`
**Mô tả:** Data quality metrics — đếm các loại data issues.

**Response 200:**
```json
{
  "skuNoNmMapping": 3,
  "channelNoLatLng": 0,
  "supplierNoSkuMapping": 5,
  "skuNoRecentSupply": 12
}
```

| Field | Ý nghĩa |
|-------|---------|
| `skuNoNmMapping` | Số SKU active không có NM mapping active |
| `channelNoLatLng` | Số Channel thiếu lat/lng (haversine formula sẽ fail) |
| `supplierNoSkuMapping` | Số Supplier active không có SKU nào mapping |
| `skuNoRecentSupply` | Số SKU không có supply trong 90 ngày |

---

## Endpoint Summary Table

| # | Method | Path | HTTP Code | Auth |
|---|--------|------|-----------|------|
| 1 | POST | `/skus` | 201 | x-user-id |
| 2 | GET | `/skus` | 200 | - |
| 3 | GET | `/skus/:id` | 200 | - |
| 4 | PATCH | `/skus/:id` | 200 | x-user-id |
| 5 | PATCH | `/skus/:id/change-nm` | 200 | x-user-id |
| 6 | DELETE | `/skus/:id` | 204 | x-user-id |
| 7 | POST | `/channels` | 201 | x-user-id |
| 8 | GET | `/channels` | 200 | - |
| 9 | GET | `/channels/:id` | 200 | - |
| 10 | PATCH | `/channels/:id` | 200 | x-user-id |
| 11 | DELETE | `/channels/:id` | 204 | x-user-id |
| 12 | GET | `/suppliers` | 200 | - |
| 13 | GET | `/suppliers/upload-template` | 200 (CSV) | - |
| 14 | GET | `/suppliers/:code` | 200 | - |
| 15 | PATCH | `/suppliers/:code` | 200 | x-user-id |
| 16 | POST | `/suppliers/:code/lt-override` | 200 | x-user-id |
| 17 | POST | `/hubs` | 201 | x-user-id |
| 18 | GET | `/hubs` | 200 | - |
| 19 | PATCH | `/hubs/:id` | 200 | x-user-id |
| 20 | POST | `/sku-cn-mappings` | 200 | x-user-id |
| 21 | GET | `/sku-cn-mappings` | 200 | - |
| 22 | PATCH | `/sku-cn-mappings/:id` | 200 | x-user-id |
| 23 | POST | `/import/:entityType` | 200 | x-user-id |
| 24 | GET | `/import/:entityType/template` | 200 (CSV) | - |
| 25 | GET | `/audit` | 200 | - |
| 26 | GET | `/quality` | 200 | - |

**PENDING (Sprint 2 — Customer):**

| # | Method | Path | HTTP Code | Sprint |
|---|--------|------|-----------|--------|
| 27 | POST | `/customers` | 201 | Sprint 2 |
| 28 | GET | `/customers` | 200 | Sprint 2 |
| 29 | GET | `/customers/:id` | 200 | Sprint 2 |
| 30 | PATCH | `/customers/:id` | 200 | Sprint 2 |
| 31 | DELETE | `/customers/:id` | 204 | Sprint 2 |
