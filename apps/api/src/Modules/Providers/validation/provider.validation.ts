import { z } from "zod";

import {
  isPublicHttpUrl,
  isSafeConnectionString,
  isValidModelName,
} from "../Runtime/safety";

// Provider keys travel in upstream `Authorization` headers: reject control
// characters (CRLF/header splitting) at the boundary. Length bounds mirror
// the request-header validation in `resolveRequestProvider`.
const apiKeySchema = z
  .string()
  .min(8, "API key is required")
  .max(500, "API key is too long")
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value), {
    message: "API key is invalid",
  });

// Model names are interpolated into upstream URL paths (Gemini) and JSON
// bodies: allow-list the charset, not just the length.
const modelSchema = z
  .string()
  .trim()
  .min(1, "Model is required")
  .max(100, "Model name is too long")
  .refine(isValidModelName, {
    message: "Model name contains invalid characters",
  });

export const embeddingConfigSchema = z.object({
  provider: z.enum(["openai", "mistral"], {
    message: "Provider must be openai or mistral",
  }),
  model: modelSchema,
  apiKey: apiKeySchema,
});

export type EmbeddingConfigRequest = z.infer<typeof embeddingConfigSchema>;

const pineconeSchema = z.object({
  provider: z.literal("pinecone"),
  apiKey: apiKeySchema,
  index: z
    .string()
    .trim()
    .min(1, "Index is required for Pinecone")
    .max(200, "Index name is too long")
    .regex(
      /^[a-z0-9-]+$/,
      "Index name must be lowercase letters, numbers, or hyphens",
    ),
});

const qdrantSchema = z.object({
  provider: z.literal("qdrant"),
  url: z
    .string()
    .trim()
    .min(1, "URL is required for Qdrant")
    .max(500, "URL is too long")
    .url("URL must be a valid URL")
    // Stored SSRF gate: the URL is persisted encrypted and dialed later
    // by a vector-store driver. Only public http(s) targets without
    // embedded credentials; loopback/private/link-local/metadata hosts
    // (incl. decimal/hex/octal IP encodings) are refused. Single-label
    // docker names still pass — runtime egress controls cover those.
    .refine(isPublicHttpUrl, {
      message: "URL must be a public http(s) address",
    }),
  collection: z
    .string()
    .trim()
    .min(1, "Collection is required for Qdrant")
    .max(200, "Collection name is too long"),
  apiKey: z
    .string()
    .max(500, "API key is too long")
    .refine((value) => !/[\x00-\x1f\x7f]/.test(value), {
      message: "API key is invalid",
    })
    .optional(),
});

const pgvectorSchema = z.object({
  provider: z.literal("pgvector"),
  connectionString: z
    .string()
    .max(1000, "Connection string is too long")
    // Absent means the managed local database. When present it must be
    // an explicit TCP postgres URL with a public host — no local
    // sockets, no loopback/private targets.
    .refine(isSafeConnectionString, {
      message: "Connection string must target a public postgres host",
    })
    .optional(),
});

export const vectorStoreConfigSchema = z.discriminatedUnion("provider", [
  pineconeSchema,
  qdrantSchema,
  pgvectorSchema,
]);

export type VectorStoreConfigRequest = z.infer<typeof vectorStoreConfigSchema>;
