import { describe, expect, it } from "bun:test";

import * as sdk from "./index.js";
import { RAGX } from "./index.js";
import type { RAGXConfig } from "./index.js";
import { loadDocument } from "./loader.js";

const CONFIG = {
  provider: "openai" as const,
  providerApiKey: "sk-test-provider-key",
  apiKey: "ragx_test_key",
};

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

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe("RAGX SDK", () => {
  it("constructs with provider + providerApiKey + ragxApiKey", () => {
    expect(new RAGX(CONFIG)).toBeInstanceOf(RAGX);
  });

  it("rejects invalid initialization with clear errors", () => {
    expect(
      () =>
        new RAGX({
          provider: "cohere",
          providerApiKey: "x",
          apiKey: "y",
        } as unknown as RAGXConfig),
    ).toThrowError(/provider must be one of openai, mistral, gemini/);

    expect(
      () => new RAGX({ ...CONFIG, providerApiKey: "  " }),
    ).toThrowError(/providerApiKey is required when provider="openai"/);

    expect(() => new RAGX({ ...CONFIG, apiKey: "" })).toThrowError(
      /apiKey is required/,
    );

    expect(
      () =>
        new RAGX({
          provider: "openai",
          providerApiKey: "x",
        } as unknown as RAGXConfig),
    ).toThrowError(/apiKey is required/);
  });

  it("accepts the legacy ragxApiKey alias and matching duplicates", () => {
    expect(
      new RAGX({
        provider: "openai",
        providerApiKey: "x",
        ragxApiKey: "ragx_legacy_key",
      }),
    ).toBeInstanceOf(RAGX);

    expect(
      new RAGX({ ...CONFIG, ragxApiKey: CONFIG.apiKey }),
    ).toBeInstanceOf(RAGX);
  });

  it("rejects ambiguous credentials when apiKey and ragxApiKey differ", () => {
    expect(
      () => new RAGX({ ...CONFIG, ragxApiKey: "ragx_other_key" }),
    ).toThrowError(/apiKey and ragxApiKey must match/);
  });

  it("validates a custom baseUrl when supplied", async () => {
    const stub = stubFetch(() => json({ data: { results: [] } }));
    try {
      await new RAGX({ ...CONFIG, baseUrl: "http://localhost:3000/" }).search(
        "hello",
      );
    } finally {
      stub.restore();
    }
    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0]!.url).toBe("http://localhost:3000/v1/search");

    for (const baseUrl of ["not-a-url", "ftp://files.example.com", "  "]) {
      expect(
        () => new RAGX({ ...CONFIG, baseUrl }),
      ).toThrowError(/baseUrl must be a valid http\(s\) URL/);
    }
  });

  it("never exposes credentials in initialization errors", () => {
    const secret = "sk-live-ultra-secret-value";
    try {
      new RAGX({ ...CONFIG, providerApiKey: secret, apiKey: "" });
      expect(false).toBe(true);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });

  it("sends ragx key as Bearer and provider key via provider headers", async () => {
    const stub = stubFetch(() => json({ data: { results: [] } }));

    try {
      await new RAGX(CONFIG).search("hello");
    } finally {
      stub.restore();
    }

    expect(stub.seen).toHaveLength(1);
    const headers = headersOf(stub.seen[0]!.init);
    expect(headers["Authorization"]).toBe("Bearer ragx_test_key");
    expect(headers["X-Provider"]).toBe("openai");
    expect(headers["X-Provider-Key"]).toBe("sk-test-provider-key");
  });

  it("uploads documents without strategy options", async () => {
    const stub = stubFetch((url, init) => {
      expect(url.endsWith("/v1/documents")).toBe(true);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["name"]).toBe("manual.pdf");
      expect(typeof body["contentBase64"]).toBe("string");
      expect("chunkingStrategy" in body).toBe(false);
      expect("embeddingStrategy" in body).toBe(false);
      return json({
        data: {
          id: "d1",
          filename: "manual.pdf",
          mimeType: "application/pdf",
          size: 18,
          status: "PENDING",
          chunks: 0,
          createdAt: new Date().toISOString(),
        },
      });
    });

    try {
      const ragx = new RAGX(CONFIG);
      const doc = await ragx.documents.upload(
        new TextEncoder().encode("%PDF-1.4 hello"),
        { name: "manual.pdf" },
      );
      expect(doc.id).toBe("d1");
      expect(doc.filename).toBe("manual.pdf");
      expect(doc.status).toBe("PENDING");
    } finally {
      stub.restore();
    }
  });

  it("uploads Phase 2 loader output directly", async () => {
    const stub = stubFetch((url, init) => {
      expect(url.endsWith("/v1/documents")).toBe(true);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["name"]).toBe("postgres.pdf");
      expect(body["mimeType"]).toBe("application/pdf");
      expect(typeof body["contentBase64"]).toBe("string");
      expect("chunkingStrategy" in body).toBe(false);
      return json({
        data: {
          id: "d9",
          filename: "postgres.pdf",
          mimeType: "application/pdf",
          size: 14,
          status: "PENDING",
          chunks: 0,
          createdAt: new Date().toISOString(),
        },
      });
    });

    try {
      const ragx = new RAGX(CONFIG);
      const loaded = await loadDocument(
        new TextEncoder().encode("%PDF-1.4 hi"),
        { name: "postgres.pdf" },
      );
      const doc = await ragx.documents.upload(loaded);
      expect(doc.id).toBe("d9");
      expect(doc.status).toBe("PENDING");
      expect(doc.chunks).toBe(0);

      // Explicit upload opts still win over loaded metadata.
      const stub2 = stubFetch((url, init) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body["name"]).toBe("renamed.pdf");
        expect(body["mimeType"]).toBe("text/plain");
        return json({
          data: {
            id: "d10",
            filename: "renamed.pdf",
            mimeType: "text/plain",
            size: 1,
            status: "PENDING",
            chunks: 0,
            createdAt: new Date().toISOString(),
          },
        });
      });
      try {
        const renamed = await ragx.documents.upload(loaded, {
          name: "renamed.pdf",
          mimeType: "text/plain",
        });
        expect(renamed.filename).toBe("renamed.pdf");
      } finally {
        stub2.restore();
      }
    } finally {
      stub.restore();
    }
  });

  it("uploads batches mixing loader output with raw inputs", async () => {
    const stub = stubFetch((url, init) => {
      expect(url.endsWith("/v1/documents/batch")).toBe(true);
      const body = JSON.parse(init.body as string) as {
        files: { filename: string; mimeType?: string; contentBase64: string }[];
      };
      expect(body.files).toHaveLength(2);
      expect(body.files[0]).toMatchObject({ filename: "a.txt" });
      expect(body.files[1]).toMatchObject({
        filename: "b.pdf",
        mimeType: "application/pdf",
      });
      return json({
        data: {
          documents: [
            { id: "d1", filename: "a.txt", status: "PENDING" },
            { id: "d2", filename: "b.pdf", status: "PENDING" },
          ],
        },
      });
    });

    try {
      const ragx = new RAGX(CONFIG);
      const loaded = await loadDocument(new TextEncoder().encode("hi"), {
        name: "b.pdf",
      });
      const result = await ragx.documents.upload([
        { data: new TextEncoder().encode("hi"), name: "a.txt" },
        loaded,
      ]);
      expect(result.documents).toHaveLength(2);
      expect(result.documents[1]).toMatchObject({
        id: "d2",
        status: "PENDING",
      });
    } finally {
      stub.restore();
    }
  });

  it("uploads batches in one call and accepts Blob input", async () => {
    const stub = stubFetch((url, init) => {
      expect(url.endsWith("/v1/documents/batch")).toBe(true);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as {
        files: { filename: string; mimeType?: string; contentBase64: string }[];
      };
      expect(body.files).toHaveLength(2);
      expect(body.files[0]).toMatchObject({ filename: "manual.pdf" });
      expect(typeof body.files[0]!.contentBase64).toBe("string");
      expect(body.files[1]).toMatchObject({
        filename: "faq.pdf",
        mimeType: "application/pdf",
      });
      return json({
        data: {
          documents: [
            { id: "d1", filename: "manual.pdf", status: "PENDING" },
            { id: "d2", filename: "faq.pdf", status: "PENDING" },
          ],
        },
      });
    });

    try {
      const ragx = new RAGX(CONFIG);
      const blob = new Blob(["%PDF-1.4 faq"], { type: "application/pdf" });
      const result = await ragx.documents.upload([
        {
          data: new TextEncoder().encode("%PDF-1.4 hello"),
          name: "manual.pdf",
        },
        { data: blob, name: "faq.pdf" },
      ]);
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0]).toMatchObject({
        id: "d1",
        status: "PENDING",
      });
      expect(result.documents[1]!.id).toBe("d2");
    } finally {
      stub.restore();
    }
  });

  it("lists and deletes documents", async () => {
    const stub = stubFetch((url, init) => {
      if (url.endsWith("/v1/documents") && init.method !== "DELETE") {
        return json({ data: [] });
      }
      expect(url.endsWith("/v1/documents/d1")).toBe(true);
      expect(init.method).toBe("DELETE");
      return json({ data: null });
    });

    try {
      const ragx = new RAGX(CONFIG);
      expect(await ragx.documents.list()).toEqual([]);
      await ragx.documents.delete("d1");
    } finally {
      stub.restore();
    }
  });

  it("gets a single document by id", async () => {
    const stub = stubFetch((url, init) => {
      expect(url.endsWith("/v1/documents/d1")).toBe(true);
      expect(init.method ?? "GET").toBe("GET");
      return json({
        data: {
          id: "d1",
          filename: "manual.pdf",
          mimeType: "application/pdf",
          size: 18,
          status: "COMPLETED",
          chunks: 3,
          createdAt: new Date().toISOString(),
        },
      });
    });

    try {
      const doc = await new RAGX(CONFIG).documents.get("d1");
      expect(doc.id).toBe("d1");
      expect(doc.status).toBe("COMPLETED");
      expect(doc.chunks).toBe(3);
    } finally {
      stub.restore();
    }
  });

  it("waits until a document is ready, then stops polling", async () => {
    let polls = 0;
    const stub = stubFetch((url) => {
      expect(url.endsWith("/v1/documents/d1")).toBe(true);
      polls += 1;
      const status = polls < 3 ? "PENDING" : "COMPLETED";
      return json({
        data: {
          id: "d1",
          filename: "manual.pdf",
          mimeType: "application/pdf",
          size: 18,
          status,
          chunks: status === "COMPLETED" ? 3 : 0,
          createdAt: new Date().toISOString(),
        },
      });
    });

    try {
      const doc = await new RAGX(CONFIG).documents.waitUntilReady("d1", {
        intervalMs: 5,
      });
      expect(doc.status).toBe("COMPLETED");
      expect(polls).toBe(3);
    } finally {
      stub.restore();
    }
  });

  it("waitUntilReady rejects when processing fails or times out", async () => {
    const failed = stubFetch(() =>
      json({
        data: {
          id: "d1",
          filename: "manual.pdf",
          mimeType: "application/pdf",
          size: 18,
          status: "FAILED",
          chunks: 0,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    try {
      await expect(
        new RAGX(CONFIG).documents.waitUntilReady("d1", { intervalMs: 5 }),
      ).rejects.toThrowError(/failed to process/);
    } finally {
      failed.restore();
    }

    const pending = stubFetch(() =>
      json({
        data: {
          id: "d1",
          filename: "manual.pdf",
          mimeType: "application/pdf",
          size: 18,
          status: "PENDING",
          chunks: 0,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    try {
      await expect(
        new RAGX(CONFIG).documents.waitUntilReady("d1", {
          timeoutMs: 30,
          intervalMs: 5,
        }),
      ).rejects.toThrowError(/did not become ready in time/);
    } finally {
      pending.restore();
    }
  });

  it("searches, retrieves, and asks through the server", async () => {
    const stub = stubFetch((url, init) => {
      expect(init.method).toBe("POST");
      if (url.endsWith("/v1/search")) {
        return json({
          data: {
            results: [{ text: "ctx", score: 0.9, documentId: "d1", page: 2 }],
          },
        });
      }
      expect(url.endsWith("/v1/ask")).toBe(true);
      return json({
        data: { answer: "answer", results: [] },
      });
    });

    try {
      const ragx = new RAGX(CONFIG);
      const hits = await ragx.search("q", { topK: 3 });
      expect(hits[0]!.page).toBe(2);
      expect(await ragx.retrieve("q")).toEqual(hits);
      const asked = await ragx.ask("q");
      expect(asked.answer).toBe("answer");
    } finally {
      stub.restore();
    }
  });

  it("surfaces server errors without internals", async () => {
    const stub = stubFetch(() =>
      json({ message: "Invalid or revoked API key" }, 401),
    );

    try {
      await expect(new RAGX(CONFIG).search("q")).rejects.toThrowError(
        /RAGX search failed \(401\): Invalid or revoked API key/,
      );
    } finally {
      stub.restore();
    }
  });

  it("no longer exposes strategy or client-side provider configuration", () => {
    expect("completeWithOwnKey" in sdk).toBe(false);
    const ragx = new RAGX(CONFIG) as unknown as Record<string, unknown>;
    expect("llm" in ragx).toBe(false);
    expect("apiKey" in ragx).toBe(false);
  });

  it("accepts the nested embedding configuration", () => {
    const ragx = new RAGX({
      apiKey: "ragx_test_key",
      embedding: {
        provider: "mistral",
        apiKey: "sk-mistral-key",
        model: "mistral-embed",
      },
    });
    expect(ragx).toBeInstanceOf(RAGX);
    // Retrieval surface only: no generation configuration exists.
    const exposed = ragx as unknown as Record<string, unknown>;
    expect("llm" in exposed).toBe(false);
    expect("llmProvider" in exposed).toBe(false);
    expect("llmApiKey" in exposed).toBe(false);
  });

  it("keeps the legacy flat provider configuration working", () => {
    expect(new RAGX(CONFIG)).toBeInstanceOf(RAGX);
  });

  it("rejects mismatched nested and flat provider configuration", () => {
    expect(
      () =>
        new RAGX({
          ...CONFIG,
          embedding: { provider: "mistral", apiKey: "sk-mistral-key" },
        }),
    ).toThrowError(/embedding\.provider and provider must match/);
    expect(
      () =>
        new RAGX({
          ...CONFIG,
          embedding: { provider: "openai", apiKey: "sk-other-key" },
        }),
    ).toThrowError(/embedding\.apiKey and providerApiKey must match/);
    expect(
      () =>
        new RAGX({
          apiKey: "ragx_test_key",
          embedding: { provider: "cohere", apiKey: "x" } as never,
        }),
    ).toThrowError(/embedding\.provider must be one of/);
    expect(
      () =>
        new RAGX({
          apiKey: "ragx_test_key",
          embedding: {
            provider: "mistral",
            apiKey: "x",
            model: "  ",
          },
        }),
    ).toThrowError(/embedding\.model must be a non-empty string/);
  });

  it("sends the model override only when configured", async () => {
    const stub = stubFetch(() => json({ data: { results: [] } }));
    try {
      await new RAGX({
        apiKey: "ragx_test_key",
        embedding: {
          provider: "mistral",
          apiKey: "sk-mistral-key",
          model: "mistral-embed",
        },
      }).search("hello");
    } finally {
      stub.restore();
    }
    const headers = headersOf(stub.seen[0]!.init);
    expect(headers["X-Provider"]).toBe("mistral");
    expect(headers["X-Provider-Key"]).toBe("sk-mistral-key");
    expect(headers["X-Provider-Model"]).toBe("mistral-embed");

    const plain = stubFetch(() => json({ data: { results: [] } }));
    try {
      await new RAGX(CONFIG).search("hello");
    } finally {
      plain.restore();
    }
    expect("X-Provider-Model" in headersOf(plain.seen[0]!.init)).toBe(false);
  });

  it("uploads via the top-level upload and uploadMany helpers", async () => {
    const stub = stubFetch((url, init) => {
      if (url.endsWith("/v1/documents/batch")) {
        return json({
          data: {
            documents: [
              { id: "d1", filename: "a.txt", status: "PENDING" },
              { id: "d2", filename: "b.txt", status: "PENDING" },
            ],
          },
        });
      }
      expect(url.endsWith("/v1/documents")).toBe(true);
      return json({
        data: {
          id: "d1",
          filename: "a.txt",
          mimeType: "text/plain",
          size: 3,
          status: "PENDING",
          chunks: 0,
          createdAt: new Date().toISOString(),
        },
      });
    });

    try {
      const ragx = new RAGX(CONFIG);
      const doc = await ragx.upload(new TextEncoder().encode("aaa"), {
        name: "a.txt",
      });
      expect(doc.id).toBe("d1");
      const batch = await ragx.uploadMany([
        { data: new TextEncoder().encode("aaa"), name: "a.txt" },
        { data: new TextEncoder().encode("bbb"), name: "b.txt" },
      ]);
      expect(batch.documents).toHaveLength(2);
    } finally {
      stub.restore();
    }
  });

  it("manages knowledge bases through the server", async () => {
    const stub = stubFetch((url, init) => {
      if (url.endsWith("/v1/knowledge-bases") && init.method === "POST") {
        return json({
          data: {
            id: "kb-1",
            name: "KB",
            documentCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }
      if (url.endsWith("/v1/knowledge-bases")) {
        return json({ data: [] });
      }
      if (url.endsWith("/v1/knowledge-bases/kb-1/documents")) {
        expect(init.method).toBe("POST");
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body["documentId"]).toBe("d1");
        return json({ data: null });
      }
      if (url.endsWith("/v1/knowledge-bases/kb-1")) {
        if (init.method === "DELETE") return json({ data: null });
        return json({
          data: {
            id: "kb-1",
            name: "KB",
            documentCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    try {
      const ragx = new RAGX(CONFIG);
      const kb = await ragx.knowledgeBases.create({ name: "KB" });
      expect(kb.id).toBe("kb-1");
      expect(await ragx.knowledgeBases.list()).toEqual([]);
      expect((await ragx.knowledgeBases.get("kb-1")).documentCount).toBe(1);
      await ragx.knowledgeBases.addDocument("kb-1", "d1");
      await ragx.knowledgeBases.delete("kb-1");
    } finally {
      stub.restore();
    }
  });

  it("passes the knowledge base filter to search", async () => {
    const stub = stubFetch((url, init) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["knowledgeBase"]).toBe("kb-1");
      expect(body["topK"]).toBe(5);
      return json({ data: { results: [] } });
    });

    try {
      await new RAGX(CONFIG).search("q", { knowledgeBase: "kb-1" });
    } finally {
      stub.restore();
    }
    expect(stub.seen).toHaveLength(1);
  });
});
