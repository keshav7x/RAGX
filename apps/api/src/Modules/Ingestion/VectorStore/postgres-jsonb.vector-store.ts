// NOTE: PostgreSQL JSONB vector-store driver (current production driver).
//
// Vectors live in `document_chunk.embedding` (JSONB) and ranking happens
// in-JS via `cosineSimilarity`. This class is the only place that SQL-shape
// knowledge lives for retrieval: services depend on the
// `VectorStoreClient` interface and obtain a project-scoped instance
// through `createVectorStore`, never by constructing this class directly
// (except tests, which inject a fake list function).
//
// Project isolation is enforced by construction: the driver is bound to
// exactly one `projectId`, reads via `listChunks(projectId)` only, and
// writes (`upsert`) stamp the scoped `projectId` — caller-supplied points
// carry no tenant field to confuse.
//
// Registered under both "pgvector" (managed local DB; JSONB fallback until
// the pgvector extension lands and a real `<=>` driver replaces this key)
// and "postgres" (backwards-compatible alias used in older comments).
// External drivers (Pinecone, Qdrant) register their own keys later
// without touching services.
//
//! Never log vectors, keys, or document contents here — errors stay generic.

import { DocumentRepository } from "@/Modules/Documents/Repository/document.repo";

import { cosineSimilarity } from "./similarity";
import { registerVectorStore } from "./vector-store.registry";
import type {
  VectorPoint,
  VectorSearchHit,
  VectorStoreClient,
} from "./vector-store.types";

interface StoredChunkRow {
  id?: string;
  documentId: string;
  page: number | null;
  text: string;
  embedding: number[] | null;
  metadata?: Record<string, unknown> | null;
}

export type ListChunksFn = (
  projectId: string,
) => Promise<StoredChunkRow[]>;

/**
 * Write dependency for the driver. `DocumentService` injects its own
 * repository (tests inject fakes); the registry threads it through scope.
 * Lazily defaulted so search-only usage never touches the write path.
 */
export type ChunkWriteStore = Pick<
  DocumentRepository,
  "insertChunks" | "deleteChunksByDocument"
>;

function defaultListChunks(projectId: string): Promise<StoredChunkRow[]> {
  return new DocumentRepository().listChunksByProject(projectId);
}

export class PostgresJsonbVectorStore implements VectorStoreClient {
  readonly provider = "pgvector";

  constructor(
    private readonly projectId: string,
    private readonly listChunks: ListChunksFn = defaultListChunks,
    private readonly chunksStore?: ChunkWriteStore,
  ) {}

  private writeStore(): ChunkWriteStore {
    return this.chunksStore ?? new DocumentRepository();
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    for (const point of points) {
      if (!point.documentId?.trim()) {
        throw new Error("VectorPoint documentId is required");
      }
      if (!point.text?.trim()) {
        throw new Error("VectorPoint text is required");
      }
      if (!Array.isArray(point.vector) || point.vector.length === 0 || !point.vector.every((v) => Number.isFinite(v))) {
        throw new Error("VectorPoint vector must be a non-empty finite array");
      }
    }
    const dim = points[0]!.vector.length;
    for (const point of points) {
      if (point.vector.length !== dim) {
        throw new Error("Embedding dimension mismatch within upsert batch");
      }
    }
    await this.writeStore().insertChunks(
      points.map((point, index) => ({
        documentId: point.documentId,
        projectId: this.projectId,
        page: point.page ?? undefined,
        text: point.text,
        embedding: point.vector,
        metadata: {
          page: point.page ?? null,
          chunkIndex: index,
          ...(point.metadata ?? {}),
        },
      })),
    );
  }

  async deleteByDocument(documentId: string): Promise<void> {
    if (!documentId?.trim()) {
      throw new Error("documentId is required");
    }
    await this.writeStore().deleteChunksByDocument(documentId, this.projectId);
  }

  async search(
    vector: number[],
    topK: number,
  ): Promise<VectorSearchHit[]> {
    if (!Array.isArray(vector) || vector.length === 0) return [];
    if (!vector.every((v) => Number.isFinite(v))) return [];
    const limit =
      Number.isInteger(topK) && topK > 0 ? Math.min(topK, 20) : 5;

    const rows = await this.listChunks(this.projectId);

    // Dimension consistency: ingestion validates a single dimension per
    // document batch, but the stored model can change over time. Rows
    // whose embedding length differs from the query vector cannot be
    // ranked meaningfully (cosine uses min-length), so they are skipped
    // rather than scored. Non-finite stored values are skipped as well.
    const dim = vector.length;
    const rankable = rows.filter(
      (row) =>
        Array.isArray(row.embedding) &&
        row.embedding.length === dim &&
        row.embedding.every((value) => Number.isFinite(value)),
    );

    return rankable
      .map((row, index) => ({
        id: row.id ?? `${row.documentId}:${row.page ?? 0}:${index}`,
        score: cosineSimilarity(vector, row.embedding ?? []),
        text: row.text,
        documentId: row.documentId,
        page: row.page ?? undefined,
        metadata: row.metadata ?? undefined,
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function requireProjectId(
  scope: { projectId?: string } | undefined,
): string {
  if (!scope?.projectId) {
    throw new Error("Vector store scope requires projectId");
  }
  return scope.projectId;
}

registerVectorStore(
  "pgvector",
  (_resolution, scope) =>
    new PostgresJsonbVectorStore(
      requireProjectId(scope),
      scope?.listChunks ?? defaultListChunks,
      scope?.chunksStore,
    ),
);

registerVectorStore(
  "postgres",
  (_resolution, scope) =>
    new PostgresJsonbVectorStore(
      requireProjectId(scope),
      scope?.listChunks ?? defaultListChunks,
      scope?.chunksStore,
    ),
);
