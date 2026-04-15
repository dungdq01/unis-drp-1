'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchConfigGroup, fetchToggles, fetchRoles, fetchAuditLog,
  updateConfigs, updateToggle,
  type ConfigItem, type ToggleItem, type RoleItem, type AuditLogItem, type ConfigGroup,
} from '@/lib/api/system-config';

type Tab = 'planning' | 'plugin' | 'toggles' | 'system';

const TOGGLE_PHASE: Record<string, string> = {
  'feature.adjustment_report.enabled': 'Phase 2',
  'feature.co2_tracking.enabled':      'Phase 3',
  'feature.mape_tracking.enabled':     'BLOCKED',
  'feature.email_alerts.enabled':      'Phase 2',
  'feature.zalo_alerts.enabled':       'Phase 2',
  'feature.scheduled_kpi.enabled':     'Phase 2',
  'feature.bravo_sftp_push.enabled':   'Phase 2',
};

const PLANNING_EDITABLE = [
  'planning.cutoff_time', 'planning.horizon_weeks',
  'planning.max_stale_minutes', 'planning.force_override_allowed',
];
const PLUGIN_EDITABLE = [
  'plugin.csl_class_a', 'plugin.csl_class_b', 'plugin.csl_class_c',
  'plugin.hstk_stockout_threshold', 'plugin.hstk_overstock_threshold',
  'plugin.po_overdue_days', 'plugin.lcnb_mode', 'plugin.lcnb_factor', 'plugin.horizon_weeks',
];
const LCNB_MODES = ['"OFF"', '"DETECT_ONLY"', '"EXECUTE"'];

export default function PolicyPage() {
  const [tab, setTab] = useState<Tab>('planning');

  const [planningConfigs, setPlanningConfigs] = useState<ConfigItem[]>([]);
  const [planningEdits, setPlanningEdits]     = useState<Record<string, string>>({});
  const [planningActor, setPlanningActor]     = useState('');

  const [pluginConfigs, setPluginConfigs] = useState<ConfigItem[]>([]);
  const [pluginEdits, setPluginEdits]     = useState<Record<string, string>>({});
  const [pluginActor, setPluginActor]     = useState('');

  const [toggles, setToggles]         = useState<ToggleItem[]>([]);
  const [toggleActor, setToggleActor] = useState('');

  const [bravoConfigs, setBravoConfigs] = useState<ConfigItem[]>([]);
  const [roles, setRoles]               = useState<RoleItem[]>([]);
  const [rolesNote, setRolesNote]       = useState('');
  const [auditLogs, setAuditLogs]       = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal]     = useState(0);
  const [auditPage, setAuditPage]       = useState(1);

  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const loadPlanning = async () => {
    const res = await fetchConfigGroup('PLANNING_CYCLE');
    setPlanningConfigs(res.configs);
    setPlanningEdits(Object.fromEntries(res.configs.map(c => [c.key, c.value])));
  };

  const loadPlugin = async () => {
    const res = await fetchConfigGroup('PLUGIN_PARAMS');
    setPluginConfigs(res.configs);
    setPluginEdits(Object.fromEntries(res.configs.map(c => [c.key, c.value])));
  };

  const loadToggles = async () => { setToggles(await fetchToggles()); };

  const loadSystem = useCallback(async () => {
    const [bravoRes, rolesRes, auditRes] = await Promise.all([
      fetchConfigGroup('BRAVO_ADAPTER'),
      fetchRoles(),
      fetchAuditLog(auditPage),
    ]);
    setBravoConfigs(bravoRes.configs);
    setRoles(rolesRes.roles);
    setRolesNote(rolesRes.note);
    setAuditLogs(auditRes.data);
    setAuditTotal(auditRes.total);
  }, [auditPage]);

  useEffect(() => {
    setError(null);
    if (tab === 'planning') loadPlanning();
    if (tab === 'plugin')   loadPlugin();
    if (tab === 'toggles')  loadToggles();
    if (tab === 'system')   loadSystem();
  }, [tab, loadSystem]);
  // loadSystem là useCallback([auditPage]) → khi auditPage đổi → loadSystem reference đổi
  // → effect re-run tự động. Không cần 2 useEffect riêng.

  const handleSaveConfigs = async (
    group: ConfigGroup,
    edits: Record<string, string>,
    editableKeys: string[],
    originalConfigs: ConfigItem[],
    actor: string,
  ) => {
    if (!actor.trim()) { setError('Nhập tên người thay đổi'); return; }
    const updates = editableKeys
      .filter(k => {
        const original = originalConfigs.find(c => c.key === k)?.value;
        return edits[k] !== undefined && edits[k] !== original;
      })
      .map(k => ({ group, key: k, value: edits[k] }));

    if (!updates.length) { showToast('Không có thay đổi'); return; }
    if (!confirm('Bạn đang thay đổi config hệ thống. Tiếp tục?')) return;

    setSaving(true);
    try {
      await updateConfigs(updates, actor);
      showToast('✅ Config updated');
      tab === 'planning' ? loadPlanning() : loadPlugin();
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  };

  const handleToggleChange = async (key: string, newValue: string) => {
    if (!toggleActor.trim()) { setError('Nhập tên người thay đổi'); return; }
    try {
      await updateToggle(key, newValue, toggleActor);
      showToast(`✅ Toggle ${key} updated`);
      loadToggles();
      setError(null);
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-5 gap-4 overflow-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 glass-card px-4 py-3 text-sm text-slate-700 shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 border border-violet-100">
          <span className="font-mono text-[13px] font-bold text-violet-700">10</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Policy Platform</h1>
          <p className="text-xs text-slate-500">System configuration · Feature toggles · RBAC · Audit trail</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['planning', 'plugin', 'toggles', 'system'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'planning' ? 'Planning Cycle'
              : t === 'plugin' ? 'Plugin Params'
              : t === 'toggles' ? 'Feature Toggles'
              : 'System Info'}
          </button>
        ))}
      </div>

      {/* ── TAB: Planning Cycle ───────────────────────────────────────────────── */}
      {tab === 'planning' && (
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Planning Cycle</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {planningConfigs.map(c => (
                <tr key={c.key} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-mono text-slate-600">{c.key}</td>
                  <td className="px-3 py-2">
                    {PLANNING_EDITABLE.includes(c.key) ? (
                      c.isSensitive
                        ? <span className="text-slate-400" title="Sensitive">••••••••</span>
                        : <input
                            className="border border-slate-200 rounded px-2 py-1 text-xs w-full max-w-[200px]"
                            value={planningEdits[c.key] ?? c.value}
                            onChange={e => setPlanningEdits(p => ({ ...p, [c.key]: e.target.value }))}
                          />
                    ) : (
                      <span className="font-mono text-slate-700">{c.value}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <input
              className="border border-slate-200 rounded px-3 py-1.5 text-xs"
              placeholder="Người thay đổi (SC_MANAGER)"
              value={planningActor}
              onChange={e => setPlanningActor(e.target.value)}
            />
            <button
              disabled={saving}
              onClick={() => handleSaveConfigs('PLANNING_CYCLE', planningEdits, PLANNING_EDITABLE, planningConfigs, planningActor)}
              className="rounded-md bg-violet-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-violet-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: Plugin Params ────────────────────────────────────────────────── */}
      {tab === 'plugin' && (
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Plugin Parameters</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pluginConfigs.map(c => (
                <tr key={c.key} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-mono text-slate-600">{c.key}</td>
                  <td className="px-3 py-2">
                    {PLUGIN_EDITABLE.includes(c.key) ? (
                      c.key === 'plugin.lcnb_mode'
                        ? <select
                            className="border border-slate-200 rounded px-2 py-1 text-xs"
                            value={pluginEdits[c.key] ?? c.value}
                            onChange={e => setPluginEdits(p => ({ ...p, [c.key]: e.target.value }))}
                          >
                            {LCNB_MODES.map(m => (
                              <option key={m} value={m}>{m.replace(/"/g, '')}</option>
                            ))}
                          </select>
                        : <input
                            className="border border-slate-200 rounded px-2 py-1 text-xs w-28"
                            value={pluginEdits[c.key] ?? c.value}
                            onChange={e => setPluginEdits(p => ({ ...p, [c.key]: e.target.value }))}
                          />
                    ) : (
                      <span className="font-mono text-slate-700">{c.value}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <input
              className="border border-slate-200 rounded px-3 py-1.5 text-xs"
              placeholder="Người thay đổi (SC_MANAGER)"
              value={pluginActor}
              onChange={e => setPluginActor(e.target.value)}
            />
            <button
              disabled={saving}
              onClick={() => handleSaveConfigs('PLUGIN_PARAMS', pluginEdits, PLUGIN_EDITABLE, pluginConfigs, pluginActor)}
              className="rounded-md bg-violet-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-violet-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: Feature Toggles ─────────────────────────────────────────────── */}
      {tab === 'toggles' && (
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Feature Toggles</h2>
          <input
            className="border border-slate-200 rounded px-3 py-1.5 text-xs"
            placeholder="Người thay đổi (SC_MANAGER)"
            value={toggleActor}
            onChange={e => setToggleActor(e.target.value)}
          />
          <div className="space-y-2">
            {toggles.map(t => {
              const phase      = TOGGLE_PHASE[t.key];
              const isLcnb     = t.key === 'feature.lcnb.enabled';
              const isDisabled = !!phase;
              return (
                <div key={t.key} className="flex items-center justify-between border border-slate-100 rounded-lg px-4 py-3 hover:bg-slate-50/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-700">{t.key}</span>
                      {phase && (
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                          phase === 'BLOCKED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {phase}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{t.description}</p>
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    {isLcnb ? (
                      <select
                        disabled={isDisabled}
                        className="border border-slate-200 rounded px-2 py-1 text-xs disabled:opacity-40"
                        value={t.value}
                        onChange={e => handleToggleChange(t.key, e.target.value)}
                      >
                        {LCNB_MODES.map(m => (
                          <option key={m} value={m}>{m.replace(/"/g, '')}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        disabled={isDisabled}
                        onClick={() => handleToggleChange(t.key, t.value === 'true' ? 'false' : 'true')}
                        className={`relative inline-flex h-6 w-11 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          t.value === 'true' ? 'bg-violet-600' : 'bg-slate-300'
                        }`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                          t.value === 'true' ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: System Info ─────────────────────────────────────────────────── */}
      {tab === 'system' && (
        <div className="space-y-4">
          {/* Bravo Adapter */}
          <div className="glass-card p-5">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Bravo ERP Adapter <span className="normal-case font-normal text-slate-400">(read-only Phase 1)</span></p>
            <table className="w-full text-xs border-collapse">
              <tbody className="divide-y divide-slate-50">
                {bravoConfigs.map(c => (
                  <tr key={c.key}>
                    <td className="px-3 py-2 font-mono text-slate-600 w-56">{c.key}</td>
                    <td className="px-3 py-2 font-mono">{c.isSensitive ? <span className="text-slate-400">••••••••</span> : c.value}</td>
                    <td className="px-3 py-2 text-slate-400">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* RBAC */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">RBAC Role Matrix</p>
              <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded font-medium">Static — Phase 1</span>
            </div>
            {rolesNote && <p className="text-[11px] text-slate-400 mb-3 italic">{rolesNote}</p>}
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Permissions</th>
                  <th className="px-3 py-2">Masking</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {roles.map(r => (
                  <tr key={r.role} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono font-semibold">{r.role}</td>
                    <td className="px-3 py-2 text-slate-500">{r.scope}</td>
                    <td className="px-3 py-2 text-slate-600">{r.permissions.join(', ')}</td>
                    <td className="px-3 py-2">
                      {r.masking === 'NONE'
                        ? <span className="text-emerald-600 font-medium">NONE</span>
                        : <span className="text-orange-600">{r.masking}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Audit Log */}
          <div className="glass-card p-5">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Config Change Audit Log</p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Old</th>
                  <th className="px-3 py-2">New</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {auditLogs.length === 0
                  ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Chưa có thay đổi</td></tr>
                  : auditLogs.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-slate-500">{new Date(a.changedAt).toLocaleString('vi-VN')}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{a.configGroup}/{a.configKey}</td>
                        <td className="px-3 py-2 text-slate-400">{a.oldValue ?? '—'}</td>
                        <td className="px-3 py-2 font-semibold">{a.newValue}</td>
                        <td className="px-3 py-2">{a.changedBy}</td>
                        <td className="px-3 py-2 text-slate-400">{a.reason ?? '—'}</td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
            <div className="flex items-center gap-2 mt-3 text-xs">
              <button
                disabled={auditPage <= 1}
                onClick={() => setAuditPage(p => p - 1)}
                className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50"
              >Prev</button>
              <span className="text-slate-400">Page {auditPage} / {Math.max(1, Math.ceil(auditTotal / 20))}</span>
              <button
                disabled={auditPage >= Math.ceil(auditTotal / 20)}
                onClick={() => setAuditPage(p => p + 1)}
                className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50"
              >Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
