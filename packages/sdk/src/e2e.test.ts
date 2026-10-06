import { describe, expect, it } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";

import { RAGX } from "./index.js";

declare const process:
  | { env: Record<string, string | undefined> }
  | undefined;

/**
 * Live end-to-end proof that the documented developer flow reaches the
 * real API and the real retrieval pipeline — no mocks here.
 *
 * Required environment (otherwise this suite vacuously passes):
 * - RAGX_E2E_BASE_URL (e.g. http://localhost:3000)
 * - RAGX_E2E_API_KEY (ragx_live_... for a real project)
 * - RAGX_E2E_MISTRAL_KEY (Mistral API key for embeddings)
 *
 * No LLM is involved anywhere: RAGX returns context, the test asserts
 * on chunks and metadata only.
 */
const BASE_URL = process?.env["RAGX_E2E_BASE_URL"];
const RAGX_API_KEY = process?.env["RAGX_E2E_API_KEY"];
const MISTRAL_API_KEY = process?.env["RAGX_E2E_MISTRAL_KEY"];
const E2E_ENABLED = Boolean(BASE_URL && RAGX_API_KEY && MISTRAL_API_KEY);

describe("ragx e2e (live API, no mocks)", () => {
  if (!E2E_ENABLED) return;

  function client(): RAGX {
    return new RAGX({
      apiKey: RAGX_API_KEY as string,
      embedding: {
        provider: "mistral",
        apiKey: MISTRAL_API_KEY as string,
        model: "mistral-embed",
      },
      baseUrl: BASE_URL as string,
    });
  }

  it("uploads, indexes, searches, scopes to a KB, and deletes", async () => {
    const ragx = client();
    const file = `./ragx-e2e-${Date.now()}.txt`;
    await writeFile(
      file,
      [
        "PostgreSQL MVCC keeps old row versions so readers never block writers.",
        "",
        "Each transaction sees a consistent snapshot of the database.",
        "",
        "VACUUM reclaims versions that are no longer visible to anyone.",
      ].join("\n"),
    );

    let documentId = "";
    let knowledgeBaseId = "";
    try {
      const document = await ragx.upload(file);
      documentId = document.id;
      expect(typeof documentId).toBe("string");

      const ready = await ragx.documents.waitUntilReady(documentId, {
        timeoutMs: 180_000,
        intervalMs: 2_000,
      });
      expect(ready.status).toBe("COMPLETED");
      expect(ready.chunks > 0).toBe(true);

      const results = await ragx.search(
        "How does PostgreSQL handle concurrent transactions?",
      );
      expect(results.length > 0).toBe(true);
      expect(
        results.every((hit) => hit.documentId === documentId),
      ).toBe(true);
      expect(
        results.every(
          (hit) =>
            typeof hit.text === "string" &&
            hit.text.length > 0 &&
            typeof hit.score === "number" &&
            typeof hit.chunkId === "string",
        ),
      ).toBe(true);

      const kb = await ragx.knowledgeBases.create({
        name: `E2E ${Date.now()}`,
      });
      knowledgeBaseId = kb.id;
      await ragx.knowledgeBases.addDocument(knowledgeBaseId, documentId);

      const scoped = await ragx.search("How does MVCC work?", {
        knowledgeBase: knowledgeBaseId,
        topK: 5,
      });
      expect(scoped.length > 0).toBe(true);
      expect(
        scoped.every((hit) => hit.documentId === documentId),
      ).toBe(true);

      await ragx.documents.delete(documentId);
      const deletedId = documentId;
      documentId = "";
      const afterDelete = await ragx.search(
        "How does PostgreSQL handle concurrent transactions?",
      );
      expect(
        afterDelete.every((hit) => hit.documentId !== deletedId),
      ).toBe(true);
    } finally {
      await unlink(file).catch(() => undefined);
      if (documentId) {
        await ragx.documents.delete(documentId).catch(() => undefined);
      }
      if (knowledgeBaseId) {
        await ragx.knowledgeBases.delete(knowledgeBaseId).catch(() => undefined);
      }
    }
  });
});
