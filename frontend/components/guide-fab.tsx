"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Map } from "lucide-react";
import { fetchAllStatus, type AllModuleStatus } from "@/lib/api/guide";
import { GuideTour } from "@/components/guide-tour";

function deriveNextLabel(s: AllModuleStatus): string | null {
  if (s.m1.step !== "DONE") return "M1 Demand";
  if (s.m2.step !== "DONE") return "M2 Supply";
  if (s.m3.step !== "DONE") return "M3 Policy";
  if (s.m4.step !== "DONE") return "M4 DRP";
  return null;
}

export function GuideFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [nextLabel, setNextLabel] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await fetchAllStatus();
        if (!cancelled) {
          const lbl = deriveNextLabel(s);
          setNextLabel(lbl);
          setAllDone(lbl === null);
        }
      } catch { /* silent */ }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [pathname]);

  // Close tour on page navigation
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      {/* Tour modal */}
      {open && <GuideTour onClose={() => setOpen(false)} />}

      {/* FAB + badge */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        {/* Next-step badge (only when tour is closed) */}
        {!open && nextLabel && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
            Bước tiếp: {nextLabel}
          </button>
        )}
        {!open && allDone && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-700 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            Pipeline hoàn tất ✓
          </button>
        )}

        {/* Main FAB */}
        <button
          onClick={() => setOpen(o => !o)}
          title="Mở Smart Guide"
          className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all hover:scale-105 ${
            open
              ? "bg-slate-600 shadow-slate-400/40"
              : "bg-gradient-to-br from-sky-500 to-blue-600 shadow-blue-400/40 hover:shadow-xl"
          }`}
        >
          <Map size={20} />
        </button>
      </div>
    </>
  );
}
