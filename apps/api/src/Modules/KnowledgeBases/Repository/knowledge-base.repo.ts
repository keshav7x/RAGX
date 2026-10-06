import { and, eq, sql } from "drizzle-orm";

import { db } from "@config/database";
import {
  documentTable,
  knowledgeBaseDocumentTable,
  knowledgeBaseTable,
} from "@db/schema";

const knowledgeBaseColumns = {
  id: knowledgeBaseTable.id,
  projectId: knowledgeBaseTable.projectId,
  name: knowledgeBaseTable.name,
  description: knowledgeBaseTable.description,
  createdAt: knowledgeBaseTable.createdAt,
  updatedAt: knowledgeBaseTable.updatedAt,
};

export class KnowledgeBaseRepository {
  private DB = db;

  async createKnowledgeBase(data: {
    projectId: string;
    name: string;
    description?: string;
  }) {
    const [row] = await this.DB
      .insert(knowledgeBaseTable)
      .values({
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
      })
      .returning(knowledgeBaseColumns);

    return row;
  }

  async listByProject(projectId: string) {
    return this.DB
      .select({
        ...knowledgeBaseColumns,
        documentCount: sql<number>`count(${knowledgeBaseDocumentTable.id})`,
      })
      .from(knowledgeBaseTable)
      .leftJoin(
        knowledgeBaseDocumentTable,
        eq(
          knowledgeBaseDocumentTable.knowledgeBaseId,
          knowledgeBaseTable.id,
        ),
      )
      .where(eq(knowledgeBaseTable.projectId, projectId))
      .groupBy(knowledgeBaseTable.id);
  }

  async findByIdAndProject(knowledgeBaseId: string, projectId: string) {
    const [row] = await this.DB
      .select({
        ...knowledgeBaseColumns,
        documentCount: sql<number>`count(${knowledgeBaseDocumentTable.id})`,
      })
      .from(knowledgeBaseTable)
      .leftJoin(
        knowledgeBaseDocumentTable,
        eq(
          knowledgeBaseDocumentTable.knowledgeBaseId,
          knowledgeBaseTable.id,
        ),
      )
      .where(
        and(
          eq(knowledgeBaseTable.id, knowledgeBaseId),
          eq(knowledgeBaseTable.projectId, projectId),
        ),
      )
      .groupBy(knowledgeBaseTable.id);

    return row;
  }

  async deleteByIdAndProject(knowledgeBaseId: string, projectId: string) {
    const [row] = await this.DB
      .delete(knowledgeBaseTable)
      .where(
        and(
          eq(knowledgeBaseTable.id, knowledgeBaseId),
          eq(knowledgeBaseTable.projectId, projectId),
        ),
      )
      .returning({ id: knowledgeBaseTable.id });

    return row;
  }

  /**
   * Scoped attach check: the link counts only when the knowledge base and
   * the document both belong to `projectId` (same-query join, so a
   * caller-supplied ID pair can never observe another project's links).
   */
  async isDocumentAttached(
    knowledgeBaseId: string,
    documentId: string,
    projectId: string,
  ) {
    const [row] = await this.DB
      .select({ id: knowledgeBaseDocumentTable.id })
      .from(knowledgeBaseDocumentTable)
      .innerJoin(
        knowledgeBaseTable,
        eq(knowledgeBaseTable.id, knowledgeBaseDocumentTable.knowledgeBaseId),
      )
      .innerJoin(
        documentTable,
        eq(documentTable.id, knowledgeBaseDocumentTable.documentId),
      )
      .where(
        and(
          eq(knowledgeBaseDocumentTable.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseDocumentTable.documentId, documentId),
          eq(knowledgeBaseTable.projectId, projectId),
          eq(documentTable.projectId, projectId),
        ),
      );

    return row !== undefined;
  }

  async addDocument(knowledgeBaseId: string, documentId: string) {
    const [row] = await this.DB
      .insert(knowledgeBaseDocumentTable)
      .values({ knowledgeBaseId, documentId })
      .returning({ id: knowledgeBaseDocumentTable.id });

    return row;
  }

  /**
   * Document IDs in a knowledge base, scoped to the owning project in the
   * same query — a KB ID can never reach another project's documents.
   */
  async listDocumentIds(knowledgeBaseId: string, projectId: string) {
    const rows = await this.DB
      .select({ documentId: knowledgeBaseDocumentTable.documentId })
      .from(knowledgeBaseDocumentTable)
      .innerJoin(
        knowledgeBaseTable,
        eq(knowledgeBaseTable.id, knowledgeBaseDocumentTable.knowledgeBaseId),
      )
      .innerJoin(
        documentTable,
        eq(documentTable.id, knowledgeBaseDocumentTable.documentId),
      )
      .where(
        and(
          eq(knowledgeBaseDocumentTable.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTable.projectId, projectId),
          eq(documentTable.projectId, projectId),
        ),
      );

    return rows.map((row) => row.documentId);
  }
}
