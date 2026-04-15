export const UNIS_ORDER_CONFIG = {
  // Phase 1: chỉ tạo TO. SO/PO thêm ở Phase 2 khi có customer/supplier master.
  enabledOrderTypes: ['TO'] as const,

  // Batch code format: TO-{YYYYMM}-{seq 4-digit zero-padded}
  batchCodePrefix: 'TO',

  // Order line numbering: {batch_code}-L{seq 4-digit}
  lineSeqPad: 4,

  // CSV export: UTF-8 BOM để Excel đọc tiếng Việt đúng
  csvBom: true,

  // Tên file export: orders_{batch_code}_{YYYYMMDD}.csv
  csvFilenamePattern: 'orders_{batchCode}_{date}.csv',

  // Chunk size khi bulk insert order_line
  insertChunkSize: 500,

  // Phase 1: không check duplicate erp_ref
  allowDuplicateErpRef: true,
} as const;
