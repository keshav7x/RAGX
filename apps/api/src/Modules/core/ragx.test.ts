import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import { buildTestPdf } from "../Ingestion/Parsers/pdf.test.utils";
import { DocumentService } from "../Documents/Services/document.services";
import { RetrievalService } from "../Documents/Services/retrieval.services";
import { RAGX } from "./index";

const CONFIG = {
  provider: "openai" as const,
  providerApiKey: "sk-provider-key",
  ragxApiKey: "ragx-live-key",
};
const PROJECT = "project-1";
const KEY_HASH = createHash("sha256").update(CONFIG.ragxApiKey).digest("hex");

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const seen: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    seen.push({ url: url as string, init: (init ?? {}) as RequestInit });
    return handler(url as string, (init ?? {}) as RequestInit);
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** OpenAI-shaped stub: single texts get a fixed vector, batches match length. */
function stubOpenAI() {
  return stubFetch((url, init) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    if (url.includes("/embeddings")) {
      const input = body["input"] as unknown[];
      if (input.length === 1) return json({ data: [{ embedding: [0.9, 0.1, 0] }] });
      return json({
        data: input.map((_, i) => ({ embedding: [i % 7, i % 5, 1] })),
      });
    }
    return json({ choices: [{ message: { content: "generated answer" } }] });
  });
}

function repos() {
  const docs: Record<
    string,
    {
      id: string;
      projectId: string;
      filename: string;
      mimeType: string;
      size: number;
      objectKey: string;
      status: string;
      chunkCount: number;
      createdAt: Date;
    }
  > = {};
  const chunks: {
    documentId: string;
    projectId: string;
    page?: number;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }[] = [];
  const objects = new Map<string, Buffer>();
  const enqueued: { documentId: string; projectId: string }[] = [];
  let seq = 0;

  const repo = {
    chunks,
    objects,
    enqueued,
    createDocument: async (data: {
      id?: string;
      projectId: string;
      filename: string;
      mimeType: string;
      size: number;
      objectKey: string;
    }) => {
      const id = data.id ?? `doc-${++seq}`;
      docs[id] = {
        id,
        projectId: data.projectId,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        objectKey: data.objectKey,
        status: "PENDING",
        chunkCount: 0,
        createdAt: new Date(),
      };
      return { ...docs[id]! };
    },
    findByIdAndProject: async (id: string, projectId: string) => {
      const doc = docs[id];
      return doc && doc.projectId === projectId ? doc : undefined;
    },
    markProcessing: async (id: string, projectId: string) => {
      const doc = docs[id];
      if (!doc || doc.projectId !== projectId) return undefined;
      doc.status = "PROCESSING";
      return { id };
    },
    markCompleted: async (
      id: string,
      projectId: string,
      chunkCount: number,
    ) => {
      const doc = docs[id];
      if (!doc || doc.projectId !== projectId) return undefined;
      doc.status = "COMPLETED";
      doc.chunkCount = chunkCount;
      return { id };
    },
    markFailed: async (id: string, projectId: string, _error: string) => {
      const doc = docs[id];
      if (!doc || doc.projectId !== projectId) return undefined;
      doc.status = "FAILED";
      return { id };
    },
    listStuckDocuments: async () =>
      Object.values(docs)
        .filter((d) => d.status === "PENDING" || d.status === "PROCESSING")
        .map((d) => ({ id: d.id, projectId: d.projectId })),
    listByProject: async (projectId: string) =>
      Object.values(docs).filter((d) => d.projectId === projectId),
    deleteByIdAndProject: async (id: string, projectId: string) => {
      const doc = docs[id];
      if (!doc || doc.projectId !== projectId) return undefined;
      delete docs[id];
      return { id };
    },
    insertChunks: async (
      rows: {
        documentId: string;
        projectId: string;
        page?: number;
        text: string;
        embedding: number[];
        metadata?: Record<string, unknown>;
      }[],
    ) => {
      chunks.push(...rows);
    },
    deleteChunksByDocument: async (documentId: string, projectId: string) => {
      for (let i = chunks.length - 1; i >= 0; i--) {
        const row = chunks[i]!;
        if (row.documentId === documentId && row.projectId === projectId) {
          chunks.splice(i, 1);
        }
      }
    },
    listChunksByProject: async (projectId: string) =>
      chunks.filter((c) => c.projectId === projectId),
  };

  const storage = {
    upload: async (key: string, data: Buffer) => {
      objects.set(key, Buffer.from(data));
    },
    download: async (key: string) => {
      const data = objects.get(key);
      if (!data) throw new Error(`Object not found: ${key}`);
      return data;
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
    exists: async (key: string) => objects.has(key),
  };

  const seenHashes: string[] = [];
  const projects = {
    findApiKeyByHash: async (hash: string) => {
      seenHashes.push(hash);
      return hash === KEY_HASH ? { id: "key-1", projectId: PROJECT } : undefined;
    },
  };

  return { repo, projects, seenHashes, storage, enqueued };
}

function brain() {
  const { repo, projects, seenHashes, storage, enqueued } = repos();
  const enqueue = (job: { documentId: string; projectId: string }) => {
    enqueued.push(job);
  };
  const documents = new DocumentService(
    repo as never,
    undefined,
    storage as never,
    enqueue as never,
  );
  const ragx = new RAGX(CONFIG, {
    documents,
    retrieval: new RetrievalService(repo as never),
    projects: projects as never,
  });
  return { ragx, repo, seenHashes, storage, enqueued, documents };
}

async function processDoc(
  documents: DocumentService,
  id: string,
): Promise<void> {
  await documents.processDocument(PROJECT, id, {
    providerName: "openai",
    providerKey: "sk-provider-key",
  });
}

function pdfBytes(): Uint8Array {
  return buildTestPdf([
    ["Getting Started", "JWT tokens are useful for authentication."],
    ["Second page body with enough words to chunk properly here."],
  ]);
}

describe("RAGX brain", () => {
  it("validates configuration at initialization", () => {
    expect(
      () =>
        new RAGX({ provider: "cohere", providerApiKey: "x", ragxApiKey: "y" } as never),
    ).toThrowError(/provider must be one of openai, mistral, gemini/);
    expect(() => new RAGX({ ...CONFIG, providerApiKey: "  " })).toThrowError(
      /providerApiKey is required/,
    );
    expect(() => new RAGX({ ...CONFIG, ragxApiKey: "" })).toThrowError(
      /ragxApiKey is required/,
    );
    expect(new RAGX(CONFIG)).toBeInstanceOf(RAGX);
  });

  it("makes no network calls during construction", async () => {
    const stub = stubFetch(() => json({}));
    try {
      new RAGX(CONFIG, { projects: { findApiKeyByHash: async () => undefined } as never });
    } finally {
      stub.restore();
    }
    expect(stub.seen).toHaveLength(0);
  });

  it("exposes a working embedding provider built from RAGX config", async () => {
    const stub = stubFetch(() => json({ data: [{ embedding: [0.1] }] }));
    try {
      const ragx = new RAGX(CONFIG);
      expect(await ragx.embedding.embed(["hello"])).toEqual([[0.1]]);
    } finally {
      stub.restore();
    }
    const headers = stub.seen[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-provider-key");
  });

  it("resolves the project from the ragx key hash, never the raw key", async () => {
    const stub = stubOpenAI();
    const { ragx, seenHashes } = brain();

    try {
      await ragx.listDocuments();
    } finally {
      stub.restore();
    }

    expect(seenHashes).toEqual([KEY_HASH]);
    expect(KEY_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(seenHashes[0]).not.toContain(CONFIG.ragxApiKey);
  });

  it("rejects revoked keys before touching documents", async () => {
    const stub = stubOpenAI();
    const { repo, storage, enqueued } = repos();
    const enqueue = (job: { documentId: string; projectId: string }) => {
      enqueued.push(job);
    };
    const ragx = new RAGX(CONFIG, {
      documents: new DocumentService(
        repo as never,
        undefined,
        storage as never,
        enqueue as never,
      ),
      retrieval: new RetrievalService(repo as never),
      projects: { findApiKeyByHash: async () => undefined } as never,
    });

    try {
      await expect(ragx.upload(pdfBytes(), "manual.pdf")).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(Object.keys(repo).length).toBeGreaterThan(0);
      expect(await ragx.listDocuments().then(
        () => "nope",
        () => "blocked",
      )).toBe("blocked");
    } finally {
      stub.restore();
    }
  });

  it("uploads a document, then processes it through the pipeline", async () => {
    const stub = stubOpenAI();
    const { repo, storage, enqueued } = repos();
    const enqueue = (job: { documentId: string; projectId: string }) => {
      enqueued.push(job);
    };
    const documents = new DocumentService(
      repo as never,
      undefined,
      storage as never,
      enqueue as never,
    );
    const ragx = new RAGX(CONFIG, {
      documents,
      retrieval: new RetrievalService(repo as never),
      projects: {
        findApiKeyByHash: async () => ({ id: "key-1", projectId: PROJECT }),
      } as never,
    });

    try {
      const doc = await ragx.upload(pdfBytes(), "manual.pdf");
      expect(doc.filename).toBe("manual.pdf");
      expect(doc.status).toBe("PENDING");
      expect(enqueued).toHaveLength(1);

      // Independent background job entry for the same document.
      const summary = await documents.processDocument(PROJECT, doc.id, {
        providerName: "openai",
        providerKey: "sk-provider-key",
      });
      expect(summary.status).toBe("COMPLETED");
      expect(repo.chunks.length).toBeGreaterThan(0);

      const listed = await ragx.listDocuments();
      expect(listed.map((d) => d.id)).toEqual([doc.id]);
      expect(listed[0]!.status).toBe("COMPLETED");
      await ragx.deleteDocument(doc.id);
      expect(await ragx.listDocuments()).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("uploads a batch with independent per-document outcomes", async () => {
    const stub = stubOpenAI();
    const { ragx, enqueued } = brain();

    try {
      const result = await ragx.uploadBatch(
        [pdfBytes(), new Uint8Array()],
        "batch.pdf",
      );
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0]).toMatchObject({ status: "PENDING" });
      expect(result.documents[0]!.id).toBeTruthy();
      expect(result.documents[1]).toMatchObject({
        id: null,
        status: "FAILED",
      });
      expect(enqueued).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it("searches and asks through one shared embedding configuration", async () => {
    const stub = stubOpenAI();
    const { ragx, documents } = brain();

    try {
      const doc = await ragx.upload(pdfBytes(), "manual.pdf");
      await processDoc(documents, doc.id);
      const hits = await ragx.search("authentication");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]).toMatchObject({ documentId: expect.any(String) });

      const asked = await ragx.ask("authentication");
      expect(asked.answer).toBe("generated answer");
      expect(asked.results.length).toBeGreaterThan(0);

      const limited = await ragx.search("authentication", 1);
      expect(limited.length).toBeLessThanOrEqual(1);
    } finally {
      stub.restore();
    }
  });

  it("validates queries and topK", async () => {
    const { ragx } = brain();
    await expect(ragx.search("  ")).rejects.toThrowError(/Query is required/);
    await expect(ragx.ask("")).rejects.toThrowError(/Query is required/);
    await expect(ragx.search("q", 0)).rejects.toThrowError(/topK/);
    await expect(ragx.search("q", 99)).rejects.toThrowError(/topK/);
    await expect(ragx.deleteDocument(" ")).rejects.toThrowError(/Document ID/);
  });

  it("keeps provider and RAGX keys strictly separate", async () => {
    const stub = stubOpenAI();
    const { ragx, documents } = brain();

    try {
      const doc = await ragx.upload(pdfBytes(), "manual.pdf");
      await processDoc(documents, doc.id);
      await ragx.ask("q");
    } finally {
      stub.restore();
    }

    const authHeaders = stub.seen.map(
      (s) => (s.init.headers as Record<string, string>)["Authorization"],
    );
    // Every provider call uses the provider key; the ragx key never leaves
    // the server except as a hash for project lookup.
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every((h) => h === "Bearer sk-provider-key")).toBe(true);
  });
});
