"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { PageHead } from "../../../components/dashboard/ui";

const NAV = ["General", "Retrieval", "API Keys"] as const;
type Tab = (typeof NAV)[number];

const inputCls =
  "w-full rounded-md border border-[#E8E8ED] bg-white px-3 py-2 text-[14px] outline-none transition-colors focus:border-[#1D1D1F]";

const API_KEYS = [
  { id: "k1", name: "Production", preview: "rgx_live_9f2a…b41c", created: "Sep 25, 2026", lastUsed: "2 min ago" },
  { id: "k2", name: "Staging", preview: "rgx_test_77e0…03ad", created: "Sep 12, 2026", lastUsed: "1 h ago" },
];

const PROVIDERS = [
  { name: "Mistral", field: "Embedding provider", state: "Connected · mistral-embed" },
  { name: "OpenAI", field: "Embedding provider", state: "Not connected" },
];

function ApiKeysTab() {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div>
      <h2 className="text-[17px] font-semibold">API Keys</h2>
      <p className="mt-1 text-[13px] text-[#6E6E73]">
        RAGX API keys authenticate your application against the retrieval API. Embedding provider credentials are stored separately, server-side.
      </p>

      <div className="mt-4 rounded-lg border border-[#E8E8ED]">
        <div className="flex items-center justify-between border-b border-[#E8E8ED] px-5 py-3.5">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <KeyRound className="size-4 text-[#6E6E73]" /> RAGX API keys
          </p>
          <button className="rounded-md bg-[#1D1D1F] px-3 py-1.5 text-[12.5px] font-medium text-white">
            Create key
          </button>
        </div>
        {API_KEYS.map((k, i) => (
          <div key={k.id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 ${i > 0 ? "border-t border-[#E8E8ED]" : ""}`}>
            <div>
              <p className="text-[14px] font-medium">{k.name}</p>
              <p className="mt-0.5 font-mono text-[12px] text-[#6E6E73]">
                {k.preview} · created {k.created} · last used {k.lastUsed}
              </p>
            </div>
            <button
              onClick={() => {
                setCopied(k.id);
                window.setTimeout(() => setCopied(null), 1400);
              }}
              className="flex items-center gap-1.5 rounded-md border border-[#E8E8ED] px-2.5 py-1.5 font-mono text-[12px] text-[#6E6E73] transition-colors hover:border-[#1D1D1F]/25"
            >
              {copied === k.id ? <Check className="size-3.5 text-[#0071E3]" /> : <Copy className="size-3.5" />}
              {copied === k.id ? "copied" : "copy"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-[#E8E8ED]">
        <div className="border-b border-[#E8E8ED] px-5 py-3.5">
          <p className="text-[14px] font-medium">Embedding provider credentials</p>
          <p className="mt-0.5 text-[12.5px] text-[#6E6E73]">Encrypted at rest. Never returned by the API after save.</p>
        </div>
        {PROVIDERS.map((p, i) => (
          <div key={p.name} className={`flex items-center justify-between px-5 py-3.5 ${i > 0 ? "border-t border-[#E8E8ED]" : ""}`}>
            <div>
              <p className="text-[14px] font-medium">{p.name}</p>
              <p className="mt-0.5 font-mono text-[12px] text-[#6E6E73]">{p.field}</p>
            </div>
            <span className={`font-mono text-[12px] ${p.state.startsWith("Not") ? "text-[#6E6E73]" : "text-[#0071E3]"}`}>
              {p.state}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-[#6E6E73]">
        Secrets are shown masked after creation. Rotate any key that appears in client-side code, logs, or URLs.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("General");

  // general
  const [name, setName] = useState("Docs Assistant");
  const [savedGeneral, setSavedGeneral] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // retrieval
  const [topK, setTopK] = useState("5");
  const [minScore, setMinScore] = useState("0.70");
  const [rerank, setRerank] = useState(true);
  const [savedRet, setSavedRet] = useState(false);

  return (
    <div>
      <PageHead title="Settings" sub="Project configuration." />

      <div className="mt-6 grid gap-8 lg:grid-cols-[190px_1fr]">
        {/* sub nav */}
        <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:self-start">
          {NAV.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-[13.5px] transition-colors ${
                tab === t ? "bg-[#F5F5F7] font-medium text-[#1D1D1F]" : "text-[#6E6E73] hover:text-[#1D1D1F]"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-w-0"
        >
          {tab === "General" && (
            <div>
              <h2 className="text-[17px] font-semibold">General</h2>
              <div className="mt-4 rounded-lg border border-[#E8E8ED]">
                <div className="border-b border-[#E8E8ED] px-5 py-4">
                  <p className="text-[14px] font-medium">Project Name</p>
                  <p className="mt-0.5 text-[13px] text-[#6E6E73]">Used in the dashboard and API responses.</p>
                  <div className="mt-3 flex max-w-md gap-2">
                    <input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setSavedGeneral(false);
                      }}
                      className={inputCls}
                    />
                    <button
                      onClick={() => setSavedGeneral(true)}
                      className="shrink-0 rounded-md bg-[#1D1D1F] px-4 py-2 text-[13px] font-medium text-white"
                    >
                      {savedGeneral ? "Saved" : "Save"}
                    </button>
                  </div>
                </div>
                <div className="border-b border-[#E8E8ED] px-5 py-4">
                  <p className="text-[14px] font-medium">Project Slug</p>
                  <p className="mt-0.5 text-[13px] text-[#6E6E73]">Immutable identifier used in URLs and API paths.</p>
                  <input value="docs-assistant" disabled className={`${inputCls} mt-3 max-w-md bg-[#F5F5F7] font-mono text-[#6E6E73]`} />
                </div>
                <div className="px-5 py-4">
                  <p className="text-[14px] font-medium text-red-600">Delete Project</p>
                  <p className="mt-0.5 text-[13px] text-[#6E6E73]">
                    Permanently removes documents, vectors and API keys. This cannot be undone.
                  </p>
                  {confirmDelete ? (
                    <span className="mt-3 flex gap-2">
                      <button className="rounded-md bg-red-600 px-4 py-2 text-[13px] font-medium text-white">
                        Confirm delete
                      </button>
                      <button onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-2 text-[13px] text-[#6E6E73]">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="mt-3 flex items-center gap-1.5 rounded-md border border-red-200 px-4 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "Retrieval" && (
            <div>
              <h2 className="text-[17px] font-semibold">Retrieval</h2>
              <div className="mt-4 rounded-lg border border-[#E8E8ED]">
                <div className="grid border-b border-[#E8E8ED] sm:grid-cols-2">
                  <div className="border-b border-[#E8E8ED] px-5 py-4 sm:border-b-0 sm:border-r">
                    <p className="text-[14px] font-medium">Default Top K</p>
                    <p className="mt-0.5 text-[13px] text-[#6E6E73]">Chunks per query when omitted.</p>
                    <input
                      value={topK}
                      onChange={(e) => {
                        setTopK(e.target.value);
                        setSavedRet(false);
                      }}
                      inputMode="numeric"
                      className={`${inputCls} mt-3 font-mono`}
                    />
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-[14px] font-medium">Minimum Score</p>
                    <p className="mt-0.5 text-[13px] text-[#6E6E73]">Drop chunks below similarity.</p>
                    <input
                      value={minScore}
                      onChange={(e) => {
                        setMinScore(e.target.value);
                        setSavedRet(false);
                      }}
                      inputMode="decimal"
                      className={`${inputCls} mt-3 font-mono`}
                    />
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRerank((r) => !r);
                    setSavedRet(false);
                  }}
                  className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[#FAFAFA]"
                >
                  <span>
                    <span className="block text-[14px] font-medium">Cross-encoder rerank</span>
                    <span className="mt-0.5 block font-mono text-[12px] text-[#6E6E73]">Re-score top 20 before returning top K</span>
                  </span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${rerank ? "bg-[#0071E3]" : "bg-[#E8E8ED]"}`}>
                    <motion.span
                      animate={{ x: rerank ? 20 : 2 }}
                      transition={{ type: "spring", stiffness: 400, damping: 28 }}
                      className="absolute top-[3px] size-[18px] rounded-full bg-white shadow"
                    />
                  </span>
                </button>
              </div>
              <button
                onClick={() => setSavedRet(true)}
                className="mt-3 flex items-center gap-1.5 rounded-md bg-[#1D1D1F] px-4 py-2 text-[13px] font-medium text-white"
              >
                {savedRet && <Check className="size-3.5" />} {savedRet ? "Saved" : "Save"}
              </button>
            </div>
          )}

          {tab === "API Keys" && <ApiKeysTab />}

        </motion.div>
      </div>
    </div>
  );
}
