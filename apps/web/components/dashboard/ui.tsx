"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { FileUp } from "lucide-react";

export function AnimatedNumber({ value, format = true }: { value: number; format?: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format ? n.toLocaleString() : n}</>;
}

export function StatusDot({ status }: { status: "ready" | "processing" | "failed" }) {
  if (status === "ready")
    return <span className="inline-block size-1.5 rounded-full bg-[#0071E3]" aria-label="ready" />;
  if (status === "processing")
    return (
      <span className="relative flex size-1.5" aria-label="processing">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#0071E3] opacity-25" />
        <span className="relative inline-flex size-1.5 rounded-full bg-[#0071E3]" />
      </span>
    );
  return <span className="inline-block size-1.5 rounded-full bg-red-500" aria-label="failed" />;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center rounded-2xl border border-dashed border-[#E8E8ED] bg-[#F5F5F7]/50 px-6 py-16 text-center"
    >
      <span className="grid size-11 place-items-center rounded-xl border border-[#E8E8ED] bg-white text-[#6E6E73]">
        <FileUp className="size-5" />
      </span>
      <p className="mt-4 text-[15px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[#6E6E73]">{body}</p>
      <div className="mt-5">{action}</div>
    </motion.div>
  );
}

export function PageHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
        {sub ? <p className="mt-1 text-[15px] text-[#6E6E73]">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Score({ value, animate = true }: { value: number; animate?: boolean }) {
  const [n, setN] = useState(animate ? 0 : value);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = 700;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, animate]);
  return <span className="font-mono text-[13px] font-medium text-[#0071E3]">{n.toFixed(2)}</span>;
}
