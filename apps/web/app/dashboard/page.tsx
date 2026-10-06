"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Plus } from "lucide-react";
import { activity, collections, projects } from "../../components/dashboard/data";
import { AnimatedNumber, EmptyState } from "../../components/dashboard/ui";

const METRICS = [
  { label: "Documents", value: 1284, delta: "+12.4%" },
  { label: "Chunks", value: 48291, delta: "+8.2%" },
  { label: "Vectors", value: 48291, delta: "+8.2%" },
  { label: "Retrievals", value: 12842, delta: "+18.7%" },
];

const FLOW = [
  { label: "documents", value: "1,284", href: "/dashboard/documents" },
  { label: "chunks", value: "48,291", href: "/dashboard/chunks" },
  { label: "vectors", value: "48,291", href: "/dashboard/usage" },
  { label: "retrievals", value: "12,842", href: "/dashboard/search" },
];

const RECENT_QUERIES = [
  { q: "How does authentication work?", score: "0.94", ms: "41ms" },
  { q: "Token expiration policy", score: "0.89", ms: "38ms" },
  { q: "Rate limit headers", score: "0.81", ms: "52ms" },
];

const QUICK_LINKS = [
  { label: "Upload documents", href: "/dashboard/documents" },
  { label: "Search knowledge", href: "/dashboard/search" },
  { label: "Project settings", href: "/dashboard/settings" },
  { label: "Read the docs", href: "/docs" },
];

export default function OverviewPage() {
  return (
    <div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Overview</h1>
          <span className="font-mono text-xs text-[#6E6E73]">Good evening — {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-xs text-[#6E6E73]">
          <span className="size-1.5 rounded-full bg-emerald-500" /> operational
        </span>
      </motion.div>

      {/* metrics — plain row */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="mt-5 grid grid-cols-2 gap-6 border-y border-[#E8E8ED] py-4 sm:grid-cols-4"
      >
        {METRICS.map((m) => (
          <div key={m.label}>
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6E6E73]">{m.label}</p>
            <p className="mt-0.5 tabular-nums">
              <span className="text-[22px] font-semibold tracking-tight">
                <AnimatedNumber value={m.value} />
              </span>{" "}
              <span className="font-mono text-[11px] text-[#0071E3]">{m.delta}</span>
            </p>
          </div>
        ))}
      </motion.div>

      {/* pipeline — one mono line */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="mt-4 font-mono text-[12.5px] text-[#6E6E73]"
      >
        {FLOW.map((f, i) => (
          <span key={f.label}>
            <Link href={f.href} className="tabular-nums transition-colors hover:text-[#0071E3]">
              <span className="font-medium text-[#1D1D1F]">{f.value}</span> {f.label}
            </Link>
            {i < FLOW.length - 1 && <span className="mx-2 text-[#E8E8ED]">→</span>}
          </span>
        ))}
      </motion.p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        {/* projects */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Projects</h2>
            <Link
              href="/dashboard/projects"
              className="flex items-center gap-1 text-[13px] text-[#6E6E73] transition-colors hover:text-[#1D1D1F]"
            >
              <Plus className="size-3.5" /> New
            </Link>
          </div>
          {projects.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="No projects yet."
                body="Create a project to start building your retrieval infrastructure."
                action={
                  <span className="rounded-md bg-[#1D1D1F] px-4 py-2 text-sm font-medium text-white">
                    New Project
                  </span>
                }
              />
            </div>
          ) : (
            <div className="mt-1">
              {projects.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.12 + i * 0.05 }}
                >
                  <Link
                    href="/dashboard/projects"
                    className="group flex items-center justify-between gap-4 border-b border-[#E8E8ED] py-3.5 transition-colors hover:bg-[#FAFAFA]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="size-2 shrink-0 rounded-full bg-[#0071E3]" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-medium">{p.name}</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-[#6E6E73]">
                          {p.documents} docs · {p.chunks.toLocaleString()} chunks
                        </p>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-[#6E6E73]">
                      {p.updated}
                      <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* event log */}
        <div>
          <h2 className="text-[15px] font-semibold">Event log</h2>
          <div className="mt-1 rounded-lg border border-[#E8E8ED] bg-[#FAFAFA]/50 font-mono text-xs">
            {activity.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 + i * 0.06 }}
                className="flex gap-3 border-b border-[#E8E8ED]/70 px-4 py-2.5 last:border-0"
              >
                <span className="shrink-0 text-[#6E6E73]/70">{a.time.replace(" ago", "")}</span>
                <span className="truncate">{a.text}</span>
              </motion.div>
            ))}
          </div>
          <Link href="/dashboard/documents" className="mt-3 flex items-center gap-1 text-[13px] text-[#6E6E73] transition-colors hover:text-[#0071E3]">
            View documents <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* collections */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Collections</h2>
            <Link
              href="/dashboard/collections"
              className="text-[13px] text-[#6E6E73] transition-colors hover:text-[#1D1D1F]"
            >
              View all
            </Link>
          </div>
          <div className="mt-1">
            {collections.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 + i * 0.05 }}
              >
                <Link
                  href="/dashboard/collections"
                  className="group flex items-center justify-between gap-4 border-b border-[#E8E8ED] py-3 transition-colors hover:bg-[#FAFAFA]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium">{c.name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-[#6E6E73]">
                      kb_{c.id} · {c.documents.toLocaleString()} docs
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-[#6E6E73]">
                    {c.chunks.toLocaleString()} ch
                    <ArrowRight className="ml-2 inline size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>

        {/* recent retrievals */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Recent retrievals</h2>
            <Link
              href="/dashboard/search"
              className="text-[13px] text-[#6E6E73] transition-colors hover:text-[#1D1D1F]"
            >
              Search
            </Link>
          </div>
          <div className="mt-3 rounded-lg border border-[#E8E8ED] bg-[#FAFAFA]/50 font-mono text-xs">
            {RECENT_QUERIES.map((r, i) => (
              <motion.div
                key={r.q}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.22 + i * 0.06 }}
                className="flex items-center gap-3 border-b border-[#E8E8ED]/70 px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate">“{r.q}”</span>
                <span className="shrink-0 font-medium text-[#0071E3]">{r.score}</span>
                <span className="shrink-0 tabular-nums text-[#6E6E73]">{r.ms}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* quick links */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-10 flex flex-wrap gap-x-8 gap-y-2 border-t border-[#E8E8ED] pt-4"
      >
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className="group flex items-center gap-1 text-[13.5px] text-[#6E6E73] transition-colors hover:text-[#0071E3]"
          >
            {l.label}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </motion.div>
    </div>
  );
}
