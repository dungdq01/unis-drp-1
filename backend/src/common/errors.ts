import { HttpException } from '@nestjs/common';

export class UnisError extends HttpException {
  constructor(code: string, message: string, status: number) {
    super({ code, message }, status);
  }
}

export const UNIS_ERR = {
  SNAPSHOT_NOT_DRAFT:  { code: 'UNIS-ERR-001', msg: 'Snapshot is not DRAFT', status: 409 },
  SNAPSHOT_EMPTY:      { code: 'UNIS-ERR-002', msg: 'Snapshot has no lines', status: 400 },
  CANNOT_OVERRIDE:     { code: 'UNIS-ERR-003', msg: 'Cannot override FROZEN snapshot', status: 409 },
  INVALID_CSV:         { code: 'UNIS-ERR-004', msg: 'Invalid CSV format', status: 400 },
  FILE_TOO_LARGE:      { code: 'UNIS-ERR-005', msg: 'File too large (max 50MB)', status: 413 },
  TOO_MANY_ERRORS:     { code: 'UNIS-ERR-006', msg: '>10% rows invalid', status: 422 },
  SNAPSHOT_NOT_FOUND:  { code: 'UNIS-ERR-007', msg: 'Snapshot not found', status: 404 },
  REASON_REQUIRED:     { code: 'UNIS-ERR-008', msg: 'Override reason required', status: 400 },
  OVERRIDER_REQUIRED:  { code: 'UNIS-ERR-009', msg: 'overriddenBy is required', status: 400 },
  LINE_NOT_FOUND:           { code: 'UNIS-ERR-010', msg: 'Demand line not found', status: 404 },
  PLAN_RUN_NOT_FOUND:       { code: 'UNIS-ERR-011', msg: 'Plan run not found', status: 404 },
  PLAN_RUN_NOT_COMPLETED:   { code: 'UNIS-ERR-013', msg: 'Plan run is not COMPLETED', status: 409 },
  ALLOCATION_RUN_NOT_FOUND: { code: 'UNIS-ERR-012', msg: 'Allocation run not found', status: 404 },
  TRANSPORT_PLAN_NOT_FOUND: { code: 'UNIS-ERR-014', msg: 'Transport plan not found', status: 404 },
  TRANSPORT_PLAN_NOT_DRAFT: { code: 'UNIS-ERR-015', msg: 'Transport plan is not DRAFT', status: 409 },
  TRANSPORT_TRIP_NOT_FOUND: { code: 'UNIS-ERR-016', msg: 'Transport trip not found', status: 404 },
  ALLOC_RUN_NOT_COMPLETED:  { code: 'UNIS-ERR-017', msg: 'Allocation run is not COMPLETED', status: 409 },
  ORDER_BATCH_NOT_FOUND:    { code: 'UNIS-ERR-018', msg: 'Order batch not found',                status: 404 },
  ORDER_BATCH_WRONG_STATUS: { code: 'UNIS-ERR-019', msg: 'Order batch status không hợp lệ',     status: 409 },
  ORDER_LINE_NOT_FOUND:     { code: 'UNIS-ERR-020', msg: 'Order line not found',                 status: 404 },
  ORDER_PLAN_NOT_CONFIRMED: { code: 'UNIS-ERR-021', msg: 'Transport plan chưa CONFIRMED',        status: 409 },
  ORDER_BATCH_DUPLICATE:    { code: 'UNIS-ERR-022', msg: 'Order batch đã tồn tại cho plan này', status: 409 },
  ORDER_REJECT_REASON_EMPTY:{ code: 'UNIS-ERR-023', msg: 'Lý do reject không được để trống',   status: 400 },
  ORDER_EXPORT_NOT_APPROVED:{ code: 'UNIS-ERR-024', msg: 'Chỉ APPROVED batch mới export được',  status: 409 },
  ALERT_NOT_FOUND:          { code: 'UNIS-ERR-025', msg: 'Alert not found',                      status: 404 },
  KPI_COMPUTE_FAILED:       { code: 'UNIS-ERR-026', msg: 'KPI computation failed',               status: 500 },
  MONITOR_NO_SUPPLY_DATA:   { code: 'UNIS-ERR-027', msg: 'Khong co supply snapshot PASS nao',    status: 422 },
  MONITOR_NO_DEMAND_DATA:   { code: 'UNIS-ERR-028', msg: 'Khong co demand snapshot FROZEN nao', status: 422 },
  // Module 9 — Plan vs Actual
  PLAN_ACTUAL_SNAPSHOT_MISSING:   { code: 'UNIS-ERR-029', msg: 'snapshotIdCompare bat buoc cho FORECAST_VERSION',   status: 400 },
  PLAN_ACTUAL_SNAPSHOT_NOT_FOUND: { code: 'UNIS-ERR-030', msg: 'Demand snapshot not found hoac khong phai FROZEN', status: 404 },
  PLAN_ACTUAL_NO_LINES:           { code: 'UNIS-ERR-031', msg: 'Snapshot khong co demand lines',                   status: 422 },
  PLAN_ACTUAL_SNAPSHOT_NOT_VALID: { code: 'UNIS-ERR-032', msg: 'Snapshot khong ton tai hoac chua FROZEN',          status: 422 },
  // Module 10 — System Config
  SYSTEM_CONFIG_NOT_FOUND:       { code: 'UNIS-ERR-033', msg: 'Config key not found',                              status: 404 },
  SYSTEM_CONFIG_BOUND_ERROR:     { code: 'UNIS-ERR-034', msg: 'Config value ngoai gioi han cho phep',              status: 400 },
  TOGGLE_KEY_NOT_FOUND:          { code: 'UNIS-ERR-035', msg: 'Feature toggle key not found',                      status: 404 },
};

export function throwUnisError(err: { code: string; msg: string; status: number }): never {
  throw new UnisError(err.code, err.msg, err.status);
}
