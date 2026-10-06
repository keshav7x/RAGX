import { RAGX_CHAT_MODELS, RAGX_EMBEDDING_MODELS } from "@repo/types";

import { ProviderUpstreamError } from "./provider";
import type { RAGXProvider } from "./provider";
import { encodeModelPathSegment, fetchWithTimeout } from "./safety";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface BatchEmbedResponse {
  embeddings?: { values?: unknown }[];
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: unknown }[] } }[];
}

async function post(
  provider: string,
  url: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetchWithTimeout(provider, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

export class GeminiProvider implements RAGXProvider {
  readonly name = "gemini" as const;

  async embed(
    input: string[],
    apiKey: string,
    opts: { model?: string } = {},
  ): Promise<number[][]> {
    if (input.length === 0) return [];
    const model = opts.model ?? RAGX_EMBEDDING_MODELS.gemini;

    // Gemini authenticates via query key; used server-side only, never logged.
    // The model is allow-listed + encoded: `x?foo=bar` or `../` cannot
    // alter the URL path or smuggle query parameters.
    const segment = encodeModelPathSegment(model);
    const url = `${BASE_URL}/models/${segment}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    const data = (await post(this.name, url, {
      requests: input.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      })),
    })) as BatchEmbedResponse;

    if (
      !Array.isArray(data.embeddings) ||
      data.embeddings.length !== input.length
    ) {
      throw new ProviderUpstreamError(this.name, "invalid response");
    }

    return data.embeddings.map((item) => {
      if (!item || !Array.isArray(item.values)) {
        throw new ProviderUpstreamError(this.name, "invalid response");
      }
      return item.values as number[];
    });
  }

  async generate(
    input: string,
    apiKey: string,
    opts: { model?: string; system?: string } = {},
  ): Promise<string> {
    const model = opts.model ?? RAGX_CHAT_MODELS.gemini;
    const segment = encodeModelPathSegment(model);
    const url = `${BASE_URL}/models/${segment}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const data = (await post(this.name, url, {
      ...(opts.system
        ? { system_instruction: { parts: [{ text: opts.system }] } }
        : {}),
      contents: [{ parts: [{ text: input }] }],
    })) as GenerateResponse;

    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();

    if (!text) {
      throw new ProviderUpstreamError(this.name, "invalid response");
    }
    return text;
  }
}
