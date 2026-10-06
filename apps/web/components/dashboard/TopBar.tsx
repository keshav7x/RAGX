"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, FileText, KeyRound, Plus, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const ACTIONS = [
  { label: "Go to Overview", hint: "Dashboard", href: "/dashboard" },
  { label: "Go to Documents", hint: "Workspace", href: "/dashboard/documents" },
  { label: "Go to Collections", hint: "Workspace", href: "/dashboard/collections" },
  { label: "Go to Search", hint: "Retrieval", href: "/dashboard/search" },
  { label: "Go to Chunks", hint: "Retrieval", href: "/dashboard/chunks" },
  { label: "Go to Usage", hint: "Developer", href: "/dashboard/usage" },
  { label: "Go to Settings", hint: "Developer", href: "/dashboard/settings" },
  { label: "Upload documents", hint: "Action", href: "/dashboard/documents" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQ("");
  }
  const filtered = ACTIONS.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black/20 p-4 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="mx-auto mt-24 max-w-lg overflow-hidden rounded-2xl border border-[#E8E8ED] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-[#E8E8ED] px-4 py-3">
              <Search className="size-4 text-[#6E6E73]" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Type a command or search…"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#6E6E73]/60"
              />
              <kbd className="rounded-md border border-[#E8E8ED] bg-[#F5F5F7] px-1.5 py-0.5 font-mono text-[11px] text-[#6E6E73]">
                esc
              </kbd>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-[#6E6E73]">No results for “{q}”.</p>
              )}
              {filtered.map((a) => (
                <button
                  key={a.label}
                  onClick={() => {
                    onClose();
                    router.push(a.href);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] transition-colors hover:bg-[#F5F5F7]"
                >
                  <span className="flex items-center gap-2.5">
                    {a.hint === "Action" ? <Plus className="size-4 text-[#0071E3]" /> : a.label.includes("API") ? <KeyRound className="size-4 text-[#6E6E73]" /> : <FileText className="size-4 text-[#6E6E73]" />}
                    {a.label}
                  </span>
                  <span className="font-mono text-[11px] text-[#6E6E73]">{a.hint}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-[#E8E8ED] bg-[#F5F5F7]/60 px-4 py-2.5 font-mono text-[11px] text-[#6E6E73]">
              <span>RAGX command</span>
              <span className="flex items-center gap-1">
                select <ArrowRight className="size-3" /> ↵
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const CRUMBS: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/projects": "Projects",
  "/dashboard/documents": "Documents",
  "/dashboard/collections": "Collections",
  "/dashboard/search": "Search",
  "/dashboard/chunks": "Chunks",
  "/dashboard/usage": "Usage",
  "/dashboard/settings": "Settings",
};

export function TopBar({ onPalette }: { onPalette: () => void }) {
  const path = usePathname();
  const base = `/${path.split("/").slice(1, 3).join("/")}`;
  const crumb = CRUMBS[base] ?? (path.startsWith("/dashboard/documents/") ? "Document" : "Overview");
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onPalette();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onPalette]);

  return (
    <div className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[#E8E8ED] bg-white/85 px-4 backdrop-blur-xl sm:px-8">
      <p className="font-mono text-[13px] text-[#6E6E73]">
        RAGX <span className="text-[#E8E8ED]">/</span> <span className="text-[#1D1D1F]">{crumb}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onPalette}
          className="hidden items-center gap-2 rounded-lg border border-[#E8E8ED] bg-white px-3 py-1.5 text-[13px] text-[#6E6E73] transition-colors hover:border-[#1D1D1F]/20 hover:text-[#1D1D1F] sm:flex"
        >
          <Search className="size-3.5" /> Search
          <kbd className="rounded border border-[#E8E8ED] bg-[#F5F5F7] px-1 font-mono text-[11px]">⌘K</kbd>
        </button>
        <button
          onClick={onPalette}
          aria-label="Search"
          className="grid size-8 place-items-center rounded-lg border border-[#E8E8ED] text-[#6E6E73] sm:hidden"
        >
          <Search className="size-4" />
        </button>
        <Link
          href="/dashboard/documents"
          className="flex items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-black"
        >
          <Plus className="size-4" /> <span className="hidden sm:inline">Create</span>
        </Link>
      </div>
    </div>
  );
}
