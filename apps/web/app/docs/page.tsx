"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Search } from "lucide-react";
import { LogoMark } from "../../components/Logo";

/* ============================================================================
 * DATA
 * ========================================================================== */

const GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  {
    title: "Getting Started",
    items: [
      { id: "introduction", label: "Introduction" },
      { id: "dashboard", label: "Dashboard" },
      { id: "installation", label: "Installation" },
      { id: "quickstart", label: "Quickstart" },
      { id: "configuration", label: "Configuration" },
      { id: "environment", label: "Environment Variables" },
      { id: "commands", label: "Common Commands" },
    ],
  },
  {
    title: "Usage",
    items: [
      { id: "upload", label: "Upload Documents" },
      { id: "upload-many", label: "Multiple Documents" },
      { id: "documents-api", label: "Document Management" },
      { id: "search", label: "Search" },
      { id: "search-options", label: "Search Options" },
      { id: "knowledge-bases", label: "Knowledge Bases" },
    ],
  },
  {
    title: "Guides",
    items: [
      { id: "rag-application", label: "Build a RAG Application" },
      { id: "mistral", label: "Mistral Embeddings" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { id: "authentication", label: "Authentication" },
      { id: "api-documents", label: "Documents" },
      { id: "api-search", label: "Search" },
      { id: "api-knowledge-bases", label: "Knowledge Bases" },
      { id: "errors", label: "Errors" },
    ],
  },
];

const ALL_SECTIONS = GROUPS.flatMap((g) => g.items);

/* ============================================================================
 * PRIMITIVES
 * ========================================================================== */

function Code({ lang, children }: { lang: string; children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative my-5 overflow-hidden rounded-xl border border-[#E8E8ED]">
      <div className="flex items-center justify-between border-b border-[#F0F0F2] bg-[#F5F5F7] px-4 py-2">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#6E6E73]">{lang}</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(children).catch(() => {});
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
          className="flex items-center gap-1.5 font-mono text-[11px] text-[#6E6E73] transition-colors hover:text-[#1D1D1F]"
        >
          {copied ? <Check className="size-3.5 text-[#0071E3]" /> : <Copy className="size-3.5" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="code-scroll overflow-x-auto bg-white p-4 font-mono text-[13px] leading-[1.75]">
        <code>
          {children.split("\n").map((line, i) => (
            <div key={i}>{highlightLine(line, lang)}</div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function highlightLine(line: string, lang: string) {
  if (lang === "text") return <span className="text-[#1D1D1F]/85">{line || " "}</span>;

  // comments first
  const commentMatch = line.match(/^(\s*)(\/\/|#)(.*)$/);
  if (commentMatch && (lang === "bash" ? commentMatch[2] === "#" : true)) {
    return (
      <span>
        <span className="text-[#1D1D1F]/85">{commentMatch[1]}</span>
        <span className="text-[#8E8E93] italic">{commentMatch[2]}{commentMatch[3]}</span>
      </span>
    );
  }

  const out: React.ReactNode[] = [];
  const regex = /("(?:[^"\\]|\\.)*")|(\/\/.*$)|(#.*$)|(\b(?:const|await|new|import|from|export|function|return|true|false|null|undefined)\b)|(\b\d+(?:\.\d+)?\b)/g;

  if (lang === "bash") {
    const cmd = line.match(/^\s*(bun|npm|pnpm|cd|ragx)\b(.*)$/);
    if (cmd) {
      const [, lead, rest] = cmd[0].match(/^(\s*)(.*)$/)!;
      const parts = (rest ?? "").split(/(".*?"|\s+)/).filter(Boolean);
      const commentAt = parts.findIndex((p) => p.startsWith("#"));
      return (
        <span>
          <span>{lead}</span>
          {parts.map((p, i) =>
            commentAt !== -1 && i >= commentAt ? (
              <span key={i} className="text-[#8E8E93] italic">{p}</span>
            ) : i === 0 ? (
              <span key={i} className="font-medium text-[#0071E3]">{p}</span>
            ) : p.startsWith('"') ? (
              <span key={i} className="text-[#B25000]">{p}</span>
            ) : (
              <span key={i} className="text-[#1D1D1F]/85">{p}</span>
            ),
          )}
        </span>
      );
    }
    return <span className="text-[#1D1D1F]/85">{line || " "}</span>;
  }

  let last = 0;
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(line))) {
    if (m.index > last) out.push(<span key={last} className="text-[#1D1D1F]/85">{line.slice(last, m.index)}</span>);
    if (m[1]) out.push(<span key={m.index} className="text-[#0071E3]">{m[1]}</span>);
    else if (m[2] || m[3]) out.push(<span key={m.index} className="text-[#8E8E93] italic">{m[2] ?? m[3]}</span>);
    else if (m[4]) out.push(<span key={m.index} className="font-medium text-[#AF52DE]/80">{m[4]}</span>);
    else if (m[5]) out.push(<span key={m.index} className="text-[#B25000]">{m[5]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(<span key={last} className="text-[#1D1D1F]/85">{line.slice(last)}</span>);
  return line ? <>{out}</> : <span> </span>;
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-12 text-[22px] font-semibold tracking-[-0.02em] first:pt-0">
      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#0071E3] align-middle" aria-hidden />
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[15px] leading-relaxed text-[#1D1D1F]/80">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-[#1D1D1F]/80">{children}</ul>;
}

const METHOD_TONE: Record<string, string> = {
  GET: "bg-[#0071E3]/10 text-[#0071E3]",
  POST: "bg-emerald-500/10 text-emerald-600",
  PATCH: "bg-amber-500/10 text-amber-600",
  DELETE: "bg-red-500/10 text-red-600",
};

function Method({ m, path }: { m: string; path: string }) {
  return (
    <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#E8E8ED] bg-[#F5F5F7] px-3 py-1.5 font-mono text-[13px]">
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${METHOD_TONE[m] ?? "text-[#0071E3]"}`}>{m}</span>
      <span>{path}</span>
    </p>
  );
}

/* ============================================================================
 * PAGE
 * ========================================================================== */

export default function DocsPage() {
  const [active, setActive] = useState("introduction");
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.2, 0.5] },
    );
    ALL_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.label.toLowerCase().includes(query)),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  return (
    <main className="min-h-screen bg-white text-[#1D1D1F] antialiased">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[#E8E8ED] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2 text-[14px] font-semibold tracking-tight">
            <LogoMark size={21} />
            <span>RAGX</span>
            <span className="font-mono text-[11px] font-normal text-[#A1A1A6]">/ docs</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden h-8 items-center gap-2 rounded-md border border-[#E8E8ED] px-3 sm:flex">
              <Search className="size-3.5 text-[#6E6E73]" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search docs…"
                className="w-40 bg-transparent font-mono text-[12px] outline-none placeholder:text-[#A1A1A6]"
              />
              <kbd className="rounded border border-[#E8E8ED] bg-[#F5F5F7] px-1 font-mono text-[10px] text-[#6E6E73]">⌘K</kbd>
            </div>
            <Link href="/dashboard" className="flex h-8 items-center rounded-md bg-[#1D1D1F] px-3.5 text-[12px] font-medium text-white">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 px-5 pt-20 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)_200px] lg:gap-10">
        {/* Sidebar */}
        <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] overflow-y-auto pb-10 lg:block">
          {filtered.map((g) => (
            <div key={g.title} className="mt-6 first:mt-0">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6E6E73]">{g.title}</p>
              <ul className="mt-2.5 space-y-0.5 border-l border-[#F0F0F2]">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <a
                      href={`#${i.id}`}
                      className={`block border-l -ml-px pl-3 py-1 text-[13.5px] transition-colors ${
                        active === i.id
                          ? "border-[#0071E3] font-medium text-[#0071E3]"
                          : "border-transparent text-[#6E6E73] hover:text-[#1D1D1F]"
                      }`}
                    >
                      {i.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        {/* Content */}
        <article className="min-w-0 max-w-3xl pb-24">
          <h1 id="introduction" className="scroll-mt-24 text-[32px] font-semibold tracking-[-0.03em] pt-6">
            Introduction
          </h1>
          <P>
            RAGX is the retrieval layer for AI applications. It turns documents into searchable,
            AI-ready context — parsing, chunking, embeddings and vector storage are handled. Your
            application handles generation.
          </P>
          <Code lang="text">{`Documents
    ↓
  RAGX
    ↓
Relevant Context
    ↓
 Your LLM`}</Code>
          <P>
            <span className="font-medium">RAGX handles retrieval.</span>{" "}
            <span className="font-medium">Your application handles generation.</span>
          </P>

          <H2 id="dashboard">Dashboard</H2>
          <P>
            The RAGX dashboard at <Link href="/dashboard" className="text-[#0071E3] underline-offset-2 hover:underline">/dashboard</Link> is where you manage
            everything day to day:
          </P>
          <UL>
            <li><span className="font-medium">Projects</span> — isolate documents, chunks, searches and API keys per workspace.</li>
            <li><span className="font-medium">Documents</span> — upload files into a specific project and watch parsing, chunking and embedding progress.</li>
            <li><span className="font-medium">Collections</span> — group documents into knowledge bases and scope retrieval to them.</li>
            <li><span className="font-medium">Search</span> — run the same semantic retrieval your integration uses, with scores and sources.</li>
            <li><span className="font-medium">Usage</span> — retrievals, processed documents, chunk counts and embedding requests over time.</li>
            <li><span className="font-medium">Settings → API Keys</span> — create and revoke <span className="font-mono text-[13px]">ragx_live_…</span> keys and manage embedding provider credentials.</li>
          </UL>

          <H2 id="installation">Installation</H2>
          <P>Install the SDK into your project:</P>
          <Code lang="bash">bun add @ragx/sdk</Code>
          <Code lang="bash">npm install @ragx/sdk</Code>
          <Code lang="bash">pnpm add @ragx/sdk</Code>
          <P>The package exposes the RAGX client that talks to the RAGX API over HTTPS.</P>

          <H2 id="quickstart">Quickstart</H2>
          <P>Copy this into a file and fill in your keys. Every step is one API call.</P>
          <Code lang="ts">{`import RAGX from "@ragx/sdk";

const ragx = new RAGX({
  apiKey: process.env.RAGX_API_KEY,
  embedding: {
    provider: "mistral",
    apiKey: process.env.MISTRAL_API_KEY,
    model: "mistral-embed",
  },
});

const document = await ragx.documents.upload(
  "./docs/postgres.pdf"
);

await ragx.documents.waitUntilReady(document.id);

const results = await ragx.search(
  "How does PostgreSQL MVCC work?"
);

console.log(results[0].text, results[0].score);`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">upload</span> parses, chunks, embeds and indexes the file.</li>
            <li><span className="font-mono text-[13px]">waitUntilReady</span> polls until indexing finishes.</li>
            <li><span className="font-mono text-[13px]">search</span> embeds the query and returns ranked chunks.</li>
          </UL>

          <H2 id="configuration">Configuration</H2>
          <Code lang="ts">{`const ragx = new RAGX({
  apiKey: process.env.RAGX_API_KEY,
  embedding: {
    provider: "mistral",
    apiKey: process.env.MISTRAL_API_KEY,
    model: "mistral-embed",
  },
});`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">apiKey</span> — your RAGX project key (<span className="font-mono text-[13px]">ragx_live_…</span>).</li>
            <li><span className="font-mono text-[13px]">embedding.provider</span> — one of <span className="font-mono text-[13px]">"openai" | "mistral" | "gemini"</span>.</li>
            <li><span className="font-mono text-[13px]">embedding.apiKey</span> — credential for that provider. Used for embeddings only.</li>
            <li><span className="font-mono text-[13px]">embedding.model</span> — optional. Same model is used for indexing and query embedding.</li>
            <li><span className="font-mono text-[13px]">baseUrl</span> — optional, defaults to <span className="font-mono text-[13px]">https://api.ragx.dev</span>.</li>
          </UL>

          <H2 id="environment">Environment Variables</H2>
          <Code lang="bash">{`RAGX_API_KEY=ragx_live_...
MISTRAL_API_KEY=...`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">RAGX_API_KEY</span> authenticates your application with RAGX.</li>
            <li><span className="font-mono text-[13px]">MISTRAL_API_KEY</span> is sent to RAGX so it can call your embedding provider.</li>
          </UL>
          <P>
            These are separate credentials. Store both in environment variables — never commit them,
            never put them in URLs, never ship them to the browser.
          </P>

          <H2 id="commands">Common Commands</H2>
          <P>RAGX has no CLI. These are the package/runtime commands you actually use in this repository:</P>
          <Code lang="bash">{`bun install          # install dependencies
bun dev              # run all apps (api + web + docs)
bun run build        # production build
bun run check-types  # typecheck
bun run lint         # lint

cd apps/api
bun run db:migrate   # apply database migrations`}</Code>

          <H2 id="upload">Upload Documents</H2>
          <P>Upload one file. RAGX runs the pipeline:</P>
          <Code lang="text">{`File
  ↓
RAGX
  ↓
Parsing
  ↓
Chunking
  ↓
Embeddings
  ↓
Vector Storage
  ↓
Ready`}</Code>
          <Code lang="ts">{`const document = await ragx.documents.upload(
  "./docs/postgres.pdf"
);`}</Code>
          <Code lang="json">{`{
  "id": "doc_8f92",
  "filename": "postgres.pdf",
  "mimeType": "application/pdf",
  "size": 2480128,
  "status": "PROCESSING",
  "chunks": 0,
  "createdAt": "2026-10-02T12:00:00.000Z"
}`}</Code>
          <UL>
            <li>Status moves <span className="font-mono text-[13px]">PENDING → PROCESSING → COMPLETED</span> (or <span className="font-mono text-[13px]">FAILED</span>).</li>
            <li>Supported types: PDF, DOCX, HTML, TXT, CSV, Markdown.</li>
          </UL>

          <H2 id="upload-many">Multiple Documents</H2>
          <Code lang="ts">{`const result = await ragx.uploadMany([
  "./docs/postgres.pdf",
  "./docs/transactions.md",
  "./docs/indexing.pdf",
]);`}</Code>
          <Code lang="json">{`{
  "documents": [
    { "id": "doc_1", "filename": "postgres.pdf", "status": "PENDING" },
    { "id": null, "filename": "transactions.md", "status": "FAILED", "error": "unsupported file type" }
  ]
}`}</Code>
          <P>Each file has its own status and error. One failure does not fail the batch.</P>

          <H2 id="documents-api">Document Management</H2>
          <Code lang="ts">{`await ragx.documents.list();
const doc = await ragx.documents.get("doc_8f92");
await ragx.documents.delete("doc_8f92");
await ragx.documents.waitUntilReady("doc_8f92");`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">list()</span> — all documents in the project.</li>
            <li><span className="font-mono text-[13px]">get(id)</span> — one document, including status and chunk count.</li>
            <li><span className="font-mono text-[13px]">delete(id)</span> — removes the document and its vectors.</li>
            <li><span className="font-mono text-[13px]">waitUntilReady(id)</span> — polls until status is COMPLETED or FAILED.</li>
          </UL>

          <H2 id="search">Search</H2>
          <Code lang="ts">{`const results = await ragx.search(
  "How does PostgreSQL handle concurrent transactions?"
);`}</Code>
          <Code lang="text">{`Query
  ↓
Query Embedding
  ↓
Vector Search
  ↓
Top-K Results
  ↓
Relevant Context`}</Code>
          <Code lang="json">{`[
  {
    "text": "PostgreSQL uses MVCC...",
    "score": 0.94,
    "documentId": "doc_8f92",
    "chunkId": "ch_0042",
    "page": 17
  }
]`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">text</span> — the retrieved chunk.</li>
            <li><span className="font-mono text-[13px]">score</span> — similarity, higher is better.</li>
            <li><span className="font-mono text-[13px]">documentId</span> / <span className="font-mono text-[13px]">chunkId</span> — provenance.</li>
            <li><span className="font-mono text-[13px]">page</span> — source page when available.</li>
          </UL>

          <H2 id="search-options">Search Options</H2>
          <Code lang="ts">{`const results = await ragx.search(
  "How does MVCC work?",
  { topK: 10, knowledgeBase: "kb_123" }
);`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">topK</span> — number of chunks returned. Default 5.</li>
            <li><span className="font-mono text-[13px]">knowledgeBase</span> — restrict search to one knowledge base.</li>
          </UL>

          <H2 id="knowledge-bases">Knowledge Bases</H2>
          <P>A knowledge base groups documents. Search can be scoped to one.</P>
          <Code lang="text">{`Knowledge Base
 ├── postgres.pdf
 ├── transactions.md
 └── mvcc.md`}</Code>
          <Code lang="ts">{`const kb = await ragx.knowledgeBases.create({
  name: "PostgreSQL Documentation",
});

await ragx.knowledgeBases.addDocument(kb.id, document.id);

const results = await ragx.search("How does MVCC work?", {
  knowledgeBase: kb.id,
});`}</Code>
          <UL>
            <li><span className="font-mono text-[13px]">create({"{ name, description? }"})</span></li>
            <li><span className="font-mono text-[13px]">list()</span></li>
            <li><span className="font-mono text-[13px]">get(id)</span></li>
            <li><span className="font-mono text-[13px]">delete(id)</span></li>
            <li><span className="font-mono text-[13px]">addDocument(kbId, documentId)</span></li>
          </UL>

          <H2 id="rag-application">Build a RAG Application</H2>
          <Code lang="text">{`User Question
      ↓
 ragx.search()
      ↓
Relevant Context
      ↓
  Your LLM
      ↓
    Answer`}</Code>
          <Code lang="ts">{`const results = await ragx.search(userQuestion);

const context = results
  .map((r) => r.text)
  .join("\\n\\n");

// Pass context to OpenAI, Anthropic, Gemini, Mistral, Ollama…
// Generation stays in your application. RAGX only returns the context.`}</Code>

          <H2 id="mistral">Mistral Embeddings</H2>
          <Code lang="ts">{`const ragx = new RAGX({
  apiKey: process.env.RAGX_API_KEY,
  embedding: {
    provider: "mistral",
    apiKey: process.env.MISTRAL_API_KEY,
    model: "mistral-embed",
  },
});`}</Code>
          <P>
            The embedding provider (Mistral here) is independent from your generation provider.
            You can embed with Mistral and generate with any other LLM.
          </P>

          <H2 id="authentication">Authentication</H2>
          <P>Every API call sends two headers:</P>
          <Code lang="text">{`Authorization: Bearer <RAGX_API_KEY>
X-Provider: mistral
X-Provider-Key: <EMBEDDING_PROVIDER_KEY>
X-Provider-Model: mistral-embed   # optional`}</Code>
          <UL>
            <li>Get your API key from the RAGX dashboard.</li>
            <li>Store it in <span className="font-mono text-[13px]">RAGX_API_KEY</span>.</li>
            <li>The SDK sets these headers for you on every request.</li>
          </UL>

          <H2 id="api-documents">API — Documents</H2>
          <Method m="POST" path="/v1/documents" />
          <Code lang="json">{`// request
{ "name": "postgres.pdf", "mimeType": "application/pdf", "contentBase64": "..." }

// response
{ "id": "doc_8f92", "filename": "postgres.pdf", "status": "PENDING", "chunks": 0, "size": 2480128, "mimeType": "application/pdf", "createdAt": "..." }`}</Code>
          <Method m="POST" path="/v1/documents/batch" />
          <Code lang="json">{`// request
{ "files": [{ "filename": "postgres.pdf", "contentBase64": "..." }] }

// response
{ "documents": [{ "id": "doc_8f92", "filename": "postgres.pdf", "status": "PENDING" }] }`}</Code>
          <Method m="GET" path="/v1/documents" />
          <Method m="GET" path="/v1/documents/:documentId" />
          <Method m="DELETE" path="/v1/documents/:documentId" />

          <H2 id="api-search">API — Search</H2>
          <Method m="POST" path="/v1/search" />
          <Code lang="json">{`// request
{ "query": "How does PostgreSQL MVCC work?", "topK": 5, "knowledgeBase": "kb_123" }

// response
{ "results": [{ "text": "...", "score": 0.94, "documentId": "doc_8f92", "chunkId": "ch_0042", "page": 17 }] }`}</Code>
          <Method m="POST" path="/v1/ask" />
          <Code lang="json">{`// request
{ "query": "How does PostgreSQL MVCC work?" }

// response
{ "answer": "...", "results": [ ... ] }`}</Code>

          <H2 id="api-knowledge-bases">API — Knowledge Bases</H2>
          <Method m="POST" path="/v1/knowledge-bases" />
          <Code lang="json">{`// request
{ "name": "PostgreSQL Documentation" }

// response
{ "id": "kb_123", "name": "PostgreSQL Documentation", "description": null }`}</Code>
          <Method m="GET" path="/v1/knowledge-bases" />
          <Method m="GET" path="/v1/knowledge-bases/:knowledgeBaseId" />
          <Method m="DELETE" path="/v1/knowledge-bases/:knowledgeBaseId" />
          <Method m="POST" path="/v1/knowledge-bases/:knowledgeBaseId/documents" />
          <Code lang="json">{`// request
{ "documentId": "doc_8f92" }`}</Code>

          <H2 id="errors">Errors</H2>
          <UL>
            <li><span className="font-mono text-[13px]">401</span> — missing or invalid API key. Check <span className="font-mono text-[13px]">Authorization: Bearer …</span>.</li>
            <li><span className="font-mono text-[13px]">400</span> — invalid request body. The error message names the field.</li>
            <li><span className="font-mono text-[13px]">404</span> — document or knowledge base not found.</li>
            <li>Document <span className="font-mono text-[13px]">status: "FAILED"</span> — the pipeline could not process the file. Common cause: unsupported type or embedding failure. Re-upload after fixing the input.</li>
          </UL>
        </article>

        {/* On this page */}
        <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] overflow-y-auto pb-10 xl:block">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6E6E73]">On this page</p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {ALL_SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={active === s.id ? "text-[#0071E3]" : "text-[#6E6E73] hover:text-[#1D1D1F]"}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
