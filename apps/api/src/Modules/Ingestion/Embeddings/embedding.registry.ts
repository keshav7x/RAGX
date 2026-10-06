import { RAGX_EMBEDDING_MODELS } from "@repo/types";
import type { RAGXProviderName } from "@repo/types";

import { getRAGXProvider } from "../../Providers/Runtime/registry";
import { ProviderUpstreamError } from "../../Providers/Runtime/provider";
import { RuntimeEmbeddingProvider } from "./embedding.provider";
import type { EmbeddingProvider } from "./embedding.types";
import { DEFAULT_EMBED_BATCH_SIZE } from "./embedding.types";

/**
 * Single source of embedding configuration. RAGX resolves
 * provider + key + model once per request, then builds exactly one
 * of these. Ingestion and retrieval share it — no second config.
 *
 * No providers/ subfolder: the HTTP implementations already live in
 * Providers/Runtime and are reused here, not duplicated.
 */
export function createEmbeddingProvider(
  provider: RAGXProviderName,
  apiKey: string,
  model?: string,
): EmbeddingProvider {
  if (!apiKey?.trim()) {
    throw new Error("providerApiKey is required");
  }

  switch (provider) {
    case "openai":
    case "mistral":
    case "gemini": {
      const runtime = getRAGXProvider(provider);
      return new RuntimeEmbeddingProvider(
        runtime,
        apiKey,
        model ?? RAGX_EMBEDDING_MODELS[provider],
      );
    }
    default:
      throw new Error(
        `Unsupported embedding provider: ${provider as string}`,
      );
  }
}

/**
 * Shared batching loop for multi-chunk embedding (ingestion path).
 *
 * NOTE: providers cap request payloads and rate-limit per request, so
 * large chunk lists are sliced into `batchSize` windows. The count check
 * guards against providers that silently drop inputs.
 *
 * WHY centralize here instead of in DocumentService: retrieval embeds one
 * query (no batching) while ingestion embeds N chunks — both must use the
 * same provider instance semantics, and this keeps the windowing policy in
 * exactly one place.
 *
 * Retry policy: each window is retried with exponential backoff on
 * retryable upstream failures only (429 / 5xx / unreachable, per
 * `ProviderUpstreamError.retryable`). Auth/validation failures,
 * malformed responses, and count mismatches fail fast. Retries reuse the
 * SAME provider instance, key, and model — never a fallback.
 */
export interface EmbedBatchOptions {
  /** Attempts per window including the first try. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; doubled per retry. Default 250. */
  baseDelayMs?: number;
  /** Injectable clock (tests). Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_EMBED_MAX_ATTEMPTS = 3;
export const DEFAULT_EMBED_BASE_DELAY_MS = 250;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedTextsBatched(
  provider: EmbeddingProvider,
  texts: string[],
  batchSize: number = DEFAULT_EMBED_BATCH_SIZE,
  options: EmbedBatchOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }
  const maxAttempts =
    Number.isInteger(options.maxAttempts) && (options.maxAttempts as number) > 0
      ? (options.maxAttempts as number)
      : DEFAULT_EMBED_MAX_ATTEMPTS;
  const baseDelayMs =
    typeof options.baseDelayMs === "number" && options.baseDelayMs >= 0
      ? options.baseDelayMs
      : DEFAULT_EMBED_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const result = await provider.embed(batch);
        if (result.length !== batch.length) {
          throw new Error("Embedding count does not match chunk count");
        }
        for (const vec of result) {
          if (!Array.isArray(vec) || vec.length === 0 || !vec.every((v) => Number.isFinite(v))) {
            throw new Error("Embedding vector must be a non-empty finite array");
          }
        }
        if (vectors.length > 0 && result[0]!.length !== vectors[0]!.length) {
          throw new Error("Embedding dimension mismatch across batches");
        }
        vectors.push(...result);
        break;
      } catch (error) {
        const retryable =
          error instanceof ProviderUpstreamError && error.retryable;
        if (attempt >= maxAttempts || !retryable) throw error;
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  return vectors;
}
