'use client';

import { useState, useEffect } from 'react';
import { fetchSupplyMetaLocations, type SupplyMetaLocation } from '@/lib/api/supply';

function defaultName() {
  return `Tồn kho ${new Date().toLocaleDateString('vi-VN')}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // FE-A3: thêm locationCodes — Phase B sẽ pass xuống BE, Phase A prep sẵn
  onCapture: (name: string, includeInTransit: boolean, locationCodes?: string[]) => Promise<void>;
}

export function CaptureDialog({ open, onClose, onCapture }: Props) {
  const [name, setName] = useState(defaultName);
  const [includeInTransit, setIncludeInTransit] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Location checklist
  const [locations, setLocations] = useState<SupplyMetaLocation[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [checkedCodes, setCheckedCodes] = useState<Set<string>>(new Set());
  const [allChecked, setAllChecked] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(defaultName());
    setError('');
    setLocLoading(true);
    fetchSupplyMetaLocations()
      .then(({ locations: locs }) => {
        setLocations(locs);
        setCheckedCodes(new Set(locs.map(l => l.locationCode)));
        setAllChecked(true);
      })
      .catch(() => setLocations([]))
      .finally(() => setLocLoading(false));
  }, [open]);

  if (!open) return null;

  const handleToggleAll = () => {
    if (allChecked) {
      setCheckedCodes(new Set());
      setAllChecked(false);
    } else {
      setCheckedCodes(new Set(locations.map(l => l.locationCode)));
      setAllChecked(true);
    }
  };

  const handleToggle = (code: string) => {
    const next = new Set(checkedCodes);
    if (next.has(code)) next.delete(code); else next.add(code);
    setCheckedCodes(next);
    setAllChecked(next.size === locations.length);
  };

  const previewItems = locations
    .filter(l => checkedCodes.has(l.locationCode))
    .reduce((sum, l) => sum + l.itemCount, 0);

  const handleCapture = async () => {
    if (!name.trim()) { setError('Tên snapshot là bắt buộc'); return; }
    setLoading(true);
    setError('');
    try {
      // TODO Phase B: pass locationCodes to BE when POST /supply/snapshots supports it
      const selectedCodes = checkedCodes.size < locations.length
        ? Array.from(checkedCodes)
        : undefined; // undefined = tất cả → behavior cũ
      await onCapture(name.trim(), includeInTransit, selectedCodes);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Capture thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Capture Snapshot Tồn kho</h2>
          <button onClick={onClose} disabled={loading} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Snapshot name */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Tên Snapshot <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50"
            />
          </div>

          {/* Include in-transit */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeInTransit}
              onChange={e => setIncludeInTransit(e.target.checked)}
              disabled={loading}
              className="rounded accent-orange-500"
            />
            <span className="text-sm text-slate-700">Bao gồm in-transit</span>
          </label>

          {/* Location checklist */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">
              Filter Locations <span className="text-slate-400">(tuỳ chọn — trống = tất cả)</span>
            </label>

            {locLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Đang tải locations...
              </div>
            ) : locations.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">Không có dữ liệu location</p>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-44 overflow-y-auto">
                <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 select-none">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={handleToggleAll}
                    disabled={loading}
                    className="rounded accent-orange-500"
                  />
                  <span className="text-xs font-semibold text-slate-600">Chọn tất cả</span>
                </label>
                {locations.map(loc => (
                  <label key={loc.locationCode} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 select-none">
                    <input
                      type="checkbox"
                      checked={checkedCodes.has(loc.locationCode)}
                      onChange={() => handleToggle(loc.locationCode)}
                      disabled={loading}
                      className="rounded accent-orange-500"
                    />
                    <span className="text-xs text-slate-700 flex-1">{loc.locationCode}</span>
                    <span className="text-[10px] text-slate-400">{loc.itemCount.toLocaleString()} items</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {locations.length > 0 && (
            <div className="rounded-lg bg-orange-50 border border-orange-100 px-3 py-2">
              <p className="text-xs text-orange-700">
                Preview: <span className="font-semibold">~{previewItems.toLocaleString()} items</span>
                {' · '}
                <span className="font-semibold">{checkedCodes.size}</span> locations
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            onClick={handleCapture}
            disabled={loading || !name.trim() || (locations.length > 0 && checkedCodes.size === 0)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && (
              <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            Capture Now
          </button>
        </div>
      </div>
    </div>
  );
}
