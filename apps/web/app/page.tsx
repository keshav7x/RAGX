"use client";

import {
  AnimatePresence,
  motion,
  MotionConfig,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowRight,
  Check,
  Copy,
  Database,
  FileUp,
  ScanText,
  Scissors,
  Search,
  Sparkles,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RagComparisonFlow } from "../components/Landing/BoringPart";
import { LogoMark } from "../components/Logo";

/* ============================================================================
 * MOTION SYSTEM
 * ========================================================================== */

const EASE = [0.22, 1, 0.36, 1] as const;

const SPRING = {
  smooth: { type: "spring" as const, stiffness: 260, damping: 28, mass: 0.7 },
  snappy: { type: "spring" as const, stiffness: 500, damping: 34, mass: 0.55 },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, delay, ease: EASE },
  }),
};

/* ============================================================================
 * DATA
 * ========================================================================== */

const PIPELINE = [
  { label: "Load", icon: FileUp },
  { label: "Parse", icon: ScanText },
  { label: "Chunk", icon: Scissors },
  { label: "Embed", icon: Sparkles },
  { label: "Store", icon: Database },
  { label: "Retrieve", icon: Search },
];

const STEPS = [
  { n: "01", title: "Ingest", desc: "PDFs, docs, markdown, HTML and CSV come in." },
  { n: "02", title: "Parse", desc: "Messy files become structured elements." },
  { n: "03", title: "Chunk", desc: "Text splits into meaningful retrieval units." },
  { n: "04", title: "Embed", desc: "Vectors via your provider — your keys, your model." },
  { n: "05", title: "Store", desc: "Vectors and metadata land in your storage." },
  { n: "06", title: "Retrieve", desc: "Semantic search returns ranked, explainable chunks." },
];

/* ============================================================================
 * UTILS
 * ========================================================================== */

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be unavailable */
    }
  };
  return { copied, copy };
}

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : "hidden"}
      animate={isInView ? "visible" : "hidden"}
      variants={fadeUp}
      custom={delay}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function LazySection({ children, minHeight = 420 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  );
}

/* ============================================================================
 * NAV
 * ========================================================================== */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          "mx-auto flex h-14 max-w-6xl items-center justify-between px-6 transition-all",
          scrolled && "mt-2 max-w-[68rem] rounded-full border border-[#E8E8ED] bg-white/85 px-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)] backdrop-blur-xl",
        )}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={22} animated={false} />
          <span className="text-[15px] font-semibold tracking-tight">RAGX</span>
        </Link>
        <nav className="hidden items-center gap-6 text-[13.5px] text-[#6E6E73] md:flex">
          <a href="#pipeline" className="transition-colors hover:text-[#1D1D1F]">Pipeline</a>
          <a href="#code" className="transition-colors hover:text-[#1D1D1F]">SDK</a>
          <a href="/docs" className="transition-colors hover:text-[#1D1D1F]">Docs</a>
        </nav>
        <Link
          href="/login"
          className="rounded-full bg-[#1D1D1F] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-black"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}

/* ============================================================================
 * HERO
 * ========================================================================== */

function Hero() {
  const install = "bun add @ragx/sdk";
  const { copied, copy } = useCopy(install);

  return (
    <section className="relative overflow-hidden border-b border-[#F0F0F2] pt-32 pb-24 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(rgba(29,29,31,0.05)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_20%,transparent_100%)]" />
        <div className="absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[#0071E3]/[0.05] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6">
        <motion.div initial="hidden" animate="visible">
          <motion.p variants={fadeUp} custom={0} className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#6E6E73]">
            RAGX — The Retrieval Layer for AI
          </motion.p>
          <motion.h1
            variants={fadeUp}
            custom={0.06}
            className="mt-6 text-[52px] font-semibold leading-[1.0] tracking-[-0.05em] sm:text-[80px]"
          >
            Documents in.
            <br />
            <span className="font-serif font-medium italic tracking-[-0.03em] text-[#0071E3]">Context out.</span>
          </motion.h1>
          <motion.p variants={fadeUp} custom={0.12} className="mx-auto mt-7 max-w-xl text-[17px] leading-relaxed text-[#6E6E73]">
            RAGX is the retrieval layer for AI applications. Ingestion, chunking, embeddings and vector search — handled. Your LLM handles the rest.
          </motion.p>
          <motion.div variants={fadeUp} custom={0.18} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-full bg-[#0071E3] px-7 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[#0077ED]"
            >
              Start Building
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a href="/docs" className="px-4 py-3.5 text-[15px] font-medium text-[#0071E3]">
              View Documentation
            </a>
          </motion.div>
          <motion.button
            variants={fadeUp}
            custom={0.24}
            onClick={copy}
            className="mt-8 inline-flex items-center gap-2.5 rounded-full border border-[#E8E8ED] bg-white px-4 py-2 font-mono text-[12.5px] text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-[#1D1D1F]/25"
          >
            <Terminal className="size-3.5 text-[#6E6E73]" />
            {install}
            <span className="text-[#6E6E73]">{copied ? "copied" : "copy"}</span>
          </motion.button>

          <motion.div
            variants={fadeUp}
            custom={0.3}
            className="mx-auto mt-14 flex max-w-xl items-center justify-center gap-0 font-mono text-[12px] text-[#6E6E73]"
          >
            {["Documents", "RAGX", "Context", "Your LLM"].map((step, i) => (
              <span key={step} className="flex items-center">
                <span
                  className={cn(
                    "rounded-full border px-3.5 py-1.5",
                    step === "RAGX"
                      ? "border-[#0071E3]/40 bg-[#0071E3]/[0.05] text-[#0071E3]"
                      : step === "Your LLM"
                        ? "border-dashed border-[#D8D8DE]"
                        : "border-[#E8E8ED] bg-white text-[#1D1D1F]",
                  )}
                >
                  {step}
                </span>
                {i < 3 && <span className="mx-2 text-[#D8D8DE]">→</span>}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ============================================================================
 * PIPELINE STRIP
 * ========================================================================== */

function PipelineStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 30%"] });
  const reduced = useReducedMotion();
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });

  return (
    <section ref={ref} aria-label="RAGX pipeline" className="mx-auto max-w-6xl px-6 py-20">
      <div className="relative overflow-hidden rounded-2xl border border-[#E8E8ED] bg-white px-6 py-9 sm:px-10">
        <div className="absolute left-10 right-10 top-[58px] hidden h-px bg-[#E8E8ED] sm:block" />
        <motion.div
          style={reduced ? undefined : { scaleX: progress }}
          className="absolute left-10 right-10 top-[58px] hidden h-px origin-left bg-[#0071E3] sm:block"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
          {PIPELINE.map((stage, index) => (
            <PipelineNode key={stage.label} stage={stage.label} Icon={stage.icon} index={index} progress={progress} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PipelineNode({ stage, Icon, index, progress }: { stage: string; Icon: typeof FileUp; index: number; progress: MotionValue<number> }) {
  const reduced = useReducedMotion();
  const active = useTransform(progress, [index / PIPELINE.length, (index + 1) / PIPELINE.length], [0, 1]);
  const scale = useTransform(active, [0, 1], [0.94, 1]);
  const borderColor = useTransform(active, [0, 1], ["#E8E8ED", "rgba(0,113,227,0.45)"]);
  const backgroundColor = useTransform(active, [0, 1], ["#ffffff", "rgba(0,113,227,0.05)"]);
  const isLast = index === PIPELINE.length - 1;

  return (
    <div className="flex flex-1 items-center gap-3 sm:flex-col sm:gap-3 sm:text-center">
      <motion.div
        style={
          reduced
            ? undefined
            : { scale, borderColor, backgroundColor, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }
        }
        className={cn(
          "relative z-10 grid size-11 shrink-0 place-items-center rounded-xl border",
          isLast ? "border-[#0071E3] bg-[#0071E3] text-white" : "border-[#E8E8ED] bg-white text-[#1D1D1F]",
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.8} />
        <span
          className={cn(
            "absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full font-mono text-[9px]",
            isLast ? "bg-white text-[#0071E3]" : "bg-[#F5F5F7] text-[#6E6E73]",
          )}
        >
          {index + 1}
        </span>
      </motion.div>
      <span className={cn("font-mono text-[13px]", isLast ? "font-semibold text-[#0071E3]" : "text-[#1D1D1F]")}>
        {stage}
      </span>
    </div>
  );
}

/* ============================================================================
 * HOW IT WORKS
 * ========================================================================== */

function HowItWorks() {
  return (
    <section id="pipeline" className="border-t border-[#F0F0F2] bg-[#F5F5F7]">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-[44px]">
              The full pipeline,
              <br />
              one API.
            </h2>
            <p className="font-mono text-[13px] text-[#6E6E73]">documents → context</p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[#E8E8ED] bg-[#E8E8ED] sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 0.045}>
              <motion.div
                whileHover={{ y: -3 }}
                transition={SPRING.smooth}
                className="h-full bg-white p-7 transition-colors hover:bg-[#F5F5F7]"
              >
                <p className="font-mono text-[13px] text-[#0071E3]">{step.n}</p>
                <h3 className="mt-4 text-[17px] font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#6E6E73]">{step.desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
 * BYO LLM
 * ========================================================================== */

function ByoLlm() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#6E6E73]">Boundary</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.035em] sm:text-[44px] sm:leading-[1.05]">
          RAGX stops at context.
          <br />
          Your app picks the LLM.
        </h2>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-12 rounded-2xl border border-[#E8E8ED] bg-white p-8">
          <div className="flex flex-col items-start gap-2 font-mono text-[14px] sm:items-center">
            <p className="rounded-lg bg-[#0071E3] px-4 py-2 font-semibold text-white">RAGX</p>
            <span className="h-6 w-px bg-[#E8E8ED]" />
            <p className="text-[#1D1D1F]">Relevant context</p>
            <span className="h-6 w-px border-l border-dashed border-[#D8D8DE]" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["OpenAI", "Anthropic", "Gemini", "Your model"].map((p) => (
              <div key={p} className="rounded-xl border border-dashed border-[#D8D8DE] px-4 py-4 text-center font-mono text-[13px] text-[#6E6E73]">
                {p}
              </div>
            ))}
          </div>
          <p className="mt-6 text-center font-mono text-[12px] text-[#6E6E73]">
            dashed = your application, not RAGX
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ============================================================================
 * CODE
 * ========================================================================== */

function CodeSection() {
  type SnippetTab = "index.ts" | "retrieve.ts";
  const SNIPPETS: Record<SnippetTab, string[]> = {
    "index.ts": [
      'const ragx = new RAGX({ apiKey: process.env.RAGX_API_KEY });',
      "",
      'const doc = await ragx.upload("./docs/postgres.pdf");',
      "",
      "const results = await ragx.search(",
      '  "How does PostgreSQL MVCC work?"',
      ");",
    ],
    "retrieve.ts": [
      "const results = await ragx.search(",
      '  "How does PostgreSQL MVCC work?",',
      "  { topK: 5, minScore: 0.7 }",
      ");",
      "",
      "// → ranked chunks with scores, pages, sources",
    ],
  };
  const [tab, setTab] = useState<SnippetTab>("index.ts");
  const snippet = SNIPPETS[tab];
  const { copied, copy } = useCopy(snippet.join("\n"));

  return (
    <section id="code" className="border-t border-[#F0F0F2] bg-[#F5F5F7]/60 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#6E6E73]">SDK</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-[44px] sm:leading-[1.05]">
            From upload to answer-ready context in a few lines.
          </h2>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[#6E6E73]">
            One client. Documents in, ranked chunks out. Nothing else to wire.
          </p>
          <div className="mt-7 inline-flex items-center gap-2.5 rounded-full border border-[#E8E8ED] bg-white px-4 py-2 font-mono text-[12.5px] text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <Terminal className="size-3.5 text-[#6E6E73]" />
            bun add @ragx/sdk
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="overflow-hidden rounded-2xl border border-[#E8E8ED] bg-white shadow-[0_24px_70px_rgba(0,0,0,0.07)]">
            <div className="flex items-center justify-between border-b border-[#F0F0F2] bg-[#F5F5F7] px-5 py-3">
              <div className="flex gap-1.5">
                {(["index.ts", "retrieve.ts"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors",
                      tab === t ? "bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "text-[#6E6E73] hover:text-[#1D1D1F]",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                onClick={copy}
                className="flex items-center gap-1.5 font-mono text-[11px] text-[#6E6E73] transition-colors hover:text-[#1D1D1F]"
              >
                {copied ? <Check className="size-3.5 text-[#0071E3]" /> : <Copy className="size-3.5" />}
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <pre className="overflow-x-auto bg-white p-6 font-mono text-[13.5px] leading-[1.8] text-[#1D1D1F]/80">
              <code>
                {snippet.map((line, i) => (
                  <div key={i} className="flex gap-4">
                    <span className="w-4 shrink-0 select-none text-right text-[#1D1D1F]/20">{i + 1}</span>
                    <span>
                      {line.includes('"') ? (
                        <>
                          {line.split('"')[0]}
                          <span className="text-[#0071E3]">&quot;{line.split('"')[1]}&quot;</span>
                          {line.split('"').slice(2).join('"')}
                        </>
                      ) : (
                        line || " "
                      )}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================================
 * CTA / FOOTER
 * ========================================================================== */

function FinalCta() {
  return (
    <section className="border-t border-[#F0F0F2] bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-28 lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <Reveal>
          <h2 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[60px]">
            Build the application<span className="text-[#0071E3]">.</span>
            <br />
            <span className="text-[#A1A1A6]">Let RAGX handle retrieval<span className="text-[#0071E3]">.</span></span>
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="divide-y divide-[#E8E8ED] rounded-2xl border border-[#E8E8ED]">
            <Link
              href="/login"
              className="group flex items-center justify-between px-6 py-5 transition-colors hover:bg-[#F5F5F7]"
            >
              <span className="text-[16px] font-medium">Get Started</span>
              <ArrowRight className="size-4 text-[#0071E3] transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="/docs"
              className="group flex items-center justify-between px-6 py-5 transition-colors hover:bg-[#F5F5F7]"
            >
              <span className="text-[16px] font-medium">Read the Docs</span>
              <ArrowRight className="size-4 text-[#6E6E73] transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  const COLS = [
    { title: "Product", links: ["Pipeline", "Knowledge Bases", "Retrieval", "Pricing"] },
    { title: "Developers", links: ["Documentation", "API Reference", "SDK", "Status"] },
    { title: "Company", links: ["About", "Changelog", "GitHub", "Contact"] },
  ];

  return (
    <footer className="border-t border-[#E8E8ED] bg-[#FAFAFA]">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2">
              <LogoMark size={22} animated={false} />
              <span className="text-[15px] font-semibold tracking-tight">RAGX</span>
            </Link>
            <p className="mt-3 max-w-[240px] text-[13.5px] leading-relaxed text-[#6E6E73]">
              The retrieval layer for AI applications. Documents in, context out.
            </p>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6E6E73]">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5 text-[13.5px] text-[#1D1D1F]/80">
                {col.links.map((link) => (
                  <li key={link}>
                    <a href="#" className="transition-colors hover:text-[#0071E3]">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[#E8E8ED] pt-6 font-mono text-[11px] text-[#6E6E73]">
          <p>© 2026 RAGX, Inc.</p>
          <p>documents → parsing → chunking → embeddings → retrieval → context</p>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="min-h-screen bg-white font-sans text-[#1D1D1F] antialiased selection:bg-[#0071E3]/15">
        <Nav />
        <Hero />
        <LazySection minHeight={240}><PipelineStrip /></LazySection>
        <LazySection minHeight={560}><RagComparisonFlow /></LazySection>
        <LazySection minHeight={720}><HowItWorks /></LazySection>
        <LazySection minHeight={560}><ByoLlm /></LazySection>
        <LazySection minHeight={560}><CodeSection /></LazySection>
        <LazySection minHeight={520}><FinalCta /></LazySection>
        <Footer />
      </main>
    </MotionConfig>
  );
}
