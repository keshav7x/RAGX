import { and, eq, inArray } from "drizzle-orm";

import { db } from "@config/database";
import { documentChunkTable, documentTable } from "@db/schema";

export interface NewChunk {
  documentId: string;
  projectId: string;
  page?: number;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

const documentColumns = {
  id: documentTable.id,
  projectId: documentTable.projectId,
  filename: documentTable.filename,
  mimeType: documentTable.mimeType,
  size: documentTable.size,
  objectKey: documentTable.objectKey,
  status: documentTable.status,
  chunkCount: documentTable.chunkCount,
  error: documentTable.error,
  createdAt: documentTable.createdAt,
};

export class DocumentRepository {
  private DB = db;

  async createDocument(data: {
    id?: string;
    projectId: string;
    filename: string;
    mimeType: string;
    size: number;
    objectKey: string;
  }) {
    const [row] = await this.DB
      .insert(documentTable)
      .values({
        ...(data.id ? { id: data.id } : {}),
        projectId: data.projectId,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        objectKey: data.objectKey,
        status: "PENDING",
      })
      .returning(documentColumns);

    return row;
  }

  async findById(documentId: string) {
    const [row] = await this.DB
      .select(documentColumns)
      .from(documentTable)
      .where(eq(documentTable.id, documentId));

    return row;
  }

  async markProcessing(documentId: string) {
    const [row] = await this.DB
      .update(documentTable)
      .set({ status: "PROCESSING", error: null, updatedAt: new Date() })
      .where(eq(documentTable.id, documentId))
      .returning({ id: documentTable.id });

    return row;
  }

  async markCompleted(documentId: string, chunkCount: number) {
    const [row] = await this.DB
      .update(documentTable)
      .set({ status: "COMPLETED", chunkCount, updatedAt: new Date() })
      .where(eq(documentTable.id, documentId))
      .returning({ id: documentTable.id });

    return row;
  }

  async markFailed(documentId: string, error: string) {
    const [row] = await this.DB
      .update(documentTable)
      .set({ status: "FAILED", error, updatedAt: new Date() })
      .where(eq(documentTable.id, documentId))
      .returning({ id: documentTable.id });

    return row;
  }

  /** Documents left behind by a shutdown: safe to requeue. */
  async listStuckDocuments() {
    return this.DB
      .select({ id: documentTable.id, projectId: documentTable.projectId })
      .from(documentTable)
      .where(
        inArray(documentTable.status, ["PENDING", "PROCESSING"] as const),
      );
  }

  async listByProject(projectId: string) {
    return this.DB
      .select({
        id: documentTable.id,
        filename: documentTable.filename,
        mimeType: documentTable.mimeType,
        size: documentTable.size,
        status: documentTable.status,
        chunkCount: documentTable.chunkCount,
        error: documentTable.error,
        createdAt: documentTable.createdAt,
      })
      .from(documentTable)
      .where(eq(documentTable.projectId, projectId));
  }

  async findByIdAndProject(documentId: string, projectId: string) {
    const [row] = await this.DB
      .select({
        id: documentTable.id,
        filename: documentTable.filename,
        mimeType: documentTable.mimeType,
        size: documentTable.size,
        objectKey: documentTable.objectKey,
        status: documentTable.status,
        chunkCount: documentTable.chunkCount,
        error: documentTable.error,
        createdAt: documentTable.createdAt,
      })
      .from(documentTable)
      .where(
        and(
          eq(documentTable.id, documentId),
          eq(documentTable.projectId, projectId),
        ),
      );

    return row;
  }

  async deleteByIdAndProject(documentId: string, projectId: string) {
    const [row] = await this.DB
      .delete(documentTable)
      .where(
        and(
          eq(documentTable.id, documentId),
          eq(documentTable.projectId, projectId),
        ),
      )
      .returning({ id: documentTable.id, objectKey: documentTable.objectKey });

    return row;
  }

  async insertChunks(chunks: NewChunk[]) {
    if (chunks.length === 0) return;
    await this.DB.insert(documentChunkTable).values(
      chunks.map((c) => ({
        documentId: c.documentId,
        projectId: c.projectId,
        page: c.page,
        text: c.text,
        embedding: c.embedding,
        metadata: c.metadata ?? null,
      })),
    );
  }

  /**
   * Remove stale chunks for one document before (re)inserting.
   * Makes retries idempotent: a FAILED attempt that already wrote rows,
   * or a PROCESSING row requeued after a crash, never leaves duplicates.
   * Scoped by (documentId, projectId) so a caller-supplied ID can never
   * reach another project's vectors even if ownership check is skipped.
   */
  async deleteChunksByDocument(documentId: string, projectId?: string) {
    const conditions = [eq(documentChunkTable.documentId, documentId)];
    if (projectId) {
      conditions.push(eq(documentChunkTable.projectId, projectId));
    }
    await this.DB.delete(documentChunkTable).where(
      conditions.length > 1 ? and(...conditions) : conditions[0],
    );
  }

  async listChunksByProject(projectId: string) {
    return this.DB
      .select({
        id: documentChunkTable.id,
        documentId: documentChunkTable.documentId,
        page: documentChunkTable.page,
        text: documentChunkTable.text,
        embedding: documentChunkTable.embedding,
        metadata: documentChunkTable.metadata,
      })
      .from(documentChunkTable)
      .where(eq(documentChunkTable.projectId, projectId));
  }

  /**
   * Chunks for an explicit document set (knowledge-base filtering).
   * Always scoped to the project alongside the document list, so a
   * caller-supplied ID set can never reach another project's vectors.
   */
  async listChunksByDocuments(projectId: string, documentIds: string[]) {
    if (documentIds.length === 0) return [];
    return this.DB
      .select({
        id: documentChunkTable.id,
        documentId: documentChunkTable.documentId,
        page: documentChunkTable.page,
        text: documentChunkTable.text,
        embedding: documentChunkTable.embedding,
        metadata: documentChunkTable.metadata,
      })
      .from(documentChunkTable)
      .where(
        and(
          eq(documentChunkTable.projectId, projectId),
          inArray(documentChunkTable.documentId, documentIds),
        ),
      );
  }
}
