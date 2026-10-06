import { randomUUID } from "node:crypto";

import { BadRequestError, HttpError, NotFoundError } from "@/Utils/httpError";

import { toStructuredDocument } from "../../Ingestion/Document/adapters";
import {
  createEmbeddingProvider,
  embedTextsBatched,
} from "../../Ingestion/Embeddings/embedding.registry";
import { DocumentEmptyError } from "../../Ingestion/Errors/document.errors";
import { structuredChunk } from "../../Ingestion/Chunking/structured.chunking";
import { createVectorStore } from "../../Ingestion/VectorStore/vector-store.registry";
// Side-effect import: self-registers the "pgvector"/"postgres" JSONB
// driver so `createVectorStore` resolves without services naming a
// concrete class.
import "../../Ingestion/VectorStore/postgres-jsonb.vector-store";
import {
  detectMimeType,
  ingestDocument,
} from "../../Ingestion/Pipeline/ingestion";
import { parserRegistry } from "../../Ingestion/Parsers";
import { resolveRequestProvider } from "../../Providers/Runtime/resolution";
import type { ResolvedProvider } from "../../Providers/Runtime/resolution";
import { ProviderService } from "../../Providers/Services/provider.services";
import {
  documentObjectKey,
  getObjectStorage,
} from "../../Storage/objectStorage";
import type { ObjectStorage } from "../../Storage/objectStorage";
import { DocumentRepository } from "../Repository/document.repo";
import { enqueueDocumentJob } from "../Jobs/document.jobs";

import type {
  BatchDocumentSummary,
  BatchUploadResult,
  Document,
} from "@repo/types";

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const EMBED_BATCH_SIZE = 32;

export interface ProviderHeaders {
  providerName?: unknown;
  providerKey?: unknown;
  providerModel?: unknown;
}

export interface UploadFileInput {
  filename: string;
  mimeType?: string;
  contentBase64: string;
}

function toDocumentMeta(row: {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string | null;
  chunkCount: number | null;
  createdAt: Date;
}): Document {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    status: (row.status ?? "PENDING") as Document["status"],
    chunks: row.chunkCount ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSummary(
  filename: string,
  status: BatchDocumentSummary["status"],
  id: string | null = null,
  error?: string,
): BatchDocumentSummary {
  return error === undefined
    ? { id, filename, status }
    : { id, filename, status, error };
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  return "Document processing failed";
}

/**
 * Filenames are client-controlled metadata (stored, returned, and logged
 * in ingestion stats). Strip ASCII control characters to block log
 * forging and control-char smuggling; length is capped to the schema
 * width so overlong names fail fast instead of DB-erroring. The object
 * key never contains the filename (UUID-scoped), so traversal via names
 * cannot reach storage.
 */
function sanitizeFileName(rawName: string): string {
  return rawName.trim().replace(/[\x00-\x1F\x7F]/g, "");
}

const MAX_FILENAME_LENGTH = 200;

function decodeContent(contentBase64: string): Buffer {
  if (!contentBase64 || contentBase64.length === 0) {
    throw new DocumentEmptyError(
      "Document content is empty or exceeds the 15MB limit",
    );
  }
  // Base64 inflates raw bytes by ~4/3. Reject oversized payloads before
  // allocating the decoded Buffer so a huge upload never spikes memory.
  const maxBase64Length = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 1024;
  if (contentBase64.length > maxBase64Length) {
    throw new DocumentEmptyError(
      "Document content is empty or exceeds the 15MB limit",
    );
  }
  const buffer = Buffer.from(contentBase64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentEmptyError(
      "Document content is empty or exceeds the 15MB limit",
    );
  }
  return buffer;
}

function assertSupportedMimeType(mimeType: string): void {
  // Fail fast at upload time: without a registered parser the background
  // job could only mark the document FAILED. Throwing here (415) creates
  // no DB row, stores no bytes, and enqueues no job.
  parserRegistry.get(mimeType);
}

function assertValidEmbeddings(vectors: number[][], expectedCount: number): void {
  if (vectors.length !== expectedCount) {
    throw new Error("Embedding count does not match chunk count");
  }
  if (vectors.length === 0) return;
  const dim = vectors[0]!.length;
  if (!dim || dim === 0) {
    throw new Error("Embedding provider returned empty vectors");
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dim) {
      throw new Error("Embedding dimensions are inconsistent");
    }
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new Error("Embedding provider returned an invalid vector");
      }
    }
  }
}

// Tables are never split by the chunker, so a single huge markdown table
// could exceed embedding provider token limits and fail the whole
// document. Split only oversize chunks here (post-process, chunker
// untouched) so the common path is unchanged.
const MAX_EMBED_CHARS = 8000;
const EMBED_SPLIT_OVERLAP = 800;

function splitOversizeChunkText(text: string): string[] {
  const clean = text.trim();
  if (!clean || clean.length <= MAX_EMBED_CHARS) return clean ? [clean] : [];
  const parts: string[] = [];
  const step = MAX_EMBED_CHARS - EMBED_SPLIT_OVERLAP;
  for (let start = 0; start < clean.length; start += step) {
    const slice = clean.slice(start, start + MAX_EMBED_CHARS).trim();
    if (slice) parts.push(slice);
    if (start + MAX_EMBED_CHARS >= clean.length) break;
  }
  return parts;
}

export class DocumentService {
  constructor(
    private readonly documentRepository = new DocumentRepository(),
    private readonly providerService = new ProviderService(),
    private readonly storage: ObjectStorage = getObjectStorage(),
    private readonly enqueue: typeof enqueueDocumentJob = enqueueDocumentJob,
  ) {}

  /**
   * Single upload: validate → persist PENDING row → store original in
   * object storage → enqueue an independent background job.
   * Processing happens asynchronously; poll GET for status.
   */
  async upload(
    projectId: string,
    input: { name: string; mimeType?: string; contentBase64: string },
    providerHeaders: ProviderHeaders = {},
  ): Promise<Document> {
    const fileName = sanitizeFileName(input.name);
    if (!fileName) {
      throw new DocumentEmptyError("Document name is required");
    }
    if (fileName.length > MAX_FILENAME_LENGTH) {
      throw new BadRequestError("Document name is too long");
    }
    const buffer = decodeContent(input.contentBase64);
    const mimeType = detectMimeType(fileName, input.mimeType);
    assertSupportedMimeType(mimeType);

    // The id is generated up front so the object key is known before
    // the first insert — no placeholder references, no extra roundtrip.
    const id = randomUUID();
    const created = await this.documentRepository.createDocument({
      id,
      projectId,
      filename: fileName,
      mimeType,
      size: buffer.length,
      objectKey: documentObjectKey(projectId, id),
    });

    if (!created) {
      throw new Error("Failed to create document");
    }

    try {
      await this.storage.upload(created.objectKey, buffer, mimeType);
    } catch (error) {
      await this.documentRepository.markFailed(
        created.id,
        safeFailureMessage(error),
      );
      throw error;
    }

    this.enqueue({
      documentId: created.id,
      projectId,
      providerName: providerHeaders.providerName,
      providerKey: providerHeaders.providerKey,
    });

    const row = await this.documentRepository.findByIdAndProject(
      created.id,
      projectId,
    );
    if (!row) throw new Error("Failed to load document");
    return toDocumentMeta(row);
  }

  /**
   * Batch upload: one row + one independent job per file. A failure in
   * one file never fails the others; each outcome is reported inline.
   */
  async uploadBatch(
    projectId: string,
    files: UploadFileInput[],
    providerHeaders: ProviderHeaders = {},
  ): Promise<BatchUploadResult> {
    const documents: BatchDocumentSummary[] = [];

    for (const file of files) {
      // Sanitized here too so FAILED summaries never echo control
      // characters back to the caller.
      const filename = sanitizeFileName(file.filename ?? "") || "document";
      try {
        const doc = await this.upload(
          projectId,
          {
            name: filename,
            mimeType: file.mimeType,
            contentBase64: file.contentBase64,
          },
          providerHeaders,
        );
        documents.push(toSummary(doc.filename, "PENDING", doc.id));
      } catch (error) {
        documents.push(
          toSummary(filename, "FAILED", null, safeFailureMessage(error)),
        );
      }
    }

    return { documents };
  }

  /**
   * Background worker entry: exactly one document lifecycle.
   * PENDING → PROCESSING → COMPLETED, or FAILED with a safe message.
   */
  async processDocument(
    projectId: string,
    documentId: string,
    providerHeaders: ProviderHeaders = {},
  ): Promise<BatchDocumentSummary> {
    const row = await this.documentRepository.findById(documentId);

    if (!row || row.projectId !== projectId) {
      throw new NotFoundError("Document not found");
    }
    if (row.status === "COMPLETED") {
      return toSummary(row.filename, "COMPLETED", row.id);
    }

    try {
      await this.documentRepository.markProcessing(documentId);

      // Defense in depth: upload already enforces MAX_DOCUMENT_BYTES, but
      // the stored object could have been replaced out of band. Checking
      // the recorded size avoids downloading a huge object unnecessarily.
      if (row.size > MAX_DOCUMENT_BYTES) {
        throw new DocumentEmptyError(
          "Document content is empty or exceeds the 15MB limit",
        );
      }

      const resolved = await resolveRequestProvider(
        projectId,
        providerHeaders,
        this.providerService,
      );

      const buffer = await this.storage.download(row.objectKey);
      if (buffer.length === 0 || buffer.length > MAX_DOCUMENT_BYTES) {
        throw new DocumentEmptyError(
          "Document content is empty or exceeds the 15MB limit",
        );
      }
      const fileName = row.filename;

      // Internal pipeline: parse → clean → chunk. RAGX chooses the
      // chunker; the client never sends strategy configuration.
      const { cleaned } = await ingestDocument({
        data: buffer,
        fileName,
        mimeType: row.mimeType,
      });
      const allChunks = structuredChunk(toStructuredDocument(cleaned, fileName));
      // Drop whitespace-only slices and image-ref chunks (no searchable
      // signal, only embedding cost). Order is preserved for chunkIndex.
      // Then split any oversize chunk (unsplit tables) so providers never
      // reject the batch on token limits. Chunker itself is untouched.
      const searchable = allChunks.filter(
        (c) => c.kind !== "image" && c.text.trim().length > 0,
      );
      const chunks: typeof searchable = [];
      for (const chunk of searchable) {
        const parts = splitOversizeChunkText(chunk.text);
        if (parts.length <= 1) {
          chunks.push(chunk);
        } else {
          for (const part of parts) {
            chunks.push({ ...chunk, text: part });
          }
        }
      }

      if (chunks.length === 0) {
        throw new DocumentEmptyError("Document produced no chunks");
      }

      const vectors = await this.embedTexts(
        resolved,
        chunks.map((c) => c.text),
      );
      // Guards the write path: every persisted embedding must be finite,
      // non-empty, and share one dimension so retrieval cosine math stays
      // valid. A mismatch fails this document only (FAILED), never others.
      assertValidEmbeddings(vectors, chunks.length);
      const embeddingDimensions = vectors[0]!.length;

      // Vector persistence goes through the store abstraction — never a
      // concrete database. The client is project-scoped at creation, so
      // reads and writes cannot leak across tenants.
      const vectorStore = await createVectorStore(
        { provider: "pgvector" },
        {
          projectId,
          listChunks: (pid) =>
            this.documentRepository.listChunksByProject(pid),
          chunksStore: this.documentRepository,
        },
      );

      // Idempotent retry: a previous attempt may have written rows before
      // failing at markCompleted (or the job was requeued after a crash).
      // Clearing this document's vectors first guarantees no duplicates.
      // Ownership was already verified via findById above. Deletion and
      // upsert both run AFTER successful embedding, so an embedding
      // failure can never wipe already-indexed chunks.
      await vectorStore.deleteByDocument(documentId);
      await vectorStore.upsert(
        chunks.map((chunk, i) => ({
          id: `${documentId}:chunk-${i}`,
          vector: vectors[i]!,
          text: chunk.text,
          documentId,
          page: chunk.page,
          metadata: {
            page: chunk.page,
            chunkIndex: i,
            kind: chunk.kind,
            // Section context: preserved from parse → clean → chunk so
            // retrieval context keeps its headings without re-parsing.
            headerPath: chunk.headerPath,
            provider: resolved.provider,
            embeddingModel: resolved.embeddingModel,
            embeddingDimensions,
          },
        })),
      );
      await this.documentRepository.markCompleted(documentId, chunks.length);

      return toSummary(row.filename, "COMPLETED", documentId);
    } catch (error) {
      await this.documentRepository.markFailed(
        documentId,
        safeFailureMessage(error),
      );
      throw error;
    }
  }

  async get(documentId: string, projectId: string): Promise<Document> {
    const row = await this.documentRepository.findByIdAndProject(
      documentId,
      projectId,
    );
    if (!row) {
      throw new NotFoundError("Document not found");
    }
    return toDocumentMeta(row);
  }

  async list(projectId: string): Promise<Document[]> {
    const rows = await this.documentRepository.listByProject(projectId);
    return rows.map(toDocumentMeta);
  }

  async remove(documentId: string, projectId: string) {
    const row = await this.documentRepository.findByIdAndProject(
      documentId,
      projectId,
    );

    if (!row) {
      throw new NotFoundError("Document not found");
    }

    const deleted = await this.documentRepository.deleteByIdAndProject(
      documentId,
      projectId,
    );

    if (!deleted) {
      throw new NotFoundError("Document not found");
    }

    // Best-effort: the DB row is authoritative; a missing object must
    // never fail the delete.
    if (row.objectKey) {
      await this.storage.delete(row.objectKey).catch(() => undefined);
    }

    return deleted;
  }

  private async embedTexts(
    resolved: ResolvedProvider,
    texts: string[],
  ): Promise<number[][]> {
    // One embedding configuration for the whole upload, built through
    // the registry — ingestion never configures providers itself.
    // NOTE: windowing + retry policy lives in `embedTextsBatched` (shared
    // with future callers) so batch-size changes apply everywhere at once.
    // Retries reuse this same instance/key/model: no provider or model
    // switching on failure, ever.
    const embedding = createEmbeddingProvider(
      resolved.provider,
      resolved.apiKey,
      resolved.embeddingModel,
    );
    return embedTextsBatched(embedding, texts, EMBED_BATCH_SIZE);
  }
}
