import { describe, expect, it } from "bun:test";

import {
  embeddingConfigSchema,
  vectorStoreConfigSchema,
} from "./provider.validation";

describe("provider validation", () => {
  it("accepts a valid embedding configuration", () => {
    const parsed = embeddingConfigSchema.safeParse({
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "sk-test-key-12345678",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects embedding configs with missing provider, model, or key", () => {
    for (const body of [
      { model: "text-embedding-3-small", apiKey: "sk-test-key-12345678" },
      { provider: "openai", apiKey: "sk-test-key-12345678" },
      { provider: "openai", model: "text-embedding-3-small" },
      { provider: "cohere", model: "embed", apiKey: "sk-test-key-12345678" },
      { provider: "openai", model: "  ", apiKey: "sk-test-key-12345678" },
    ]) {
      expect(embeddingConfigSchema.safeParse(body).success).toBe(false);
    }
  });

  it("accepts per-provider vector store shapes", () => {
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pinecone",
        apiKey: "pc-test-key-12345678",
        index: "my-rag-index",
      }).success,
    ).toBe(true);

    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "qdrant",
        url: "https://xyz.cloud.qdrant.io",
        collection: "docs",
      }).success,
    ).toBe(true);

    expect(
      vectorStoreConfigSchema.safeParse({ provider: "pgvector" }).success,
    ).toBe(true);
  });

  it("rejects vector configs missing provider-specific fields", () => {
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pinecone",
        apiKey: "pc-test-key-12345678",
      }).success,
    ).toBe(false);

    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "qdrant",
        collection: "docs",
      }).success,
    ).toBe(false);

    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "qdrant",
        url: "not-a-url",
        collection: "docs",
      }).success,
    ).toBe(false);
  });

  it("never echoes secrets in validation errors", () => {    const secret = "sk-super-secret-should-never-appear-123";
    const parsed = vectorStoreConfigSchema.safeParse({
      provider: "qdrant",
      url: "not-a-url",
      collection: "docs",
      apiKey: secret,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.flatten())).not.toContain(secret);
    }

    const badEmbedding = embeddingConfigSchema.safeParse({
      provider: "openai",
      model: "",
      apiKey: secret,
    });
    expect(badEmbedding.success).toBe(false);
    if (!badEmbedding.success) {
      expect(JSON.stringify(badEmbedding.error.flatten())).not.toContain(
        secret,
      );
    }
  });

  it("rejects Qdrant URLs targeting internal networks (stored SSRF)", () => {
    const base = { provider: "qdrant", collection: "docs" } as const;
    for (const url of [
      "http://localhost:6333",
      "http://LOCALHOST:6333",
      "http://127.0.0.1:6333",
      "http://10.0.0.5:6333",
      "http://172.16.0.5:6333",
      "http://192.168.1.5:6333",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0:6333",
      "http://[::1]:6333",
      "http://[::ffff:127.0.0.1]:6333",
      "http://2130706433:6333",
      "http://0x7f000001:6333",
      "ftp://files.example.com/qdrant",
      "https://user:pass@xyz.cloud.qdrant.io",
    ]) {
      expect(
        vectorStoreConfigSchema.safeParse({ ...base, url }).success,
        url,
      ).toBe(false);
    }

    expect(
      vectorStoreConfigSchema.safeParse({
        ...base,
        url: "https://xyz.cloud.qdrant.io",
      }).success,
    ).toBe(true);
  });

  it("gates pgvector connection strings to public TCP hosts", () => {
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pgvector",
        connectionString: "postgresql://user:pass@localhost:5432/ragx",
      }).success,
    ).toBe(false);
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pgvector",
        connectionString: "postgresql://user:pass@10.0.0.5:5432/ragx",
      }).success,
    ).toBe(false);
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pgvector",
        connectionString: "mysql://db.example.com:3306/ragx",
      }).success,
    ).toBe(false);
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pgvector",
        connectionString: "postgresql://user:pass@db.example.com:5432/ragx",
      }).success,
    ).toBe(true);
    expect(
      vectorStoreConfigSchema.safeParse({ provider: "pgvector" }).success,
    ).toBe(true);
  });

  it("rejects model names and keys that could inject upstream", () => {
    const base = { provider: "openai", apiKey: "sk-test-key-12345678" } as const;
    for (const model of [
      "x?foo=bar",
      "../models",
      "model\ninjected",
      "a".repeat(101),
    ]) {
      expect(
        embeddingConfigSchema.safeParse({ ...base, model }).success,
        model,
      ).toBe(false);
    }
    expect(
      embeddingConfigSchema.safeParse({
        ...base,
        apiKey: "short",
      }).success,
    ).toBe(false);
    expect(
      embeddingConfigSchema.safeParse({
        ...base,
        apiKey: "sk-test\r\ninjected: x",
      }).success,
    ).toBe(false);
    expect(
      vectorStoreConfigSchema.safeParse({
        provider: "pinecone",
        apiKey: "pc-test-key-12345678",
        index: "My_Index!",
      }).success,
    ).toBe(false);
  });
});
