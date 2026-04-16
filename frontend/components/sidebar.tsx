"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  PackageOpen,
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
  Database,
  ChevronDown,
  ChevronRight,
  Cpu,
  Sparkles,
} from "lucide-react";

type NavChild = {
  name: string;
  sub?: string;
  href: string;
  badge?: number;
  badgeColor?: "red" | "amber" | "green";
  isNew?: boolean;
};

type NavItem = {
  key: string;
  step?: string;
  icon: React.ElementType;
  name: string;
  sub: string;
  href: string;
  badge?: number;
  badgeColor?: "red" | "amber" | "green";
  children?: NavChild[];
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
        key: "dashboard",
        icon: LayoutDashboard,
        name: "Exception Dashboard",
        sub: "KPI + AI đề xuất",
        href: "/",
      },
    ],
  },
  {
    label: "FOUNDATION",
    items: [
      {
        key: "d1",
        icon: Database,
        name: "Foundation",
        sub: "D1 · Master data · Config",
        href: "/master-data",
        children: [
          { name: "Master Data",   sub: "M00 · SKU · CN · NM · Hub",       href: "/master-data",   isNew: true },
          { name: "System Config", sub: "M10 · Toggles · RBAC · Params",   href: "/system-config"  },
        ],
      },
    ],
  },
  {
    label: "PLANNING",
    items: [
      {
        key: "d2",
        icon: TrendingUp,
        name: "Demand Planning",
        sub: "D2 · Forecast · S&OP · B2B",
        href: "/demand",
        children: [
          { name: "Demand v2",         sub: "M11 · 2-level + B2B 6-stage",  href: "/demand"            },
          { name: "S&OP Consensus",    sub: "M12 · 2-tier · FVA · Lock",    href: "/saop-consensus",   isNew: true },
          { name: "CN Demand Adjust",  sub: "M22 · Trust score · ±30%",     href: "/cn-demand-adjust", isNew: true },
        ],
      },
      {
        key: "d3",
        icon: PackageOpen,
        name: "Supply Intake",
        sub: "D3 · Sync · Freshness · ATP",
        href: "/supply",
        children: [
          { name: "Data Sync v2",  sub: "M21 · NM upload · Freshness gate",  href: "/supply"   },
          { name: "NM ATP Check",  sub: "M26 · PASS/PARTIAL/FAIL · Urgency", href: "/nm-atp",  isNew: true },
        ],
      },
      {
        key: "d4",
        icon: GitBranch,
        name: "Replenishment",
        sub: "D4 · SS · DRP Netting",
        href: "/drp",
        children: [
          { name: "DRP Netting v2", sub: "M23 · SS CN + Netting + Policy pin", href: "/drp" },
        ],
      },
      {
        key: "d5",
        icon: Target,
        name: "Allocation",
        sub: "D5 · LCNB · Nearest · Fair-share",
        href: "/allocation",
        children: [
          { name: "Allocation LCNB", sub: "M24 · LCNB + multi-source leg", href: "/allocation" },
        ],
      },
    ],
  },
  {
    label: "EXECUTION",
    items: [
      {
        key: "d6",
        icon: Truck,
        name: "Transport",
        sub: "D6 · Vehicle · Carrier · Lot",
        href: "/transport",
        children: [
          { name: "Transport Lot v2", sub: "M25 · Bin-pack · Hold/Ship · ETA", href: "/transport" },
        ],
      },
      {
        key: "d7",
        icon: ClipboardCheck,
        name: "Order Management",
        sub: "D7 · PO Review · ERP sync",
        href: "/po-review",
        children: [
          { name: "PO Review",    sub: "M27 · Confirm · Amend · Reject", href: "/po-review", isNew: true },
        ],
      },
    ],
  },
  {
    label: "S&OP",
    items: [
      {
        key: "d8",
        icon: Cpu,
        name: "Production Booking",
        sub: "D8 · Monthly booking chain",
        href: "/commitment",
        children: [
          { name: "Prod Lot Sizing", sub: "M13 · Hub netting · MOQ",         href: "/prod-lot-sizing", isNew: true },
          { name: "FC Commitment",   sub: "M14 · Hard/Firm/Soft 3-tier",      href: "/commitment",      isNew: true },
          { name: "NM Response",     sub: "M15 · Accept/Partial · SLA 3d/5d", href: "/nm-negotiate",    isNew: true },
          { name: "Hub Virtual",     sub: "M16 · Virtual Σ committed − SS",   href: "/hub-virtual",     isNew: true },
          { name: "Gap Monitor",     sub: "M17 · Day 20/25/28 · Scenario",    href: "/gap-simulator",   isNew: true },
        ],
      },
    ],
  },
  {
    label: "MONITOR",
    items: [
      {
        key: "d9",
        icon: Activity,
        name: "Monitoring",
        sub: "D9 · KPI · Alert · Plan vs Actual",
        href: "/monitor",
        children: [
          { name: "Monitor & Learn", sub: "M8 · KPI · Alert · Drift",           href: "/monitor"     },
          { name: "Plan vs Actual",  sub: "M9 · Variance · Version · Rolling",  href: "/plan-actual" },
        ],
      },
      {
        key: "d10",
        icon: Sparkles,
        name: "Intelligence",
        sub: "D10 · Feedback · MAPE · NM Portal",
        href: "/feedback",
        children: [
          { name: "Feedback Loop", sub: "M28 · Closed loop · MAPE · POD", href: "/feedback", isNew: true },
        ],
      },
    ],
  },
  {
    label: "GUIDE",
    items: [
      {
        key: "guide",
        icon: Map,
        name: "Smart Guide",
        sub: "Workflow · M11→M28",
        href: "/guide",
      },
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
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set<string>());

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const isGroupActive = (item: NavItem): boolean =>
    isActive(item.href) || (item.children?.some((c) => isActive(c.href)) ?? false);

  const toggleExpand = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderIconBox = (item: NavItem, active: boolean) => {
    const Icon = item.icon;
    return (
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
      </div>
    );
  };

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
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 text-white font-bold text-sm select-none shadow-md shadow-sky-200/50">
          S
        </div>

        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-white leading-tight whitespace-nowrap">Smartlog SCP</p>
            <p className="text-[10px] text-blue-400 leading-tight mt-0.5">UNIS · v2.0</p>
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
          className={cn(
            "flex items-center justify-center rounded-md text-slate-400 hover:text-blue-300 hover:bg-white/10 transition-colors",
            collapsed ? "h-7 w-7" : "h-7 w-7 flex-shrink-0"
          )}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5">
        {NAV.map((group) => (
          <div key={group.label} className="mb-1">
            {/* Group label */}
            {collapsed
              ? <div className="pt-3 mb-1 border-t border-white/10 mx-1" />
              : <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">{group.label}</p>
            }

            {group.items.map((item) => {
              const groupActive = isGroupActive(item);
              const expanded = expandedItems.has(item.key);
              const hasChildren = !!item.children?.length;

              return (
                <div key={item.key}>
                  {/* Parent item — expandable or direct link */}
                  {hasChildren ? (
                    <button
                      onClick={() => !collapsed && toggleExpand(item.key)}
                      title={collapsed ? `${item.name} — ${item.sub}` : undefined}
                      className={cn(
                        "group relative flex w-full items-center rounded-lg mb-0.5 transition-all duration-150",
                        collapsed ? "justify-center px-1 py-2" : "gap-2.5 px-2.5 py-2",
                        groupActive
                          ? "bg-blue-500/15 border border-blue-400/30"
                          : "hover:bg-white/5 border border-transparent"
                      )}
                    >
                      {groupActive && !expanded && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-blue-400" />
                      )}

                      {renderIconBox(item, groupActive)}

                      {!collapsed && (
                        <>
                          <div className="flex-1 min-w-0 text-left">
                            <p className={cn(
                              "text-[13px] font-medium leading-tight truncate",
                              groupActive ? "text-white font-semibold" : "text-slate-300 group-hover:text-white"
                            )}>
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-500 leading-tight mt-0.5 truncate">
                              {item.sub}
                            </p>
                          </div>
                          <span className="flex-shrink-0 text-slate-500 group-hover:text-slate-400 transition-colors">
                            {expanded
                              ? <ChevronDown size={13} />
                              : <ChevronRight size={13} />
                            }
                          </span>
                        </>
                      )}
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      title={collapsed ? `${item.name} — ${item.sub}` : undefined}
                    >
                      <div
                        className={cn(
                          "group relative flex items-center rounded-lg mb-0.5 transition-all duration-150",
                          collapsed ? "justify-center px-1 py-2" : "gap-2.5 px-2.5 py-2",
                          isActive(item.href)
                            ? "bg-blue-500/15 border border-blue-400/30"
                            : "hover:bg-white/5 border border-transparent"
                        )}
                      >
                        {isActive(item.href) && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-blue-400" />
                        )}
                        {renderIconBox(item, isActive(item.href))}
                        {!collapsed && (
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "text-[13px] font-medium leading-tight truncate",
                              isActive(item.href) ? "text-white font-semibold" : "text-slate-300 group-hover:text-white"
                            )}>
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-500 leading-tight mt-0.5 truncate">
                              {item.sub}
                            </p>
                          </div>
                        )}
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
                  )}

                  {/* Children — only when expanded and sidebar is open */}
                  {!collapsed && hasChildren && expanded && (
                    <div className="ml-[44px] pl-2 border-l border-white/[0.08] mb-1 mt-0.5">
                      {item.children!.map((child) => {
                        const childActive = isActive(child.href);
                        return (
                          <Link key={child.href} href={child.href}>
                            <div
                              className={cn(
                                "group relative flex items-center rounded-md mb-0.5 px-2 py-1.5 transition-all duration-150",
                                childActive
                                  ? "bg-blue-500/15 border border-blue-400/30"
                                  : "hover:bg-white/5 border border-transparent"
                              )}
                            >
                              {childActive && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r bg-blue-400" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={cn(
                                  "text-[12px] font-medium leading-tight truncate",
                                  childActive ? "text-white font-semibold" : "text-slate-400 group-hover:text-white"
                                )}>
                                  {child.name}
                                </p>
                                {child.sub && (
                                  <p className="text-[10px] text-slate-600 leading-tight mt-0.5 truncate">
                                    {child.sub}
                                  </p>
                                )}
                              </div>
                              {child.isNew && (
                                <span className="ml-1 flex-shrink-0 rounded px-1 py-0 text-[8px] font-bold leading-4 bg-sky-500/20 text-sky-400 border border-sky-400/30">
                                  NEW
                                </span>
                              )}
                              {child.badge !== undefined && (
                                <span className={cn(
                                  "ml-1 flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-bold",
                                  BADGE_STYLE[child.badgeColor ?? "amber"]
                                )}>
                                  {child.badge}
                                </span>
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
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
