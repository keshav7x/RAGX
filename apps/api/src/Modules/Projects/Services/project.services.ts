import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "@/Utils/httpError";

import { ProjectRepository } from "../Repository/project.repo";

import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "@repo/types";

export class ProjectService {
  constructor(
    private readonly projectRepository = new ProjectRepository(),
  ) {}

  /**
   * Single scoped query: missing and foreign projects are indistinguishable
   * (both 404), so project-ID enumeration reveals nothing. This also
   * removes the check-then-act window of an unscoped read followed by a
   * separate ownership comparison.
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

  async createProject(data: CreateProjectInput) {
    const project = await this.projectRepository.create(data);

    if (!project) {
      throw new Error("Failed to create project");
    }

    const apiKey = await this.projectRepository.createApiKey(
      project.id,
      "Default",
    );

    return {
      project,
      apiKey,
    };
  }

  async getProject(projectId: string, userId: string) {
    return this.requireOwnedProject(projectId, userId);
  }

  async getUserProjects(userId: string) {
    return this.projectRepository.findByUserId(userId);
  }

  async updateProject(
    projectId: string,
    userId: string,
    data: UpdateProjectInput,
  ) {
    await this.requireOwnedProject(projectId, userId);

    const updatedProject = await this.projectRepository.update(
      projectId,
      userId,
      data,
    );

    if (!updatedProject) {
      throw new NotFoundError("Project not found");
    }

    return updatedProject;
  }

  async deleteProject(projectId: string, userId: string) {
    await this.requireOwnedProject(projectId, userId);

    const deletedProject = await this.projectRepository.delete(
      projectId,
      userId,
    );

    if (!deletedProject) {
      throw new NotFoundError("Project not found");
    }

    return deletedProject;
  }

  async createApiKey(
    projectId: string,
    userId: string,
    name: string,
  ) {
    await this.requireOwnedProject(projectId, userId);

    return this.projectRepository.createApiKey(projectId, name);
  }

  async getApiKeys(projectId: string, userId: string) {
    await this.requireOwnedProject(projectId, userId);

    return this.projectRepository.getApiKeys(projectId);
  }

  async getApiKey(
    projectId: string,
    userId: string,
    apiKeyId: string,
  ) {
    await this.requireOwnedProject(projectId, userId);

    const apiKey = await this.projectRepository.getApiKey(
      projectId,
      apiKeyId,
    );

    if (!apiKey) {
      throw new NotFoundError("API key not found");
    }

    return apiKey;
  }
  async revokeApiKey(
    projectId: string,
    userId: string,
    apiKeyId: string,
  ) {

    await this.requireOwnedProject(projectId, userId);

    const apiKey = await this.projectRepository.getApiKey(
      projectId,
      apiKeyId,
    );

    if (!apiKey) {
      throw new NotFoundError("API key not found");
    }

    if (apiKey.revokedAt) {
      throw new BadRequestError("API key is already revoked");
    }

    const revokedKey = await this.projectRepository.revokeApiKey(
      projectId,
      apiKeyId,
    );

    if (!revokedKey) {
      throw new NotFoundError("API key not found");
    }

    return revokedKey;
  }

  async rotateApiKey(
    projectId: string,
    userId: string,
    apiKeyId: string,
  ) {
    await this.requireOwnedProject(projectId, userId);

    const existing = await this.projectRepository.getApiKey(
      projectId,
      apiKeyId,
    );

    if (!existing) {
      throw new NotFoundError("API key not found");
    }

    if (existing.revokedAt) {
      throw new BadRequestError("API key is already revoked");
    }

    // Issue the replacement first so a failure never locks the caller out,
    // then invalidate the old key. The raw key is returned exactly once.
    const created = await this.projectRepository.createApiKey(
      projectId,
      existing.name,
    );

    await this.projectRepository.revokeApiKey(projectId, apiKeyId);

    return created;
  }

  async authenticateApiKey(keyHash: string) {
    const apiKey =
      await this.projectRepository.findApiKeyByHash(keyHash);

    if (!apiKey) {
      throw new UnauthorizedError("Invalid or revoked API key");
    }

    const project = await this.projectRepository.findById(
      apiKey.projectId,
    );
    // NOTE: `apiKey.projectId` is server-derived (verified key hash), not
    // caller input, so the unscoped internal lookup is safe here.

    if (!project) {
      throw new NotFoundError("Project not found");
    }

    return {
      apiKey,
      project,
    };
  }
}
