/**
 * Shared RAGX SDK/server contract.
 *
 * RAGX is the retrieval layer: the developer configures exactly one
 * embedding provider (plus the RAGX project key) and gets back relevant
 * context. Generation stays in the developer's application — the SDK has
 * no LLM configuration.
 */

export type RAGXProviderName = "openai" | "mistral" | "gemini";

export const RAGX_PROVIDER_NAMES: readonly RAGXProviderName[] = [
  "openai",
  "mistral",
  "gemini",
] as const;

/**
 * Embedding configuration. The embedding key lets RAGX call the selected
 * provider for document and query embeddings only — never for generation.
 */
export interface RAGXEmbeddingConfig {
  provider: RAGXProviderName;
  apiKey: string;
  /**
   * Optional model override (e.g. `"mistral-embed"`). When omitted the
   * server uses its default for the provider. The same model is used for
   * indexing and query embedding within a request so the vector space
   * stays compatible.
   */
  model?: string;
}

export interface RAGXConfig {
  /**
   * Canonical embedding configuration.
   */
  embedding?: RAGXEmbeddingConfig;
  /**
   * @deprecated Use `embedding.provider` instead. Accepted as an alias:
   * when both are supplied they must match.
   */
  provider?: RAGXProviderName;
  /**
   * @deprecated Use `embedding.apiKey` instead. Accepted as an alias:
   * when both are supplied they must match.
   */
  providerApiKey?: string;
  /**
   * Canonical RAGX project key (`ragx_live_...`). Authenticates the
   * developer/project with RAGX. Sent as `Authorization: Bearer`.
   * Conceptually separate from the embedding key (sent via provider
   * headers so RAGX can call the selected embedding provider).
   */
  apiKey?: string;
  /**
   * @deprecated Use `apiKey` instead. Accepted as an alias: when both are
   * supplied they must match.
   */
  ragxApiKey?: string;
  baseUrl?: string;
}

/** Provider defaults RAGX uses internally. Not client configuration. */
export const RAGX_EMBEDDING_MODELS: Record<RAGXProviderName, string> = {
  openai: "text-embedding-3-small",
  mistral: "mistral-embed",
  gemini: "text-embedding-004",
};

export const RAGX_CHAT_MODELS: Record<RAGXProviderName, string> = {
  openai: "gpt-4o-mini",
  mistral: "mistral-small-latest",
  gemini: "gemini-2.0-flash",
};

export type DocumentStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Document {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  chunks: number;
  createdAt: string;
}

/** Per-document outcome inside a batch upload. Independent lifecycle. */
export interface BatchDocumentSummary {
  id: string | null;
  filename: string;
  status: DocumentStatus;
  error?: string;
}

export interface BatchUploadResult {
  documents: BatchDocumentSummary[];
}

export interface SearchResult {
  text: string;
  score: number;
  documentId: string;
  chunkId: string;
  page?: number;
  metadata?: Record<string, unknown>;
}

export interface AskResult {
  answer: string;
  results: SearchResult[];
}

/** A named, project-scoped group of documents for filtered retrieval. */
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  /** Number of documents currently attached. */
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string;
}

export function isRAGXProviderName(
  value: unknown,
): value is RAGXProviderName {
  return (
    typeof value === "string" &&
    (RAGX_PROVIDER_NAMES as readonly string[]).includes(value)
  );
}
