// NOTE: vector-store port (interface boundary).
//
// The business layer (DocumentService / RetrievalService) depends only on
// these types. Concrete drivers (pgvector, Pinecone, Qdrant, ...) implement
// `VectorStoreClient` and are selected through `vector-store.registry.ts`.
// Today the only driver is the PostgreSQL JSONB store (vectors in
// `document_chunk.embedding`, ranked in-JS); the interface exists so that
// migration never touches the domain services.
//
//! Never expose raw vectors or provider credentials through these types —
// they stay server-side. `projectId` is the tenant boundary for every
// operation.

import type { VectorStoreConfigInput } from "@repo/types";

/** Decrypted vector-store credentials for internal pipeline use only. */
export type VectorStoreResolution = VectorStoreConfigInput;

export interface VectorPoint {
  id: string;
  vector: number[];
  text: string;
  documentId: string;
  page?: number;
  /**
   * Caller-supplied metadata merged into the stored row (service values
   * win over driver defaults). Carries chunkIndex, kind, headerPath,
   * and embedding provenance for retrieval and debugging.
   */
  metadata?: Record<string, unknown>;
}

export interface VectorSearchHit {
  id: string;
  score: number;
  text: string;
  documentId: string;
  page?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Runtime vector-store client interface. Concrete implementations
 * (pgvector, Pinecone, Qdrant adapters) plug in here.
 */
export interface VectorStoreClient {
  readonly provider: string;
  upsert(points: VectorPoint[]): Promise<void>;
  search(vector: number[], topK: number): Promise<VectorSearchHit[]>;
  /** Remove every vector belonging to one document (retry/delete path). */
  deleteByDocument(documentId: string): Promise<void>;
}
