"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X, ChevronLeft, ChevronRight, Map } from "lucide-react";

interface TourStep {
  title: string;
  location?: string;
  clickTarget?: string;
  actions: string[];
  inputs?: { label: string; value: string }[];
  warn?: string;
  tip?: string;
}

interface PageTour {
  module: string;
  steps: TourStep[];
}

const PAGE_TOURS: Record<string, PageTour> = {
  "/demand": {
    module: "M1 - Demand Ingestion",
    steps: [
      {
        title: "Tao snapshot moi",
        location: "Goc tren phai man hinh",
        clickTarget: "+ New Snapshot",
        actions: [
          "Click nut [+ New Snapshot] o goc tren phai man hinh.",
          "Dien ten snapshot (vi du: W18-2026) roi xac nhan.",
          "Snapshot moi tao ra o trang thai DRAFT.",
        ],
      },
      {
        title: "Upload file forecast CSV",
        location: "Goc tren phai man hinh",
        clickTarget: "Upload CSV",
        actions: [
          "Click nut [Upload CSV] o goc tren phai.",
          "Chon file .csv tu team thuat toan.",
          "He thong tu dong parse, validate va loc items.",
        ],
        inputs: [{ label: "File", value: "forecast_W18.csv - cot: item_code, location_code, period, qty" }],
        tip: "Neu file co loi, he thong bao chi tiet tung dong loi.",
      },
      {
        title: "Kiem tra snapshot DRAFT",
        location: "Tab Branch -> cuon xuong cuoi trang",
        actions: [
          "Chuyen sang tab [Branch] o thanh tab tren cung.",
          "Cuon xuong phan Snapshot Management o cuoi trang.",
          "Kiem tra: tong so dong, coverage, validation errors.",
          "Neu can override qty: click vao dong, nhap ly do (bat buoc).",
        ],
        tip: "So dong expected = so SKU x so branch x so tuan forecast.",
      },
      {
        title: "Freeze snapshot",
        location: "Tab Branch -> bang Snapshot Management -> cot Actions",
        clickTarget: "Freeze",
        actions: [
          "Tim snapshot DRAFT vua upload trong bang Snapshot Management.",
          "Click nut [Freeze] o cot Actions.",
          "Xac nhan trong hop thoai.",
          "Snapshot chuyen sang FROZEN - khong the chinh sua nua.",
        ],
        warn: "Sau khi Freeze khong the undo. Kiem tra ky buoc tren truoc khi Freeze.",
      },
    ],
  },
  "/supply": {
    module: "M2 - Supply Snapshot",
    steps: [
      {
        title: "Kiem tra freshness du lieu Bravo",
        location: "Tab Dashboard - the Freshness",
        actions: [
          "Xem the Freshness tren Dashboard tab.",
          "Nguong cho phep: <= 240 phut (4 tieng) ke tu lan sync cuoi.",
          "Neu > 240 phut: du lieu STALE - can upload lai hoac acknowledge.",
        ],
        warn: "Neu du lieu STALE, ban van capture duoc nhung phai giai thich ly do.",
      },
      {
        title: "Upload file Bravo",
        location: "Goc tren phai man hinh",
        clickTarget: "Upload Bravo",
        actions: [
          "Click [Upload Bravo] o goc tren phai.",
          "Chon file lot_attribute export tu Bravo ERP.",
          "He thong cap nhat on_hand_qty, reserved_qty, quality_status.",
        ],
        inputs: [{ label: "File", value: "lot_attribute export tu Bravo ERP" }],
        tip: "Chi lot co quality_status = ALLOCATABLE moi duoc tinh vao supply.",
      },
      {
        title: "Capture Supply Snapshot",
        location: "Goc tren phai man hinh",
        clickTarget: "Capture Snapshot",
        actions: [
          "Click [Capture Snapshot] o goc tren phai.",
          "He thong tong hop tat ca lot ALLOCATABLE theo item x location.",
          "Tu dong tinh: allocatable_qty = on_hand - reserved.",
          "Snapshot tao ra o trang thai DRAFT.",
        ],
      },
      {
        title: "Acknowledge snapshot STALE",
        location: "Banner vang phia tren trang",
        clickTarget: "Xac nhan",
        actions: [
          "Neu co banner canh bao mau vang STALE - khong bo qua.",
          "Dien ly do vao o text (bat buoc).",
          "Click [Xac nhan] de tiep tuc.",
        ],
        inputs: [{ label: "Ly do", value: "VD: Bravo dang bao tri - du lieu tu hom qua" }],
        warn: "Buoc nay chi xuat hien neu snapshot STALE. Neu khong co banner bo qua.",
      },
      {
        title: "Freeze snapshot",
        location: "Tab Snapshot List -> cot Actions",
        clickTarget: "Freeze",
        actions: [
          "Chuyen sang tab [Snapshot List].",
          "Tim snapshot DRAFT vua capture.",
          "Click [Freeze] o cot Actions va xac nhan.",
          "Snapshot FROZEN - DRP (M4) se doc in_transit_qty tu day.",
        ],
        warn: "Sau khi Freeze khong the thay doi. Chi Freeze khi da kiem tra xong.",
      },
    ],
  },
  "/policy": {
    module: "M3 - Inventory Policy",
    steps: [
      {
        title: "Kiem tra cau hinh Plugin Params",
        location: "Tab Plugin Params",
        actions: [
          "Chuyen sang tab [Plugin Params].",
          "Kiem tra CSL: A=99%, B=95%, C=90% la mac dinh.",
          "Kiem tra HSTK: stockout < 1.5 tuan, overstock > 3.0 tuan.",
          "Kiem tra LCNB mode: OFF / DETECT_ONLY / EXECUTE.",
        ],
        tip: "Neu thay doi: dien ten nguoi thay doi, click [Save Changes].",
      },
      {
        title: "Import ABC Classification",
        location: "Tab Planning Cycle",
        clickTarget: "Import ABC from Snapshot",
        actions: [
          "Chuyen sang tab [Planning Cycle].",
          "Click [Import ABC from Snapshot].",
          "He thong doc segment A/B/C tu demand_snapshot_line FROZEN.",
          "Tu dong luu vao item_abc_classification.",
        ],
        tip: "Phai co demand snapshot FROZEN (M1) truoc khi import.",
      },
      {
        title: "Tinh Safety Stock",
        location: "Tab Plugin Params -> cuoi trang",
        clickTarget: "Recalculate Safety Stock",
        actions: [
          "Cuon xuong cuoi tab Plugin Params.",
          "Click [Recalculate Safety Stock].",
          "He thong tinh SS cho ~4,800 item x location combinations.",
          "Thoi gian xu ly: khoang 25 giay.",
        ],
        tip: "A: cap 45 ngay, B: 35 ngay, C: 20 ngay.",
      },
      {
        title: "Review LCNB flags",
        location: "Tab Plugin Params -> bang SS Results",
        actions: [
          "Xem bang ket qua SS sau khi tinh xong.",
          "Loc cot LCNB = true de xem cac items bat thuong.",
          "Override SS thu cong neu can - dien ly do bat buoc.",
        ],
        warn: "Items LCNB nen duoc SC Manager xem xet truoc khi activate.",
      },
      {
        title: "Activate Policy Run",
        location: "Tab Planning Cycle -> bang Policy Runs -> cot Actions",
        clickTarget: "Activate",
        actions: [
          "Vao tab [Planning Cycle].",
          "Trong bang Policy Runs, tim run vua tinh (DRAFT).",
          "Click [Activate] o cot Actions.",
          "Run chuyen sang ACTIVE - DRP chi doc SS tu run ACTIVE.",
        ],
        warn: "Chi 1 policy run ACTIVE tai 1 thoi diem. Run cu se tu DEACTIVATED.",
      },
    ],
  },
  "/drp": {
    module: "M4 - DRP Netting",
    steps: [
      {
        title: "Tao DRP Plan Run",
        location: "Tab Run Dashboard -> goc tren phai",
        clickTarget: "+ Tao Plan Run",
        actions: [
          "Click [+ Tao Plan Run] o goc tren phai.",
          "Hop thoai xuat hien - dien day du thong tin ben duoi.",
        ],
        inputs: [
          { label: "Demand", value: "Chon demand snapshot FROZEN (M1)" },
          { label: "Supply", value: "Chon supply snapshot FROZEN (M2)" },
          { label: "Horizon", value: "So tuan netting (mac dinh 12 tuan)" },
          { label: "Frozen Zone", value: "So tuan can duyet thu cong (mac dinh 2)" },
          { label: "Created By", value: "Email nguoi tao, VD: planner@unis.vn" },
        ],
      },
      {
        title: "Chay DRP va cho hoan tat",
        location: "Dialog tao run -> nut cuoi",
        clickTarget: "Chay DRP",
        actions: [
          "Sau khi dien xong click [Chay DRP].",
          "He thong bat dau netting 12 tuan x ~4,800 combinations.",
          "Tab Run Dashboard hien status: RUNNING thi COMPLETED.",
          "Click [Refresh] de cap nhat. Mat khoang 45 giay.",
        ],
        tip: "Neu run bi loi FAILED: kiem tra M1/M2/M3 da FROZEN/ACTIVE chua.",
      },
      {
        title: "Xu ly Exceptions",
        location: "Tab Exceptions -> bang danh sach",
        clickTarget: "Resolve",
        actions: [
          "Chuyen sang tab [Exceptions].",
          "Uu tien xu ly HIGH truoc: PAB_NEGATIVE, STOCKOUT_ALERT.",
          "Click [Resolve] tren tung exception.",
          "Dien ghi chu xu ly va click [Xac nhan].",
        ],
        inputs: [{ label: "Ghi chu", value: "VD: Day som PO tuan 3 hoac Tang SS item ABC" }],
        warn: "FROZEN_ZONE_VIOLATION = PO trong tuan 1-2 can duyet rieng o buoc sau.",
      },
      {
        title: "Duyet Planned Orders Frozen Zone",
        location: "Tab Planned Orders -> filter Frozen Zone",
        clickTarget: "Approve",
        actions: [
          "Chuyen sang tab [Planned Orders].",
          "Loc: Frozen Zone + Status = NEEDS_APPROVAL.",
          "Click [Loc] de ap dung bo loc.",
          "Review tung PO trong tuan 1-2, click [Approve] de phe duyet.",
        ],
        inputs: [
          { label: "Filter 1", value: "Frozen Zone (dropdown Frozen Zone)" },
          { label: "Filter 2", value: "NEEDS_APPROVAL (dropdown Status)" },
        ],
        warn: "PO trong frozen zone anh huong truc tiep den ke hoach thuc thi tuan nay.",
      },
      {
        title: "Kiem tra Netting Grid",
        location: "Tab Netting Grid",
        clickTarget: "Xem Grid",
        actions: [
          "Chuyen sang tab [Netting Grid].",
          "Nhap Item Code va Location Code can kiem tra.",
          "Click [Xem Grid] hoac nhan Enter.",
          "Xem bang 12 tuan: PAB, SS, Planned Orders, HSTK.",
        ],
        inputs: [
          { label: "Item Code", value: "VD: SKU-001" },
          { label: "Location", value: "VD: HAN, SGN, DN" },
        ],
        tip: "Mau do = STOCKOUT nguy co, mau vang = canh bao, mau xanh = OK.",
      },
    ],
  },
  "/monitor": {
    module: "M8 - Monitor & Learn",
    steps: [
      {
        title: "Xem KPI Dashboard",
        location: "Phia tren trang",
        actions: [
          "Xem cac the KPI: Forecast Accuracy, HSTK, Fill Rate, DRP Cycle Time.",
          "Click [Refresh] de cap nhat KPI moi nhat.",
        ],
        tip: "HSTK (tuan) = on_hand / avg_weekly_sales. < 1.5 tuan = STOCKOUT nguy co.",
      },
      {
        title: "Xu ly Alerts",
        location: "Bang Alerts phia duoi",
        actions: [
          "Xem danh sach alerts theo severity: CRITICAL, WARNING, INFO.",
          "Uu tien xu ly CRITICAL (STOCKOUT) truoc.",
          "Click vao alert de xem chi tiet item x location bi anh huong.",
          "Danh dau RESOLVED sau khi da xu ly.",
        ],
        warn: "Alert STOCKOUT: ton kho < 1.5 tuan ban - can dat hang ngay.",
      },
    ],
  },
};

const DEFAULT_TOUR: PageTour = {
  module: "Smart Guide",
  steps: [{
    title: "Pipeline tong quat M1 den M4",
    actions: [
      "M1 Demand: Upload CSV forecast -> Freeze snapshot.",
      "M2 Supply: Upload Bravo -> Capture -> Freeze snapshot.",
      "M3 Policy: Import ABC -> Tinh Safety Stock -> Activate.",
      "M4 DRP: Tao Plan Run -> Xu ly Exceptions -> Duyet Frozen POs.",
    ],
    tip: "Truy cap tung trang de xem huong dan chi tiet cho module do.",
  }],
};

interface GuideTourProps { onClose: () => void; }

export function GuideTour({ onClose }: GuideTourProps) {
  const pathname = usePathname();
  const [stepIdx, setStepIdx] = useState(0);

  const tour = Object.entries(PAGE_TOURS)
    .find(([p]) => pathname === p || pathname.startsWith(p + "/"))
    ?.[1] ?? DEFAULT_TOUR;

  const step = tour.steps[stepIdx];
  const total = tour.steps.length;

  useEffect(() => { setStepIdx(0); }, [pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed bottom-24 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">

        <div className="bg-gradient-to-r from-blue-600 to-sky-500 px-4 py-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">{tour.module}</p>
            <p className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
              <Map size={13} className="flex-shrink-0" /><span>{step.title}</span>
            </p>
          </div>
          <button onClick={onClose} className="h-6 w-6 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
            <X size={12} />
          </button>
        </div>

        <div className="px-4 py-3.5 space-y-3 overflow-y-auto max-h-[55vh]">
          {step.location && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">Vi tri</span>
              <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-medium">{step.location}</span>
            </div>
          )}
          {step.clickTarget && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">Click</span>
              <span className="inline-flex px-2.5 py-1 rounded-md bg-blue-600 text-white font-bold text-[11px] shadow-sm">{step.clickTarget}</span>
            </div>
          )}
          <ul className="space-y-2">
            {step.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="leading-relaxed pt-0.5">{a}</span>
              </li>
            ))}
          </ul>
          {step.inputs && step.inputs.length > 0 && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Thong tin can dien</p>
              {step.inputs.map((inp, i) => (
                <div key={i} className="flex gap-2 text-[11px]">
                  <span className="text-slate-500 font-semibold w-20 flex-shrink-0">{inp.label}</span>
                  <span className="text-slate-600">{inp.value}</span>
                </div>
              ))}
            </div>
          )}
          {step.warn && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700 flex items-start gap-1.5">
              <span>⚠</span><span>{step.warn}</span>
            </div>
          )}
          {step.tip && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-[11px] text-blue-700 flex items-start gap-1.5">
              <span>💡</span><span>{step.tip}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/60">
          <div className="flex items-center gap-1.5">
            {tour.steps.map((_, i) => (
              <button key={i} onClick={() => setStepIdx(i)}
                className={`rounded-full transition-all ${i === stepIdx ? "w-5 h-2 bg-blue-500" : "w-2 h-2 bg-slate-300 hover:bg-slate-400"}`} />
            ))}
            <span className="text-[11px] text-slate-400 ml-1">Buoc {stepIdx + 1}/{total}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setStepIdx(s => s - 1)} disabled={stepIdx === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft size={12} /> Truoc
            </button>
            {stepIdx < total - 1 ? (
              <button onClick={() => setStepIdx(s => s + 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                Tiep theo <ChevronRight size={12} />
              </button>
            ) : (
              <button onClick={onClose}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition-colors">
                Xong ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
