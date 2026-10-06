import { describe, expect, it } from "bun:test";

import { buildTestPdf } from "../../Ingestion/Parsers/pdf.test.utils";
import { ingestDocument } from "../../Ingestion/Pipeline/ingestion";
import { resolveRequestProvider } from "../../Providers/Runtime/resolution";
import type { ObjectStorage } from "../../Storage/objectStorage";
import { DocumentService } from "./document.services";
import { RetrievalService } from "./retrieval.services";
import type { DocumentJob } from "../Jobs/document.jobs";

const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";
const HEADERS = { providerName: "openai", providerKey: "sk-header-key" };

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    return handler(url as string, (init ?? {}) as RequestInit);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Emulates the OpenAI HTTP API. Single-text queries get a fixed vector
 * so ranking is deterministic; batches get length-matched vectors.
 */
function stubOpenAI() {
  const seen: { url: string; init: RequestInit }[] = [];
  return {
    seen,
    restore: stubFetch((url, init) => {
      seen.push({ url, init });
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (url.includes("/embeddings")) {
        const input = body["input"] as unknown[];
        if (input.length === 1) {
          return json({ data: [{ embedding: [0.9, 0.1, 0] }] });
        }
        return json({
          data: input.map((_, i) => ({ embedding: [i % 7, i % 5, 1] })),
        });
      }
      return json({ choices: [{ message: { content: "generated answer" } }] });
    }),
  };
}

interface FakeDoc {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  size: number;
  objectKey: string;
  status: string;
  chunkCount: number;
  error?: string;
  createdAt: Date;
}

function documentRepo() {
  const docs: Record<string, FakeDoc> = {};
  const chunks: {
    documentId: string;
    projectId: string;
    page?: number;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }[] = [];
  let seq = 0;

  return {
    chunks,
    docs,
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
    markFailed: async (id: string, projectId: string, error: string) => {
      const doc = docs[id];
      if (!doc || doc.projectId !== projectId) return undefined;
      doc.status = "FAILED";
      (doc as FakeDoc).error = error;
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
      // Mirrors the real onDelete cascade: document rows take their
      // chunks with them.
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i]!.documentId === id) chunks.splice(i, 1);
      }
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
        if (row.documentId === documentId && row.projectId === projectId)
          chunks.splice(i, 1);
      }
    },
    listChunksByProject: async (projectId: string) =>
      chunks.filter((c) => c.projectId === projectId),
    listChunksByDocuments: async (projectId: string, documentIds: string[]) =>
      chunks.filter(
        (c) => c.projectId === projectId && documentIds.includes(c.documentId),
      ),
  };
}

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const storage: ObjectStorage = {
    upload: async (key, data) => {
      objects.set(key, Buffer.from(data));
    },
    download: async (key) => {
      const data = objects.get(key);
      if (!data) throw new Error(`Object not found: ${key}`);
      return data;
    },
    delete: async (key) => {
      objects.delete(key);
    },
    exists: async (key) => objects.has(key),
  };
  return { storage, objects };
}

function jobSpy() {
  const jobs: DocumentJob[] = [];
  return {
    jobs,
    enqueue: (job: DocumentJob) => {
      jobs.push(job);
    },
  };
}

function testService() {
  const repo = documentRepo();
  const { storage, objects } = memoryStorage();
  const { jobs, enqueue } = jobSpy();
  const service = new DocumentService(
    repo as never,
    undefined,
    storage,
    enqueue,
  );
  return { service, repo, storage, objects, jobs };
}

function pdfBase64(): string {
  return buildTestPdf([
    ["Getting Started", "JWT tokens are useful for authentication."],
    ["Second page body with enough words to chunk properly here."],
  ]).toString("base64");
}

describe("provider resolution", () => {
  it("resolves from SDK headers without touching stored config", async () => {
    const stub = stubOpenAI();
    let storedCalled = false;
    const fakeService = {
      resolveEmbeddingCredentials: async () => {
        storedCalled = true;
        throw new Error("must not be called");
      },
    };

    try {
      const resolved = await resolveRequestProvider(
        PROJECT,
        HEADERS,
        fakeService as never,
      );

      expect(resolved.provider).toBe("openai");
      expect(resolved.apiKey).toBe("sk-header-key");
      expect(resolved.embeddingModel).toBe("text-embedding-3-small");
      expect(resolved.runtime.name).toBe("openai");
      expect(storedCalled).toBe(false);

      // The resolved runtime performs real HTTP with the transient key.
      const vectors = await resolved.runtime.embed(["hello"], resolved.apiKey);
      expect(vectors).toEqual([[0.9, 0.1, 0]]);
      const auth = (stub.seen[0]!.init.headers ?? {}) as Record<string, string>;
      expect(auth["Authorization"]).toBe("Bearer sk-header-key");
    } finally {
      stub.restore();
    }
  });

  it("falls back to the stored project configuration", async () => {
    const stub = stubOpenAI();
    const fakeService = {
      resolveEmbeddingCredentials: async () => ({
        provider: "openai",
        model: "text-embedding-3-small",
        apiKey: "sk-stored-key",
      }),
    };

    try {
      const resolved = await resolveRequestProvider(
        PROJECT,
        {},
        fakeService as never,
      );
      expect(resolved.apiKey).toBe("sk-stored-key");
      expect(resolved.embeddingModel).toBe("text-embedding-3-small");
    } finally {
      stub.restore();
    }
  });

  it("honors an explicit model override from headers", async () => {
    const fakeService = {
      resolveEmbeddingCredentials: async () => {
        throw new Error("must not be called");
      },
    };

    const resolved = await resolveRequestProvider(
      PROJECT,
      {
        providerName: "mistral",
        providerKey: "sk-header-key",
        providerModel: "mistral-embed",
      },
      fakeService as never,
    );
    expect(resolved.provider).toBe("mistral");
    expect(resolved.embeddingModel).toBe("mistral-embed");
  });

  it("rejects model-only headers and overlong model names", async () => {
    await expect(
      resolveRequestProvider(PROJECT, { providerModel: "mistral-embed" }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      resolveRequestProvider(PROJECT, {
        providerName: "openai",
        providerKey: "x",
        providerModel: `m${"o".repeat(100)}`,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects incomplete or missing provider configuration clearly", async () => {
    const stub = stubOpenAI();
    try {
      await expect(
        resolveRequestProvider(PROJECT, { providerName: "openai" }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        resolveRequestProvider(PROJECT, {
          providerName: "cohere",
          providerKey: "x",
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      const missing = {
        resolveEmbeddingCredentials: async () => {
          const { NotFoundError } = await import("@/Utils/httpError");
          throw new NotFoundError("Embedding provider is not configured");
        },
      };
      await expect(
        resolveRequestProvider(PROJECT, {}, missing as never),
      ).rejects.toThrowError(/No provider configured/);
    } finally {
      stub.restore();
    }
  });
});

describe("upload intake", () => {
  it("stores the original and enqueues a job, returning PENDING", async () => {
    const { service, repo, objects, jobs } = testService();
    const content = pdfBase64();

    const doc = await service.upload(
      PROJECT,
      { name: "manual.pdf", contentBase64: content },
      HEADERS,
    );

    expect(doc.filename).toBe("manual.pdf");
    expect(doc.status).toBe("PENDING");
    expect(doc.chunks).toBe(0);
    expect(doc.size).toBe(Buffer.from(content, "base64").length);

    const expectedKey = `projects/${PROJECT}/documents/${doc.id}/original`;
    expect(objects.get(expectedKey)?.toString("base64")).toBe(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      documentId: doc.id,
      projectId: PROJECT,
      providerName: "openai",
      providerKey: "sk-header-key",
    });
    expect(repo.docs[doc.id]!.status).toBe("PENDING");
  });

  it("marks storage failures FAILED without enqueueing", async () => {
    const { service, repo, jobs } = testService();
    const failing = {
      upload: async () => {
        throw new Error("disk full");
      },
      download: async () => {
        throw new Error("unreachable");
      },
      delete: async () => undefined,
      exists: async () => false,
    };
    const failingService = new DocumentService(
      repo as never,
      undefined,
      failing,
      jobs.push.bind(jobs),
    );

    await expect(
      failingService.upload(
        PROJECT,
        { name: "manual.pdf", contentBase64: pdfBase64() },
        HEADERS,
      ),
    ).rejects.toThrowError(/disk full/);
    expect(jobs).toHaveLength(0);
    const listed = await failingService.list(PROJECT);
    expect(listed[0]!.status).toBe("FAILED");
  });

  it("rejects empty and oversized uploads", async () => {
    const { service } = testService();

    await expect(
      service.upload(PROJECT, { name: "e.pdf", contentBase64: "" }),
    ).rejects.toThrow();

    const big = Buffer.alloc(16 * 1024 * 1024, "a").toString("base64");
    await expect(
      service.upload(PROJECT, { name: "big.pdf", contentBase64: big }),
    ).rejects.toThrow(/15MB/);
  });

  it("processes a batch independently: one bad file cannot fail the rest", async () => {
    const { service, jobs } = testService();

    const result = await service.uploadBatch(
      PROJECT,
      [
        { filename: "manual.pdf", contentBase64: pdfBase64() },
        { filename: "empty.pdf", contentBase64: "" },
        { filename: "faq.pdf", contentBase64: pdfBase64() },
      ],
      HEADERS,
    );

    expect(result.documents).toHaveLength(3);
    expect(result.documents[0]).toMatchObject({
      filename: "manual.pdf",
      status: "PENDING",
    });
    expect(result.documents[0]!.id).toBeTruthy();
    expect(result.documents[1]).toMatchObject({
      id: null,
      filename: "empty.pdf",
      status: "FAILED",
    });
    expect(result.documents[1]!.error).toBeTruthy();
    expect(result.documents[2]).toMatchObject({
      filename: "faq.pdf",
      status: "PENDING",
    });
    expect(jobs).toHaveLength(2);
    const firstId = result.documents[0]!.id;
    const thirdId = result.documents[2]!.id;
    expect(firstId).toBeTruthy();
    expect(thirdId).toBeTruthy();
    expect(jobs[0]!.documentId).toBe(firstId!);
    expect(jobs[1]!.documentId).toBe(thirdId!);
  });

  it("rejects unsupported types before creating any record", async () => {
    const { service, repo, objects, jobs } = testService();
    const content = Buffer.from("hello").toString("base64");

    await expect(
      service.upload(
        PROJECT,
        { name: "clip.bin", mimeType: "video/mp4", contentBase64: content },
        HEADERS,
      ),
    ).rejects.toMatchObject({ statusCode: 415 });

    // Fail-fast: no DB row, no stored bytes, no background job.
    expect(await service.list(PROJECT)).toHaveLength(0);
    expect(Object.keys(repo.docs)).toHaveLength(0);
    expect(objects.size).toBe(0);
    expect(jobs).toHaveLength(0);
  });

  it("persists PENDING metadata with a project-scoped object key", async () => {
    const { service, repo, objects } = testService();
    const content = pdfBase64();
    const size = Buffer.from(content, "base64").length;

    const doc = await service.upload(
      PROJECT,
      { name: "manual.pdf", contentBase64: content },
      HEADERS,
    );

    expect(doc).toMatchObject({
      filename: "manual.pdf",
      mimeType: "application/pdf",
      size,
      status: "PENDING",
      chunks: 0,
    });
    expect(typeof doc.createdAt).toBe("string");

    const row = repo.docs[doc.id]!;
    expect(row.objectKey).toBe(
      `projects/${PROJECT}/documents/${doc.id}/original`,
    );
    expect(objects.get(row.objectKey)?.toString("base64")).toBe(content);

    const fetched = await service.get(doc.id, PROJECT);
    expect(fetched).toMatchObject({
      id: doc.id,
      filename: "manual.pdf",
      status: "PENDING",
      chunks: 0,
    });
  });

  it("strips control characters from filenames", async () => {
    const { service, repo } = testService();
    const content = pdfBase64();

    const doc = await service.upload(
      PROJECT,
      { name: "invo\tice\nreport.pdf", contentBase64: content },
      HEADERS,
    );

    expect(doc.filename).toBe("invoice report.pdf");
    expect(repo.docs[doc.id]!.filename).toBe("invoice report.pdf");
    expect(JSON.stringify(doc)).not.toMatch(/[\x00-\x1F\x7F]/);
  });

  it("rejects overlong filenames without touching storage", async () => {
    const { service, repo, objects, jobs } = testService();

    await expect(
      service.upload(
        PROJECT,
        { name: `${"a".repeat(201)}.pdf`, contentBase64: pdfBase64() },
        HEADERS,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(Object.keys(repo.docs)).toHaveLength(0);
    expect(objects.size).toBe(0);
    expect(jobs).toHaveLength(0);
  });

  it("sanitizes batch summary filenames on failure", async () => {
    const { service } = testService();

    const result = await service.uploadBatch(
      PROJECT,
      [
        {
          filename: "bad\nname.pdf",
          mimeType: "video/mp4",
          contentBase64: Buffer.from("hello").toString("base64"),
        },
      ],
      HEADERS,
    );

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      id: null,
      filename: "badname.pdf",
      status: "FAILED",
    });
    expect(JSON.stringify(result)).not.toMatch(/[\x00-\x1F\x7F]/);
  });
});

describe("background processing", () => {
  it("runs the full pipeline to COMPLETED with project-scoped chunks", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();

    try {
      const doc = await service.upload(
        PROJECT,
        { name: "manual.pdf", contentBase64: pdfBase64() },
        HEADERS,
      );
      const summary = await service.processDocument(
        PROJECT,
        doc.id,
        HEADERS,
      );

      expect(summary).toMatchObject({
        id: doc.id,
        filename: "manual.pdf",
        status: "COMPLETED",
      });
      expect(repo.docs[doc.id]!.status).toBe("COMPLETED");
      expect(repo.chunks.length).toBeGreaterThan(0);
      expect(
        repo.chunks.every(
          (c) => c.projectId === PROJECT && c.documentId === doc.id,
        ),
      ).toBe(true);
      expect(repo.chunks.every((c) => c.embedding.length === 3)).toBe(true);
      expect(repo.chunks[0]).toMatchObject({
        page: 1,
        metadata: { page: 1, chunkIndex: 0 },
      });
    } finally {
      stub.restore();
    }
  });

  it("marks corrupt documents FAILED with a safe error", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();

    try {
      const doc = await service.upload(
        PROJECT,
        {
          name: "broken.pdf",
          contentBase64: Buffer.from("not a pdf").toString("base64"),
        },
        HEADERS,
      );

      const seen = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(seen).toBeTruthy();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
      const listed = await service.list(PROJECT);
      expect(listed[0]!.status).toBe("FAILED");
      expect(JSON.stringify(listed)).not.toContain("sk-header-key");
    } finally {
      stub.restore();
    }
  });

  it("rejects cross-project processing and missing objects", async () => {
    const stub = stubOpenAI();
    const { service, repo, objects } = testService();

    try {
      const doc = await service.upload(
        PROJECT,
        { name: "manual.pdf", contentBase64: pdfBase64() },
        HEADERS,
      );

      await expect(
        service.processDocument(OTHER_PROJECT, doc.id, HEADERS),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(repo.docs[doc.id]!.status).toBe("PENDING");

      objects.clear();
      await expect(
        service.processDocument(PROJECT, doc.id, HEADERS),
      ).rejects.toThrow();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
    } finally {
      stub.restore();
    }
  });

  it("skips already-COMPLETED documents without re-embedding", async () => {
    const stub = stubOpenAI();
    const { service } = testService();

    try {
      const doc = await service.upload(
        PROJECT,
        { name: "manual.pdf", contentBase64: pdfBase64() },
        HEADERS,
      );
      await service.processDocument(PROJECT, doc.id, HEADERS);
      const callsBefore = stub.seen.length;
      const summary = await service.processDocument(PROJECT, doc.id, HEADERS);
      expect(summary.status).toBe("COMPLETED");
      expect(stub.seen.length).toBe(callsBefore);
    } finally {
      stub.restore();
    }
  });
});

describe("documents access control", () => {
  it("lists, gets, and deletes within project scope only", async () => {
    const { service, objects } = testService();

    const doc = await service.upload(
      PROJECT,
      { name: "manual.pdf", contentBase64: pdfBase64() },
      HEADERS,
    );
    const key = `projects/${PROJECT}/documents/${doc.id}/original`;

    expect((await service.list(PROJECT)).length).toBe(1);
    expect((await service.list(OTHER_PROJECT)).length).toBe(0);
    expect((await service.get(doc.id, PROJECT)).filename).toBe("manual.pdf");
    await expect(service.get(doc.id, OTHER_PROJECT)).rejects.toMatchObject({
      statusCode: 404,
    });

    await expect(service.remove(doc.id, OTHER_PROJECT)).rejects.toMatchObject({
      statusCode: 404,
    });
    await service.remove(doc.id, PROJECT);
    expect((await service.list(PROJECT)).length).toBe(0);
    expect(objects.has(key)).toBe(false);
    await expect(service.remove(doc.id, PROJECT)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("tolerates a missing object on delete", async () => {
    const { service, objects } = testService();

    const doc = await service.upload(
      PROJECT,
      { name: "manual.pdf", contentBase64: pdfBase64() },
      HEADERS,
    );
    objects.clear();
    await service.remove(doc.id, PROJECT);
    expect((await service.list(PROJECT)).length).toBe(0);
  });
});

describe("retrieval engine", () => {
  // Allow-fake for the output guardrail: keeps retrieval/ask tests
  // deterministic without touching the Gemini-backed guard model.
  // Guardrail behavior itself is covered in "ask output guardrail" below.
  const allowGuardrail = async () => ({ decision: "allow" as const });

  function seeded() {
    const { repo } = testService();
    repo.chunks.push(
      { documentId: "d1", projectId: PROJECT, page: 1, text: "aaa", embedding: [1, 0, 0] },
      { documentId: "d1", projectId: PROJECT, page: 2, text: "bbb", embedding: [0, 1, 0] },
      { documentId: "d2", projectId: PROJECT, page: 1, text: "ccc", embedding: [0, 0, 1] },
    );
    return new RetrievalService(repo as never, undefined, allowGuardrail);
  }

  it("ranks chunks by cosine similarity and honors topK", async () => {
    const stub = stubOpenAI();
    try {
      const hits = await seeded().search(PROJECT, "query", 2, HEADERS);

      expect(hits.length).toBe(2);
      expect(hits[0]!.text).toBe("aaa");
      expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
      expect(hits[0]).toMatchObject({ documentId: "d1", page: 1 });
    } finally {
      stub.restore();
    }
  });

  it("ask builds context and generates through the provider", async () => {
    const stub = stubOpenAI();
    try {
      const result = await seeded().ask(PROJECT, "What is this?", 5, HEADERS);

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.answer).toBe("generated answer");
      const generateCall = stub.seen.find((c) =>
        c.url.includes("/chat/completions"),
      );
      expect(generateCall).toBeDefined();
      const body = JSON.parse(generateCall!.init.body as string) as {
        messages: { content: string }[];
      };
      expect(
        body.messages.some((m) => m.content.includes("What is this?")),
      ).toBe(true);
      expect(body.messages.some((m) => m.content.includes("aaa"))).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it("ask answers deterministically when nothing matches", async () => {
    const stub = stubOpenAI();
    try {
      const { repo } = testService();
      const retrieval = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
      );
      const result = await retrieval.ask(PROJECT, "anything", 5, HEADERS);

      expect(result.results).toEqual([]);
      expect(result.answer).toContain("couldn't find");
      expect(
        stub.seen.some((c) => c.url.includes("/chat/completions")),
      ).toBe(false);
    } finally {
      stub.restore();
    }
  });

  it("never exposes provider keys in results", async () => {
    const stub = stubOpenAI();
    const secret = { providerName: "openai", providerKey: "sk-ultra-secret" };
    try {
      const service = seeded();
      const hits = await service.search(PROJECT, "q", 5, secret);
      const asked = await service.ask(PROJECT, "q", 5, secret);

      expect(JSON.stringify({ hits, asked })).not.toContain("sk-ultra-secret");
    } finally {
      stub.restore();
    }
  });

  it("scopes vector search to the authenticated project", async () => {
    const stub = stubOpenAI();
    try {
      const { repo } = testService();
      repo.chunks.push(
        { documentId: "mine", projectId: PROJECT, text: "aaa", embedding: [1, 0, 0] },
        { documentId: "theirs", projectId: OTHER_PROJECT, text: "aaa", embedding: [1, 0, 0] },
      );
      const service = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
      );

      const hits = await service.search(PROJECT, "query", 10, HEADERS);
      expect(hits.length).toBe(1);
      expect(hits[0]!.documentId).toBe("mine");

      const otherHits = await service.search(OTHER_PROJECT, "query", 10, HEADERS);
      expect(otherHits.length).toBe(1);
      expect(otherHits[0]!.documentId).toBe("theirs");
    } finally {
      stub.restore();
    }
  });

  it("filters search to knowledge base documents with chunk metadata", async () => {
    const stub = stubOpenAI();
    try {
      const { repo } = testService();
      repo.chunks.push(
        { documentId: "d1", projectId: PROJECT, page: 1, text: "aaa", embedding: [1, 0, 0], metadata: { chunkIndex: 0 } },
        { documentId: "d2", projectId: PROJECT, page: 1, text: "aab", embedding: [1, 0, 0] },
      );
      const kbRepo = {
        findByIdAndProject: async (id: string, projectId: string) =>
          id === "kb-1" && projectId === PROJECT ? { id } : undefined,
        listDocumentIds: async () => ["d1"],
      };
      const service = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
        kbRepo as never,
      );

      const hits = await service.search(PROJECT, "query", 10, HEADERS, {
        knowledgeBaseId: "kb-1",
      });
      expect(hits.length).toBe(1);
      expect(hits[0]).toMatchObject({ documentId: "d1", page: 1 });
      expect(typeof hits[0]!.chunkId).toBe("string");
      expect(hits[0]!.metadata).toMatchObject({ chunkIndex: 0 });

      const unfiltered = await service.search(PROJECT, "query", 10, HEADERS);
      expect(unfiltered.length).toBe(2);
    } finally {
      stub.restore();
    }
  });

  it("rejects unknown or foreign knowledge bases without leaking", async () => {
    const stub = stubOpenAI();
    try {
      const { repo } = testService();
      repo.chunks.push(
        { documentId: "d1", projectId: PROJECT, page: 1, text: "aaa", embedding: [1, 0, 0] },
      );
      const kbRepo = {
        findByIdAndProject: async () => undefined,
        listDocumentIds: async (): Promise<string[]> => {
          throw new Error("must not list documents of an unknown KB");
        },
      };
      const service = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
        kbRepo as never,
      );

      await expect(
        service.search(PROJECT, "query", 5, HEADERS, {
          knowledgeBaseId: "kb-nope",
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        service.search(PROJECT, "query", 5, HEADERS, {
          knowledgeBaseId: "kb-foreign",
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      stub.restore();
    }
  });

  it("returns no results for an empty knowledge base", async () => {
    const stub = stubOpenAI();
    try {
      const { repo } = testService();
      repo.chunks.push(
        { documentId: "d1", projectId: PROJECT, page: 1, text: "aaa", embedding: [1, 0, 0] },
      );
      const kbRepo = {
        findByIdAndProject: async (id: string, projectId: string) =>
          id === "kb-empty" && projectId === PROJECT ? { id } : undefined,
        listDocumentIds: async () => [],
      };
      const service = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
        kbRepo as never,
      );

      const hits = await service.search(PROJECT, "query", 5, HEADERS, {
        knowledgeBaseId: "kb-empty",
      });
      expect(hits).toEqual([]);
    } finally {
      stub.restore();
    }
  });
});

describe("ask output guardrail", () => {
  const allowGuardrail = async () => ({ decision: "allow" as const });
  const reviewGuardrail = async () => ({ decision: "review" as const });

  function singleChunk() {
    const { repo } = testService();
    repo.chunks.push(
      { documentId: "d1", projectId: PROJECT, page: 1, text: "aaa", embedding: [1, 0, 0] },
    );
    return repo;
  }

  it("returns the answer when the guardrail allows", async () => {
    const stub = stubOpenAI();
    try {
      const repo = singleChunk();
      const service = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
      );

      const result = await service.ask(PROJECT, "What is this?", 5, HEADERS);

      expect(result.answer).toBe("generated answer");
      expect(result.results.length).toBeGreaterThan(0);
    } finally {
      stub.restore();
    }
  });

  it("blocks credential leaks without returning the answer", async () => {
    const { envConfig } = await import("@/config/envConfig");
    envConfig.GEMINI_GUARD_API_KEY ||= "guardrail-test-key";

    const leaked = `the key is ragx_live_${"A".repeat(32)}`;
    const chatBodies: string[] = [];
    const restore = stubFetch((url, init) => {
      if (url.includes("/embeddings")) {
        return json({ data: [{ embedding: [1, 0, 0] }] });
      }
      chatBodies.push((init.body as string) ?? "");
      return json({ choices: [{ message: { content: leaked } }] });
    });

    try {
      const repo = singleChunk();
      // Default (real) guardrail: the local secret scanner must block the
      // leaked key without any network call to the guard model.
      const service = new RetrievalService(repo as never);

      const err = await service
        .ask(PROJECT, "What is this?", 5, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      // Generation happened first — the guard inspected actual output.
      expect(chatBodies.length).toBe(1);
      expect(err).toMatchObject({ statusCode: 403 });
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("A".repeat(32));
      expect(message).not.toContain(leaked);
    } finally {
      restore();
    }
  });

  it("withholds suspicious output marked for review", async () => {
    const stub = stubOpenAI();
    try {
      const repo = singleChunk();
      const service = new RetrievalService(
        repo as never,
        undefined,
        reviewGuardrail,
      );

      const err = await service
        .ask(PROJECT, "What is this?", 5, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(err).toMatchObject({ statusCode: 502 });
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("generated answer");
    } finally {
      stub.restore();
    }
  });

  it("withholds the answer when the guardrail itself fails", async () => {
    const stub = stubOpenAI();
    try {
      const repo = singleChunk();
      const failing = async (): Promise<{
        decision: "allow" | "block" | "review";
      }> => {
        throw new Error("boom");
      };
      const service = new RetrievalService(
        repo as never,
        undefined,
        failing,
      );

      const err = await service
        .ask(PROJECT, "What is this?", 5, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(err).toMatchObject({ statusCode: 502 });
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("boom");
      expect(message).not.toContain("generated answer");
    } finally {
      stub.restore();
    }
  });
});

describe("multi-format processing pipeline", () => {
  const silentLogger = { info: () => undefined };
  const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");

  const SAMPLES: Record<string, { name: string; content: string }> = {
    txt: {
      name: "notes.txt",
      content:
        "Getting Started\n\nJWT tokens are useful for authentication.\n\nSecond paragraph with enough words to be meaningful here.",
    },
    markdown: {
      name: "guide.md",
      content:
        "# RAGX Guide\n\n## Getting Started\n\nJWT tokens are useful for authentication.\n\n| col1 | col2 |\n| --- | --- |\n| a | b |\n",
    },
    html: {
      name: "page.html",
      content:
        "<html><body><h1>RAGX Guide</h1><p>JWT tokens are useful for authentication.</p><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>",
    },
    json: {
      name: "data.json",
      content:
        '{"title":"RAGX Guide","description":"JWT tokens are useful for authentication.","tags":["retrieval","guide"]}',
    },
    csv: {
      name: "users.csv",
      content: "name,role\nada,admin\nbob,viewer\n",
    },
  };

  async function uploadAndProcess(
    name: string,
    contentBase64: string,
  ): Promise<ReturnType<typeof testService> & { id: string }> {
    const { service, repo, storage, objects, jobs } = testService();
    const doc = await service.upload(
      PROJECT,
      { name, contentBase64 },
      HEADERS,
    );
    // Upload is intake only: PENDING, nothing searchable yet.
    expect(doc.status).toBe("PENDING");
    expect(doc.chunks).toBe(0);
    const summary = await service.processDocument(PROJECT, doc.id, HEADERS);
    expect(summary.status).toBe("COMPLETED");
    return { service, repo, storage, objects, jobs, id: doc.id };
  }

  for (const [format, sample] of Object.entries(SAMPLES)) {
    it(`processes ${format} PENDING → PROCESSING → COMPLETED with scoped chunks`, async () => {
      const stub = stubOpenAI();
      try {
        const { repo, id } = await uploadAndProcess(
          sample.name,
          b64(sample.content),
        );
        expect(repo.docs[id]!.status).toBe("COMPLETED");
        expect(repo.chunks.length).toBeGreaterThan(0);
        expect(
          repo.chunks.every(
            (c) => c.projectId === PROJECT && c.documentId === id,
          ),
        ).toBe(true);
        expect(
          repo.chunks.every(
            (c) =>
              typeof c.page === "number" &&
              typeof (c.metadata as Record<string, unknown>)?.["chunkIndex"] ===
                "number",
          ),
        ).toBe(true);
      } finally {
        stub.restore();
      }
    });
  }

  it("preserves markdown headings and tables through to chunks", async () => {
    const stub = stubOpenAI();
    try {
      const { repo } = await uploadAndProcess(
        SAMPLES["markdown"]!.name,
        b64(SAMPLES["markdown"]!.content),
      );
      const joined = repo.chunks.map((c) => c.text).join("\n");
      expect(joined).toContain("RAGX Guide");
      expect(joined).toContain("col1");
      expect(
        repo.chunks.some(
          (c) =>
            Array.isArray(
              (c.metadata as Record<string, unknown>)?.["headerPath"],
            ) &&
            (
              (c.metadata as Record<string, unknown>)[
                "headerPath"
              ] as string[]
            ).some((h) => h.includes("RAGX Guide")),
        ),
      ).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it("preserves csv tables and html structure through to chunks", async () => {
    const stub = stubOpenAI();
    try {
      const csv = await uploadAndProcess(
        SAMPLES["csv"]!.name,
        b64(SAMPLES["csv"]!.content),
      );
      const csvText = csv.repo.chunks.map((c) => c.text).join("\n");
      expect(csvText).toContain("ada");
      expect(csvText).toContain("name");

      const html = await uploadAndProcess(
        SAMPLES["html"]!.name,
        b64(SAMPLES["html"]!.content),
      );
      const htmlText = html.repo.chunks.map((c) => c.text).join("\n");
      expect(htmlText).toContain("RAGX Guide");
    } finally {
      stub.restore();
    }
  });

  it("keeps parse → clean structure: headings stay headers, tables stay tables", async () => {
    const md = await ingestDocument(
      { data: Buffer.from("# Title\n\nBody text here."), fileName: "a.md" },
      {},
      silentLogger,
    );
    expect(md.cleaned.pages[0]!.blocks[0]).toMatchObject({
      type: "header",
      content: "Title",
    });

    const html = await ingestDocument(
      {
        data: Buffer.from(
          "<html><body><h2>Section</h2><p>Body.</p><table><tr><th>a</th></tr><tr><td>1</td></tr></table></body></html>",
        ),
        fileName: "a.html",
      },
      {},
      silentLogger,
    );
    const types = html.cleaned.pages[0]!.blocks.map((b) => b.type);
    expect(types).toContain("header");
    expect(types).toContain("table");
    expect(types).toContain("text");
  });

  it("honors an explicit MIME override over the filename", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      // Named .pdf but declared plain text: the override wins, so the
      // text parser handles bytes the PDF parser would reject.
      const doc = await service.upload(
        PROJECT,
        {
          name: "report.pdf",
          mimeType: "text/plain",
          contentBase64: b64(
            "Just plain text content here. JWT tokens are useful.",
          ),
        },
        HEADERS,
      );
      const summary = await service.processDocument(PROJECT, doc.id, HEADERS);
      expect(summary.status).toBe("COMPLETED");
      expect(repo.docs[doc.id]!.status).toBe("COMPLETED");
      expect(repo.chunks.length).toBeGreaterThan(0);
    } finally {
      stub.restore();
    }
  });

  it("marks corrupt docx FAILED with a safe message", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        {
          name: "broken.docx",
          contentBase64: Buffer.from("not a docx at all").toString("base64"),
        },
        HEADERS,
      );
      const err = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(err).toBeTruthy();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
      const listed = await service.list(PROJECT);
      expect(listed[0]!.status).toBe("FAILED");
      expect(JSON.stringify(listed)).not.toContain("sk-header-key");
    } finally {
      stub.restore();
    }
  });

  it("marks malformed json and empty text/csv FAILED without leaking keys", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const cases: [string, string][] = [
        ["bad.json", "{oops not json"],
        ["empty.txt", "   \n  "],
        ["empty.csv", "  \n "],
      ];
      for (const [name, content] of cases) {
        const doc = await service.upload(
          PROJECT,
          { name, contentBase64: b64(content) },
          HEADERS,
        );
        const err = await service
          .processDocument(PROJECT, doc.id, HEADERS)
          .then(
            () => null,
            (error: unknown) => error,
          );
        expect(err).toBeTruthy();
        expect(repo.docs[doc.id]!.status).toBe("FAILED");
      }
      expect(JSON.stringify(repo.docs)).not.toContain("sk-header-key");
    } finally {
      stub.restore();
    }
  });
});

describe("embedding stage", () => {
  const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");
  const TEXT = "notes.txt";
  const BODY =
    "Getting Started\n\nJWT tokens are useful for authentication.\n\nSecond paragraph with enough words to be meaningful here.";

  function embedCalls(seen: { url: string; init: RequestInit }[]) {
    return seen.filter((s) => s.url.includes("/embeddings"));
  }

  function embedModels(seen: { url: string; init: RequestInit }[]) {
    return embedCalls(seen).map(
      (s) =>
        (JSON.parse(s.init.body as string) as Record<string, unknown>)[
          "model"
        ],
    );
  }

  function embedAuthHeaders(seen: { url: string; init: RequestInit }[]) {
    return embedCalls(seen).map(
      (s) =>
        ((s.init.headers ?? {}) as Record<string, string>)["Authorization"],
    );
  }

  it("embeds with one consistent provider/model/key (no switching)", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: TEXT, contentBase64: b64(BODY) },
        HEADERS,
      );
      const summary = await service.processDocument(PROJECT, doc.id, HEADERS);

      expect(summary.status).toBe("COMPLETED");
      const calls = embedCalls(stub.seen);
      expect(calls.length).toBeGreaterThan(0);
      // Same resolved configuration on every window: no silent provider
      // or model switching mid-document.
      expect(embedModels(stub.seen).every((m) => m === "text-embedding-3-small")).toBe(
        true,
      );
      expect(
        embedAuthHeaders(stub.seen).every((h) => h === "Bearer sk-header-key"),
      ).toBe(true);
      expect(repo.chunks.length).toBeGreaterThan(0);
    } finally {
      stub.restore();
    }
  });

  it("fails the document on ragged embedding dimensions", async () => {
    const restore = stubFetch((url, init) => {
      if (url.includes("/embeddings")) {
        const body = JSON.parse(init.body as string) as {
          input: unknown[];
        };
        return json({
          data: body.input.map((_, i) => ({
            embedding: i === 0 ? [1, 0, 0] : [1],
          })),
        });
      }
      return json({ choices: [{ message: { content: "x" } }] });
    });
    const { service, repo } = testService();
    try {
      // Long enough to split into several chunks: the stub answers the
      // first window with dim 3 and the rest with dim 1.
      const longText =
        "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(30);
      const doc = await service.upload(
        PROJECT,
        { name: TEXT, contentBase64: b64(longText) },
        HEADERS,
      );
      const err = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(err).toBeTruthy();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
      expect(repo.docs[doc.id]!.chunkCount).toBe(0);
      expect(repo.chunks).toHaveLength(0);
      const listed = await service.list(PROJECT);
      expect(JSON.stringify(listed)).not.toContain("sk-header-key");
    } finally {
      restore();
    }
  });

  it("fails fast on credential errors without retrying", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const restore = stubFetch((url, init) => {
      seen.push({ url, init });
      if (url.includes("/embeddings")) {
        return json({ error: "bad key" }, 401);
      }
      return json({ choices: [{ message: { content: "x" } }] });
    });
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: TEXT, contentBase64: b64(BODY) },
        HEADERS,
      );
      const err = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(err).toBeTruthy();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
      expect(repo.chunks).toHaveLength(0);
      // 401 is not retryable: exactly one attempt, no backoff loop.
      expect(embedCalls(seen)).toHaveLength(1);
      const listed = await service.list(PROJECT);
      expect(JSON.stringify(listed)).not.toContain("sk-header-key");
    } finally {
      restore();
    }
  });

  it("recovers from transient rate limits and still completes", async () => {
    let embedAttempts = 0;
    const restore = stubFetch((url, init) => {
      if (url.includes("/embeddings")) {
        embedAttempts += 1;
        if (embedAttempts === 1) {
          return json({ error: "slow down" }, 429);
        }
        const body = JSON.parse(init.body as string) as {
          input: unknown[];
        };
        return json({
          data: body.input.map((_, i) => ({
            embedding: [i % 7, i % 5, 1],
          })),
        });
      }
      return json({ choices: [{ message: { content: "x" } }] });
    });
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: TEXT, contentBase64: b64(BODY) },
        HEADERS,
      );
      const summary = await service.processDocument(PROJECT, doc.id, HEADERS);

      expect(summary.status).toBe("COMPLETED");
      expect(repo.docs[doc.id]!.status).toBe("COMPLETED");
      expect(embedAttempts).toBeGreaterThan(1);
      expect(repo.chunks.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("issues zero embedding calls when there is nothing to embed", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const restore = stubFetch((url, init) => {
      seen.push({ url, init });
      return json({ data: [] });
    });
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: "empty.txt", contentBase64: b64("   \n  ") },
        HEADERS,
      );
      const err = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(err).toBeTruthy();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
      expect(embedCalls(seen)).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe("vector indexing", () => {
  const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");
  // Long enough to split into several chunks; stub vectors stay dim-3.
  const LONG_TEXT = `PostgreSQL MVCC keeps old row versions. ${"Concurrent transactions see consistent snapshots. ".repeat(40)}`;
  const allowGuardrail = async () => ({ decision: "allow" as const });

  function embedCalls(seen: { url: string; init: RequestInit }[]) {
    return seen.filter((s) => s.url.includes("/embeddings"));
  }

  it("indexes chunks with full metadata and the actual indexed count", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: "postgres.txt", contentBase64: b64(LONG_TEXT) },
        HEADERS,
      );
      const summary = await service.processDocument(PROJECT, doc.id, HEADERS);

      expect(summary.status).toBe("COMPLETED");
      expect(repo.docs[doc.id]!.status).toBe("COMPLETED");
      expect(repo.chunks.length).toBeGreaterThan(1);
      // chunkCount is the ACTUAL indexed count, not an estimate.
      expect(repo.docs[doc.id]!.chunkCount).toBe(repo.chunks.length);
      for (const [index, row] of repo.chunks.entries()) {
        expect(row.documentId).toBe(doc.id);
        expect(row.projectId).toBe(PROJECT);
        expect(row.embedding).toHaveLength(3);
        expect(row.metadata).toMatchObject({
          page: row.page,
          chunkIndex: index,
          provider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDimensions: 3,
        });
      }
    } finally {
      stub.restore();
    }
  });

  it("keeps retrieval scoped to the owning project end to end", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const mine = await service.upload(
        PROJECT,
        { name: "mine.txt", contentBase64: b64(`Mine. ${LONG_TEXT}`) },
        HEADERS,
      );
      await service.processDocument(PROJECT, mine.id, HEADERS);
      const theirs = await service.upload(
        OTHER_PROJECT,
        { name: "theirs.txt", contentBase64: b64(`Theirs. ${LONG_TEXT}`) },
        HEADERS,
      );
      await service.processDocument(OTHER_PROJECT, theirs.id, HEADERS);

      const retrieval = new RetrievalService(
        repo as never,
        undefined,
        allowGuardrail,
      );
      const mineHits = await retrieval.search(
        PROJECT,
        "PostgreSQL MVCC snapshots",
        10,
        HEADERS,
      );
      expect(mineHits.length).toBeGreaterThan(0);
      expect(
        mineHits.every((h) => h.documentId === mine.id),
      ).toBe(true);

      const theirsHits = await retrieval.search(
        OTHER_PROJECT,
        "PostgreSQL MVCC snapshots",
        10,
        HEADERS,
      );
      expect(theirsHits.length).toBeGreaterThan(0);
      expect(
        theirsHits.every((h) => h.documentId === theirs.id),
      ).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it("marks FAILED (never COMPLETED) when the vector store fails", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: "postgres.txt", contentBase64: b64(LONG_TEXT) },
        HEADERS,
      );
      repo.insertChunks = async () => {
        throw new Error("store down");
      };

      const err = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(err).toBeTruthy();
      expect(repo.docs[doc.id]!.status).toBe("FAILED");
      expect(repo.docs[doc.id]!.chunkCount).toBe(0);
      expect(repo.chunks).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it("retries partial failures exactly once with no duplicate vectors", async () => {
    const stub = stubOpenAI();
    const { service, repo } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: "postgres.txt", contentBase64: b64(LONG_TEXT) },
        HEADERS,
      );
      const realInsert = repo.insertChunks.bind(repo);
      let calls = 0;
      repo.insertChunks = (async (
        rows: Parameters<typeof realInsert>[0],
      ) => {
        calls += 1;
        if (calls === 1) throw new Error("store down mid-write");
        return realInsert(rows);
      }) as typeof realInsert;

      const first = await service
        .processDocument(PROJECT, doc.id, HEADERS)
        .then(
          () => ({ status: "COMPLETED" as const }),
          () => ({ status: "FAILED" as const }),
        );
      expect(first.status).toBe("FAILED");

      const embedBefore = embedCalls(stub.seen).length;
      const second = await service.processDocument(PROJECT, doc.id, HEADERS);
      expect(second.status).toBe("COMPLETED");
      expect(repo.docs[doc.id]!.chunkCount).toBe(repo.chunks.length);

      // Exactly-once: chunkIndexes are a gapless 0..n-1 with unique texts.
      const indexes = repo.chunks.map(
        (c) => (c.metadata as Record<string, unknown>)?.["chunkIndex"],
      );
      expect(indexes).toEqual(repo.chunks.map((_, i) => i));

      // A third run is a no-op: COMPLETED short-circuits before embedding.
      await service.processDocument(PROJECT, doc.id, HEADERS);
      expect(embedCalls(stub.seen).length).toBe(embedBefore + 1);
      expect(repo.chunks.map((c) => c.text)).toHaveLength(
        repo.docs[doc.id]!.chunkCount,
      );
    } finally {
      stub.restore();
    }
  });

  it("removes indexed vectors with the document", async () => {
    const stub = stubOpenAI();
    const { service, repo, objects } = testService();
    try {
      const doc = await service.upload(
        PROJECT,
        { name: "postgres.txt", contentBase64: b64(LONG_TEXT) },
        HEADERS,
      );
      await service.processDocument(PROJECT, doc.id, HEADERS);
      expect(repo.chunks.length).toBeGreaterThan(0);

      await service.remove(doc.id, PROJECT);

      expect((await service.list(PROJECT)).length).toBe(0);
      expect(
        repo.chunks.filter((c) => c.documentId === doc.id),
      ).toHaveLength(0);
      expect(objects.has(`projects/${PROJECT}/documents/${doc.id}/original`)).toBe(
        false,
      );
    } finally {
      stub.restore();
    }
  });
});
