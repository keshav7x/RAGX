/**
 * Minimal embedding contract: text in, vectors out.
 * The API key is bound at construction by RAGX and never appears
 * in calls, logs, or responses.
 *
 * NOTE: batch-only by design — providers bill per token and enforce
 * rate limits per request, so even single-text callers go through the
 * same batched path (`embedSingle()` helper below). Do not add a
 * separate single-text provider call; wrap instead.
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Convenience for single-text callers (e.g. query embedding in
 * `RetrievalService.search`). Still issues one batch of size 1 so the
 * provider sees a uniform call shape.
 */
export async function embedSingle(
  provider: EmbeddingProvider,
  text: string,
): Promise<number[]> {
  const [vector] = await provider.embed([text]);
  if (!vector) {
    throw new Error("Embedding provider returned no vector");
  }
  return vector;
}

/**
 * Normalized single-query embedding: the `embedQuery` half of the
 * provider contract (`embedDocuments` is `embed` / `embedTextsBatched`).
 * Same batched path as ingestion, so indexing and query vectors always
 * share provider, model, and call semantics.
 */
export async function embedQuery(
  provider: EmbeddingProvider,
  text: string,
): Promise<number[]> {
  return embedSingle(provider, text);
}

/** Batching guard shared by ingestion and retrieval paths. */
export const DEFAULT_EMBED_BATCH_SIZE = 32;
