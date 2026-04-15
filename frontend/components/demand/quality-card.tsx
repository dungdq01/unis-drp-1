'use client';

import type { QualityData } from '@/lib/api/demand';

interface Props { quality: QualityData | null }

function Row({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-600">{label}</span>
      <span className={`font-mono font-semibold ${color}`}>{count.toLocaleString()}</span>
    </div>
  );
}

export function QualityCard({ quality }: Props) {
  if (!quality) {
    return <div className="glass-card p-10 text-center text-sm text-slate-400">Loading quality…</div>;
  }
  const { confidence, alerts } = quality;
  const totalConf = confidence.tight.count + confidence.medium.count + confidence.wide.count;
  const pct = (n: number) => totalConf > 0 ? (n / totalConf) * 100 : 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="glass-card p-5 space-y-3">
        <p className="section-label">Confidence Spread</p>
        <p className="text-xs text-slate-500">
          Avg range: <span className="font-mono font-semibold text-slate-700">±{confidence.avgSpreadPct.toFixed(1)}%</span>
        </p>
        <div className="space-y-2">
          {[
            { label: 'Tight (<5%)', data: confidence.tight, color: 'bg-emerald-400' },
            { label: 'Medium (5–20%)', data: confidence.medium, color: 'bg-amber-400' },
            { label: 'Wide (>20%)', data: confidence.wide, color: 'bg-rose-400' },
          ].map(r => (
            <div key={r.label} className="flex items-center gap-2">
              <span className="w-28 text-[11px] text-slate-500">{r.label}</span>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${r.color}`} style={{ width: `${pct(r.data.count)}%` }} />
              </div>
              <span className="text-[11px] font-mono text-slate-600 w-12 text-right">{r.data.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="glass-card p-5 space-y-2">
        <p className="section-label">Accuracy Alerts</p>
        <Row label={`⚠ ${alerts.highAccProxy.label}`} count={alerts.highAccProxy.count} color="text-rose-600" />
        <Row label={`⚠ ${alerts.dormant.label}`} count={alerts.dormant.count} color="text-amber-600" />
        <Row label={`⚠ ${alerts.noHistory.label}`} count={alerts.noHistory.count} color="text-amber-600" />
        <Row label={`✓ ${alerts.ok.label}`} count={alerts.ok.count} color="text-emerald-600" />
      </div>
    </div>
  );
}
