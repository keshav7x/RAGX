import { z } from "zod";

// Single-document cap (15MB raw). Base64 inflates ~4/3, so the wire form
// is capped before any Buffer is allocated. NOTE: `express.json` already
// bounds the whole request body (21mb), so a batch can never exceed that
// on the wire; these per-file caps fail fast with clean 400s instead of
// ambiguous processing errors.
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 1024;

// Standard base64 alphabet (+ padding, tolerant of client-inserted
// whitespace). Rejects `data:` URIs, hex, and other non-base64 payloads
// at the boundary instead of letting `Buffer.from` silently ignore them.
const base64ContentSchema = z
  .string()
  .min(1, "Document content is required")
  .max(MAX_BASE64_CHARS, "Document content is required")
  .regex(
    /^[A-Za-z0-9+/=\s]+$/,
    "Document content is not valid base64",
  );

export const uploadDocumentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Document name is required")
    .max(200, "Document name is too long"),
  mimeType: z.string().trim().max(100).optional(),
  contentBase64: base64ContentSchema,
});

export type UploadDocumentRequest = z.infer<typeof uploadDocumentSchema>;

const batchFileSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "Document filename is required")
    .max(200, "Document filename is too long"),
  mimeType: z.string().trim().max(100).optional(),
  contentBase64: base64ContentSchema,
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
