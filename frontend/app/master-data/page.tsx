'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchSkus,
  fetchChannels,
  fetchSuppliers,
  fetchHubs,
  fetchQuality,
  createSku,
  updateSku,
  deactivateSku,
  createChannel,
  updateChannel,
  updateSupplier,
  createHub,
  type Sku,
  type Channel,
  type Supplier,
  type Hub,
  type QualityMetrics,
} from '@/lib/api/master-data';

type Tab = 'sku' | 'channel' | 'supplier' | 'hub';

// ─── Helpers ────────────────────────────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        active
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : 'bg-slate-100 text-slate-500 border border-slate-200'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function ConnectivityBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    GOOD: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border border-amber-200',
    WEAK: 'bg-red-50 text-red-600 border border-red-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        map[value] ?? 'bg-slate-100 text-slate-500 border border-slate-200'
      }`}
    >
      {value}
    </span>
  );
}

function HubTypeBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        value === 'VIRTUAL'
          ? 'bg-blue-50 text-blue-700 border border-blue-200'
          : 'bg-slate-100 text-slate-600 border border-slate-200'
      }`}
    >
      {value}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

// ─── Modal wrapper ───────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50';

// ─── SKU Tab ─────────────────────────────────────────────────────────────────

function SkuTab({ suppliers }: { suppliers: Supplier[] }) {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editSku, setEditSku] = useState<Sku | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Sku>>({
    skuCode: '',
    skuName: '',
    uom: '',
    productGroup: '',
    nmCode: '',
    moq: undefined,
  });

  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSkus({ page, pageSize: PAGE_SIZE, search: search || undefined });
      setSkus(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      setError('Đang kết nối...');
      setSkus([]);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ skuCode: '', skuName: '', uom: '', productGroup: '', nmCode: '', moq: undefined });
    setEditSku(null);
    setShowAdd(true);
  };

  const openEdit = (sku: Sku) => {
    setForm({ ...sku });
    setEditSku(sku);
    setShowAdd(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editSku) {
        await updateSku(editSku.id, form);
      } else {
        await createSku(form);
      }
      setShowAdd(false);
      await load();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate SKU này?')) return;
    await deactivateSku(id);
    await load();
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Tìm theo SKU code / tên..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 max-w-xs rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={openAdd}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-sm transition-all"
        >
          + Add SKU
        </button>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
            <Spinner />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-slate-400">{error}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">SKU Code</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">SKU Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">UOM</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">NM</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">MOQ</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {skus.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                        Không có dữ liệu
                      </td>
                    </tr>
                  ) : (
                    skus.map((sku) => (
                      <tr key={sku.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{sku.skuCode}</td>
                        <td className="px-4 py-2.5 text-slate-700">{sku.skuName}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{sku.uom}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{sku.nmCode ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600 text-xs tabular-nums">
                          {sku.moq?.toLocaleString() ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <ActiveBadge active={sku.active} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(sku)}
                              className="rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              Edit
                            </button>
                            {sku.active && (
                              <button
                                onClick={() => handleDeactivate(sku.id)}
                                className="rounded-md px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  {total.toLocaleString()} SKUs · Trang {page}/{totalPages}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAdd && (
        <Modal
          title={editSku ? `Edit SKU: ${editSku.skuCode}` : 'Add SKU'}
          onClose={() => setShowAdd(false)}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="SKU Code" required>
                <input
                  className={inputCls}
                  value={form.skuCode ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, skuCode: e.target.value }))}
                  disabled={!!editSku}
                />
              </FormField>
              <FormField label="UOM">
                <input
                  className={inputCls}
                  value={form.uom ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))}
                />
              </FormField>
            </div>
            <FormField label="SKU Name" required>
              <input
                className={inputCls}
                value={form.skuName ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, skuName: e.target.value }))}
              />
            </FormField>
            <FormField label="Product Group">
              <input
                className={inputCls}
                value={form.productGroup ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, productGroup: e.target.value }))}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="NM Code" required>
                <select
                  className={inputCls}
                  value={form.nmCode ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, nmCode: e.target.value }))}
                >
                  <option value="">— Chọn NM —</option>
                  {suppliers.map((s) => (
                    <option key={s.supplierCode} value={s.supplierCode}>
                      {s.supplierCode} · {s.supplierName}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="MOQ">
                <input
                  type="number"
                  className={inputCls}
                  value={form.moq ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, moq: e.target.value ? Number(e.target.value) : undefined }))
                  }
                />
              </FormField>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Spinner />}
                {editSku ? 'Lưu thay đổi' : 'Tạo SKU'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Channel Tab ─────────────────────────────────────────────────────────────

function ChannelTab() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Channel>>({
    cnCode: '',
    cnName: '',
    region: '',
    lat: 0,
    lng: 0,
    connectivity: 'GOOD',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchChannels({ pageSize: 50 });
      setChannels(res.data ?? []);
    } catch {
      setError('Đang kết nối...');
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ cnCode: '', cnName: '', region: '', lat: 0, lng: 0, connectivity: 'GOOD' });
    setEditChannel(null);
    setShowAdd(true);
  };

  const openEdit = (ch: Channel) => {
    setForm({ ...ch });
    setEditChannel(ch);
    setShowAdd(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editChannel) {
        await updateChannel(editChannel.id, form);
      } else {
        await createChannel(form);
      }
      setShowAdd(false);
      await load();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500 flex-1">
          {channels.length > 0 ? `${channels.length} channels` : ''}
        </span>
        <button
          onClick={openAdd}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-sm transition-all"
        >
          + Add CN
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
            <Spinner />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-slate-400">{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">CN Code</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">CN Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Region</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Lat / Lng</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Connectivity</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {channels.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  channels.map((ch) => (
                    <tr key={ch.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{ch.cnCode}</td>
                      <td className="px-4 py-2.5 text-slate-700">{ch.cnName}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{ch.region ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs tabular-nums">
                        {ch.lat != null ? ch.lat.toFixed(4) : '—'} / {ch.lng != null ? ch.lng.toFixed(4) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ConnectivityBadge value={ch.connectivity} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ActiveBadge active={ch.active} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => openEdit(ch)}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal
          title={editChannel ? `Edit CN: ${editChannel.cnCode}` : 'Add Channel'}
          onClose={() => setShowAdd(false)}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="CN Code" required>
                <input
                  className={inputCls}
                  value={form.cnCode ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, cnCode: e.target.value }))}
                  disabled={!!editChannel}
                />
              </FormField>
              <FormField label="Region">
                <input
                  className={inputCls}
                  value={form.region ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                />
              </FormField>
            </div>
            <FormField label="CN Name" required>
              <input
                className={inputCls}
                value={form.cnName ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, cnName: e.target.value }))}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Latitude">
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={form.lat ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, lat: Number(e.target.value) }))}
                />
              </FormField>
              <FormField label="Longitude">
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={form.lng ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, lng: Number(e.target.value) }))}
                />
              </FormField>
            </div>
            <FormField label="Connectivity">
              <select
                className={inputCls}
                value={form.connectivity ?? 'GOOD'}
                onChange={(e) => setForm((f) => ({ ...f, connectivity: e.target.value }))}
              >
                <option value="GOOD">GOOD</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="WEAK">WEAK</option>
              </select>
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Spinner />}
                {editChannel ? 'Lưu thay đổi' : 'Tạo CN'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Supplier Tab ─────────────────────────────────────────────────────────────

function SupplierTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ leadTimeDays: string; contactEmail: string }>({
    leadTimeDays: '',
    contactEmail: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSuppliers({ pageSize: 50 });
      setSuppliers(res.data ?? []);
    } catch {
      setError('Đang kết nối...');
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (s: Supplier) => {
    setForm({
      leadTimeDays: s.leadTimeDays != null ? String(s.leadTimeDays) : '',
      contactEmail: '',
    });
    setEditSupplier(s);
  };

  const handleSave = async () => {
    if (!editSupplier) return;
    setSaving(true);
    try {
      await updateSupplier(editSupplier.supplierCode, {
        leadTimeDays: form.leadTimeDays != null ? Number(form.leadTimeDays) : undefined,
      });
      setEditSupplier(null);
      await load();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Danh sách NM — import từ CSV (Sprint 2). Chỉ có thể cập nhật Lead Time và Contact Email.
      </p>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
            <Spinner />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-slate-400">{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Supplier Code</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">NM Name</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Lead Time (days)</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">LT Drift</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  suppliers.map((s) => (
                    <tr key={s.supplierCode} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{s.supplierCode}</td>
                      <td className="px-4 py-2.5 text-slate-700">{s.supplierName}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600 text-xs tabular-nums">
                        {s.leadTimeDays ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                        <span
                          className={
                            s.ltDriftCount > 0
                              ? 'text-amber-600 font-semibold'
                              : 'text-slate-400'
                          }
                        >
                          {s.ltDriftCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ActiveBadge active={s.status === 'ACTIVE'} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => openEdit(s)}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editSupplier && (
        <Modal
          title={`Edit NM: ${editSupplier.supplierCode}`}
          onClose={() => setEditSupplier(null)}
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              NM: <span className="font-semibold text-slate-700">{editSupplier.supplierName}</span>
            </p>
            <FormField label="Lead Time (days)">
              <input
                type="number"
                className={inputCls}
                value={form.leadTimeDays}
                onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
              />
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditSupplier(null)}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Spinner />}
                Lưu thay đổi
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Hub Tab ──────────────────────────────────────────────────────────────────

function HubTab() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Hub>>({
    hubCode: '',
    hubName: '',
    hubType: 'VIRTUAL',
    lat: null,
    lng: null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchHubs({ pageSize: 50 });
      setHubs(res.data ?? []);
    } catch {
      setError('Đang kết nối...');
      setHubs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ hubCode: '', hubName: '', hubType: 'VIRTUAL', lat: null, lng: null });
    setShowAdd(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await createHub(form);
      setShowAdd(false);
      await load();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500 flex-1">
          {hubs.length > 0 ? `${hubs.length} hubs` : ''}
        </span>
        <button
          onClick={openAdd}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-sm transition-all"
        >
          + Add Hub
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
            <Spinner />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-slate-400">{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Hub Code</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Hub Name</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Type</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Lat / Lng</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {hubs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  hubs.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{h.hubCode}</td>
                      <td className="px-4 py-2.5 text-slate-700">{h.hubName}</td>
                      <td className="px-4 py-2.5 text-center">
                        <HubTypeBadge value={h.hubType} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs tabular-nums">
                        {h.lat != null ? h.lat.toFixed(4) : '—'} / {h.lng != null ? h.lng.toFixed(4) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ActiveBadge active={h.active} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal title="Add Hub" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Hub Code" required>
                <input
                  className={inputCls}
                  value={form.hubCode ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, hubCode: e.target.value }))}
                />
              </FormField>
              <FormField label="Hub Type">
                <select
                  className={inputCls}
                  value={form.hubType ?? 'VIRTUAL'}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hubType: e.target.value as 'VIRTUAL' | 'PHYSICAL' }))
                  }
                >
                  <option value="VIRTUAL">VIRTUAL</option>
                  <option value="PHYSICAL">PHYSICAL</option>
                </select>
              </FormField>
            </div>
            <FormField label="Hub Name" required>
              <input
                className={inputCls}
                value={form.hubName ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, hubName: e.target.value }))}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Latitude">
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={form.lat ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lat: e.target.value ? Number(e.target.value) : null }))
                  }
                />
              </FormField>
              <FormField label="Longitude">
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={form.lng ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lng: e.target.value ? Number(e.target.value) : null }))
                  }
                />
              </FormField>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Spinner />}
                Tạo Hub
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Quality Bar ─────────────────────────────────────────────────────────────

function QualityBar({ metrics }: { metrics: QualityMetrics | null }) {
  if (!metrics) return null;

  const items = [
    { label: 'SKU no NM', value: metrics.skuNoNmMapping, warn: true },
    { label: 'CN no geo', value: metrics.channelNoLatLng, warn: true },
    { label: 'NM no SKU', value: metrics.supplierNoSkuMapping, warn: true },
    { label: 'SKU no supply', value: metrics.skuNoRecentSupply, warn: true },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-2.5">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Data Quality</span>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{item.label}:</span>
            <span
              className={`text-xs font-bold tabular-nums ${
                item.warn && item.value > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MasterDataPage() {
  const [tab, setTab] = useState<Tab>('sku');
  const [quality, setQuality] = useState<QualityMetrics | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    // Load quality metrics
    fetchQuality()
      .then(setQuality)
      .catch(() => {/* silent */});

    // Load suppliers for SKU form dropdown
    fetchSuppliers({ pageSize: 100 })
      .then((res) => setSuppliers(res.data ?? []))
      .catch(() => {/* silent */});
  }, []);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'channel', label: 'Channel (CN)' },
    { key: 'supplier', label: 'Supplier (NM)' },
    { key: 'hub', label: 'Hub' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100">
            <span className="font-mono text-sm font-bold text-blue-600">00</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">M00 Master Data Platform</h1>
            <p className="text-sm text-slate-500">SKU · Channel · Supplier · Hub</p>
          </div>
        </div>
      </div>

      {/* ─── Tab Switcher ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'text-blue-600 border-b-2 border-blue-500 -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Quality Bar ─────────────────────────────────────────────────────── */}
      <QualityBar metrics={quality} />

      {/* ─── Tab Content ─────────────────────────────────────────────────────── */}
      {tab === 'sku' && <SkuTab suppliers={suppliers} />}
      {tab === 'channel' && <ChannelTab />}
      {tab === 'supplier' && <SupplierTab />}
      {tab === 'hub' && <HubTab />}
    </div>
  );
}
