"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { EmptyState, PageHead } from "../../../components/dashboard/ui";
import {
  ragxApi,
  type ApiDocument,
  type DocumentStatus,
  type Project,
} from "../../../lib/ragx-api";

const STAGES: DocumentStatus[] = ["PENDING", "PROCESSING", "COMPLETED"];

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  if (status === "COMPLETED") {
    return (
      <span className="flex items-center gap-2 text-[13px]">
        <span className="inline-block size-1.5 rounded-full bg-[#0071E3]" aria-label="ready" />
        Ready
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="flex items-center gap-2 text-[13px]">
        <span className="inline-block size-1.5 rounded-full bg-red-500" aria-label="failed" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-[13px]">
      <span className="relative flex size-1.5" aria-label="processing">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#0071E3] opacity-25" />
        <span className="relative inline-flex size-1.5 rounded-full bg-[#0071E3]" />
      </span>
      {status === "PENDING" ? "Pending" : "Processing"}
    </span>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("ragx.projectId");
  });
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(async () => {
    try {
      const list = await ragxApi.projects();
      setProjects(list);
      setProjectId((current) => {
        if (current && list.some((p) => p.id === current)) return current;
        const fallback = list[0]?.id ?? null;
        if (fallback) window.localStorage.setItem("ragx.projectId", fallback);
        return fallback;
      });
    } catch {
      setError("Sign in to view your projects and documents.");
    }
  }, []);

  const loadDocuments = useCallback(async (id: string) => {
    try {
      setDocuments(await ragxApi.projectDocuments(id));
    } catch {
      setError("Could not load documents for this project.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProjects().finally(() => setLoading(false));
  }, [loadProjects]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (projectId) void loadDocuments(projectId);
    else setDocuments([]);
  }, [projectId, loadDocuments]);

  // Poll while anything is still moving through the pipeline.
  useEffect(() => {
    if (
      !projectId ||
      !documents.some((d) => d.status === "PENDING" || d.status === "PROCESSING")
    ) {
      return;
    }
    const timer = window.setTimeout(() => void loadDocuments(projectId), 3000);
    return () => window.clearTimeout(timer);
  }, [documents, projectId, loadDocuments]);

  const selectProject = (id: string) => {
    setProjectId(id);
    window.localStorage.setItem("ragx.projectId", id);
    setError(null);
  };

  const uploadFiles = async (files: File[]) => {
    if (!projectId || files.length === 0) return;
    setError(null);
    setUploading(files.map((f) => f.name));
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          mimeType: f.type || undefined,
          contentBase64: await fileToBase64(f),
        })),
      );
      const result = await ragxApi.uploadProjectDocuments(projectId, payload);
      const failed = result.documents.filter((d) => d.status === "FAILED");
      if (failed.length > 0) {
        setError(
          `${failed.length} file${failed.length > 1 ? "s" : ""} failed: ${failed.map((d) => d.error ?? d.filename).join("; ")}`,
        );
      }
      await loadDocuments(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeDocument = async (id: string) => {
    if (!projectId) return;
    try {
      await ragxApi.deleteProjectDocument(projectId, id);
      setConfirmDelete(null);
      await loadDocuments(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  return (
    <div>
      <PageHead
        title="Documents"
        sub="Everything you've given RAGX to understand."
        right={
          <span className="flex items-center gap-2">
            <select
              aria-label="Project"
              value={projectId ?? ""}
              onChange={(e) => selectProject(e.target.value)}
              className="rounded-lg border border-[#E8E8ED] bg-white px-3 py-2 text-[13px] outline-none focus:border-black"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-black">
              <Plus className="size-4" /> Upload documents
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void uploadFiles(files);
                }}
              />
            </label>
          </span>
        }
      />

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </p>
      )}

      {/* dropzone */}
      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) void uploadFiles(files);
        }}
        animate={{ borderColor: drag ? "#0071E3" : "#E8E8ED", backgroundColor: drag ? "rgba(0,113,227,0.04)" : "#fff" }}
        className="mt-6 flex items-center justify-between rounded-2xl border border-dashed px-6 py-5 transition-colors"
      >
        <span className="flex items-center gap-3 text-sm text-[#6E6E73]">
          <FileUp className="size-5" />
          {drag ? "Drop to start the pipeline…" : "Drag & drop files here, or browse"}
        </span>
        <span className="hidden font-mono text-xs text-[#6E6E73] sm:block">PDF · DOCX · TXT · MD · HTML</span>
      </motion.div>

      {/* uploading */}
      {uploading && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-2xl border border-[#0071E3]/25 bg-[#0071E3]/[0.04] px-6 py-4"
        >
          <p className="flex items-center gap-2 font-mono text-[13px] font-medium">
            <Loader2 className="size-3.5 animate-spin" />
            Uploading {uploading.length} file{uploading.length > 1 ? "s" : ""}…
          </p>
          <p className="mt-1 truncate font-mono text-xs text-[#6E6E73]">
            {uploading.join(", ")}
          </p>
        </motion.div>
      )}

      {loading ? (
        <p className="mt-6 font-mono text-[13px] text-[#6E6E73]">Loading…</p>
      ) : !projectId ? (
        <div className="mt-6">
          <EmptyState
            title="No project selected."
            body="Create a project first, then upload documents into it."
            action={<Link href="/dashboard/projects" className="rounded-full bg-[#1D1D1F] px-4 py-2 text-sm font-medium text-white">Go to projects</Link>}
          />
        </div>
      ) : documents.length === 0 && !uploading ? (
        <div className="mt-6">
          <EmptyState
            title="No documents yet."
            body="Upload your first document and RAGX will take care of the pipeline."
            action={<span className="rounded-full bg-[#0071E3] px-4 py-2 text-sm font-medium text-white">Upload document</span>}
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-[#E8E8ED]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E8E8ED] bg-[#F5F5F7]/60 font-mono text-[11px] uppercase tracking-wider text-[#6E6E73]">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Size</th>
                <th className="px-3 py-3 font-medium">Chunks</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d, i) => (
                <motion.tr
                  key={d.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.05, 0.3) }}
                  className="border-b border-[#E8E8ED] last:border-0 transition-colors hover:bg-[#F5F5F7]/50"
                >
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/documents/${d.id}`} className="font-medium hover:text-[#0071E3]">
                      {d.filename}
                    </Link>
                    <p className="font-mono text-[11px] text-[#6E6E73]">{d.mimeType}</p>
                  </td>
                  <td className="px-3 py-3.5 font-mono text-xs tabular-nums">{formatBytes(d.size)}</td>
                  <td className="px-3 py-3.5 font-mono text-xs tabular-nums">{d.chunks.toLocaleString()}</td>
                  <td className="px-3 py-3.5">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {confirmDelete === d.id ? (
                      <span className="inline-flex items-center gap-2">
                        <button
                          onClick={() => void removeDocument(d.id)}
                          className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md px-2 py-1.5 text-xs text-[#6E6E73]"
                        >
                          <Check className="size-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(d.id)}
                        aria-label={`Delete ${d.filename}`}
                        className="rounded-md p-1.5 text-[#6E6E73] transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
