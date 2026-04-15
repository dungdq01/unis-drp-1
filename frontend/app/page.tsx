import React from "react";
import Link from "next/link";
import {
  AlertTriangle, TrendingUp, PackageOpen, Scale,
  GitBranch, Target, Truck, ClipboardCheck, Activity,
} from "lucide-react";

const EXCEPTION_MODULES = [
  { step:"01", name:"Demand",            sub:"Forecast · PO · VMI",      href:"/demand",     status:"ready",  exc:0,  color:"#22c55e" },
  { step:"02", name:"Supply",            sub:"Tồn kho · Lot · Transit",  href:"/supply",     status:"ready",  exc:0,  color:"#22c55e" },
  { step:"03", name:"Inventory & Policy",sub:"SS · ABC · FEFO",          href:"/policy",     status:"ready",  exc:0,  color:"#22c55e" },
  { step:"04", name:"DRP Netting",       sub:"Net req · Lot sizing",     href:"/drp",        status:"ready",  exc:0,  color:"#22c55e" },
  { step:"05", name:"Allocation",        sub:"6-Layer constraint",       href:"/allocation", status:"active", exc:0,  color:"#f59e0b" },
  { step:"06", name:"Transport",         sub:"Vehicle · Carrier",        href:"/transport",  status:"draft",  exc:0,  color:"#4a5568" },
  { step:"07", name:"Order Bridge",      sub:"SO/TO/PO → ERP",          href:"/execution",  status:"draft",  exc:0,  color:"#4a5568" },
  { step:"08", name:"Monitor & Learn",   sub:"KPI · Alert · Drift",      href:"/monitor",    status:"draft",  exc:0,  color:"#4a5568" },
];

const STATUS_BADGE: Record<string, string> = {
  ready:  "text-green-600 bg-green-50 border-green-200",
  active: "text-amber-600 bg-amber-50 border-amber-200",
  draft:  "text-gray-400  bg-gray-100 border-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "READY", active: "ACTIVE", draft: "DRAFT",
};

export default function ExceptionDashboard() {
  const today = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const totalExc = EXCEPTION_MODULES.reduce((s, m) => s + m.exc, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Exception Dashboard</h1>
          <p className="text-sm text-[#9ca3af] mt-0.5">KPI + AI đề xuất · UNIS Group · Ngày {today}</p>
        </div>
        <div className="flex items-center gap-2">
          {totalExc > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 font-medium">
              <AlertTriangle size={11} />
              {totalExc} exceptions cần xử lý
            </span>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        {[
          { label: "Fill Rate",      value: "—",    target: "≥92%",  ok: false },
          { label: "HSTK (tuần)",    value: "—",    target: "≥6",    ok: false },
          { label: "OTIF",           value: "—",    target: "≥90%",  ok: false },
          { label: "MAPE Forecast",  value: "—",    target: "≤25%",  ok: false },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-[#e4e8ef] bg-white shadow-card px-4 py-3">
            <p className="text-[11px] text-[#9ca3af] uppercase tracking-wide">{kpi.label}</p>
            <p className="text-2xl font-mono font-bold text-[#111827] mt-1">{kpi.value}</p>
            <p className="text-[10px] text-[#9ca3af] mt-0.5">Target: {kpi.target}</p>
          </div>
        ))}
      </div>

      {/* Module status grid */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-3">
          8-Step Pipeline Status
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EXCEPTION_MODULES.map((mod) => (
            <Link key={mod.step} href={mod.href}>
              <div className="group rounded-xl border border-[#e4e8ef] bg-white shadow-card p-4 hover:shadow-card-hover hover:border-[#c8d0de] transition-all duration-150 cursor-pointer">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 border border-blue-100">
                      <span className="font-mono text-xs font-bold text-[#2563eb]">
                        {mod.step}
                      </span>
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-[#111827] leading-tight">{mod.name}</p>
                      <p className="text-[11px] text-[#9ca3af] leading-tight">{mod.sub}</p>
                    </div>
                  </div>
                  {mod.exc > 0 && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      <AlertTriangle size={9} />
                      {mod.exc}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${STATUS_BADGE[mod.status]}`}
                  >
                    {STATUS_LABEL[mod.status]}
                  </span>
                  <span className="text-[10px] text-[#9ca3af] group-hover:text-[#9ca3af] transition-colors">
                    Xem chi tiết →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* System health */}
      <div className="rounded-xl border border-[#e4e8ef] bg-white shadow-card p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-4">
          System Health
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label:"Bravo ERP Sync",    value:"2:30 AM",  status:"ok"  },
            { label:"Freshness Gate",    value:"PASS",     status:"ok"  },
            { label:"PlanningCycle",     value:"23:00 ICT",status:"ok"  },
            { label:"Last DRP Run",      value:"Run #247", status:"ok"  },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-[#e4e8ef] bg-white shadow-card px-3 py-2.5">
              <p className="text-[11px] text-[#9ca3af]">{item.label}</p>
              <p className="text-[12px] font-mono font-semibold text-green-600 mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
