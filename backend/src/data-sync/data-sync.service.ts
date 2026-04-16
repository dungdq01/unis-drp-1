import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { parse as csvParse } from 'csv-parse/sync';
import { SyncLog, TriggerSource } from './entities/sync-log.entity';
import { DrpOverrideLog } from './entities/drp-override-log.entity';
import { SupplySnapshot } from '../supply/entities/supply-snapshot.entity';
import { FreshnessGateService, NmFreshnessResult } from './freshness-gate.service';
import { SyncHistoryQueryDto, OverrideDto } from './dto/sync-query.dto';

// ── CSV Template ──────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS = ['sku_code', 'sku_name', 'uom', 'available_qty', 'atp_qty', 'last_updated'];

// ── Cron times (UTC equiv of VN 06:00 + 14:00, UTC+7) ────────────────────────
const CRON_HOURS_VN = [6, 14]; // Asia/Ho_Chi_Minh

@Injectable()
export class DataSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private _cronTimers: NodeJS.Timeout[] = [];

  constructor(
    @InjectRepository(SyncLog)
    private readonly syncLogRepo: Repository<SyncLog>,
    @InjectRepository(DrpOverrideLog)
    private readonly overrideLogRepo: Repository<DrpOverrideLog>,
    @InjectRepository(SupplySnapshot)
    private readonly snapshotRepo: Repository<SupplySnapshot>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly freshnessGate: FreshnessGateService,
  ) {}

  // ── Lifecycle hooks — cron scheduler ──────────────────────────────────────

  onApplicationBootstrap() {
    for (const hourVN of CRON_HOURS_VN) {
      this._scheduleDailyCron(hourVN, 0);
    }
  }

  onApplicationShutdown() {
    this._cronTimers.forEach(t => clearTimeout(t));
    this._cronTimers = [];
  }

  /**
   * Schedule a daily cron at `hourVN:minute` Asia/Ho_Chi_Minh (UTC+7).
   * Uses recursive setTimeout to avoid drift.
   */
  private _scheduleDailyCron(hourVN: number, minute: number) {
    const triggerSource: TriggerSource = hourVN === 6 ? 'CRON_06' : 'CRON_14';

    const msUntilNext = () => {
      const nowMs = Date.now();
      // VN time = UTC + 7h
      const nowVN = new Date(nowMs + 7 * 60 * 60 * 1000);
      // Next fire: today or tomorrow at hourVN:minute VN
      const fireVN = new Date(Date.UTC(
        nowVN.getUTCFullYear(), nowVN.getUTCMonth(), nowVN.getUTCDate(),
        hourVN - 7,  // convert VN → UTC (may be negative → prev day, Date handles it)
        minute, 0, 0,
      ));
      if (fireVN.getTime() <= nowMs) {
        fireVN.setUTCDate(fireVN.getUTCDate() + 1);
      }
      return fireVN.getTime() - nowMs;
    };

    const scheduleNext = () => {
      const delay = msUntilNext();
      const timer = setTimeout(async () => {
        try {
          await this.runSyncAll(triggerSource, null);
        } catch (e) {
          // Tolerant — log only, do not crash
          console.error(`[DataSync] cron ${triggerSource} failed:`, e);
        }
        scheduleNext(); // reschedule for next day
      }, delay);
      this._cronTimers.push(timer);
    };

    scheduleNext();
  }

  // ── Dashboard: freshness per NM ───────────────────────────────────────────

  async getDashboard(): Promise<{ nms: NmFreshnessResult[]; checkedAt: Date }> {
    const nms = await this.freshnessGate.checkAll();
    return { nms, checkedAt: new Date() };
  }

  // ── Gate check (internal, called by M23/M26) ──────────────────────────────

  async gateCheck() {
    return this.freshnessGate.check();
  }

  // ── NM Upload CSV ─────────────────────────────────────────────────────────

  async uploadNmCsv(
    nmCode: string,
    fileBuffer: Buffer,
    triggeredByUser: string,
  ): Promise<{ snapshotId: string; rowsImported: number; syncLogId: string }> {
    // 1. Verify NM exists and is active
    const supplier = await this._requireActiveSupplier(nmCode);

    // 2. Parse CSV
    const rows = this._parseCsv(fileBuffer);

    // 3. Validate header
    this._validateHeaders(rows, nmCode);

    // 4. Validate row content
    const validRows = this._validateRows(rows, nmCode);

    // 5. Persist in transaction
    const result = await this.dataSource.transaction(async (em) => {
      // Create snapshot header
      const snapshot = em.create(SupplySnapshot, {
        snapshotName: `NM_UPLOAD_${nmCode}_${new Date().toISOString().slice(0, 10)}`,
        status: 'FROZEN',
        freshness: 'PASS',
        nmCode,
        syncedAt: new Date(),
        source: 'NM_UPLOAD',
        isLegacyData: false,
        totalLines: validRows.length,
        totalItems: new Set(validRows.map(r => r.sku_code)).size,
        totalAllocatableQty: validRows.reduce((s, r) => s + r.available_qty, 0),
        createdBy: triggeredByUser,
      });
      const savedSnapshot = await em.save(SupplySnapshot, snapshot);

      // Create sync log
      const log = em.create(SyncLog, {
        nmCode,
        triggerSource: 'MANUAL',
        triggeredByUser,
        status: 'SUCCESS',
        rowsImported: validRows.length,
        completedAt: new Date(),
      });
      const savedLog = await em.save(SyncLog, log);

      return { snapshotId: savedSnapshot.id, rowsImported: validRows.length, syncLogId: savedLog.id };
    });

    return result;
  }

  // ── CSV template generator ────────────────────────────────────────────────

  async generateTemplate(nmCode: string): Promise<{ csv: string; filename: string }> {
    await this._requireActiveSupplier(nmCode);

    // Fetch SKUs mapped to this NM
    const skus = await this.dataSource.query<{ sku_code: string; sku_name: string; uom: string }[]>(`
      SELECT s.sku_code, s.sku_name, COALESCE(s.uom, 'm2') AS uom
      FROM sku s
      INNER JOIN sku_nm_mapping m ON m.sku_id = s.id AND m.active = TRUE AND m.nm_code = $1
      WHERE s.active = TRUE
      ORDER BY s.sku_code ASC
    `, [nmCode]);

    const header = TEMPLATE_HEADERS.join(',');
    const dataRows = skus.map(s =>
      `${s.sku_code},${s.sku_name.replace(/,/g, ';')},${s.uom},,,`,
    );

    const csv = [header, ...dataRows].join('\n');
    return { csv, filename: `template_nm_${nmCode}_${new Date().toISOString().slice(0, 10)}.csv` };
  }

  // ── Manual trigger: 1 NM ──────────────────────────────────────────────────

  async triggerSyncOne(nmCode: string, triggeredByUser: string): Promise<SyncLog> {
    const supplier = await this._requireActiveSupplier(nmCode);
    const log = this.syncLogRepo.create({
      nmCode,
      triggerSource: 'MANUAL',
      triggeredByUser,
      status: 'SUCCESS',
      rowsImported: 0,
      completedAt: new Date(),
      errorMsg: 'Manual trigger — no file upload. Use POST /supply/nm-upload/:nmCode to upload data.',
    });
    return this.syncLogRepo.save(log);
  }

  // ── Sync all active NMs ───────────────────────────────────────────────────

  async runSyncAll(
    triggerSource: TriggerSource,
    triggeredByUser: string | null,
  ): Promise<{ triggered: number; logs: string[] }> {
    const suppliers = await this.dataSource.query<{ supplier_code: string }[]>(
      `SELECT supplier_code FROM supplier WHERE status = 'ACTIVE' ORDER BY supplier_code`,
    );

    const logIds: string[] = [];

    for (const s of suppliers) {
      try {
        const log = this.syncLogRepo.create({
          nmCode: s.supplier_code,
          triggerSource,
          triggeredByUser,
          status: 'SUCCESS',
          rowsImported: 0,
          completedAt: new Date(),
          errorMsg: triggerSource.startsWith('CRON')
            ? 'Cron ping — awaiting NM upload file.'
            : null,
        });
        const saved = await this.syncLogRepo.save(log);
        logIds.push(saved.id);
      } catch (err) {
        // Tolerant: 1 NM fail → log + continue (spec R5)
        const errLog = this.syncLogRepo.create({
          nmCode:          s.supplier_code,
          triggerSource,
          triggeredByUser,
          status:          'FAILED',
          rowsImported:    0,
          completedAt:     new Date(),
          errorMsg:        (err as Error).message,
        });
        const saved = await this.syncLogRepo.save(errLog);
        logIds.push(saved.id);
      }
    }

    return { triggered: suppliers.length, logs: logIds };
  }

  // ── Override (force DRP run with stale data) ──────────────────────────────

  async override(dto: OverrideDto): Promise<DrpOverrideLog> {
    if (dto.reason.length < 20) {
      throw new BadRequestException('override reason phải >= 20 ký tự');
    }

    // Snapshot current stale state for audit
    const gateResult = await this.freshnessGate.check();
    const staleSnapshot = gateResult.staleNms.map(n => ({
      nmCode: n.nmCode,
      nmName: n.nmName,
      hoursSinceSync: n.hoursSinceSync,
      status: n.status,
    }));

    const log = this.overrideLogRepo.create({
      overrideReason: dto.reason,
      approvedBy:     dto.approvedBy,
      planRunId:      dto.planRunId ?? null,
      staleNms:       staleSnapshot,
    });

    return this.overrideLogRepo.save(log);
  }

  // ── Sync history (paginated) ──────────────────────────────────────────────

  async getHistory(query: SyncHistoryQueryDto): Promise<{
    data: SyncLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const qb = this.syncLogRepo.createQueryBuilder('l')
      .orderBy('l.startedAt', 'DESC');

    if (query.nmCode) qb.where('l.nmCode = :nmCode', { nmCode: query.nmCode });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _requireActiveSupplier(nmCode: string) {
    const rows = await this.dataSource.query<{ supplier_code: string; supplier_name: string }[]>(
      `SELECT supplier_code, supplier_name FROM supplier WHERE supplier_code = $1 AND status = 'ACTIVE' LIMIT 1`,
      [nmCode],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`NM supplier không tìm thấy hoặc không active: ${nmCode}`);
    }
    return rows[0];
  }

  private _parseCsv(buffer: Buffer): Record<string, string>[] {
    try {
      return csvParse(buffer, {
        columns:           true,
        skip_empty_lines:  true,
        trim:              true,
      }) as Record<string, string>[];
    } catch (e) {
      throw new BadRequestException('CSV không đọc được. Kiểm tra encoding (UTF-8) và định dạng file.');
    }
  }

  private _validateHeaders(rows: Record<string, string>[], nmCode: string) {
    if (rows.length === 0) throw new BadRequestException('CSV rỗng hoặc không có data rows.');
    const headers = Object.keys(rows[0]);
    const required = ['sku_code', 'available_qty', 'atp_qty'];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Header không hợp lệ — thiếu cột: [${missing.join(', ')}]. ` +
        `Tải template mới tại GET /api/v1/supply/sync/template/${nmCode}`,
      );
    }
  }

  private _validateRows(
    rows: Record<string, string>[],
    nmCode: string,
  ): { sku_code: string; available_qty: number; atp_qty: number }[] {
    return rows.map((row, idx) => {
      const lineNum = idx + 2; // 1-indexed + header
      if (!row['sku_code']?.trim()) {
        throw new BadRequestException(`Dòng ${lineNum}: sku_code không được rỗng`);
      }
      const available_qty = parseFloat(row['available_qty']);
      const atp_qty = parseFloat(row['atp_qty']);
      if (isNaN(available_qty) || available_qty < 0) {
        throw new BadRequestException(`Dòng ${lineNum}: available_qty phải là số >= 0`);
      }
      if (isNaN(atp_qty) || atp_qty < 0) {
        throw new BadRequestException(`Dòng ${lineNum}: atp_qty phải là số >= 0`);
      }
      return { sku_code: row['sku_code'].trim(), available_qty, atp_qty };
    });
  }
}
