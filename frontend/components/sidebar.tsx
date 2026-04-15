"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  PackageOpen,
  Scale,
  GitBranch,
  Target,
  Truck,
  ClipboardCheck,
  Activity,
  BarChart2,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Map,
} from "lucide-react";

type NavItem = {
  step?: string;
  icon: React.ElementType;
  name: string;
  sub: string;
  href: string;
  badge?: number;
  badgeColor?: "red" | "amber" | "green";
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    label: "COCKPIT",
    items: [
      {
        icon: LayoutDashboard,
        name: "Exception Dashboard",
        sub: "KPI + AI đề xuất",
        href: "/",
      },
    ],
  },
  {
    label: "PLANNING",
    items: [
      { step: "01", icon: TrendingUp,     name: "Demand",            sub: "Forecast · PO · VMI",          href: "/demand"     },
      { step: "02", icon: PackageOpen,    name: "Supply",            sub: "Tồn kho · Lot · Transit",       href: "/supply"     },
      { step: "03", icon: Scale,          name: "Inventory & Policy",sub: "SS · ABC · FEFO · HSTK",        href: "/policy"     },
      { step: "04", icon: GitBranch,      name: "DRP Netting",       sub: "Net req · Lot sizing",          href: "/drp"        },
      { step: "05", icon: Target,         name: "Allocation",        sub: "6-Layer constraint",            href: "/allocation" },
    ],
  },
  {
    label: "EXECUTION",
    items: [
      { step: "06", icon: Truck,          name: "Transport",         sub: "Vehicle · Carrier · GLEC",      href: "/transport"  },
      { step: "07", icon: ClipboardCheck, name: "Order Bridge",      sub: "SO/TO/PO → ERP",                href: "/execution"  },
    ],
  },
  {
    label: "MONITOR",
    items: [
      { step: "08", icon: Activity,       name: "Monitor & Learn",   sub: "KPI · Alert · Drift",           href: "/monitor"    },
      {             icon: BarChart2,       name: "Plan vs Actual",    sub: "Variance · Version · Rolling",   href: "/plan-actual"},
    ],
  },
  {
    label: "CONFIG",
    items: [
      { step: "10", icon: Settings2, name: "Policy Platform", sub: "System config · Toggles · RBAC", href: "/system-config" },
    ],
  },
  {
    label: "GUIDE",
    items: [
      { icon: Map, name: "Smart Guide", sub: "Workflow · M1→M4", href: "/guide" },
    ],
  },
];

const BADGE_STYLE: Record<string, string> = {
  red:   "bg-red-50   text-red-600   border border-red-200",
  amber: "bg-amber-50 text-amber-600 border border-amber-200",
  green: "bg-green-50 text-green-600 border border-green-200",
};

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "glass-sidebar flex h-screen flex-shrink-0 flex-col transition-all duration-300 ease-in-out overflow-hidden",
        collapsed ? "w-[62px]" : "w-[220px]"
      )}
    >
      {/* Logo + Toggle */}
      <div
        className={cn(
          "flex items-center border-b border-white/10",
          collapsed ? "flex-col gap-2 px-0 py-3" : "gap-2.5 px-4 py-4"
        )}
      >
        {/* Logo mark */}
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 text-white font-bold text-sm select-none shadow-md shadow-sky-200/50">
          S
        </div>

        {/* Brand text — hidden when collapsed */}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-white leading-tight whitespace-nowrap">Smartlog SCP</p>
            <p className="text-[10px] text-blue-400 leading-tight mt-0.5">UNIS · v3.5</p>
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
          className={cn(
            "flex items-center justify-center rounded-md text-slate-400 hover:text-blue-300 hover:bg-white/10 transition-colors",
            collapsed ? "h-7 w-7" : "h-7 w-7 flex-shrink-0"
          )}
        >
          {collapsed
            ? <PanelLeftOpen size={15} />
            : <PanelLeftClose size={15} />
          }
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5">
        {NAV.map((group) => (
          <div key={group.label} className="mb-1">
            {/* Group label — only when expanded */}
            {collapsed
              ? <div className="pt-3 mb-1 border-t border-white/10 mx-1" />
              : <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">{group.label}</p>
            }

            {group.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? `${item.name} — ${item.sub}` : undefined}
                >
                  <div
                    className={cn(
                      "group relative flex items-center rounded-lg mb-0.5 transition-all duration-150",
                      collapsed ? "justify-center px-1 py-2" : "gap-2.5 px-2.5 py-2",
                      active
                        ? "bg-blue-500/15 border border-blue-400/30"
                        : "hover:bg-white/5 border border-transparent"
                    )}
                  >
                    {/* Active left accent */}
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-blue-400" />
                    )}

                    {/* Icon box */}
                    <div
                      className={cn(
                        "relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-sm transition-colors",
                        active
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-white/[0.08] text-slate-500 group-hover:text-slate-300"
                      )}
                    >
                      {item.step ? (
                        <span className={cn("font-mono text-[11px] font-bold", active ? "text-blue-300" : "text-slate-500")}>
                          {item.step}
                        </span>
                      ) : (
                        <Icon size={14} />
                      )}
                      {/* Badge dot (collapsed mode) */}
                      {item.badge !== undefined && collapsed && (
                        <span className={cn(
                          "absolute -top-0.5 -right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full text-[8px] font-bold px-0.5",
                          item.badgeColor === "red" ? "bg-red-500 text-white" : "bg-amber-400 text-white"
                        )}>
                          {item.badge > 9 ? "9+" : item.badge}
                        </span>
                      )}
                    </div>

                    {/* Label + sub (expanded) */}
                    {!collapsed && (
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-[13px] font-medium leading-tight truncate",
                          active ? "text-white font-semibold" : "text-slate-300 group-hover:text-white"
                        )}>
                          {item.name}
                        </p>
                        <p className="text-[11px] text-slate-500 leading-tight mt-0.5 truncate">
                          {item.sub}
                        </p>
                      </div>
                    )}

                    {/* Badge pill (expanded) */}
                    {item.badge !== undefined && !collapsed && (
                      <span className={cn(
                        "flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                        BADGE_STYLE[item.badgeColor ?? "amber"]
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 py-3 px-2">
        <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
          <div className="relative h-7 w-7 flex-shrink-0 rounded-full bg-[#2563eb] flex items-center justify-center text-[10px] font-bold text-white">
            SU
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 border border-white" title="Online" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-slate-300 truncate">SC Manager</p>
              <p className="text-[10px] text-slate-500 truncate">UNIS Group</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
