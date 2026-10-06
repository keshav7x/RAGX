
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  RAGX_PROVIDER_NAMES,
  isRAGXProviderName,
} from "@repo/types";
import type {
  AskResult,
  BatchUploadResult,
  Document,
  KnowledgeBase,
  RAGXConfig,
  RAGXProviderName,
  SearchResult,
} from "@repo/types";

export type {
  AskResult,
  BatchUploadResult,
  Document,
  KnowledgeBase,
  RAGXConfig,
  RAGXProviderName,
  SearchResult,
};

export type { LoadedDocument, LoadOptions } from "./loader.js";
import { loadDocument, loadDocuments } from "./loader.js";
import type {
  LoadBatchItem,
  LoadInput,
  LoadOptions,
  LoadedDocument,
} from "./loader.js";


export const DEFAULT_BASE_URL = "https://api.ragx.dev";

function assertBaseUrl(baseUrl: unknown): string {
  if (baseUrl === undefined) return DEFAULT_BASE_URL;
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error(
      "RAGX initialization failed: baseUrl must be a valid http(s) URL.",
    );
  }
  const trimmed = baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      "RAGX initialization failed: baseUrl must be a valid http(s) URL.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      "RAGX initialization failed: baseUrl must be a valid http(s) URL.",
    );
  }
  return trimmed.replace(/\/+$/, "");
}

function assertConfig(config: RAGXConfig): {
  provider: RAGXProviderName;
  providerApiKey: string;
  embeddingModel?: string;
  ragxApiKey: string;
  baseUrl: string;
} {
  if (!config || typeof config !== "object") {
    throw new Error("RAGX initialization failed: configuration is required.");
  }
  // Canonical nested `embedding`, with flat `provider`/`providerApiKey`
  // as legacy aliases. Both supplied but different means ambiguous
  // credentials — fail fast instead of silently picking one.
  const nested = config.embedding;
  const nestedProvider =
    nested && isRAGXProviderName(nested.provider)
      ? nested.provider
      : undefined;
  if (nested && nested.provider !== undefined && !nestedProvider) {
    throw new Error(
      `RAGX initialization failed: embedding.provider must be one of ${RAGX_PROVIDER_NAMES.join(", ")}.`,
    );
  }
  const flatProvider = isRAGXProviderName(config.provider)
    ? config.provider
    : undefined;
  if (config.provider !== undefined && !flatProvider) {
    throw new Error(
      `RAGX initialization failed: provider must be one of ${RAGX_PROVIDER_NAMES.join(", ")}.`,
    );
  }
  if (nestedProvider && flatProvider && nestedProvider !== flatProvider) {
    throw new Error(
      "RAGX initialization failed: embedding.provider and provider must match when both are supplied.",
    );
  }
  const provider = nestedProvider ?? flatProvider;
  if (!provider) {
    throw new Error(
      `RAGX initialization failed: provider must be one of ${RAGX_PROVIDER_NAMES.join(", ")}.`,
    );
  }

  const rawNestedKey =
    typeof nested?.apiKey === "string" && nested.apiKey.trim()
      ? nested.apiKey
      : undefined;
  const rawFlatKey =
    typeof config.providerApiKey === "string" && config.providerApiKey.trim()
      ? config.providerApiKey
      : undefined;
  if (rawNestedKey && rawFlatKey && rawNestedKey !== rawFlatKey) {
    throw new Error(
      "RAGX initialization failed: embedding.apiKey and providerApiKey must match when both are supplied.",
    );
  }
  const providerApiKey = rawNestedKey ?? rawFlatKey;
  if (!providerApiKey) {
    throw new Error(
      `RAGX initialization failed: providerApiKey is required when provider="${provider}".`,
    );
  }

  // Optional model override, sent as `X-Provider-Model` and applied to
  // both indexing and query embedding so the vector space stays
  // compatible. Omitted → server default for the provider.
  const rawModel = nested?.model;
  let embeddingModel: string | undefined;
  if (rawModel !== undefined) {
    if (typeof rawModel !== "string" || !rawModel.trim()) {
      throw new Error(
        "RAGX initialization failed: embedding.model must be a non-empty string.",
      );
    }
    if (rawModel.trim().length > 100) {
      throw new Error(
        "RAGX initialization failed: embedding.model name is too long.",
      );
    }
    embeddingModel = rawModel.trim();
  }

  // Canonical `apiKey`, with legacy `ragxApiKey` as an alias. Both
  // supplied but different means ambiguous credentials — fail fast
  // instead of silently picking one.
  const apiKey = config.apiKey?.trim() ? config.apiKey : undefined;
  const legacyKey =
    config.ragxApiKey?.trim() ? config.ragxApiKey : undefined;
  if (apiKey && legacyKey && apiKey !== legacyKey) {
    throw new Error(
      "RAGX initialization failed: apiKey and ragxApiKey must match when both are supplied.",
    );
  }
  const ragxApiKey = apiKey ?? legacyKey;
  if (!ragxApiKey?.trim()) {
    throw new Error(
      "RAGX initialization failed: apiKey is required.",
    );
  }
  return {
    provider,
    providerApiKey,
    embeddingModel,
    ragxApiKey,
    baseUrl: assertBaseUrl(config.baseUrl),
  };
}

export interface SearchOptions {
  topK?: number;
  knowledgeBase?: string;
}

export interface UploadOptions {
  /** Defaults to the file name (or "document" for raw bytes). */
  name?: string;
  /** Defaults to server-side detection from the name. */
  mimeType?: string;
}

export interface WaitForReadyOptions {
  /** Give up after this long. Defaults to 120_000 ms. */
  timeoutMs?: number;
  /** Delay between status polls. Defaults to 1_000 ms. */
  intervalMs?: number;
}

/** Anything the SDK can turn into bytes: path, buffer, or web Blob. */
export type UploadInput = string | Uint8Array | Blob;

/** One file inside a batch, with its own name when bytes carry none. */
export interface BatchFileInput {
  data: UploadInput;
  name?: string;
  mimeType?: string;
}

function isBatchItem(
  file: UploadInput | BatchFileInput | LoadedDocument,
): file is BatchFileInput {
  return (
    typeof file === "object" && file !== null && "data" in file
  );
}

/**
 * Phase 2 loader output. `LoadedDocument` carries no `data` field, so it
 * never collides with `BatchFileInput` — both stay accepted side by side.
 */
function isLoadedDocument(file: unknown): file is LoadedDocument {
  return (
    typeof file === "object" &&
    file !== null &&
    "content" in file &&
    "name" in file &&
    (file as { content?: unknown }).content instanceof Uint8Array
  );
}

export class RAGX {
  private readonly provider: RAGXProviderName;
  private readonly providerApiKey: string;
  private readonly embeddingModel?: string;
  private readonly ragxApiKey: string;
  private readonly baseUrl: string;

  readonly documents: {
    upload(
      file: UploadInput | LoadedDocument,
      opts?: UploadOptions,
    ): Promise<Document>;
    upload(
      files: (UploadInput | BatchFileInput | LoadedDocument)[],
      opts?: UploadOptions,
    ): Promise<BatchUploadResult>;
    list(): Promise<Document[]>;
    get(documentId: string): Promise<Document>;
    delete(documentId: string): Promise<void>;
    waitUntilReady(
      documentId: string,
      opts?: WaitForReadyOptions,
    ): Promise<Document>;
  };

  readonly knowledgeBases: {
    create(input: { name: string; description?: string }): Promise<KnowledgeBase>;
    list(): Promise<KnowledgeBase[]>;
    get(knowledgeBaseId: string): Promise<KnowledgeBase>;
    delete(knowledgeBaseId: string): Promise<void>;
    addDocument(knowledgeBaseId: string, documentId: string): Promise<void>;
  };

  /**
   * Local document loading. Normalizes paths, bytes, and Blobs into
   * `LoadedDocument`s that feed the ingestion pipeline (via
   * `documents.upload()`). Local-only — no remote URL loading.
   */
  readonly loader: {
    load(
      input: LoadInput | BatchFileInput,
      opts?: LoadOptions,
    ): Promise<LoadedDocument>;
    load(
      inputs: LoadBatchItem[],
      opts?: LoadOptions,
    ): Promise<LoadedDocument[]>;
  };

  constructor(config: RAGXConfig) {
    const valid = assertConfig(config);
    this.provider = valid.provider;
    // Kept in memory only. Sent to the RAGX server per request over the
    // provider headers — never to the provider directly, never logged.
    // The embedding key covers embeddings only; the SDK has no LLM
    // configuration because RAGX does not own generation.
    this.providerApiKey = valid.providerApiKey;
    this.embeddingModel = valid.embeddingModel;
    this.ragxApiKey = valid.ragxApiKey;
    this.baseUrl = valid.baseUrl;

    this.documents = {
      upload: ((
        file:
          | UploadInput
          | LoadedDocument
          | (UploadInput | BatchFileInput | LoadedDocument)[],
        opts?: UploadOptions,
      ): Promise<Document | BatchUploadResult> => {
        if (Array.isArray(file)) {
          return this.uploadBatch(file, opts);
        }
        return this.uploadDocument(file, opts);
      }) as {
        (
          file: UploadInput | LoadedDocument,
          opts?: UploadOptions,
        ): Promise<Document>;
        (
          files: (UploadInput | BatchFileInput | LoadedDocument)[],
          opts?: UploadOptions,
        ): Promise<BatchUploadResult>;
      },
      list: () => this.listDocuments(),
      get: (documentId) => this.getDocument(documentId),
      delete: (documentId) => this.deleteDocument(documentId),
      waitUntilReady: (documentId, opts) =>
        this.waitUntilReady(documentId, opts),
    };

    this.loader = {
      load: ((
        input: LoadInput | BatchFileInput | LoadBatchItem[],
        opts?: LoadOptions,
      ): Promise<LoadedDocument | LoadedDocument[]> => {
        if (Array.isArray(input)) {
          return loadDocuments(input, opts);
        }
        return loadDocument(input, opts);
      }) as {
        (
          input: LoadInput | BatchFileInput,
          opts?: LoadOptions,
        ): Promise<LoadedDocument>;
        (
          inputs: LoadBatchItem[],
          opts?: LoadOptions,
        ): Promise<LoadedDocument[]>;
      },
    };

    this.knowledgeBases = {
      create: (input) => this.createKnowledgeBase(input),
      list: () => this.listKnowledgeBases(),
      get: (knowledgeBaseId) => this.getKnowledgeBase(knowledgeBaseId),
      delete: (knowledgeBaseId) =>
        this.deleteKnowledgeBase(knowledgeBaseId),
      addDocument: (knowledgeBaseId, documentId) =>
        this.addDocumentToKnowledgeBase(knowledgeBaseId, documentId),
    };
  }

  /**
   * Upload a single document: local load inputs and loader output are
   * accepted interchangeably and normalized onto the same payload.
   */
  async upload(
    file: UploadInput | LoadedDocument,
    opts?: UploadOptions,
  ): Promise<Document> {
    return this.uploadDocument(file, opts);
  }

  /**
   * Upload many documents in one call; the server fans out to
   * independent per-document jobs.
   */
  async uploadMany(
    files: (UploadInput | BatchFileInput | LoadedDocument)[],
    opts?: UploadOptions,
  ): Promise<BatchUploadResult> {
    return this.uploadBatch(files, opts);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.ragxApiKey}`,
      "X-Provider": this.provider,
      "X-Provider-Key": this.providerApiKey,
      ...(this.embeddingModel
        ? { "X-Provider-Model": this.embeddingModel }
        : {}),
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    operation: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: this.headers(),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new Error(`RAGX ${operation} failed: unreachable server`);
    }

    const data = (await res.json().catch(() => null)) as {
      message?: string;
      data?: T;
    } | null;

    if (!res.ok) {
      throw new Error(
        `RAGX ${operation} failed (${res.status}): ${data?.message ?? "request failed"}`,
      );
    }
    return (data?.data ?? null) as T;
  }

  private async toUploadFile(
    file: UploadInput | LoadedDocument,
    opts: UploadOptions = {},
  ): Promise<{ filename: string; mimeType?: string; contentBase64: string }> {
    if (typeof file === "string") {
      const bytes = await readFile(file);
      return {
        filename: opts.name ?? path.basename(file),
        ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
        contentBase64: bytes.toString("base64"),
      };
    }

    // Phase 2 loader output: already normalized (bare name + MIME), so it
    // maps straight onto the upload payload. Explicit opts still win.
    if (isLoadedDocument(file)) {
      const bytes = Buffer.from(file.content);
      const mimeType = opts.mimeType ?? file.mimeType ?? undefined;
      return {
        filename: opts.name ?? file.name,
        ...(mimeType ? { mimeType } : {}),
        contentBase64: bytes.toString("base64"),
      };
    }

    if (typeof Blob !== "undefined" && file instanceof Blob) {
      const bytes = Buffer.from(new Uint8Array(await file.arrayBuffer()));
      const mimeType = opts.mimeType ?? file.type ?? undefined;
      return {
        filename: opts.name ?? "document",
        ...(mimeType ? { mimeType } : {}),
        contentBase64: bytes.toString("base64"),
      };
    }

    const bytes = Buffer.from(file as Uint8Array);
    return {
      filename: opts.name ?? "document",
      ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
      contentBase64: bytes.toString("base64"),
    };
  }

  private async uploadDocument(
    file: UploadInput | LoadedDocument,
    opts: UploadOptions = {},
  ): Promise<Document> {
    const single = await this.toUploadFile(file, opts);

    return this.request<Document>("upload", "/v1/documents", {
      method: "POST",
      body: {
        name: single.filename,
        ...(single.mimeType ? { mimeType: single.mimeType } : {}),
        contentBase64: single.contentBase64,
      },
    });
  }

  private async uploadBatch(
    files: (UploadInput | BatchFileInput | LoadedDocument)[],
    opts: UploadOptions = {},
  ): Promise<BatchUploadResult> {
    // One API call; the server fans out to independent per-document jobs.
    const normalized = await Promise.all(
      files.map((file) => {
        if (isBatchItem(file)) {
          return this.toUploadFile(file.data, {
            name: file.name ?? opts.name,
            mimeType: file.mimeType ?? opts.mimeType,
          });
        }
        return this.toUploadFile(file, opts);
      }),
    );

    return this.request<BatchUploadResult>("upload", "/v1/documents/batch", {
      method: "POST",
      body: { files: normalized },
    });
  }

  private async listDocuments(): Promise<Document[]> {
    return this.request<Document[]>("list", "/v1/documents");
  }

  private async createKnowledgeBase(input: {
    name: string;
    description?: string;
  }): Promise<KnowledgeBase> {
    return this.request<KnowledgeBase>("create", "/v1/knowledge-bases", {
      method: "POST",
      body: {
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      },
    });
  }

  private async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    return this.request<KnowledgeBase[]>("list", "/v1/knowledge-bases");
  }

  private async getKnowledgeBase(
    knowledgeBaseId: string,
  ): Promise<KnowledgeBase> {
    return this.request<KnowledgeBase>(
      "get",
      `/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
    );
  }

  private async deleteKnowledgeBase(
    knowledgeBaseId: string,
  ): Promise<void> {
    await this.request<unknown>(
      "delete",
      `/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
      { method: "DELETE" },
    );
  }

  private async addDocumentToKnowledgeBase(
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    await this.request<unknown>(
      "addDocument",
      `/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`,
      { method: "POST", body: { documentId } },
    );
  }

  private async getDocument(documentId: string): Promise<Document> {
    return this.request<Document>(
      "get",
      `/v1/documents/${encodeURIComponent(documentId)}`,
    );
  }

  /**
   * Poll `GET /v1/documents/:id` until the background pipeline finishes.
   * Resolves with the COMPLETED document; rejects when processing FAILED
   * or the timeout elapses. Polling only — uploading/processing stays
   * server-side.
   */
  private async waitUntilReady(
    documentId: string,
    opts: WaitForReadyOptions = {},
  ): Promise<Document> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const startedAt = Date.now();
    for (;;) {
      const doc = await this.getDocument(documentId);
      if (doc.status === "COMPLETED") return doc;
      if (doc.status === "FAILED") {
        throw new Error(`RAGX document ${documentId} failed to process`);
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `RAGX document ${documentId} did not become ready in time`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  private async deleteDocument(documentId: string): Promise<void> {
    await this.request<unknown>("delete", `/v1/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    });
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const data = await this.request<{ results: SearchResult[] }>(
      "search",
      "/v1/search",
      {
        method: "POST",
        body: {
          query,
          topK: opts.topK ?? 5,
          ...(opts.knowledgeBase !== undefined
            ? { knowledgeBase: opts.knowledgeBase }
            : {}),
        },
      },
    );
    if (!data || !Array.isArray(data.results)) {
      throw new Error("RAGX search failed: malformed response");
    }
    return data.results;
  }

  async retrieve(
    query: string,
    opts: SearchOptions = {},
  ): Promise<SearchResult[]> {
    return this.search(query, opts);
  }

  async ask(query: string, opts: SearchOptions = {}): Promise<AskResult> {
    return this.request<AskResult>("ask", "/v1/ask", {
      method: "POST",
      body: {
        query,
        topK: opts.topK ?? 5,
        ...(opts.knowledgeBase !== undefined
          ? { knowledgeBase: opts.knowledgeBase }
          : {}),
      },
    });
  }
}

export default RAGX;
