import { BadRequestError, NotFoundError } from "@/Utils/httpError";

import { RAGX_EMBEDDING_MODELS } from "@repo/types";
import type { RAGXProviderName } from "@repo/types";

import { ProviderService } from "../Services/provider.services";
import { getRAGXProvider } from "./registry";
import type { RAGXProvider } from "./provider";
import {
  MAX_HEADER_KEY_LENGTH,
  isSafeHeaderValue,
  isValidModelName,
} from "./safety";

export interface ResolvedProvider {
  provider: RAGXProviderName;
  /** Transient credential. Never stored, never logged, never returned. */
  apiKey: string;
  embeddingModel: string;
  runtime: RAGXProvider;
}

/**
 * Resolve which provider/key/model the engine uses for this request.
 *
 * Precedence: explicit per-request SDK headers first, then the project's
 * stored (encrypted) embedding configuration from the dashboard. The
 * model override is optional: when the SDK sends `X-Provider-Model` it
 * must be a non-empty model name (bounded like the stored column) and
 * applies to both indexing and query embedding within the request, so
 * the vector space stays compatible. It is never logged or persisted.
 */
export async function resolveRequestProvider(
  projectId: string,
  headers: {
    providerName?: unknown;
    providerKey?: unknown;
    providerModel?: unknown;
  },
  providerService = new ProviderService(),
): Promise<ResolvedProvider> {
  const headerName =
    typeof headers.providerName === "string" ? headers.providerName.trim() : "";
  const headerKey =
    typeof headers.providerKey === "string" ? headers.providerKey : "";
  const headerModel =
    typeof headers.providerModel === "string"
      ? headers.providerModel.trim()
      : "";

  if (headerName || headerKey || headerModel) {
    if (!headerName || !headerKey) {
      throw new BadRequestError(
        "Both provider name and provider key are required together",
      );
    }
    // Keys ride into an `Authorization: Bearer` header upstream: bound
    // their length (mirrors stored-config validation) and reject control
    // characters so CRLF/header splitting is impossible.
    if (
      headerKey.length < 8 ||
      !isSafeHeaderValue(headerKey, MAX_HEADER_KEY_LENGTH)
    ) {
      throw new BadRequestError("Provider key is invalid");
    }
    // Model names ride into the Gemini URL path: allow-list the charset
    // (length + characters), not just the length.
    if (headerModel && !isValidModelName(headerModel)) {
      throw new BadRequestError("Provider model name is invalid");
    }
    const runtime = getRAGXProvider(headerName);
    return {
      provider: runtime.name,
      apiKey: headerKey,
      embeddingModel:
        headerModel || RAGX_EMBEDDING_MODELS[runtime.name],
      runtime,
    };
  }

  try {
    const stored =
      await providerService.resolveEmbeddingCredentials(projectId);
    // Stored rows predate validation hardening; fail with a clear 400
    // (re-save in the dashboard) instead of interpolating garbage into
    // upstream URLs or embedding the wrong vector space.
    if (!isValidModelName(stored.model)) {
      throw new BadRequestError("Stored provider model is invalid");
    }
    const runtime = getRAGXProvider(stored.provider);
    return {
      provider: runtime.name,
      apiKey: stored.apiKey,
      embeddingModel: stored.model,
      runtime,
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new BadRequestError(
        "No provider configured. Pass provider + providerApiKey to the RAGX SDK or configure one in the dashboard.",
      );
    }
    throw error;
  }
}
