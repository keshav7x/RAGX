"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Search } from "lucide-react";
import { chunks } from "../../../components/dashboard/data";
import { PageHead, Score } from "../../../components/dashboard/ui";

const FILTERS = ["Collection", "Document", "Score", "Metadata"];

export default function SearchPage() {
  const [q, setQ] = useState("How does authentication work?");
  const [phase, setPhase] = useState<"idle" | "searching" | "done">("done");
  const [run, setRun] = useState(0);
  const [activeFilters, setActiveFilters] = useState<string[]>(["Collection"]);
  const timer = useRef<number | null>(null);

  const submit = () => {
    if (!q.trim()) return;
    setPhase("searching");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPhase("done");
      setRun((r) => r + 1);
    }, 1100);
  };

  return (
    <div>
      <PageHead title="Search your knowledge" sub="Semantic retrieval over your collections. Scores, pages and sources included." />

      {/* input */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-[#E8E8ED] focus-within:border-[#0071E3]/50">
        <div className="flex items-center gap-3 px-5 py-4">
          <Search className="size-5 shrink-0 text-[#6E6E73]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Ask your knowledge base…"
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-[#6E6E73]/50"
          />
          <button
            onClick={submit}
            disabled={phase === "searching" || !q.trim()}
            className="shrink-0 rounded-lg bg-[#0071E3] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#0077ED] disabled:opacity-50"
          >
            {phase === "searching" ? <Loader2 className="size-4 animate-spin" /> : "Retrieve"}
          </button>
        </div>
        {/* progress line */}
        <div className="relative h-[2px] bg-[#F5F5F7]">
          {phase === "searching" && (
            <motion.span
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 1.1, ease: "easeInOut" }}
              className="absolute left-0 top-0 h-full bg-[#0071E3]"
            />
          )}
        </div>
      </div>

      {/* filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = activeFilters.includes(f);
          return (
            <button
              key={f}
              onClick={() =>
                setActiveFilters((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]))
              }
              className={`rounded-full border px-3.5 py-1.5 font-mono text-xs transition-colors ${
                on ? "border-[#0071E3] bg-[#0071E3]/[0.06] text-[#0071E3]" : "border-[#E8E8ED] text-[#6E6E73] hover:border-[#1D1D1F]/25"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* results */}
      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-[#6E6E73]">
        {phase === "searching" ? "Searching…" : "Retrieval results"}
      </p>
      {activeFilters.includes("Collection") && (
        <p className="mt-1 font-mono text-[11px] text-[#6E6E73]">
          Scoped to <span className="text-[#0071E3]">kb_postgresql_docs</span> · retrieval is collection-scoped
        </p>
      )}
      <div className="mt-3 space-y-2.5" key={run}>
        {phase === "searching"
          ? [0, 1].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-[#E8E8ED] p-5">
                <div className="h-3 w-2/3 rounded bg-[#F5F5F7]" />
                <div className="mt-2 h-3 w-1/3 rounded bg-[#F5F5F7]" />
              </div>
            ))
          : chunks.slice(0, 3).map((h, i) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.12 }}
                className="rounded-xl border border-[#E8E8ED] p-5 transition-colors hover:border-[#1D1D1F]/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[15px] font-medium">{h.section}</p>
                  <Score value={h.score ?? 0} />
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[#6E6E73]">{h.content}</p>
                <p className="mt-2.5 font-mono text-xs text-[#6E6E73]">
                  page {h.page} · {h.document}
                </p>
              </motion.div>
            ))}
      </div>
    </div>
  );
}
