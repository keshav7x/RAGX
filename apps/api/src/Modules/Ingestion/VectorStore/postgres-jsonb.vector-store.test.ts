import { describe, expect, it } from "bun:test";

import { PostgresJsonbVectorStore } from "./postgres-jsonb.vector-store";
import type { VectorPoint } from "./vector-store.types";

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";

interface Row {
  documentId: string;
  projectId: string;
  page?: number;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

function memoryStore() {
  const rows: Row[] = [];
  return {
    rows,
    listChunks: async (projectId: string) =>
      rows
        .filter((r) => r.projectId === projectId)
        .map((r) => ({
          documentId: r.documentId,
          page: r.page ?? null,
          text: r.text,
          embedding: r.embedding,
        })),
    chunksStore: {
      insertChunks: async (chunks: Row[]) => {
        rows.push(...chunks);
      },
      deleteChunksByDocument: async (documentId: string) => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.documentId === documentId) rows.splice(i, 1);
        }
      },
    },
  };
}

function point(
  documentId: string,
  vector: number[],
  text: string,
  page = 1,
  metadata: Record<string, unknown> = {},
): VectorPoint {
  return { id: `${documentId}:${page}`, vector, text, documentId, page, metadata };
}

function storeFor(projectId: string, memory: ReturnType<typeof memoryStore>) {
  return new PostgresJsonbVectorStore(
    projectId,
    memory.listChunks,
    memory.chunksStore,
  );
}

describe("postgres jsonb vector store", () => {
  it("upserts points and returns them ranked by similarity", async () => {
    const memory = memoryStore();
    const store = storeFor(PROJECT_A, memory);

    await store.upsert([
      point("d1", [1, 0], "aaa", 1, { chunkIndex: 0, kind: "text" }),
      point("d1", [0, 1], "bbb", 2, { chunkIndex: 1, kind: "text" }),
    ]);

    const hits = await store.search([1, 0], 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ documentId: "d1", page: 1, text: "aaa" });
    expect(hits[0]!.score).toBe(1);
    expect(memory.rows).toHaveLength(2);
    expect(memory.rows[0]).toMatchObject({
      projectId: PROJECT_A,
      documentId: "d1",
    });
    expect(memory.rows[0]!.metadata).toMatchObject({
      chunkIndex: 0,
      kind: "text",
    });
  });

  it("never returns vectors belonging to another project", async () => {
    const memory = memoryStore();
    const storeA = storeFor(PROJECT_A, memory);
    const storeB = storeFor(PROJECT_B, memory);

    await storeA.upsert([point("d1", [1, 0], "aaa")]);
    await storeB.upsert([point("d2", [1, 0], "bbb")]);

    const hitsA = await storeA.search([1, 0], 5);
    expect(hitsA).toHaveLength(1);
    expect(hitsA[0]!.documentId).toBe("d1");

    const hitsB = await storeB.search([1, 0], 5);
    expect(hitsB).toHaveLength(1);
    expect(hitsB[0]!.documentId).toBe("d2");
  });

  it("deletes only the target document's vectors", async () => {
    const memory = memoryStore();
    const store = storeFor(PROJECT_A, memory);

    await store.upsert([point("d1", [1, 0], "aaa")]);
    await store.upsert([point("d2", [1, 0], "bbb")]);
    await store.deleteByDocument("d1");

    expect(memory.rows.map((r) => r.documentId)).toEqual(["d2"]);
    const hits = await store.search([1, 0], 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.documentId).toBe("d2");
  });

  it("ignores empty upserts and filters dimension mismatches", async () => {
    const memory = memoryStore();
    const store = storeFor(PROJECT_A, memory);

    await store.upsert([]);
    expect(memory.rows).toHaveLength(0);

    await store.upsert([point("d1", [1, 0], "aaa")]);
    expect(await store.search([1, 0, 0], 5)).toEqual([]);
    expect(await store.search([], 5)).toEqual([]);
  });
});
