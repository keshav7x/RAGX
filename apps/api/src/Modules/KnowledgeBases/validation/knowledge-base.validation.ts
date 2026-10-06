import { z } from "zod";

export const createKnowledgeBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Knowledge base name is required")
    .max(100, "Knowledge base name is too long"),
  description: z
    .string()
    .trim()
    .max(500, "Description is too long")
    .optional(),
});

export type CreateKnowledgeBaseRequest = z.infer<
  typeof createKnowledgeBaseSchema
>;

export const addDocumentToKnowledgeBaseSchema = z.object({
  documentId: z.string().trim().min(1, "Document ID is required"),
});

export type AddDocumentToKnowledgeBaseRequest = z.infer<
  typeof addDocumentToKnowledgeBaseSchema
>;
