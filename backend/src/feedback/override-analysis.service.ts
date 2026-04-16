import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * M28 Step 7 — Override Analysis (R6).
 *
 * Aggregates po_edit_log + to_edit_log 7 days prior to weekStart.
 * Top 5 reasons by frequency. Manual review only — NO auto-adjust.
 */
@Injectable()
export class OverrideAnalysisService {
  private readonly logger = new Logger(OverrideAnalysisService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run(snapshotId: string, weekStart: string): Promise<{ totalEdits: number }> {
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    // Aggregate reasons from both po_edit_log and to_edit_log (spec §12 override includes TO)
    const reasonRows: Array<{ reason: string; cnt: number }> = await this.dataSource.query(
      `SELECT reason, COUNT(*)::int AS cnt
       FROM (
         SELECT reason FROM po_edit_log WHERE changed_at >= $1 AND changed_at < $2
         UNION ALL
         SELECT reason FROM to_edit_log  WHERE changed_at >= $1 AND changed_at < $2
       ) combined
       WHERE reason IS NOT NULL
       GROUP BY reason
       ORDER BY cnt DESC
       LIMIT 5`,
      [weekStart, weekEnd],
    );

    const totalEditsRow: Array<{ cnt: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt
       FROM (
         SELECT id FROM po_edit_log WHERE changed_at >= $1 AND changed_at < $2
         UNION ALL
         SELECT id FROM to_edit_log  WHERE changed_at >= $1 AND changed_at < $2
       ) combined`,
      [weekStart, weekEnd],
    );
    const totalEdits = totalEditsRow[0]?.cnt ?? 0;

    const totalPosRow: Array<{ cnt: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM po_header WHERE confirmed_at >= $1 AND confirmed_at < $2`,
      [weekStart, weekEnd],
    );
    const totalTosRow: Array<{ cnt: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM to_header WHERE confirmed_at >= $1 AND confirmed_at < $2`,
      [weekStart, weekEnd],
    );
    const totalPos = totalPosRow[0]?.cnt ?? 0;
    const totalTos = totalTosRow[0]?.cnt ?? 0;
    const total = totalPos + totalTos;

    const topReasons = reasonRows.map(r => ({
      reason: r.reason,
      count: r.cnt,
      pct: totalEdits > 0 ? Math.round(r.cnt / totalEdits * 10000) / 100 : 0,
    }));

    const systemAccuracyPct = total > 0
      ? Math.round((1 - totalEdits / total) * 10000) / 10000
      : null;

    // Field breakdown
    const fieldRows: Array<{ field_changed: string; cnt: number }> = await this.dataSource.query(
      `SELECT field_changed, COUNT(*)::int AS cnt
       FROM po_edit_log
       WHERE changed_at >= $1 AND changed_at < $2
       GROUP BY field_changed`,
      [weekStart, weekEnd],
    );
    const fieldBreakdown: Record<string, number> = {};
    for (const r of fieldRows) fieldBreakdown[r.field_changed] = r.cnt;

    await this.dataSource.query(
      `INSERT INTO override_analysis
         (weekly_snapshot_id, week_start_date, top_reasons, total_edits, total_pos, total_tos, system_accuracy_pct, field_breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (weekly_snapshot_id) DO UPDATE SET
         top_reasons = EXCLUDED.top_reasons,
         total_edits = EXCLUDED.total_edits,
         system_accuracy_pct = EXCLUDED.system_accuracy_pct,
         field_breakdown = EXCLUDED.field_breakdown`,
      [
        snapshotId, weekStart,
        JSON.stringify(topReasons), totalEdits, totalPos, totalTos,
        systemAccuracyPct,
        JSON.stringify(fieldBreakdown),
      ],
    );

    this.logger.log(`[Override-Analysis] week=${weekStart}: ${totalEdits} edits, top reasons: ${topReasons.map(r => r.reason).join(', ')}`);
    return { totalEdits };
  }
}
