'use client';

import type { ZeroForecastAlert, AlertSummary } from '@/lib/api/demand';

interface Props { alerts: ZeroForecastAlert[]; summary: AlertSummary | null }

const severityStyle = (s: ZeroForecastAlert['severity']) => {
  if (s === 'CRITICAL') return 'bg-rose-100 text-rose-700 border border-rose-200';
  if (s === 'HIGH') return 'bg-orange-100 text-orange-700 border border-orange-200';
  return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
};

export function ZeroForecastTable({ alerts, summary }: Props) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-center justify-between">
        <div>
          <p className="section-label">⚠ Zero Forecast Alert</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {summary?.totalAlerts ?? 0} items with zero forecast but sales history
          </p>
        </div>
        {summary && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-rose-600 font-semibold">🔴 {summary.critical} critical</span>
            <span className="text-orange-600 font-semibold">🟠 {summary.high} high</span>
            <span className="text-yellow-600 font-semibold">🟡 {summary.medium} medium</span>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">FSKU</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Seg</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Combo Class</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">12m Avg</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">3m Avg</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center">Zero Periods</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Severity</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">No zero-forecast alerts</td></tr>
            )}
            {alerts.map(a => (
              <tr key={a.itemCode} className="border-b border-[rgba(148,173,215,0.08)]">
                <td className="px-5 py-2 font-mono text-xs text-slate-700">{a.itemCode}</td>
                <td className="px-5 py-2 font-semibold text-xs">{a.segment}</td>
                <td className="px-5 py-2 text-xs text-slate-500">{a.comboClass}</td>
                <td className="px-5 py-2 text-right font-mono text-xs text-slate-600">{Math.round(a.qtySold12mAvg).toLocaleString()}</td>
                <td className="px-5 py-2 text-right font-mono text-xs text-slate-600">{Math.round(a.qtySold3mAvg).toLocaleString()}</td>
                <td className="px-5 py-2 text-center font-mono text-xs">{a.periodsWithZero}</td>
                <td className="px-5 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${severityStyle(a.severity)}`}>
                    {a.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
