import { ForbiddenError, NotFoundError, ProviderError } from "@/Utils/httpError";
import { resolveRequestProvider } from "../../Providers/Runtime/resolution";
import { createEmbeddingProvider } from "../../Ingestion/Embeddings/embedding.registry";
import { embedQuery } from "../../Ingestion/Embeddings/embedding.types";
import { createVectorStore } from "../../Ingestion/VectorStore/vector-store.registry";
// Side-effect import: self-registers the "pgvector"/"postgres" JSONB
// driver so `createVectorStore` resolves without services naming a
// concrete class.
import "../../Ingestion/VectorStore/postgres-jsonb.vector-store";
import { KnowledgeBaseRepository } from "../../KnowledgeBases/Repository/knowledge-base.repo";
import { ProviderService } from "../../Providers/Services/provider.services";
import { DocumentRepository } from "../Repository/document.repo";
import type { ProviderHeaders } from "./document.services";

import type { AskResult, SearchResult } from "@repo/types";

// NOTE: retrieval reads through the `VectorStoreClient` abstraction
// (Postgres JSONB driver today: vectors in `document_chunk.embedding`,
// ranked in-JS via `cosineSimilarity`). Cosine math itself stays shared
// in `Ingestion/VectorStore/similarity.ts` so ranking semantics cannot
// drift. A future pgvector/Pinecone/Qdrant driver plugs into the same
// registry without touching this service.
//
// `ask` additionally gates the generated answer on the output guardrail
// (`Modules/Guardrails/output.guardrail.ts`): only `allow` releases the
// answer; `block`/`review`/failure fail closed and never expose it.

export type GuardrailDecision = "allow" | "block" | "review";

export interface GuardrailVerdict {
  decision: GuardrailDecision;
}

export interface GuardrailCheckOptions {
  userQuery?: string;
  retrievedContext?: string;
  knownSecrets?: readonly string[];
  model?: string;
}

export type GuardrailCheck = (
  output: string,
  options?: GuardrailCheckOptions,
) => Promise<GuardrailVerdict>;

async function defaultGuardrailCheck(
  output: string,
  options: GuardrailCheckOptions = {},
): Promise<GuardrailVerdict> {
  // Lazy import: keeps `aiConfig`/GoogleGenAI construction off the module
  // load path (typecheck, unrelated tests) — paid once per process on the
  // first guarded answer. Callers that need determinism (tests) inject a
  // fake via the constructor instead.
  const { outputGuardrail } = await import(
    "../../Guardrails/output.guardrail"
  );
  return outputGuardrail(output, options);
}

export class RetrievalService {
  constructor(
    private readonly documentRepository = new DocumentRepository(),
    private readonly providerService = new ProviderService(),
    private readonly checkOutput: GuardrailCheck = defaultGuardrailCheck,
    private readonly knowledgeBaseRepository = new KnowledgeBaseRepository(),
  ) {}

  async search(
    projectId: string,
    query: string,
    topK: number,
    providerHeaders: ProviderHeaders = {},
    options: { knowledgeBaseId?: string } = {},
  ): Promise<SearchResult[]> {
    // Defense in depth: controllers already validate via zod, but direct
    // callers (jobs, tests) bypass them. Empty queries return no results
    // without spending an embedding call; out-of-range topK is clamped.
    const trimmedQuery = typeof query === "string" ? query.trim() : "";
    if (!trimmedQuery) return [];
    const limit =
      Number.isInteger(topK) && topK > 0 ? Math.min(topK, 20) : 5;

    const resolved = await resolveRequestProvider(
      projectId,
      providerHeaders,
      this.providerService,
    );

    // Same embedding configuration as ingestion: resolved once,
    // built through the registry. No second config anywhere.
    const embedding = createEmbeddingProvider(
      resolved.provider,
      resolved.apiKey,
      resolved.embeddingModel,
    );
    const queryVector = await embedQuery(embedding, trimmedQuery);
    if (queryVector.length === 0) return [];

    // Optional knowledge-base scoping: the KB must belong to the project
    // (404 otherwise, so foreign IDs reveal nothing), and chunk reads are
    // restricted to its documents in addition to the project boundary.
    let documentIds: string[] | undefined;
    if (options.knowledgeBaseId) {
      const knowledgeBase =
        await this.knowledgeBaseRepository.findByIdAndProject(
          options.knowledgeBaseId,
          projectId,
        );
      if (!knowledgeBase) {
        throw new NotFoundError("Knowledge base not found");
      }
      documentIds =
        await this.knowledgeBaseRepository.listDocumentIds(
          options.knowledgeBaseId,
          projectId,
        );
      if (documentIds.length === 0) return [];
    }

    // Project-scoped vector search through the store abstraction. The
    // driver reads only this project's chunks (tenant boundary bound at
    // creation) and owns dim-consistency filtering, cosine ranking,
    // score filtering, and topK slicing.
    const vectorStore = await createVectorStore(
      { provider: "pgvector" },
      {
        projectId,
        listChunks: documentIds
          ? (pid) =>
              this.documentRepository.listChunksByDocuments(pid, documentIds)
          : (pid) =>
              this.documentRepository.listChunksByProject(pid),
      },
    );
    const hits = await vectorStore.search(queryVector, limit);

    return hits.map((hit) => ({
      score: hit.score,
      text: hit.text,
      documentId: hit.documentId,
      chunkId: hit.id,
      page: hit.page ?? undefined,
      metadata: hit.metadata ?? undefined,
    }));
  }

  async ask(
    projectId: string,
    query: string,
    topK: number,
    providerHeaders: ProviderHeaders = {},
    options: { knowledgeBaseId?: string } = {},
  ): Promise<AskResult> {
    const results = await this.search(
      projectId,
      query,
      topK,
      providerHeaders,
      options,
    );

    if (results.length === 0) {
      return {
        answer:
          "I couldn't find relevant context in your documents to answer that.",
        results: [],
      };
    }

    const resolved = await resolveRequestProvider(
      projectId,
      providerHeaders,
      this.providerService,
    );

    const context = results
      .map(
        (hit, i) =>
          `[${i + 1}] (document ${hit.documentId}${hit.page !== undefined ? `, page ${hit.page}` : ""})\n${hit.text}`,
      )
      .join("\n\n");

    const answer = await resolved.runtime.generate(
      `Context:\n${context}\n\nQuestion: ${query}`,
      resolved.apiKey,
      {
        system:
          "Answer using only the provided context. Do not use outside knowledge. Cite page numbers when present. If the context is insufficient to answer, say you couldn't find relevant context in the documents.",
      },
    );

    // Output guardrail: inspect the ACTUAL generated answer (never before
    // generation, never a substitute for it). Only `allow` releases it.
    // `block`/`review`/failure fail closed with safe, static messages —
    // the candidate answer, guardrail reasoning, and any credentials stay
    // server-side and are never logged or returned.
    let verdict: GuardrailVerdict;
    try {
      verdict = await this.checkOutput(answer, {
        userQuery: query,
        retrievedContext: context,
        knownSecrets: resolved.apiKey ? [resolved.apiKey] : undefined,
      });
    } catch {
      throw new ProviderError(
        "The generated answer could not be verified and was withheld.",
      );
    }

    if (verdict.decision === "allow") {
      return { answer, results };
    }
    if (verdict.decision === "block") {
      throw new ForbiddenError(
        "The generated answer was blocked by a safety check.",
      );
    }
    throw new ProviderError(
      "The generated answer could not be verified and was withheld.",
    );
  }
}
