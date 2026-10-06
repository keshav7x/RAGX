import type { Request, Response } from "express";

import {
  getErrorMessage,
  getStatusCode,
} from "@/Utils/httpError";

import { DocumentService } from "../Services/document.services";
import type { ProviderHeaders } from "../Services/document.services";
import { RetrievalService } from "../Services/retrieval.services";
import { ProjectRepository } from "../../Projects/Repository/project.repo";
import {
  askSchema,
  searchSchema,
  uploadBatchSchema,
  uploadDocumentSchema,
} from "../validation/document.validation";

function providerHeaders(req: Request): ProviderHeaders {
  return {
    providerName: req.headers["x-provider"],
    providerKey: req.headers["x-provider-key"],
    providerModel: req.headers["x-provider-model"],
  };
}

function requireProject(req: Request): string | null {
  return req.apiKeyContext?.projectId ?? null;
}

/**
 * Resolve the path project for dashboard (session) requests and verify
 * it belongs to the authenticated user. Returns null → 404 so project
 * existence is never leaked across users.
 */
async function requireOwnedProject(
  projectRepository: ProjectRepository,
  projectId: string | undefined,
  userId: string | undefined,
): Promise<string | null> {
  if (!projectId || !userId) return null;
  const project = await projectRepository.findByIdAndUserId(
    projectId,
    userId,
  );
  return project ? project.id : null;
}

export class DocumentController {
  constructor(
    private readonly documentService = new DocumentService(),
    private readonly retrievalService = new RetrievalService(),
    private readonly projectRepository = new ProjectRepository(),
  ) {}

  async upload(req: Request, res: Response) {
    try {
      const projectId = requireProject(req);
      if (!projectId) {
        return res.status(401).json({
          success: false,
          message: "Missing RAGX API key",
        });
      }

      const parsed = uploadDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid document",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const document = await this.documentService.upload(
        projectId,
        parsed.data,
        providerHeaders(req),
      );

      return res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: document,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to upload document"),
      });
    }
  }

  async uploadBatch(req: Request, res: Response) {
    try {
      const projectId = requireProject(req);
      if (!projectId) {
        return res.status(401).json({
          success: false,
          message: "Missing RAGX API key",
        });
      }

      const parsed = uploadBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid batch upload",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const result = await this.documentService.uploadBatch(
        projectId,
        parsed.data.files,
        providerHeaders(req),
      );

      return res.status(202).json({
        success: true,
        message: "Batch accepted for processing",
        data: result,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to upload documents"),
      });
    }
  }

  async get(req: Request<{ documentId: string }>, res: Response) {
    try {
      const projectId = requireProject(req);
      const { documentId } = req.params;

      if (!projectId || !documentId) {
        return res.status(400).json({
          success: false,
          message: "Document ID is required",
        });
      }

      const document = await this.documentService.get(documentId, projectId);

      return res.status(200).json({
        success: true,
        data: document,
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(error, "Failed to fetch document"),
      });
    }
  }

  // ----------------------------------------
  // Dashboard (session auth, project in path)
  // ----------------------------------------

  async dashboardUploadBatch(
    req: Request<{ projectId: string }>,
    res: Response,
  ) {
    try {
      const projectId = await requireOwnedProject(
        this.projectRepository,
        req.params.projectId,
        req.user?.id,
      );
      if (!projectId) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      const parsed = uploadBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid batch upload",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const result = await this.documentService.uploadBatch(
        projectId,
        parsed.data.files,
        providerHeaders(req),
      );

      return res.status(202).json({
        success: true,
        message: "Batch accepted for processing",
        data: result,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to upload documents"),
      });
    }
  }

  async dashboardList(req: Request<{ projectId: string }>, res: Response) {
    try {
      const projectId = await requireOwnedProject(
        this.projectRepository,
        req.params.projectId,
        req.user?.id,
      );
      if (!projectId) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      const documents = await this.documentService.list(projectId);

      return res.status(200).json({
        success: true,
        data: documents,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to fetch documents"),
      });
    }
  }

  async dashboardGet(
    req: Request<{ projectId: string; documentId: string }>,
    res: Response,
  ) {
    try {
      const projectId = await requireOwnedProject(
        this.projectRepository,
        req.params.projectId,
        req.user?.id,
      );
      const { documentId } = req.params;

      if (!projectId || !documentId) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      const document = await this.documentService.get(documentId, projectId);

      return res.status(200).json({
        success: true,
        data: document,
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(error, "Failed to fetch document"),
      });
    }
  }

  async dashboardRemove(
    req: Request<{ projectId: string; documentId: string }>,
    res: Response,
  ) {
    try {
      const projectId = await requireOwnedProject(
        this.projectRepository,
        req.params.projectId,
        req.user?.id,
      );
      const { documentId } = req.params;

      if (!projectId || !documentId) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      await this.documentService.remove(documentId, projectId);

      return res.status(200).json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(error, "Failed to delete document"),
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

      const documents = await this.documentService.list(projectId);

      return res.status(200).json({
        success: true,
        data: documents,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to fetch documents"),
      });
    }
  }

  async remove(req: Request<{ documentId: string }>, res: Response) {
    try {
      const projectId = requireProject(req);
      const { documentId } = req.params;

      if (!projectId || !documentId) {
        return res.status(400).json({
          success: false,
          message: "Document ID is required",
        });
      }

      await this.documentService.remove(documentId, projectId);

      return res.status(200).json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      return res.status(getStatusCode(error, 404)).json({
        success: false,
        message: getErrorMessage(error, "Failed to delete document"),
      });
    }
  }

  async search(req: Request, res: Response) {
    try {
      const projectId = requireProject(req);
      if (!projectId) {
        return res.status(401).json({
          success: false,
          message: "Missing RAGX API key",
        });
      }

      const parsed = searchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid search request",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const results = await this.retrievalService.search(
        projectId,
        parsed.data.query,
        parsed.data.topK,
        providerHeaders(req),
        { knowledgeBaseId: parsed.data.knowledgeBase },
      );

      return res.status(200).json({
        success: true,
        data: { results },
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Search failed"),
      });
    }
  }

  async ask(req: Request, res: Response) {
    try {
      const projectId = requireProject(req);
      if (!projectId) {
        return res.status(401).json({
          success: false,
          message: "Missing RAGX API key",
        });
      }

      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid request",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const result = await this.retrievalService.ask(
        projectId,
        parsed.data.query,
        parsed.data.topK,
        providerHeaders(req),
        { knowledgeBaseId: parsed.data.knowledgeBase },
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(getStatusCode(error)).json({
        success: false,
        message: getErrorMessage(error, "Failed to answer"),
      });
    }
  }
}
