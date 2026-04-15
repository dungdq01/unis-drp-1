import React from "react";
import { cn } from "@/lib/utils";

type MetricItem = {
  label: string;
  value: string;
  status?: "ok" | "warn" | "error" | "neutral";
};

type ModuleShellProps = {
  step?: string;
  name: string;
  subtitle: string;
  description: string;
  docRef?: string;
  version?: string;
  status?: "draft" | "in_progress" | "ready" | "active";
  metrics?: MetricItem[];
  owner?: string;
};

const STATUS_CONFIG = {
  draft:       { label: "DRAFT",       class: "bg-gray-100   text-gray-500   border-gray-200"    },
  in_progress: { label: "IN PROGRESS", class: "bg-amber-50   text-amber-600  border-amber-200"   },
  ready:       { label: "READY",       class: "bg-green-50   text-green-600  border-green-200"   },
  active:      { label: "ACTIVE",      class: "bg-blue-50    text-blue-600   border-blue-200"    },
};

const METRIC_STATUS = {
  ok:      "text-green-600",
  warn:    "text-amber-600",
  error:   "text-red-500",
  neutral: "text-[#9ca3af]",
};

export function ModuleShell({
  step,
  name,
  subtitle,
  description,
  docRef,
  version = "v1.0",
  status = "draft",
  metrics = [],
  owner,
}: ModuleShellProps) {
  const statusCfg = STATUS_CONFIG[status];

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-5">
      {/* Module header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {step && (
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 border border-blue-100">
              <span className="font-mono text-[13px] font-bold text-[#2563eb]">{step}</span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-semibold text-[#111827]">{name}</h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide",
                  statusCfg.class
                )}
              >
                {statusCfg.label}
              </span>
            </div>
            <p className="text-sm text-[#6b7280]">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right flex-shrink-0">
          {docRef && (
            <span className="font-mono text-[11px] text-[#6b7280] bg-[#f0f2f5] border border-[#e4e8ef] rounded px-2 py-1">
              {docRef}
            </span>
          )}
          <span className="font-mono text-[11px] text-[#6b7280] bg-[#f0f2f5] border border-[#e4e8ef] rounded px-2 py-1">
            {version}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="rounded-xl border border-[#e4e8ef] bg-[#f8f9fb] px-5 py-4">
        <p className="text-[13px] text-[#6b7280] leading-relaxed">{description}</p>
        {owner && (
          <p className="mt-2 text-[11px] text-[#9ca3af]">
            Owner: <span className="text-[#6b7280]">{owner}</span>
          </p>
        )}
      </div>

      {/* Metrics row */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-[#e4e8ef] bg-white shadow-card px-4 py-3"
            >
              <p className="text-[11px] text-[#9ca3af] uppercase tracking-wide mb-1">{m.label}</p>
              <p
                className={cn(
                  "text-xl font-semibold font-mono",
                  m.status ? METRIC_STATUS[m.status] : "text-[#111827]"
                )}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Content placeholder */}
      <div className="flex flex-1 min-h-[340px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d1d5db] bg-[#f8f9fb]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#e4e8ef] bg-white shadow-card">
            {step ? (
              <span className="font-mono text-xl font-bold text-[#2563eb] opacity-40">{step}</span>
            ) : (
              <span className="font-mono text-xl text-[#d1d5db]">—</span>
            )}
          </div>
          <p className="text-sm font-semibold text-[#6b7280]">{name}</p>
          <p className="mt-1 text-[12px] text-[#d1d5db]">Module content — coming soon</p>
          <div className="mt-5 flex items-center gap-2 justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d1d5db]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#d1d5db]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#d1d5db]" />
          </div>
        </div>
      </div>
    </div>
  );
}
