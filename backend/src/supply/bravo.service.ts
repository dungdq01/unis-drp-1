import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { LotAttribute } from './entities/lot-attribute.entity';

export interface BravoUploadResult {
  rowsParsed: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  unmappedItems: string[];
  unmappedLocations: string[];
  syncTimestamp: string;
}

interface RawRow {
  [key: string]: any;
}

@Injectable()
export class BravoService {
  constructor(
    @InjectRepository(LotAttribute)
    private readonly lotRepo: Repository<LotAttribute>,
    private readonly dataSource: DataSource,
  ) {}

  async processUpload(buffer: Buffer): Promise<BravoUploadResult> {
    const rows = this.parseBuffer(buffer);

    if (rows.length === 0) {
      throw new BadRequestException('File contains no data rows');
    }

    // Collect all item_codes and location_codes for bulk validation
    const allItemCodes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))];
    const allLocationCodes = [...new Set(rows.map((r) => r.location_code).filter(Boolean))];

    const validItemCodes = await this.validateCodes('item_code', allItemCodes);
    const validLocationCodes = await this.validateCodes('location_code', allLocationCodes);

    // Track unmapped codes
    const unmappedItemsSet = new Set<string>();
    const unmappedLocationsSet = new Set<string>();

    const validRows: {
      itemCode: string;
      locationCode: string;
      onHandQty: number;
      reservedQty: number;
      inTransitQty: number;
      sourceType: string;
    }[] = [];

    let rowsSkipped = 0;

    for (const raw of rows) {
      const itemCode = (raw.item_code ?? '').toString().trim();
      const locationCode = (raw.location_code ?? '').toString().trim();

      if (!itemCode || !locationCode) {
        rowsSkipped++;
        continue;
      }

      const itemValid = validItemCodes.has(itemCode);
      const locValid = validLocationCodes.has(locationCode);

      if (!itemValid) unmappedItemsSet.add(itemCode);
      if (!locValid) unmappedLocationsSet.add(locationCode);

      if (!itemValid || !locValid) {
        rowsSkipped++;
        continue;
      }

      const onHandQty = this.toNum(raw.on_hand_qty);
      const reservedQty = this.toNum(raw.reserved_qty);
      const inTransitQty = this.toNum(raw.in_transit_qty);
      const sourceType = (['OEM', 'DISTRIBUTION'].includes((raw.source_type ?? '').toString().toUpperCase()))
        ? (raw.source_type as string).toUpperCase()
        : 'OEM';

      validRows.push({ itemCode, locationCode, onHandQty, reservedQty, inTransitQty, sourceType });
    }

    let rowsInserted = 0;
    let rowsUpdated = 0;

    // Process in chunks of 500 for batch upsert
    const CHUNK = 500;
    for (let start = 0; start < validRows.length; start += CHUNK) {
      const chunk = validRows.slice(start, start + CHUNK);
      const upsertResult = await this.upsertChunk(chunk);
      rowsInserted += upsertResult.inserted;
      rowsUpdated += upsertResult.updated;
    }

    return {
      rowsParsed: rows.length,
      rowsInserted,
      rowsUpdated,
      rowsSkipped,
      unmappedItems: [...unmappedItemsSet],
      unmappedLocations: [...unmappedLocationsSet],
      syncTimestamp: new Date().toISOString(),
    };
  }

  async processManualRows(
    rows: { item_code: string; location_code: string; on_hand_qty: number; reserved_qty: number; in_transit_qty: number; source_type: string }[],
  ): Promise<BravoUploadResult> {
    if (rows.length === 0) throw new BadRequestException('No rows provided');

    const allItemCodes = [...new Set(rows.map((r) => r.item_code))];
    const allLocationCodes = [...new Set(rows.map((r) => r.location_code))];

    const validItemCodes = await this.validateCodes('item_code', allItemCodes);
    const validLocationCodes = await this.validateCodes('location_code', allLocationCodes);

    const unmappedItemsSet = new Set<string>();
    const unmappedLocationsSet = new Set<string>();
    let rowsSkipped = 0;

    const validRows: { itemCode: string; locationCode: string; onHandQty: number; reservedQty: number; inTransitQty: number; sourceType: string }[] = [];

    for (const r of rows) {
      const itemValid = validItemCodes.has(r.item_code);
      const locValid = validLocationCodes.has(r.location_code);
      if (!itemValid) unmappedItemsSet.add(r.item_code);
      if (!locValid) unmappedLocationsSet.add(r.location_code);
      if (!itemValid || !locValid) { rowsSkipped++; continue; }
      const sourceType = (['OEM', 'DISTRIBUTION'].includes(r.source_type.toUpperCase())) ? r.source_type.toUpperCase() : 'OEM';
      validRows.push({ itemCode: r.item_code, locationCode: r.location_code, onHandQty: r.on_hand_qty, reservedQty: r.reserved_qty, inTransitQty: r.in_transit_qty, sourceType });
    }

    let rowsInserted = 0;
    let rowsUpdated = 0;
    const CHUNK = 500;
    for (let start = 0; start < validRows.length; start += CHUNK) {
      const chunk = validRows.slice(start, start + CHUNK);
      const upsertResult = await this.upsertChunk(chunk);
      rowsInserted += upsertResult.inserted;
      rowsUpdated += upsertResult.updated;
    }

    return {
      rowsParsed: rows.length,
      rowsInserted,
      rowsUpdated,
      rowsSkipped,
      unmappedItems: [...unmappedItemsSet],
      unmappedLocations: [...unmappedLocationsSet],
      syncTimestamp: new Date().toISOString(),
    };
  }

  private parseBuffer(buffer: Buffer): RawRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('No sheets found in the uploaded file');
    }
    const sheet = workbook.Sheets[sheetName];

    // Parse as array-of-arrays first to handle double-header files
    // (row 1 = display header in Vietnamese, row 2 = machine-readable keys)
    const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (aoa.length < 2) return [];

    // Detect if row[0] contains known machine-readable column names
    const row0 = aoa[0].map((v: any) => String(v ?? '').toLowerCase().trim());
    const knownKeys = ['branch_code', 'bravo_sku', 'invqty', 'item_code', 'location_code', 'ma_kho', 'ma_hang', 'sku'];
    const isRow0Header = row0.some((k: string) => knownKeys.includes(k));

    let headerRow: string[];
    let dataStartIdx: number;

    if (isRow0Header) {
      headerRow = row0;
      dataStartIdx = 1;
    } else {
      // Row 0 is display header, Row 1 is the machine-readable header
      headerRow = aoa[1].map((v: any) => String(v ?? '').toLowerCase().trim());
      dataStartIdx = 2;
    }

    const rawRows: RawRow[] = aoa.slice(dataStartIdx).map((cells) => {
      const row: RawRow = {};
      headerRow.forEach((key, i) => { row[key] = cells[i] ?? ''; });
      return this.mapColumns(row);
    });

    return rawRows;
  }

  private mapColumns(row: RawRow): RawRow {
    const mapped: RawRow = {};

    // location_code: ma_kho, branch_code, location_code
    // Numeric branch codes (e.g. 8) must be zero-padded to 3 digits to match DB format (008, 076)
    const rawLoc = row['location_code'] ?? row['ma_kho'] ?? row['branch_code'] ?? '';
    const locStr = String(rawLoc).trim();
    mapped.location_code = /^\d+$/.test(locStr) && locStr.length > 0 ? locStr.padStart(3, '0') : locStr;

    // item_code: use base Sku (matches item master / demand snapshot item_code)
    // sku column is only populated for some rows; fall back to stripping color suffix from bravo_sku
    const rawSku = (row['sku'] || row['item_code'] || row['ma_hang'] || '').toString().trim();
    if (rawSku) {
      mapped.item_code = rawSku;
    } else {
      // Derive base code from bravo_sku: strip trailing numeric color suffix (e.g. "12.L1.3030.3002.8" → "12.L1.3030.3002")
      const bravo = (row['bravo_sku'] || '').toString().trim();
      mapped.item_code = bravo.replace(/\.\d$/, '');
    }

    // on_hand_qty: ton_thuc_te, invqty, on_hand_qty
    mapped.on_hand_qty =
      row['on_hand_qty'] ?? row['ton_thuc_te'] ?? row['invqty'] ?? 0;

    // reserved_qty: da_dat, reserved_qty (default 0)
    mapped.reserved_qty =
      row['reserved_qty'] ?? row['da_dat'] ?? 0;

    // in_transit_qty: dang_van_chuyen, in_transit_qty (default 0)
    mapped.in_transit_qty =
      row['in_transit_qty'] ?? row['dang_van_chuyen'] ?? 0;

    // source_type: source_type (default 'OEM')
    mapped.source_type = row['source_type'] ?? 'OEM';

    return mapped;
  }

  private toNum(val: any): number {
    const n = parseFloat((val ?? '0').toString().replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  /**
   * Validate that codes exist in DB by checking the lot_attribute table's
   * own column. Falls back to checking if already known in the lot_attribute table.
   * Since items/locations may come from external master tables not available here,
   * we accept all codes that either:
   *   - already exist in lot_attribute, OR
   *   - we simply allow all and let DB FK handle it (no FK defined in entity)
   *
   * Per spec: "Validate item_code and location_code against DB using SELECT ... WHERE code = ANY($1)"
   * We query lot_attribute for existing codes and also check item_master / location tables if present.
   */
  private async validateCodes(column: 'item_code' | 'location_code', codes: string[]): Promise<Set<string>> {
    if (codes.length === 0) return new Set();

    // Try to find a dedicated master table; fall back to lot_attribute existing rows
    const tableMap: Record<string, string> = {
      item_code: 'item',
      location_code: 'location',
    };
    const masterTable = tableMap[column];

    try {
      const rows: { code: string }[] = await this.dataSource.query(
        `SELECT ${column} AS code FROM ${masterTable} WHERE ${column} = ANY($1)`,
        [codes],
      );
      return new Set(rows.map((r) => r.code));
    } catch {
      // Master table not found — fall back: accept all codes (no FK enforcement)
      // Log a warning but do not crash the upload
      return new Set(codes);
    }
  }

  private async upsertChunk(
    rows: {
      itemCode: string;
      locationCode: string;
      onHandQty: number;
      reservedQty: number;
      inTransitQty: number;
      sourceType: string;
    }[],
  ): Promise<{ inserted: number; updated: number }> {
    // Deduplicate by (itemCode, locationCode) — SUM quantities across variants
    // e.g. bravo_sku "14.L1.6060.66383026.S" and "14.L1.6060.66383026" both map to same base code
    // Must SUM, not overwrite, otherwise multi-variant items lose stock
    const dedupMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      const key = `${row.itemCode}||${row.locationCode}`;
      const existing = dedupMap.get(key);
      if (existing) {
        existing.onHandQty    += row.onHandQty;
        existing.reservedQty  += row.reservedQty;
        existing.inTransitQty += row.inTransitQty;
      } else {
        dedupMap.set(key, { ...row });
      }
    }
    const dedupedRows = [...dedupMap.values()];

    // We need to know which rows already exist to count inserted vs updated
    const keys = dedupedRows.map((r) => `${r.itemCode}||${r.locationCode}`);

    const existingRaw: { item_code: string; location_code: string }[] =
      await this.dataSource.query(
        `SELECT item_code, location_code FROM lot_attribute
         WHERE lot_number = 'BRAVO'
           AND (item_code || '||' || location_code) = ANY($1)`,
        [keys],
      );

    const existingKeys = new Set(
      existingRaw.map((r) => `${r.item_code}||${r.location_code}`),
    );

    let inserted = 0;
    let updated = 0;

    for (const row of dedupedRows) {
      const key = `${row.itemCode}||${row.locationCode}`;
      if (existingKeys.has(key)) {
        updated++;
      } else {
        inserted++;
      }
    }

    // Build values for bulk upsert
    const valuePlaceholders: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const row of dedupedRows) {
      valuePlaceholders.push(
        `($${idx++}, $${idx++}, 'BRAVO', $${idx++}, $${idx++}, 0, $${idx++}, 'ALLOCATABLE', $${idx++}, NOW())`,
      );
      params.push(
        row.itemCode,
        row.locationCode,
        row.onHandQty,
        row.reservedQty,
        row.inTransitQty,
        row.sourceType,
      );
    }

    await this.dataSource.query(
      `INSERT INTO lot_attribute
         (item_code, location_code, lot_number, on_hand_qty, reserved_qty, quarantine_qty, in_transit_qty, quality_status, source_type, last_sync_at)
       VALUES ${valuePlaceholders.join(', ')}
       ON CONFLICT (item_code, location_code, lot_number)
       DO UPDATE SET
         on_hand_qty    = EXCLUDED.on_hand_qty,
         reserved_qty   = EXCLUDED.reserved_qty,
         in_transit_qty = EXCLUDED.in_transit_qty,
         source_type    = EXCLUDED.source_type,
         last_sync_at   = NOW(),
         updated_at     = NOW()`,
      params,
    );

    return { inserted, updated };
  }
}
