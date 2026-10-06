import { and, eq, isNull } from "drizzle-orm";

import { db } from "@config/database";
import { ApiKeys, projectTable } from "@db/schema";

import {
  generateApiKey,
  hashApiKey,
} from "@utils/generateApiKey";

import type {
  CreateApiKeyResponse,
  CreateProjectInput,
} from "@repo/types";
import { toKeyPreview } from "@repo/types";

export class ProjectRepository {
  private DB = db;

  async create(data: CreateProjectInput) {
    const { name, userId, description } = data;

    const [createdProject] = await this.DB
      .insert(projectTable)
      .values({
        name,
        userId,
        description,
      })
      .returning();

    return createdProject;
  }

  /**
   * Internal lookup by ID only. The project ID here is server-derived
   * (from a verified API-key hash), never caller-supplied, so no tenant
   * scope applies. Ownership checks must use `findByIdAndUserId`.
   */
  async findById(projectId: string) {
    const [project] = await this.DB
      .select()
      .from(projectTable)
      .where(eq(projectTable.id, projectId));

    return project;
  }

  async findByIdAndUserId(projectId: string, userId: string) {
    const [project] = await this.DB
      .select()
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.userId, userId),
        ),
      );

    return project;
  }

  async findByUserId(userId: string) {
    const projects = await this.DB
      .select()
      .from(projectTable)
      .where(eq(projectTable.userId, userId));

    return projects;
  }

  async update(
    projectId: string,
    userId: string,
    data: {
      name?: string;
      description?: string;
    },
  ) {
    const [updatedProject] = await this.DB
      .update(projectTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.userId, userId),
        ),
      )
      .returning();

    return updatedProject;
  }

  async delete(projectId: string, userId: string) {
    const [deletedProject] = await this.DB
      .delete(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.userId, userId),
        ),
      )
      .returning();

    return deletedProject;
  }


  async createApiKey(
    projectId: string,
    name: string = "Default",
  ): Promise<CreateApiKeyResponse> {
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);

    const [createdKey] = await this.DB
      .insert(ApiKeys)
      .values({
        projectId,
        name,
        keyHash,
        keyPreview: toKeyPreview(apiKey),
      })
      .returning({
        id: ApiKeys.id,
        name: ApiKeys.name,
        keyPreview: ApiKeys.keyPreview,
        projectId: ApiKeys.projectId,
        createdAt: ApiKeys.createdAt,
      });

    if (!createdKey?.id || !createdKey.name || !createdKey.projectId || !createdKey.createdAt) {
      throw new Error("Failed to create API key");
    }

    return {
      id: createdKey.id,
      name: createdKey.name,
      projectId: createdKey.projectId,
      createdAt: createdKey.createdAt,
      keyPreview: createdKey.keyPreview ?? toKeyPreview(apiKey),
      key: apiKey,
    };
  }

  async getApiKeys(projectId: string) {
    return this.DB
      .select({
        id: ApiKeys.id,
        projectId: ApiKeys.projectId,
        name: ApiKeys.name,
        keyPreview: ApiKeys.keyPreview,
        createdAt: ApiKeys.createdAt,
        updatedAt: ApiKeys.updatedAt,
        revokedAt: ApiKeys.revokedAt,
      })
      .from(ApiKeys)
      .where(eq(ApiKeys.projectId, projectId));
  }

  async getActiveApiKeys(projectId: string) {
    return this.DB
      .select({
        id: ApiKeys.id,
        projectId: ApiKeys.projectId,
        name: ApiKeys.name,
        keyPreview: ApiKeys.keyPreview,
        createdAt: ApiKeys.createdAt,
        updatedAt: ApiKeys.updatedAt,
      })
      .from(ApiKeys)
      .where(
        and(
          eq(ApiKeys.projectId, projectId),
          isNull(ApiKeys.revokedAt),
        ),
      );
  }

  async getApiKey(projectId: string, apiKeyId: string) {
    const [apiKey] = await this.DB
      .select({
        id: ApiKeys.id,
        projectId: ApiKeys.projectId,
        name: ApiKeys.name,
        keyPreview: ApiKeys.keyPreview,
        createdAt: ApiKeys.createdAt,
        updatedAt: ApiKeys.updatedAt,
        revokedAt: ApiKeys.revokedAt,
      })
      .from(ApiKeys)
      .where(
        and(
          eq(ApiKeys.id, apiKeyId),
          eq(ApiKeys.projectId, projectId),
        ),
      );

    return apiKey;
  }


  async findApiKeyByHash(keyHash: string) {
    const [apiKey] = await this.DB
      .select()
      .from(ApiKeys)
      .where(
        and(
          eq(ApiKeys.keyHash, keyHash),
          isNull(ApiKeys.revokedAt),
        ),
      );

    return apiKey;
  }


  async revokeApiKey(
    projectId: string,
    apiKeyId: string,
  ) {
    const [revokedKey] = await this.DB
      .update(ApiKeys)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ApiKeys.id, apiKeyId),
          eq(ApiKeys.projectId, projectId),
          isNull(ApiKeys.revokedAt),
        ),
      )
      .returning({
        id: ApiKeys.id,
        projectId: ApiKeys.projectId,
        name: ApiKeys.name,
        revokedAt: ApiKeys.revokedAt,
      });

    return revokedKey;
  }
}
