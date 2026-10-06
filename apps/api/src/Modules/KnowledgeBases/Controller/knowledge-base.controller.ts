import type { Request, Response } from "express";

import {
  getErrorMessage,
  getStatusCode,
} from "@/Utils/httpError";

import { KnowledgeBaseService } from "../Services/knowledge-base.services";
import {
  addDocumentToKnowledgeBaseSchema,
  createKnowledgeBaseSchema,
} from "../validation/knowledge-base.validation";

function requireProject(req: Request): string | null {
  return req.apiKeyContext?.projectId ?? null;
}

export class KnowledgeBaseController {
  constructor(
    private readonly knowledgeBaseService = new KnowledgeBaseService(),
  ) {}

  async create(req: Request, res: Response) {
    try {
      const projectId = requireProject(req);
      if (!projectId) {
        return res.status(401).json({
          success: false,
          message: "Missing RAGX API key",
        });
      }

      const parsed = createKnowledgeBaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid knowledge base",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const knowledgeBase = await this.knowledgeBaseService.create(
        projectId,
        parsed.data,
      );

      return res.status(201).json({
        success: true,
        message: "Knowledge base created successfully",
        data: knowledgeBase,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to create knowledge base"),
      });
    }
  }

  async list(req: Request, res: Response) {
    try {
      const projectId = requireProject(req);
      if (!projectId) {
        return res.status(401).json({
          success: false,
          message: "Missing RAGX API key",
        });
      }

      const knowledgeBases = await this.knowledgeBaseService.list(projectId);

      return res.status(200).json({
        success: true,
        data: knowledgeBases,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to fetch knowledge bases"),
      });
    }
  }

  async get(req: Request<{ knowledgeBaseId: string }>, res: Response) {
    try {
      const projectId = requireProject(req);
      const { knowledgeBaseId } = req.params;

      if (!projectId || !knowledgeBaseId) {
        return res.status(400).json({
          success: false,
          message: "Knowledge base ID is required",
        });
      }

      const knowledgeBase = await this.knowledgeBaseService.get(
        knowledgeBaseId,
        projectId,
      );

      return res.status(200).json({
        success: true,
        data: knowledgeBase,
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(error, "Failed to fetch knowledge base"),
      });
    }
  }

  async remove(req: Request<{ knowledgeBaseId: string }>, res: Response) {
    try {
      const projectId = requireProject(req);
      const { knowledgeBaseId } = req.params;

      if (!projectId || !knowledgeBaseId) {
        return res.status(400).json({
          success: false,
          message: "Knowledge base ID is required",
        });
      }

      await this.knowledgeBaseService.remove(knowledgeBaseId, projectId);

      return res.status(200).json({
        success: true,
        message: "Knowledge base deleted successfully",
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(error, "Failed to delete knowledge base"),
      });
    }
  }

  async addDocument(
    req: Request<{ knowledgeBaseId: string }>,
    res: Response,
  ) {
    try {
      const projectId = requireProject(req);
      const { knowledgeBaseId } = req.params;

      if (!projectId || !knowledgeBaseId) {
        return res.status(400).json({
          success: false,
          message: "Knowledge base ID is required",
        });
      }

      const parsed = addDocumentToKnowledgeBaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid request",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      await this.knowledgeBaseService.addDocument(
        projectId,
        knowledgeBaseId,
        parsed.data.documentId,
      );

      return res.status(200).json({
        success: true,
        message: "Document added to knowledge base successfully",
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(
          error,
          "Failed to add document to knowledge base",
        ),
      });
    }
  }
}
