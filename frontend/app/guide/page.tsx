'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchAllStatus,
  type AllModuleStatus,
  type M1Status, type M2Status, type M3Status, type M4Status,
} from '@/lib/api/guide';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ModuleId = 'M1' | 'M2' | 'M3' | 'M4';
type StepState = 'done' | 'current' | 'pending' | 'blocked';

const MODULE_META: Record<ModuleId, { label: string; title: string; href: string; step: string }> = {
  M1: { label: 'M1', title: 'Demand Ingestion',  href: '/demand',     step: 'Step 01' },
  M2: { label: 'M2', title: 'Supply Snapshot',   href: '/supply',     step: 'Step 02' },
  M3: { label: 'M3', title: 'Inventory Policy',  href: '/policy',     step: 'Step 03' },
  M4: { label: 'M4', title: 'DRP Netting',       href: '/drp',        step: 'Step 04' },
};

interface ActionStep {
  id: string;
  state: StepState;
  /** Short title shown in step header */
  title: string;
  /** Which page this action lives on */
  page: string;
  /** Exact href to navigate */
  pageHref: string;
  /** Location on the page (e.g. "góc trên phải") */
  where?: string;
  /** Exact button/element label to click — rendered as a mock button chip */
  clickTarget?: string;
  /** Tab to open first (if any) */
  tabTarget?: string;
  /** One-line concrete instruction */
  action: string;
  /** Extra context: field to fill, value to select, etc. */
  inputs?: { label: string; hint: string }[];
  /** Warning/alert badge */
  badge?: string;
  /** Note shown only when step is current */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Row — action-oriented layout
// ─────────────────────────────────────────────────────────────────────────────

function StepRow({ step, idx, total }: { step: ActionStep; idx: number; total: number }) {
  const isCurrent = step.state === 'current';
  const isDone    = step.state === 'done';
  const isBlocked = step.state === 'blocked';
  const isPending = step.state === 'pending';
  const isLast    = idx === total - 1;

  return (
    <div className={`flex gap-3 px-4 py-3 transition-all ${isCurrent ? 'bg-blue-50/70' : ''}`}>
      {/* Step number + connector */}
      <div className="flex flex-col items-center gap-0 pt-0.5 flex-shrink-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border-2 flex-shrink-0 ${
          isDone    ? 'bg-green-500 border-green-500 text-white' :
          isCurrent ? 'bg-blue-500 border-blue-500 text-white ring-2 ring-blue-200 ring-offset-1' :
          isBlocked ? 'bg-slate-100 border-slate-200 text-slate-300' :
                      'bg-white border-slate-200 text-slate-400'
        }`}>
          {isDone ? '✓' : isBlocked ? '⊘' : idx + 1}
        </div>
        {!isLast && <div className="w-px flex-1 mt-1 min-h-[20px] bg-slate-100" />}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-3 ${isBlocked || isPending ? 'opacity-50' : ''}`}>
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[13px] font-bold ${isDone ? 'text-green-700' : isCurrent ? 'text-blue-800' : 'text-slate-500'}`}>
            {step.title}
          </span>
          {isCurrent && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 animate-pulse">
              ← BẠN ĐANG Ở ĐÂY
            </span>
          )}
          {step.badge && isCurrent && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              {step.badge}
            </span>
          )}
        </div>

        {/* Action instruction block — only show when not blocked */}
        {!isBlocked && (
          <div className={`mt-2 rounded-lg border p-3 text-xs space-y-2 ${
            isDone    ? 'bg-green-50/50 border-green-100' :
            isCurrent ? 'bg-white border-blue-200 shadow-sm' :
                        'bg-slate-50 border-slate-100'
          }`}>
            {/* Page + location */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Trang</span>
              <Link
                href={step.pageHref}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] transition-colors"
              >
                {step.page} →
              </Link>
              {step.where && (
                <span className="text-[11px] text-slate-400">📍 {step.where}</span>
              )}
            </div>

            {/* Tab to open */}
            {step.tabTarget && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Tab</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-violet-700 font-semibold text-[11px]">
                  {step.tabTarget}
                </span>
              </div>
            )}

            {/* Click target */}
            {step.clickTarget && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Click</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white font-bold text-[11px] shadow-sm select-none">
                  {step.clickTarget}
                </span>
              </div>
            )}

            {/* Main action */}
            <p className={`text-[12px] leading-relaxed font-medium ${isDone ? 'text-green-700' : isCurrent ? 'text-slate-700' : 'text-slate-500'}`}>
              {step.action}
            </p>

            {/* Input fields needed */}
            {step.inputs && step.inputs.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-slate-100">
                {step.inputs.map(inp => (
                  <div key={inp.label} className="flex items-start gap-2">
                    <span className="text-[10px] font-semibold text-slate-400 mt-0.5 w-20 flex-shrink-0">{inp.label}</span>
                    <span className="text-[11px] text-slate-500 italic">{inp.hint}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Note */}
            {step.note && isCurrent && (
              <p className="text-[11px] text-amber-600 font-medium bg-amber-50 border border-amber-100 rounded px-2 py-1">
                ⚠ {step.note}
              </p>
            )}
          </div>
        )}

        {isBlocked && (
          <p className="mt-1 text-[11px] text-slate-400">🔒 Hoàn thành các bước trước để mở khoá.</p>
        )}

        {/* CTA button for current step */}
        {isCurrent && (
          <Link
            href={step.pageHref}
            className="inline-flex items-center gap-1.5 mt-2.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow"
          >
            Đến trang {step.page} →
          </Link>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step builders — each step = 1 concrete action
// ─────────────────────────────────────────────────────────────────────────────

function buildM1Steps(s: M1Status): ActionStep[] {
  const isDone   = s.step === 'DONE';
  const hasDraft = s.step === 'HAS_DRAFT';

  return [
    {
      id: 'm1-upload',
      state: isDone || hasDraft ? 'done' : 'current',
      title: 'Upload file forecast CSV',
      page: 'Demand',
      pageHref: '/demand',
      where: 'góc trên phải màn hình',
      clickTarget: 'Upload CSV',
      action: 'Chọn file CSV từ team thuật toán → hệ thống parse & validate tự động.',
      inputs: [
        { label: 'File', hint: 'File .csv — cột: item_code, location_code, period, qty' },
      ],
    },
    {
      id: 'm1-review',
      state: isDone ? 'done' : hasDraft ? 'current' : 'pending',
      title: 'Kiểm tra snapshot DRAFT',
      page: 'Demand',
      pageHref: '/demand',
      tabTarget: 'Branch',
      where: 'bảng Snapshot Management ở cuối tab Branch',
      action: `Xem lại ${s.totalLines > 0 ? s.totalLines.toLocaleString('vi-VN') + ' dòng' : 'dữ liệu'} — kiểm tra forecast summary, lỗi validation. Override qty nếu cần.`,
      note: hasDraft ? `Snapshot DRAFT "${s.latestDraftName ?? ''}" đang chờ review.` : undefined,
    },
    {
      id: 'm1-freeze',
      state: isDone ? 'done' : hasDraft ? 'pending' : 'pending',
      title: 'Freeze snapshot → FROZEN',
      page: 'Demand',
      pageHref: '/demand',
      tabTarget: 'Branch',
      where: 'bảng Snapshot Management — cột Actions',
      clickTarget: 'Freeze',
      action: 'Click Freeze trên snapshot DRAFT → chuyển sang FROZEN (immutable). DRP (M4) chỉ đọc snapshot FROZEN.',
    },
  ];
}

function buildM2Steps(s: M2Status, m1Done: boolean): ActionStep[] {
  const isDone   = s.step === 'DONE';
  const hasDraft = s.step === 'HAS_DRAFT' || s.step === 'STALE_DRAFT';
  const isStale  = s.step === 'STALE_LOT';
  const b = (st: StepState): StepState => !m1Done ? 'blocked' : st;

  return [
    {
      id: 'm2-check',
      state: b(isDone || hasDraft ? 'done' : 'current'),
      title: 'Kiểm tra freshness dữ liệu Bravo',
      page: 'Supply',
      pageHref: '/supply',
      tabTarget: 'Dashboard',
      where: 'thẻ "Freshness" trên Dashboard',
      action: `Xác nhận dữ liệu lot từ Bravo ERP sync trong vòng 240 phút.${s.lotAgeMinutes > 0 ? ` Hiện tại: ${s.lotAgeMinutes} phút.` : ''}`,
      badge: s.lotFreshness === 'STALE' ? `STALE ${s.lotAgeMinutes}m` : undefined,
      note: isStale ? 'Dữ liệu đã cũ — vẫn capture được nhưng phải acknowledge.' : undefined,
    },
    {
      id: 'm2-upload',
      state: b(isDone || hasDraft ? 'done' : isStale ? 'current' : 'current'),
      title: 'Upload file Bravo (nếu cần cập nhật)',
      page: 'Supply',
      pageHref: '/supply',
      where: 'góc trên phải màn hình',
      clickTarget: 'Upload Bravo',
      action: 'Upload file lot_attribute từ Bravo ERP để cập nhật tồn kho mới nhất trước khi capture.',
      inputs: [
        { label: 'File', hint: 'File export từ Bravo — lot_attribute với on_hand_qty, reserved_qty, quality_status' },
      ],
    },
    {
      id: 'm2-capture',
      state: b(isDone ? 'done' : hasDraft ? 'done' : 'current'),
      title: 'Capture Supply Snapshot',
      page: 'Supply',
      pageHref: '/supply',
      where: 'góc trên phải màn hình',
      clickTarget: 'Capture Snapshot',
      action: 'Hệ thống tổng hợp tất cả lot ALLOCATABLE → tính allocatable_qty = on_hand - reserved theo item × location.',
    },
    {
      id: 'm2-ack',
      state: b(isDone ? 'done' : s.step === 'STALE_DRAFT' ? 'current' : s.draftFreshness === 'PASS' ? 'done' : 'pending'),
      title: 'Acknowledge STALE (nếu snapshot bị stale)',
      page: 'Supply',
      pageHref: '/supply',
      where: 'banner cảnh báo màu vàng phía trên trang',
      clickTarget: 'Xác nhận',
      action: 'Nếu có banner STALE: điền lý do → click Xác nhận để tiếp tục.',
      inputs: [
        { label: 'Lý do', hint: 'Ví dụ: "Bravo bảo trì — dữ liệu lấy từ ngày hôm trước"' },
      ],
      badge: s.step === 'STALE_DRAFT' ? 'Cần xử lý' : undefined,
      note: s.step === 'STALE_DRAFT' ? 'Snapshot chưa được acknowledge. Bắt buộc trước khi Freeze.' : undefined,
    },
    {
      id: 'm2-freeze',
      state: b(isDone ? 'done' : s.step === 'HAS_DRAFT' ? 'current' : 'pending'),
      title: 'Freeze snapshot → FROZEN',
      page: 'Supply',
      pageHref: '/supply',
      tabTarget: 'Snapshot List',
      where: 'bảng danh sách snapshots — cột Actions',
      clickTarget: 'Freeze',
      action: `Click Freeze trên snapshot DRAFT → FROZEN.${s.totalLines > 0 ? ` (${s.totalLines.toLocaleString('vi-VN')} dòng)` : ''} DRP tuần 1 SR sẽ đọc in_transit từ snapshot này.`,
    },
  ];
}

function buildM3Steps(s: M3Status, m1Done: boolean): ActionStep[] {
  const isDone   = s.step === 'DONE';
  const hasDraft = s.step === 'SS_CALCULATED';
  const b = (st: StepState): StepState => !m1Done ? 'blocked' : st;

  return [
    {
      id: 'm3-abc',
      state: b(isDone || hasDraft ? 'done' : 'current'),
      title: 'Import ABC Classification từ Demand snapshot',
      page: 'Policy',
      pageHref: '/policy',
      tabTarget: 'Planning Cycle',
      where: 'nút Import ở phần ABC Classification',
      clickTarget: 'Import ABC from Snapshot',
      action: 'Đọc cột segment (A/B/C) từ demand_snapshot_line → lưu vào item_abc_classification. Tự động kiểm tra vs. internal ranking.',
    },
    {
      id: 'm3-ss',
      state: b(isDone || hasDraft ? 'done' : 'pending'),
      title: 'Tính Safety Stock (batch ~4,800 combinations)',
      page: 'Policy',
      pageHref: '/policy',
      tabTarget: 'Plugin Params',
      where: 'nút tính SS ở cuối trang',
      clickTarget: 'Recalculate Safety Stock',
      action: 'Hệ thống tính SS theo công thức: z×√(LT×σd²+ADU²×σlt²), cap DOS (A=45d, B=35d, C=20d). Mất ~25 giây.',
    },
    {
      id: 'm3-lcnb',
      state: b(isDone ? 'done' : hasDraft ? 'current' : 'pending'),
      title: 'Review SS targets & LCNB flags',
      page: 'Policy',
      pageHref: '/policy',
      tabTarget: 'Plugin Params',
      where: 'bảng kết quả SS — lọc cột LCNB = true',
      action: `Xem ${s.lcnbCount > 0 ? s.lcnbCount + ' items bị LCNB flag' : 'kết quả SS'}. Override SS thủ công nếu cần (nhập lý do bắt buộc).`,
      badge: s.lcnbCount > 0 && !isDone ? `${s.lcnbCount} LCNB` : undefined,
      note: s.lcnbCount > 0 && !isDone ? `${s.lcnbCount} items SS quá cao do forecast error lớn.` : undefined,
    },
    {
      id: 'm3-activate',
      state: b(isDone ? 'done' : hasDraft ? 'current' : 'pending'),
      title: 'Activate Policy Run',
      page: 'Policy',
      pageHref: '/policy',
      tabTarget: 'Planning Cycle',
      where: 'panel Policy Run — cột Actions',
      clickTarget: 'Activate',
      action: `Policy run DRAFT → ACTIVE. Chỉ 1 run ACTIVE tại 1 thời điểm.${s.totalCombinations > 0 ? ` (${s.totalCombinations.toLocaleString('vi-VN')} combinations)` : ''} DRP chỉ đọc SS từ run ACTIVE.`,
      note: hasDraft ? 'Policy đã tính xong — cần Activate để DRP (M4) có thể dùng.' : undefined,
    },
  ];
}

function buildM4Steps(s: M4Status, prereqDone: boolean): ActionStep[] {
  const isDone    = s.step === 'DONE';
  const isRunning = s.step === 'RUNNING';
  const hasExc    = s.step === 'HAS_EXCEPTIONS' || s.step === 'HAS_FROZEN_PO';
  const hasFrozen = s.step === 'HAS_FROZEN_PO';
  const b = (st: StepState): StepState => !prereqDone ? 'blocked' : st;

  return [
    {
      id: 'm4-create',
      state: b(isDone || hasExc || isRunning ? 'done' : 'current'),
      title: 'Tạo DRP Plan Run mới',
      page: 'DRP',
      pageHref: '/drp',
      tabTarget: 'Run Dashboard',
      where: 'góc trên phải màn hình',
      clickTarget: '+ Tạo Plan Run',
      action: 'Mở dialog tạo run → chọn snapshots và cấu hình.',
      inputs: [
        { label: 'Demand', hint: 'Chọn demand snapshot FROZEN (M1)' },
        { label: 'Supply', hint: 'Chọn supply snapshot FROZEN (M2)' },
        { label: 'Horizon', hint: 'Số tuần (mặc định 12 tuần)' },
        { label: 'Frozen Zone', hint: 'Số tuần frozen (mặc định 2 tuần)' },
        { label: 'Created By', hint: 'Email người tạo, ví dụ: planner@unis.vn' },
      ],
      note: !prereqDone ? 'M1 + M2 + M3 phải DONE trước khi tạo DRP run.' : undefined,
    },
    {
      id: 'm4-run',
      state: b(isDone || hasExc || isRunning ? 'done' : 'pending'),
      title: 'Nhấn "Chạy DRP" để bắt đầu netting',
      page: 'DRP',
      pageHref: '/drp',
      where: 'trong dialog tạo run',
      clickTarget: 'Chạy DRP',
      action: 'Hệ thống netting 12 tuần cho ~4,800 item×location. Mất khoảng 45 giây.',
    },
    {
      id: 'm4-wait',
      state: b(isRunning ? 'current' : (isDone || hasExc) ? 'done' : 'pending'),
      title: 'Chờ run hoàn tất (RUNNING → COMPLETED)',
      page: 'DRP',
      pageHref: '/drp',
      tabTarget: 'Run Dashboard',
      where: 'bảng Plan Runs — cột Status',
      clickTarget: 'Refresh',
      action: 'Click Refresh để cập nhật trạng thái. Run chuyển RUNNING → COMPLETED tự động.',
      badge: isRunning ? 'Đang chạy...' : undefined,
      note: isRunning ? `Run #${s.latestRunId} đang xử lý. Click Refresh để theo dõi.` : undefined,
    },
    {
      id: 'm4-exceptions',
      state: b(isDone ? 'done' : hasExc ? 'current' : 'pending'),
      title: 'Xử lý Exceptions',
      page: 'DRP',
      pageHref: '/drp',
      tabTarget: 'Exceptions',
      where: 'tab Exceptions — bảng danh sách',
      clickTarget: 'Resolve',
      action: `Review từng exception → click Resolve → điền note xử lý. Ưu tiên: HIGH (PAB_NEGATIVE) trước.`,
      inputs: [
        { label: 'Ghi chú', hint: 'Ví dụ: "Tăng SS hoặc đẩy sớm PO tuần 3"' },
      ],
      badge: s.openExceptions > 0 && !isDone ? `${s.openExceptions} chưa xử lý` : undefined,
      note: s.openExceptions > 0 && !isDone ? `Còn ${s.openExceptions} exceptions chưa resolve.` : undefined,
    },
    {
      id: 'm4-approve',
      state: b(isDone ? 'done' : hasFrozen ? 'current' : 'pending'),
      title: 'Duyệt Planned Orders vùng Frozen (tuần 1–2)',
      page: 'DRP',
      pageHref: '/drp',
      tabTarget: 'Planned Orders',
      where: 'tab Planned Orders — filter "Frozen Zone ❄"',
      clickTarget: 'Approve',
      action: 'Lọc Frozen Zone → review từng order NEEDS_APPROVAL → click Approve để chuyển sang RELEASED.',
      inputs: [
        { label: 'Filter', hint: 'Chọn "Frozen Zone ❄" + Status "NEEDS_APPROVAL"' },
      ],
      badge: s.frozenZonePending > 0 && !isDone ? `${s.frozenZonePending} chờ duyệt` : undefined,
      note: s.frozenZonePending > 0 && !isDone ? `${s.frozenZonePending} POs trong frozen zone cần duyệt thủ công.` : undefined,
    },
    {
      id: 'm4-handoff',
      state: b(isDone ? 'done' : 'pending'),
      title: 'Bàn giao cho M5 Allocation',
      page: 'DRP',
      pageHref: '/drp',
      tabTarget: 'Planned Orders',
      where: 'bảng Planned Orders — cột Status',
      action: `${s.totalPlannedOrders > 0 ? s.totalPlannedOrders.toLocaleString('vi-VN') + ' planned orders' : 'Planned orders'} với status AUTO_RELEASE + RELEASED sẵn sàng → M5 Allocation Engine đọc và phân bổ.`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Module completion helpers
// ─────────────────────────────────────────────────────────────────────────────

function moduleCompletionLevel(id: ModuleId, status: AllModuleStatus): 'DONE' | 'IN_PROGRESS' | 'BLOCKED' | 'EMPTY' {
  if (id === 'M1') return status.m1.step === 'DONE' ? 'DONE' : status.m1.step === 'HAS_DRAFT' ? 'IN_PROGRESS' : 'EMPTY';
  if (id === 'M2') {
    if (status.m1.step !== 'DONE') return 'BLOCKED';
    return status.m2.step === 'DONE' ? 'DONE' : status.m2.step === 'EMPTY' ? 'EMPTY' : 'IN_PROGRESS';
  }
  if (id === 'M3') {
    if (status.m1.step !== 'DONE') return 'BLOCKED';
    return status.m3.step === 'DONE' ? 'DONE' : status.m3.step === 'EMPTY' ? 'EMPTY' : 'IN_PROGRESS';
  }
  if (id === 'M4') {
    if (status.m1.step !== 'DONE' || status.m2.step !== 'DONE' || status.m3.step !== 'DONE') return 'BLOCKED';
    return status.m4.step === 'DONE' ? 'DONE' : status.m4.step === 'EMPTY' ? 'EMPTY' : 'IN_PROGRESS';
  }
  return 'EMPTY';
}

function overallProgress(status: AllModuleStatus): number {
  let done = 0;
  if (status.m1.step === 'DONE') done++;
  if (status.m2.step === 'DONE') done++;
  if (status.m3.step === 'DONE') done++;
  if (status.m4.step === 'DONE') done++;
  return done;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Tab Button
// ─────────────────────────────────────────────────────────────────────────────

function ModuleTabBtn({ id, active, level, onClick }: {
  id: ModuleId; active: boolean; level: ReturnType<typeof moduleCompletionLevel>; onClick: () => void;
}) {
  const meta = MODULE_META[id];
  const icon = level === 'DONE' ? '✅' : level === 'IN_PROGRESS' ? '🔄' : level === 'BLOCKED' ? '🔒' : '○';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
        active
          ? 'bg-blue-600 text-white border-blue-600 shadow-md'
          : level === 'DONE'
          ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
          : level === 'BLOCKED'
          ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-default'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span>{icon}</span>
      <span>{meta.label}</span>
      <span className={`font-normal text-[11px] ${active ? 'text-blue-200' : 'text-slate-400'}`}>{meta.title}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Panel
// ─────────────────────────────────────────────────────────────────────────────

function ModulePanel({ id, status }: { id: ModuleId; status: AllModuleStatus }) {
  const meta  = MODULE_META[id];
  const level = moduleCompletionLevel(id, status);

  const steps: ActionStep[] = (() => {
    const prereq = status.m1.step === 'DONE' && status.m2.step === 'DONE' && status.m3.step === 'DONE';
    if (id === 'M1') return buildM1Steps(status.m1);
    if (id === 'M2') return buildM2Steps(status.m2, status.m1.step === 'DONE');
    if (id === 'M3') return buildM3Steps(status.m3, status.m1.step === 'DONE');
    return buildM4Steps(status.m4, prereq);
  })();

  const doneCount = steps.filter(s => s.state === 'done').length;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[rgba(148,173,215,0.15)]">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">{meta.step}</p>
            <h2 className="text-sm font-bold text-slate-700">{meta.title}</h2>
          </div>
          <div className="flex-1" />
          {level === 'BLOCKED' && (
            <span className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-500 font-semibold border border-slate-200">
              🔒 Chờ module trước
            </span>
          )}
          {level === 'DONE' && (
            <span className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 font-semibold border border-green-200">
              ✅ Hoàn thành
            </span>
          )}
          {level === 'IN_PROGRESS' && (
            <span className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 font-semibold border border-blue-200 animate-pulse">
              🔄 Đang thực hiện
            </span>
          )}
          <Link
            href={meta.href}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors font-medium"
          >
            Mở trang →
          </Link>
        </div>

        {/* Progress */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${level === 'DONE' ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-400 font-mono">{doneCount}/{steps.length}</span>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-[rgba(148,173,215,0.08)]">
        {steps.map((step, idx) => (
          <StepRow key={step.id} step={step} idx={idx} total={steps.length} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Next Module CTA
// ─────────────────────────────────────────────────────────────────────────────

const NEXT_MODULE: Record<ModuleId, { nextId: ModuleId | null; nextTitle: string; nextHref: string; message: string }> = {
  M1: { nextId: 'M2', nextTitle: 'Supply Snapshot',  nextHref: '/supply',     message: 'Demand frozen ✓ — Tiếp theo: capture Supply Snapshot (M2).' },
  M2: { nextId: 'M3', nextTitle: 'Inventory Policy', nextHref: '/policy',     message: 'Supply frozen ✓ — Tiếp theo: import ABC & tính Safety Stock (M3).' },
  M3: { nextId: 'M4', nextTitle: 'DRP Netting',      nextHref: '/drp',        message: 'Policy active ✓ — Tiếp theo: chạy DRP Netting (M4).' },
  M4: { nextId: null, nextTitle: 'Allocation',       nextHref: '/allocation', message: '🎉 M1→M4 hoàn tất! Pipeline sẵn sàng cho Allocation (M5).' },
};

function NextModuleCta({ activeTab, status, onSwitch }: {
  activeTab: ModuleId; status: AllModuleStatus; onSwitch: (id: ModuleId) => void;
}) {
  if (moduleCompletionLevel(activeTab, status) !== 'DONE') return null;
  const info = NEXT_MODULE[activeTab];
  const isAllDone = info.nextId === null;

  return (
    <div className={`rounded-xl border px-4 py-3.5 flex items-center gap-4 flex-wrap shadow-sm ${
      isAllDone ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'
    }`}>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold uppercase tracking-wider ${isAllDone ? 'text-emerald-600' : 'text-blue-600'}`}>
          {isAllDone ? '✅ Tất cả module hoàn thành' : `✅ ${activeTab} xong — Bước tiếp theo`}
        </p>
        <p className="text-sm text-slate-700 mt-0.5">{info.message}</p>
      </div>
      {info.nextId ? (
        <button
          onClick={() => onSwitch(info.nextId!)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors shadow"
        >
          Xem hướng dẫn {info.nextId} →
        </button>
      ) : (
        <Link href={info.nextHref} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors shadow">
          Mở M5 →
        </Link>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall Progress Banner
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBanner({ status }: { status: AllModuleStatus }) {
  const done = overallProgress(status);
  const pct  = (done / 4) * 100;
  const msgs = [
    'Bắt đầu từ M1: upload file forecast CSV.',
    'M1 xong → M2: capture supply snapshot từ Bravo.',
    'M1+M2 xong → M3: import ABC & activate policy.',
    'M1+M2+M3 xong → M4: chạy DRP netting.',
    '🎉 M1→M4 hoàn tất! Pipeline sẵn sàng cho Allocation (M5).',
  ];

  return (
    <div className="glass-card px-4 py-3.5">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Tiến độ tổng thể M1→M4</p>
          <p className="text-sm font-bold text-slate-700 mt-0.5">{msgs[done]}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(['M1', 'M2', 'M3', 'M4'] as ModuleId[]).map(id => {
            const lv = moduleCompletionLevel(id, status);
            return (
              <div key={id} className={`h-2 w-8 rounded-full ${lv === 'DONE' ? 'bg-green-400' : lv === 'IN_PROGRESS' ? 'bg-blue-400 animate-pulse' : 'bg-slate-200'}`} title={id} />
            );
          })}
          <span className="text-xs font-bold text-slate-500 ml-1">{done}/4</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${done === 4 ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  const [status, setStatus]       = useState<AllModuleStatus | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<ModuleId>('M1');
  const [lastLoad, setLastLoad]   = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchAllStatus();
      setStatus(s);
      setLastLoad(s.loadedAt);
      // Auto-jump to first incomplete module
      if (s.m1.step !== 'DONE') setActiveTab('M1');
      else if (s.m2.step !== 'DONE') setActiveTab('M2');
      else if (s.m3.step !== 'DONE') setActiveTab('M3');
      else setActiveTab('M4');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-3">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">🗺 Smart Guide</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Từng bước cụ thể — trang nào, click nút gì, nhập gì.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors shadow-sm"
          >
            <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
            Refresh
          </button>
        </div>

        {lastLoad && (
          <p className="text-[11px] text-slate-400">
            Cập nhật {fmtTime(lastLoad)}
            {loading && <span className="ml-2 text-blue-400 animate-pulse">Đang tải...</span>}
          </p>
        )}

        {!status && loading && (
          <div className="glass-card p-8 flex items-center justify-center">
            <p className="text-sm text-slate-400 animate-pulse">Đang kiểm tra trạng thái hệ thống...</p>
          </div>
        )}

        {status && (
          <>
            <ProgressBanner status={status} />

            {/* Module tabs */}
            <div className="flex gap-2 flex-wrap">
              {(['M1', 'M2', 'M3', 'M4'] as ModuleId[]).map(id => (
                <ModuleTabBtn
                  key={id}
                  id={id}
                  active={activeTab === id}
                  level={moduleCompletionLevel(id, status)}
                  onClick={() => setActiveTab(id)}
                />
              ))}
            </div>

            {/* Active module */}
            <ModulePanel id={activeTab} status={status} />

            {/* Next module CTA */}
            <NextModuleCta activeTab={activeTab} status={status} onSwitch={setActiveTab} />

            {/* Legend */}
            <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-400 px-1">
              <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-green-500 inline-block" /> Đã xong</span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-blue-500 inline-block ring-2 ring-blue-200" /> Bước hiện tại</span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-white border-2 border-slate-200 inline-block" /> Chưa đến</span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-slate-100 border-2 border-slate-200 inline-block" /> Bị khoá</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
