import { z } from "zod";

export const uploadDocumentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Document name is required")
    .max(200, "Document name is too long"),
  mimeType: z.string().trim().max(100).optional(),
  contentBase64: z.string().min(1, "Document content is required"),
});

export type UploadDocumentRequest = z.infer<typeof uploadDocumentSchema>;

const batchFileSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "Document filename is required")
    .max(200, "Document filename is too long"),
  mimeType: z.string().trim().max(100).optional(),
  contentBase64: z.string().min(1, "Document content is required"),
});

export const uploadBatchSchema = z.object({
  files: z
    .array(batchFileSchema)
    .min(1, "At least one file is required")
    .max(20, "At most 20 files per batch"),
});

export type UploadBatchRequest = z.infer<typeof uploadBatchSchema>;

export const searchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Query is required")
    .max(2000, "Query is too long"),
  topK: z.number().int().min(1).max(20).default(5),
  knowledgeBase: z.string().trim().min(1).optional(),
});

export type SearchRequest = z.infer<typeof searchSchema>;

export const askSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Query is required")
    .max(2000, "Query is too long"),
  topK: z.number().int().min(1).max(20).default(5),
  knowledgeBase: z.string().trim().min(1).optional(),
});

export type AskRequest = z.infer<typeof askSchema>;
