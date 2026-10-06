import { BadRequestError, ConflictError, NotFoundError } from "@/Utils/httpError";

import { DocumentRepository } from "../../Documents/Repository/document.repo";
import { KnowledgeBaseRepository } from "../Repository/knowledge-base.repo";

import type { KnowledgeBase } from "@repo/types";

function toKnowledgeBase(row: {
  id: string;
  name: string;
  description: string | null;
  documentCount?: number | string | null;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    documentCount: Number(row.documentCount ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class KnowledgeBaseService {
  constructor(
    private readonly knowledgeBaseRepository = new KnowledgeBaseRepository(),
    private readonly documentRepository = new DocumentRepository(),
  ) {}

  async create(
    projectId: string,
    input: { name: string; description?: string },
  ): Promise<KnowledgeBase> {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestError("Knowledge base name is required");
    }

    const created =
      await this.knowledgeBaseRepository.createKnowledgeBase({
        projectId,
        name,
        description: input.description?.trim() || undefined,
      });
    if (!created) {
      throw new Error("Failed to create knowledge base");
    }

    return toKnowledgeBase({ ...created, documentCount: 0 });
  }

  async list(projectId: string): Promise<KnowledgeBase[]> {
    const rows =
      await this.knowledgeBaseRepository.listByProject(projectId);
    return rows.map(toKnowledgeBase);
  }

  async get(
    knowledgeBaseId: string,
    projectId: string,
  ): Promise<KnowledgeBase> {
    const row = await this.knowledgeBaseRepository.findByIdAndProject(
      knowledgeBaseId,
      projectId,
    );
    if (!row) {
      throw new NotFoundError("Knowledge base not found");
    }
    return toKnowledgeBase(row);
  }

  async remove(knowledgeBaseId: string, projectId: string): Promise<void> {
    const deleted =
      await this.knowledgeBaseRepository.deleteByIdAndProject(
        knowledgeBaseId,
        projectId,
      );
    if (!deleted) {
      throw new NotFoundError("Knowledge base not found");
    }
  }

  /**
   * Attach a document to a knowledge base. Both sides are ownership-checked
   * against the authenticated project, so a KB ID can never reach another
   * project's documents and vice versa. Re-attaching is a 409, never a
   * duplicate row (unique constraint backstops the pre-check race).
   */
  async addDocument(
    projectId: string,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    const knowledgeBase =
      await this.knowledgeBaseRepository.findByIdAndProject(
        knowledgeBaseId,
        projectId,
      );
    if (!knowledgeBase) {
      throw new NotFoundError("Knowledge base not found");
    }

    const document = await this.documentRepository.findByIdAndProject(
      documentId,
      projectId,
    );
    if (!document) {
      throw new NotFoundError("Document not found");
    }

    const attached =
      await this.knowledgeBaseRepository.isDocumentAttached(
        knowledgeBaseId,
        documentId,
      );
    if (attached) {
      throw new ConflictError(
        "Document is already in this knowledge base",
      );
    }

    try {
      await this.knowledgeBaseRepository.addDocument(
        knowledgeBaseId,
        documentId,
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "23505"
      ) {
        throw new ConflictError(
          "Document is already in this knowledge base",
        );
      }
      throw error;
    }
  }
}
