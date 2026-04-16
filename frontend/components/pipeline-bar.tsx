"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type StepStatus = "completed" | "active" | "pending";

type PipelineStep = {
  step: number;
  domain: string;
  name: string;
  subtext: string;
  href: string;
  status: StepStatus;
  flow: "Cross" | "Flow 1" | "Flow 2";
};

const STEPS: PipelineStep[] = [
  { step: 1,  domain: "D1",  name: "Foundation",   subtext: "Master data",  href: "/master-data", status: "completed", flow: "Cross"  },
  { step: 2,  domain: "D2",  name: "Demand",        subtext: "Synced",       href: "/demand",      status: "completed", flow: "Flow 2" },
  { step: 3,  domain: "D3",  name: "Supply",        subtext: "4-bucket",     href: "/supply",      status: "completed", flow: "Flow 2" },
  { step: 4,  domain: "D4",  name: "Replenishment", subtext: "SS+Netting",   href: "/drp",         status: "completed", flow: "Flow 2" },
  { step: 5,  domain: "D5",  name: "Allocation",    subtext: "3 exc",        href: "/allocation",  status: "active",    flow: "Flow 2" },
  { step: 6,  domain: "D6",  name: "Transport",     subtext: "—",            href: "/transport",   status: "pending",   flow: "Flow 2" },
  { step: 7,  domain: "D7",  name: "Order Mgmt",    subtext: "12 draft",     href: "/execution",   status: "pending",   flow: "Flow 2" },
  { step: 8,  domain: "D8",  name: "S&OP",          subtext: "Booking",      href: "/commitment",  status: "pending",   flow: "Flow 1" },
  { step: 9,  domain: "D9",  name: "Monitor",       subtext: "—",            href: "/monitor",     status: "pending",   flow: "Cross"  },
  { step: 10, domain: "D10", name: "Intelligence",  subtext: "—",            href: "/intelligence",status: "pending",   flow: "Cross"  },
];

const completedCount = STEPS.filter((s) => s.status === "completed").length;
const activeStep = STEPS.find((s) => s.status === "active");
const progressPct = (completedCount / STEPS.length) * 100;

export function PipelineBar() {
  const pathname = usePathname();

  return (
    <div className="flex-shrink-0 border-b border-white/10 bg-[#0f1c36]">
      {/* Steps row */}
      <div className="flex items-center gap-0 px-4 pt-2.5 pb-1.5 overflow-x-auto">
        {STEPS.map((step, idx) => {
          const isCurrentPage =
            step.href === "/" ? pathname === "/" : pathname.startsWith(step.href);
          const prevFlow = idx > 0 ? STEPS[idx - 1].flow : null;
          const flowChanged = prevFlow !== null && prevFlow !== step.flow;
          const FLOW_LABEL: Record<PipelineStep["flow"], string> = {
            "Cross":  "Cross",
            "Flow 2": "F2",
            "Flow 1": "F1",
          };
          const FLOW_COLOR: Record<PipelineStep["flow"], string> = {
            "Cross":  "text-slate-500 border-slate-600",
            "Flow 2": "text-blue-400 border-blue-700",
            "Flow 1": "text-amber-400 border-amber-700",
          };

          return (
            <React.Fragment key={step.step}>
              {flowChanged && (
                <div className="flex-shrink-0 flex flex-col items-center justify-center mx-1 gap-0.5">
                  <div className="h-6 w-px bg-slate-700" />
                  <span className={cn("text-[8px] font-bold border rounded px-0.5 leading-tight", FLOW_COLOR[step.flow])}>
                    {FLOW_LABEL[step.flow]}
                  </span>
                  <div className="h-6 w-px bg-slate-700" />
                </div>
              )}
              <Link href={step.href} className="flex-shrink-0">
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150",
                    step.status === "active"
                      ? "bg-amber-400/15 border border-amber-400/30"
                      : isCurrentPage
                      ? "bg-blue-500/15 border border-blue-400/30"
                      : "border border-transparent hover:bg-white/5"
                  )}
                >
                  {/* Circle indicator */}
                  <div className="relative flex-shrink-0">
                    {step.status === "completed" ? (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-sm shadow-blue-900/50">
                        <Check size={10} className="text-white" strokeWidth={3} />
                      </div>
                    ) : step.status === "active" ? (
                      <div className="relative flex h-[22px] w-[22px] items-center justify-center">
                        <div className="absolute inset-0 rounded-full bg-amber-400 opacity-30 animate-pulse" />
                        <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-400/20">
                          <span className="text-[9px] font-bold text-amber-600">{step.step}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-800">
                        <span className="text-[9px] font-semibold text-slate-500">{step.step}</span>
                      </div>
                    )}
                  </div>

                  {/* Step info */}
                  <div>
                    <p className="text-[9px] font-mono leading-none mb-0.5 text-slate-600">
                      {step.domain}
                    </p>
                    <p
                      className={cn(
                        "text-[12px] font-semibold leading-none",
                        step.status === "completed"
                          ? "text-blue-400"
                          : step.status === "active"
                          ? "text-amber-400"
                          : "text-slate-500"
                      )}
                    >
                      {step.name}
                    </p>
                    <p
                      className={cn(
                        "text-[10px] leading-none mt-0.5",
                        step.status === "completed"
                          ? "text-blue-400"
                          : step.status === "active"
                          ? "text-amber-400"
                          : "text-slate-600"
                      )}
                    >
                      {step.subtext}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Connector arrow */}
              {idx < STEPS.length - 1 && (
                <div className="flex-shrink-0 px-1">
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path
                      d="M1 4H11M8 1L11 4L8 7"
                      stroke={idx < completedCount ? "#60a5fa" : "#334155"}
                      strokeWidth="1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* Right status */}
        <div className="ml-auto flex-shrink-0 pl-4 text-right">
          <p className="text-[11px] text-slate-400">
            {completedCount}/{STEPS.length} ·{" "}
            <span className="text-amber-400 font-medium">
              {activeStep?.name ?? "—"} running
            </span>{" "}
            · Run #247
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 transition-all duration-700"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
