import { NotFoundError } from "@/Utils/httpError";
import { decryptSecret, encryptSecret } from "@/Utils/encryption";

import { ProjectRepository } from "../../Projects/Repository/project.repo";
import { ProviderRepository } from "../Repository/provider.repo";

import {
  toSecretPreview,
} from "@repo/types";

import type {
  EmbeddingConfigInput,
  EmbeddingConfigMeta,
  EmbeddingProvider,
  VectorStoreConfigInput,
  VectorStoreConfigMeta,
  VectorStoreProvider,
} from "@repo/types";

export class ProviderService {
  constructor(
    private readonly providerRepository = new ProviderRepository(),
    private readonly projectRepository = new ProjectRepository(),
  ) {}

  /**
   * Single scoped query: missing and foreign projects are indistinguishable
   * (both 404), so project-ID enumeration reveals nothing.
   */
  private async requireOwnedProject(projectId: string, userId: string) {
    const project = await this.projectRepository.findByIdAndUserId(
      projectId,
      userId,
    );

    if (!project) {
      throw new NotFoundError("Project not found");
    }

    return project;
  }

  async getProviders(
    projectId: string,
    userId: string,
  ): Promise<{
    embedding: EmbeddingConfigMeta | null;
    vectorStore: VectorStoreConfigMeta | null;
  }> {
    await this.requireOwnedProject(projectId, userId);

    const [embeddingRow, vectorStoreRow] = await Promise.all([
      this.providerRepository.findEmbedding(projectId),
      this.providerRepository.findVectorStore(projectId),
    ]);

    return {
      embedding: embeddingRow ? this.toEmbeddingMeta(embeddingRow) : null,
      vectorStore: vectorStoreRow
        ? this.toVectorStoreMeta(vectorStoreRow)
        : null,
    };
  }

  async saveEmbedding(
    projectId: string,
    userId: string,
    input: EmbeddingConfigInput,
  ): Promise<EmbeddingConfigMeta> {
    await this.requireOwnedProject(projectId, userId);

    const row = await this.providerRepository.upsertEmbedding(projectId, {
      provider: input.provider,
      model: input.model.trim(),
      encryptedApiKey: encryptSecret(input.apiKey),
    });

    if (!row) {
      throw new Error("Failed to save embedding configuration");
    }

    return this.toEmbeddingMeta(row);
  }

  async deleteEmbedding(projectId: string, userId: string) {
    await this.requireOwnedProject(projectId, userId);

    const deleted =
      await this.providerRepository.deleteEmbedding(projectId);

    if (!deleted) {
      throw new NotFoundError("Embedding configuration not found");
    }

    return deleted;
  }

  async saveVectorStore(
    projectId: string,
    userId: string,
    input: VectorStoreConfigInput,
  ): Promise<VectorStoreConfigMeta> {
    await this.requireOwnedProject(projectId, userId);

    const row = await this.providerRepository.upsertVectorStore(projectId, {
      provider: input.provider,
      encryptedCredentials: encryptSecret(JSON.stringify(input)),
    });

    if (!row) {
      throw new Error("Failed to save vector store configuration");
    }

    return this.toVectorStoreMeta(row);
  }

  async deleteVectorStore(projectId: string, userId: string) {
    await this.requireOwnedProject(projectId, userId);

    const deleted =
      await this.providerRepository.deleteVectorStore(projectId);

    if (!deleted) {
      throw new NotFoundError("Vector store configuration not found");
    }

    return deleted;
  }

  /**
   * Internal resolution for the ingestion pipeline. The caller must have
   * already identified the project via the RAGX API key. Never expose
   * through a controller.
   */
  async resolveEmbeddingCredentials(projectId: string): Promise<{
    provider: EmbeddingProvider;
    model: string;
    apiKey: string;
  }> {
    const row = await this.providerRepository.findEmbedding(projectId);

    if (!row) {
      throw new NotFoundError("Embedding provider is not configured");
    }

    return {
      provider: row.provider as EmbeddingProvider,
      model: row.model,
      apiKey: decryptSecret(row.encryptedApiKey),
    };
  }

  /**
   * Internal resolution for the ingestion pipeline. Never expose
   * through a controller.
   */
  async resolveVectorStoreCredentials(
    projectId: string,
  ): Promise<VectorStoreConfigInput> {
    const row = await this.providerRepository.findVectorStore(projectId);

    if (!row) {
      throw new NotFoundError("Vector store is not configured");
    }

    return JSON.parse(decryptSecret(row.encryptedCredentials)) as VectorStoreConfigInput;
  }

  private toEmbeddingMeta(row: {
    provider: string;
    model: string;
    encryptedApiKey: string;
    updatedAt: Date;
  }): EmbeddingConfigMeta {
    return {
      provider: row.provider as EmbeddingProvider,
      model: row.model,
      configured: true,
      apiKeyPreview: toSecretPreview(decryptSecret(row.encryptedApiKey)),
      updatedAt: row.updatedAt,
    };
  }

  private toVectorStoreMeta(row: {
    provider: string;
    encryptedCredentials: string;
    updatedAt: Date;
  }): VectorStoreConfigMeta {
    const provider = row.provider as VectorStoreProvider;
    const credentials = JSON.parse(
      decryptSecret(row.encryptedCredentials),
    ) as VectorStoreConfigInput;

    if (credentials.provider === "pinecone") {
      return {
        provider,
        configured: true,
        apiKeyPreview: credentials.apiKey
          ? toSecretPreview(credentials.apiKey)
          : undefined,
        details: { index: credentials.index },
        updatedAt: row.updatedAt,
      };
    }

    if (credentials.provider === "qdrant") {
      return {
        provider,
        configured: true,
        apiKeyPreview: credentials.apiKey
          ? toSecretPreview(credentials.apiKey)
          : undefined,
        details: {
          url: credentials.url,
          collection: credentials.collection,
        },
        updatedAt: row.updatedAt,
      };
    }

    return {
      provider,
      configured: true,
      details: {
        connection: credentials.connectionString ? "custom" : "managed",
      },
      updatedAt: row.updatedAt,
    };
  }
}
