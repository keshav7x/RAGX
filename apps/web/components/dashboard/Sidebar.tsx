"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LogoMark } from "../Logo";
import {
  BookOpen,
  Boxes,
  FileText,
  FolderOpen,
  LayoutGrid,
  Search,
  Settings,
  ChartColumn,
} from "lucide-react";

const SECTIONS: { label: string; items: { href: string; label: string; icon: typeof FileText }[] }[] = [
  {
    label: "",
    items: [{ href: "/dashboard", label: "Overview", icon: LayoutGrid }],
  },
  {
    label: "Workspace",
    items: [
      { href: "/dashboard/projects", label: "Projects", icon: Boxes },
      { href: "/dashboard/documents", label: "Documents", icon: FileText },
      { href: "/dashboard/collections", label: "Collections", icon: FolderOpen },
    ],
  },
  {
    label: "Retrieval",
    items: [
      { href: "/dashboard/search", label: "Search", icon: Search },
      { href: "/dashboard/chunks", label: "Chunks", icon: BookOpen },
    ],
  },
  {
    label: "Developer",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: ChartColumn },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

function Item({ href, label, Icon }: { href: string; label: string; Icon: typeof FileText }) {
  const path = usePathname();
  const active = href === "/dashboard" ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors ${
        active ? "bg-[#F5F5F7] font-medium text-[#1D1D1F]" : "text-[#6E6E73] hover:bg-[#F5F5F7]/70 hover:text-[#1D1D1F]"
      }`}
    >
      {active && (
        <motion.span
          layoutId="side-active"
          className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-[#0071E3]"
        />
      )}
      <Icon className="size-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[#E8E8ED] bg-white px-3 py-4 lg:flex">
      <Link href="/dashboard" className="flex items-center gap-2 px-2.5 pb-4">
        <LogoMark size={24} />
        <span className="text-[15px] font-semibold tracking-tight">RAGX</span>
        <span className="ml-1 size-1.5 rounded-full bg-[#0071E3]" aria-hidden />
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {SECTIONS.map((s) => (
          <div key={s.label || "top"}>
            {s.label ? (
              <p className="px-2.5 pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#6E6E73]/70">
                {s.label}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {s.items.map((it) => (
                <Item key={it.href} href={it.href} label={it.label} Icon={it.icon} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-[#E8E8ED] pt-3">
        <a href="/docs" className="flex items-center justify-between rounded-lg px-2.5 py-[7px] text-[13.5px] text-[#6E6E73] transition-colors hover:bg-[#F5F5F7]/70 hover:text-[#1D1D1F]">
          Documentation <span aria-hidden>→</span>
        </a>
        <a href="https://github.com/Keshavcodes3/RAGX" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-lg px-2.5 py-[7px] text-[13.5px] text-[#6E6E73] transition-colors hover:bg-[#F5F5F7]/70 hover:text-[#1D1D1F]">
          GitHub <span aria-hidden>↗</span>
        </a>
        <div className="flex items-center gap-2.5 px-2.5 pt-3">
          <span className="grid size-7 place-items-center rounded-full bg-[#1D1D1F] text-[11px] font-semibold text-white">
            K
          </span>
          <span className="text-[13.5px] font-medium">Keshav</span>
        </div>
      </div>
    </aside>
  );
}
