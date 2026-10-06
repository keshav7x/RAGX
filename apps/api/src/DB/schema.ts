// NOTE: single source of truth for PostgreSQL tables (drizzle).
//
// Repository classes own all queries against these tables — controllers,
// services, SDK, and workers never import drizzle directly. `objectKey`
// references object storage (binaries never live in Postgres); vectors
// live in `document_chunk.embedding` (JSONB, ranked in-JS) until the
// pgvector migration lands behind the VectorStore abstraction.
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";



export const userTable=pgTable("user",{
    id: uuid("id").defaultRandom().primaryKey(),
    username:varchar({length:30}).notNull(),
    email:varchar({length:50}).notNull().unique(),
    passwordHash:varchar("password_hash",{length:255}).notNull(),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

    updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),
})

export const projectTable = pgTable("project", {
  id: uuid("id").defaultRandom().primaryKey(),

  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id, {
      onDelete: "cascade",
    }),

  name: varchar({ length: 50 }).notNull(),

  description: varchar({ length: 200 }),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),
});


export const ApiKeys=pgTable("api-keys",{
    id: uuid("id").defaultRandom().primaryKey(),
    projectId:uuid("project_id").notNull().references(()=>projectTable.id,{
        onDelete:"cascade"
    }),
    name:varchar({length:50}).notNull(),
    keyHash:varchar({length:64}).notNull().unique(),
    // Non-secret display hint, e.g. "ragx_••••abcd". Raw key is never stored.
    keyPreview:varchar("key_preview",{length:24}),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),

    revokedAt:timestamp("revoked_at"),



})

export const embeddingConfigTable = pgTable("embedding_config",{
    id: uuid("id").defaultRandom().primaryKey(),
    projectId:uuid("project_id").notNull().unique().references(()=>projectTable.id,{
        onDelete:"cascade"
    }),
    provider:varchar({length:20}).notNull(),
    model:varchar({length:100}).notNull(),
    // AES-256-GCM payload. Plaintext provider key is never stored.
    encryptedApiKey:text("encrypted_api_key").notNull(),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

    updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),
})

export const vectorStoreConfigTable = pgTable("vector_store_config",{
    id: uuid("id").defaultRandom().primaryKey(),
    projectId:uuid("project_id").notNull().unique().references(()=>projectTable.id,{
        onDelete:"cascade"
    }),
    provider:varchar({length:20}).notNull(),
    // AES-256-GCM payload wrapping provider-specific JSON credentials.
    // Shape depends on provider (pinecone: {apiKey,index}, qdrant:
    // {url,collection,apiKey?}, pgvector: {connectionString?}).
    encryptedCredentials:text("encrypted_credentials").notNull(),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

    updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),
})

export const documentTable = pgTable("document",{
    id: uuid("id").defaultRandom().primaryKey(),
    projectId:uuid("project_id").notNull().references(()=>projectTable.id,{
        onDelete:"cascade"
    }),
    filename:varchar({length:200}).notNull(),
    mimeType:varchar("mime_type",{length:100}).notNull(),
    size:integer().notNull(),
    // Reference to the original binary in object storage, e.g.
    // projects/{projectId}/documents/{documentId}/original.
    // Binaries are never stored in PostgreSQL.
    objectKey:text("object_key").notNull(),
    // Lifecycle: PENDING → PROCESSING → COMPLETED | FAILED.
    status:varchar({length:20}).notNull().default("PENDING"),
    chunkCount:integer("chunk_count").notNull().default(0),
    error:varchar({length:500}),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

    updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),
})

export const documentChunkTable = pgTable("document_chunk",{
    id: uuid("id").defaultRandom().primaryKey(),
    documentId:uuid("document_id").notNull().references(()=>documentTable.id,{
        onDelete:"cascade"
    }),
    projectId:uuid("project_id").notNull().references(()=>projectTable.id,{
        onDelete:"cascade"
    }),
    page:integer(),
    text:text().notNull(),
    // Stored embedding vector (pgvector-free JSON storage; cosine ranked in-JS).
    // Length matches the embedding model that produced it; never assumed global.
    embedding:jsonb().$type<number[]>().notNull(),
    // Per-chunk structural info, e.g. { page, chunkIndex }.
    metadata:jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
},(table)=>[
    index("document_chunk_project_idx").on(table.projectId),
    index("document_chunk_document_idx").on(table.documentId),
])

export const knowledgeBaseTable = pgTable("knowledge_base",{
    id: uuid("id").defaultRandom().primaryKey(),
    projectId:uuid("project_id").notNull().references(()=>projectTable.id,{
        onDelete:"cascade"
    }),
    name:varchar({length:100}).notNull(),
    description:varchar({length:500}),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

    updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull(),
},(table)=>[
    index("knowledge_base_project_idx").on(table.projectId),
])

export const knowledgeBaseDocumentTable = pgTable("knowledge_base_document",{
    id: uuid("id").defaultRandom().primaryKey(),
    knowledgeBaseId:uuid("knowledge_base_id").notNull().references(()=>knowledgeBaseTable.id,{
        onDelete:"cascade"
    }),
    documentId:uuid("document_id").notNull().references(()=>documentTable.id,{
        onDelete:"cascade"
    }),
    createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
},(table)=>[
    index("knowledge_base_document_kb_idx").on(table.knowledgeBaseId),
    index("knowledge_base_document_doc_idx").on(table.documentId),
    unique("knowledge_base_document_unique").on(table.knowledgeBaseId, table.documentId),
])
