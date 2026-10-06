import { HttpError } from "@/Utils/httpError";

import type { RAGXProviderName } from "@repo/types";

export interface RAGXProvider {
  readonly name: RAGXProviderName;

  embed(
    input: string[],
    apiKey: string,
    opts?: { model?: string },
  ): Promise<number[][]>;

  generate(
    input: string,
    apiKey: string,
    opts?: { model?: string; system?: string },
  ): Promise<string>;
}

export class ProviderUpstreamError extends HttpError {
  /** HTTP status when the provider answered (undefined for network/parse failures). */
  readonly status?: number;
  /**
   * Whether retrying the same request (same provider, key, model) may
   * succeed: rate limits (429), server errors (5xx), and unreachable
   * transports. Auth/validation failures (4xx) and malformed responses
   * must fail fast instead of looping.
   */
  readonly retryable: boolean;

  constructor(
    provider: string,
    detail = "Provider request failed",
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(502, `${provider} request failed: ${detail}`);
    this.status = options.status;
    this.retryable =
      options.retryable ??
      (options.status !== undefined &&
        (options.status === 429 || options.status >= 500));
  }
}

export async function readJsonResponse(
  provider: string,
  res: Response,
): Promise<unknown> {
  if (!res.ok) {
    throw new ProviderUpstreamError(provider, `status ${res.status}`, {
      status: res.status,
    });
  }
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new ProviderUpstreamError(provider, "invalid response");
  }
}

export function postJson(
  provider: string,
  url: string,
  apiKey: string,
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new ProviderUpstreamError(provider, "unreachable", {
      retryable: true,
    });
  });
}
