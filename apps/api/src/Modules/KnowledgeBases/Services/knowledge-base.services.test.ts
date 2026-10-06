import { describe, expect, it } from "bun:test";

import { KnowledgeBaseService } from "./knowledge-base.services";

const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";

interface FakeKnowledgeBase {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function knowledgeBaseRepo() {
  const bases = new Map<string, FakeKnowledgeBase>();
  const links = new Set<string>();
  let seq = 0;

  const key = (knowledgeBaseId: string, documentId: string) =>
    `${knowledgeBaseId}:${documentId}`;

  return {
    bases,
    links,
    createKnowledgeBase: async (data: {
      projectId: string;
      name: string;
      description?: string;
    }) => {
      seq += 1;
      const row: FakeKnowledgeBase = {
        id: `kb-${seq}`,
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bases.set(row.id, row);
      return { ...row };
    },
    listByProject: async (projectId: string) =>
      [...bases.values()]
        .filter((b) => b.projectId === projectId)
        .map((b) => ({
          ...b,
          documentCount: [...links].filter((l) =>
            l.startsWith(`${b.id}:`),
          ).length,
        })),
    findByIdAndProject: async (id: string, projectId: string) => {
      const row = bases.get(id);
      if (!row || row.projectId !== projectId) return undefined;
      return {
        ...row,
        documentCount: [...links].filter((l) => l.startsWith(`${id}:`)).length,
      };
    },
    deleteByIdAndProject: async (id: string, projectId: string) => {
      const row = bases.get(id);
      if (!row || row.projectId !== projectId) return undefined;
      bases.delete(id);
      for (const link of [...links]) {
        if (link.startsWith(`${id}:`)) links.delete(link);
      }
      return { id };
    },
    isDocumentAttached: async (knowledgeBaseId: string, documentId: string) =>
      links.has(key(knowledgeBaseId, documentId)),
    addDocument: async (knowledgeBaseId: string, documentId: string) => {
      if (links.has(key(knowledgeBaseId, documentId))) {
        throw Object.assign(new Error("duplicate key value"), {
          code: "23505",
        });
      }
      links.add(key(knowledgeBaseId, documentId));
      return { id: `link-${links.size}` };
    },
    listDocumentIds: async (knowledgeBaseId: string, projectId: string) => {
      const row = bases.get(knowledgeBaseId);
      if (!row || row.projectId !== projectId) return [];
      return [...links]
        .filter((l) => l.startsWith(`${knowledgeBaseId}:`))
        .map((l) => l.slice(knowledgeBaseId.length + 1));
    },
  };
}

function documentRepo(documentProjectId: string | undefined) {
  return {
    findByIdAndProject: async (id: string, projectId: string) => {
      if (id !== "doc-1" || projectId !== documentProjectId) return undefined;
      return { id };
    },
  };
}

function testService(documentProjectId: string | undefined = PROJECT) {
  const kb = knowledgeBaseRepo();
  const docs = documentRepo(documentProjectId);
  const service = new KnowledgeBaseService(kb as never, docs as never);
  return { service, kb };
}

describe("knowledge base service", () => {
  it("creates, lists, gets, and deletes within project scope", async () => {
    const { service } = testService();

    const created = await service.create(PROJECT, {
      name: "PostgreSQL Documentation",
      description: "PG docs",
    });
    expect(created.name).toBe("PostgreSQL Documentation");
    expect(created.description).toBe("PG docs");
    expect(created.documentCount).toBe(0);
    expect(typeof created.createdAt).toBe("string");

    expect((await service.list(PROJECT)).map((kb) => kb.id)).toEqual([
      created.id,
    ]);
    expect(await service.list(OTHER_PROJECT)).toEqual([]);
    expect((await service.get(created.id, PROJECT)).id).toBe(created.id);
    await expect(
      service.get(created.id, OTHER_PROJECT),
    ).rejects.toMatchObject({ statusCode: 404 });

    await service.remove(created.id, PROJECT);
    expect(await service.list(PROJECT)).toEqual([]);
    await expect(
      service.remove(created.id, PROJECT),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects blank names", async () => {
    const { service } = testService();
    await expect(
      service.create(PROJECT, { name: "  " }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("attaches owned documents and reports counts", async () => {
    const { service } = testService();

    const kb = await service.create(PROJECT, { name: "KB" });
    await service.addDocument(PROJECT, kb.id, "doc-1");

    expect((await service.get(kb.id, PROJECT)).documentCount).toBe(1);
    expect(
      (await service.list(PROJECT))[0]!.documentCount,
    ).toBe(1);
  });

  it("rejects duplicate attaches with 409", async () => {
    const { service } = testService();

    const kb = await service.create(PROJECT, { name: "KB" });
    await service.addDocument(PROJECT, kb.id, "doc-1");
    await expect(
      service.addDocument(PROJECT, kb.id, "doc-1"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("maps unique violations to 409 when the pre-check races", async () => {
    const { kb } = testService();
    const racing = {
      ...kb,
      // Pre-check misses, storage constraint catches it.
      isDocumentAttached: async () => false,
    };
    const service = new KnowledgeBaseService(
      racing as never,
      documentRepo(PROJECT) as never,
    );

    const created = await service.create(PROJECT, { name: "KB" });
    await service.addDocument(PROJECT, created.id, "doc-1");
    await expect(
      service.addDocument(PROJECT, created.id, "doc-1"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("never attaches foreign knowledge bases or documents", async () => {
    const { service, kb } = testService();
    const created = await service.create(PROJECT, { name: "KB" });

    // Another project's KB ID is invisible (404, not 403 — no leaking).
    await expect(
      service.addDocument(OTHER_PROJECT, created.id, "doc-1"),
    ).rejects.toMatchObject({ statusCode: 404 });

    // A document owned by another project cannot be attached, even
    // through an owned knowledge base.
    const foreignDocService = new KnowledgeBaseService(
      kb as never,
      documentRepo("someone-else") as never,
    );
    await expect(
      foreignDocService.addDocument(PROJECT, created.id, "doc-1"),
    ).rejects.toMatchObject({ statusCode: 404 });

    // Unknown IDs on both sides.
    await expect(
      service.addDocument(PROJECT, "kb-missing", "doc-1"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service.addDocument(PROJECT, created.id, "doc-missing"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
