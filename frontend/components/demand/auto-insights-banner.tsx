'use client';

import type { AccuracyOverview, AccuracySummary, WorstPerformer } from '@/lib/api/demand';

interface Insight { icon: string; tone: 'good' | 'warn' | 'bad' | 'info'; text: string }

const TONE: Record<Insight['tone'], string> = {
  good: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  warn: 'bg-amber-50 border-amber-300 text-amber-900',
  bad:  'bg-rose-50 border-rose-300 text-rose-900',
  info: 'bg-sky-50 border-sky-300 text-sky-900',
};

/**
 * I-9: Auto-generated insights — rule-based (no ML).
 * Takes overview + accuracy + worst data → derives 2-4 short insight bullets.
 */
export function AutoInsightsBanner({
  overview, accuracy, worstTotal,
}: {
  overview: AccuracyOverview | null;
  accuracy: AccuracySummary | null;
  worstTotal: number;
}) {
  const insights: Insight[] = [];

  if (accuracy && overview) {
    const t1 = accuracy.byMonth.find(m => m.month === 'T1');
    const gain = accuracy.kpi.gainT1;
    if (gain >= 5) {
      insights.push({
        icon: '🎯',
        tone: 'good',
        text: `Model T1 LIVE đạt ${accuracy.kpi.modelAccT1.toFixed(1)}% — vượt MA3 baseline +${gain.toFixed(1)}%. Model đang thắng.`,
      });
    } else if (gain < 0) {
      insights.push({
        icon: '⚠',
        tone: 'bad',
        text: `Model T1 (${accuracy.kpi.modelAccT1.toFixed(1)}%) thua MA3 (${accuracy.kpi.ma3AccT1.toFixed(1)}%). Review model config.`,
      });
    }

    // Top tier call-out
    const top50 = accuracy.byTier.find(t => t.tier === 'Top 50');
    if (top50 && top50.gain > 7) {
      insights.push({
        icon: '🏆',
        tone: 'good',
        text: `Top 50 SKUs có gain cao nhất (+${top50.gain.toFixed(1)}%) — model mạnh ở mã cao volume.`,
      });
    }

    // Coverage insight
    if (overview.kpi.coveragePercent < 70) {
      insights.push({
        icon: '📉',
        tone: 'warn',
        text: `Coverage chỉ ${overview.kpi.coveragePercent.toFixed(1)}% — nhiều SKU chưa có forecast, planner cần chạy lại import.`,
      });
    } else if (overview.kpi.coveragePercent >= 90) {
      insights.push({
        icon: '✅',
        tone: 'good',
        text: `Coverage ${overview.kpi.coveragePercent.toFixed(1)}% — gần như toàn bộ ${overview.kpi.totalItems.toLocaleString()} SKU đã có forecast.`,
      });
    }

    // Dormant warning
    if (overview.kpi.dormantCount > 100) {
      insights.push({
        icon: '⏸',
        tone: 'warn',
        text: `${overview.kpi.dormantCount} SKU hoàn toàn không có actual T10-T1 — kiểm tra exclusion rules hoặc loại khỏi DRP.`,
      });
    }

    // Worst performers
    if (worstTotal >= 20) {
      insights.push({
        icon: '🔥',
        tone: 'bad',
        text: `${worstTotal} SKU có accuracy < 20% nhưng actual > 100 — cần override forecast T2/T3 trước DRP.`,
      });
    }

    // T12 vs T1 trend
    const t12 = accuracy.byMonth.find(m => m.month === 'T12');
    if (t1 && t12 && t1.finalAcc != null && t12.finalAcc != null) {
      const delta = t1.finalAcc - t12.finalAcc;
      if (delta >= 5) {
        insights.push({
          icon: '📈',
          tone: 'info',
          text: `Accuracy cải thiện ${delta.toFixed(1)}% từ T12 (${t12.finalAcc.toFixed(1)}%) → T1 (${t1.finalAcc.toFixed(1)}%) — model đang học tốt hơn.`,
        });
      }
    }
  }

  if (insights.length === 0) return null;

  return (
    <div className="glass-card p-3">
      <p className="section-label mb-2 text-[10px]">💡 Auto-Insights</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {insights.slice(0, 4).map((ins, i) => (
          <div key={i} className={`flex items-start gap-2 p-2 rounded-md border text-xs ${TONE[ins.tone]}`}>
            <span className="text-base leading-none flex-shrink-0 mt-0.5">{ins.icon}</span>
            <span className="flex-1 leading-snug">{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
