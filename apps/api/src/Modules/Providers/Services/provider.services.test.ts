import { describe, expect, it } from "bun:test";

import { decryptSecret } from "@/Utils/encryption";

import { ProviderService } from "./provider.services";

process.env.RAGX_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const OWNER = "user-owner";
const INTRUDER = "user-intruder";
const PROJECT = "project-1";

function projectRepo(ownedBy: string | null) {
  return {
    findByIdAndUserId: async (projectId: string, userId: string) =>
      projectId === PROJECT && ownedBy && ownedBy === userId
        ? {
            id: PROJECT,
            userId: ownedBy,
            name: "Docs",
            description: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined,
  };
}

function providerRepo() {
  const store: {
    embedding?: {
      provider: string;
      model: string;
      encryptedApiKey: string;
      updatedAt: Date;
    };
    vectorStore?: {
      provider: string;
      encryptedCredentials: string;
      updatedAt: Date;
    };
  } = {};
  const seen: { encryptedApiKey?: string; encryptedCredentials?: string } = {};

  return {
    seen,
    upsertEmbedding: async (
      _projectId: string,
      data: { provider: string; model: string; encryptedApiKey: string },
    ) => {
      seen.encryptedApiKey = data.encryptedApiKey;
      store.embedding = { ...data, updatedAt: new Date() };
      return store.embedding;
    },
    findEmbedding: async (_projectId: string) => store.embedding,
    deleteEmbedding: async (_projectId: string) => {
      const existed = store.embedding ? { id: "emb-1" } : undefined;
      store.embedding = undefined;
      return existed;
    },
    upsertVectorStore: async (
      _projectId: string,
      data: { provider: string; encryptedCredentials: string },
    ) => {
      seen.encryptedCredentials = data.encryptedCredentials;
      store.vectorStore = { ...data, updatedAt: new Date() };
      return store.vectorStore;
    },
    findVectorStore: async (_projectId: string) => store.vectorStore,
    deleteVectorStore: async (_projectId: string) => {
      const existed = store.vectorStore ? { id: "vs-1" } : undefined;
      store.vectorStore = undefined;
      return existed;
    },
  };
}

function serviceWith(owner: string | null = OWNER) {
  const providers = providerRepo();
  const service = new ProviderService(
    providers as never,
    projectRepo(owner) as never,
  );
  return { service, providers };
}

const EMBEDDING_INPUT = {
  provider: "openai" as const,
  model: "text-embedding-3-small",
  apiKey: "sk-owner-secret-key-abcdef123456",
};

describe("ProviderService", () => {
  it("owner can save and read back embedding config without plaintext", async () => {
    const { service } = serviceWith();

    const saved = await service.saveEmbedding(PROJECT, OWNER, EMBEDDING_INPUT);
    expect(saved.provider).toBe("openai");
    expect(saved.model).toBe("text-embedding-3-small");
    expect(saved.configured).toBe(true);
    expect(saved.apiKeyPreview).toContain("3456");
    expect(saved.apiKeyPreview).not.toContain(EMBEDDING_INPUT.apiKey);

    const all = await service.getProviders(PROJECT, OWNER);
    expect(all.embedding?.apiKeyPreview).toBe(saved.apiKeyPreview);
    expect(JSON.stringify(all)).not.toContain(EMBEDDING_INPUT.apiKey);
  });

  it("encrypts secrets before they reach the repository", async () => {
    const { service, providers } = serviceWith();

    await service.saveEmbedding(PROJECT, OWNER, EMBEDDING_INPUT);

    expect(providers.seen.encryptedApiKey).toBeDefined();
    expect(providers.seen.encryptedApiKey).not.toContain(
      EMBEDDING_INPUT.apiKey,
    );
    expect(decryptSecret(providers.seen.encryptedApiKey!)).toBe(
      EMBEDDING_INPUT.apiKey,
    );
  });

  it("updating config replaces the stored secret", async () => {
    const { service, providers } = serviceWith();

    await service.saveEmbedding(PROJECT, OWNER, EMBEDDING_INPUT);
    const first = providers.seen.encryptedApiKey;

    await service.saveEmbedding(PROJECT, OWNER, {
      ...EMBEDDING_INPUT,
      model: "text-embedding-3-large",
      apiKey: "sk-rotated-secret-9999",
    });

    expect(providers.seen.encryptedApiKey).not.toBe(first);
    expect(decryptSecret(providers.seen.encryptedApiKey!)).toBe(
      "sk-rotated-secret-9999",
    );
    const all = await service.getProviders(PROJECT, OWNER);
    expect(all.embedding?.model).toBe("text-embedding-3-large");
  });

  it("deleting config works and second delete is a 404", async () => {
    const { service } = serviceWith();

    await service.saveEmbedding(PROJECT, OWNER, EMBEDDING_INPUT);
    await service.deleteEmbedding(PROJECT, OWNER);

    const all = await service.getProviders(PROJECT, OWNER);
    expect(all.embedding).toBeNull();
    await expect(service.deleteEmbedding(PROJECT, OWNER)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("hides another user's project (404, not 403 — no leaking)", async () => {
    const { service } = serviceWith(OWNER);

    await expect(
      service.saveEmbedding(PROJECT, INTRUDER, EMBEDDING_INPUT),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getProviders(PROJECT, INTRUDER)).rejects.toMatchObject(
      { statusCode: 404 },
    );
    await expect(
      service.deleteEmbedding(PROJECT, INTRUDER),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns 404 for unknown projects", async () => {
    const { service } = serviceWith(null);
    await expect(
      service.getProviders("missing", OWNER),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("stores vector credentials encrypted and summarizes without secrets", async () => {
    const { service, providers } = serviceWith();
    const credentials = {
      provider: "pinecone" as const,
      apiKey: "pc-secret-key-abcdef123456",
      index: "my-rag-index",
    };

    const saved = await service.saveVectorStore(PROJECT, OWNER, credentials);
    expect(saved.provider).toBe("pinecone");
    expect(saved.details).toEqual({ index: "my-rag-index" });
    expect(saved.apiKeyPreview).toContain("3456");
    expect(JSON.stringify(saved)).not.toContain(credentials.apiKey);

    expect(providers.seen.encryptedCredentials).not.toContain(
      credentials.apiKey,
    );
    const resolved = await service.resolveVectorStoreCredentials(PROJECT);
    expect(resolved).toEqual(credentials);
  });

  it("resolves decrypted embedding credentials for internal pipeline use", async () => {
    const { service } = serviceWith();
    await service.saveEmbedding(PROJECT, OWNER, EMBEDDING_INPUT);

    const resolved = await service.resolveEmbeddingCredentials(PROJECT);
    expect(resolved).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: EMBEDDING_INPUT.apiKey,
    });
  });

  it("resolution fails cleanly when nothing is configured", async () => {
    const { service } = serviceWith();
    await expect(service.resolveEmbeddingCredentials(PROJECT)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      service.resolveVectorStoreCredentials(PROJECT),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("never logs secrets during save and read", async () => {
    const { service } = serviceWith();
    const calls: unknown[][] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      await service.saveEmbedding(PROJECT, OWNER, EMBEDDING_INPUT);
      await service.getProviders(PROJECT, OWNER);
      await service.resolveEmbeddingCredentials(PROJECT);
    } finally {
      console.info = original;
    }

    expect(JSON.stringify(calls)).not.toContain(EMBEDDING_INPUT.apiKey);
  });
});
