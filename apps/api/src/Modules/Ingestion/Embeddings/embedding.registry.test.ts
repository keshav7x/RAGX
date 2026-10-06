import { describe, expect, it } from "bun:test";

import { ProviderUpstreamError } from "../../Providers/Runtime/provider";
import {
  DEFAULT_EMBED_BASE_DELAY_MS,
  createEmbeddingProvider,
  embedTextsBatched,
} from "./embedding.registry";
import type { EmbeddingProvider } from "./embedding.types";

const KEY = "sk-test-key";

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const seen: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    seen.push({ url: url as string, init: (init ?? {}) as RequestInit });
    return handler(url as string, (init ?? {}) as RequestInit);
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function authOf(init: RequestInit): string {
  return (init.headers as Record<string, string>)["Authorization"] ?? "";
}

describe("embedding registry", () => {
  it("builds an openai provider with the default model and bound key", async () => {
    const stub = stubFetch(() =>
      json({ data: [{ embedding: [0.1, 0.2] }] }),
    );

    try {
      const embedding = createEmbeddingProvider("openai", KEY);
      expect(await embedding.embed(["hello"])).toEqual([[0.1, 0.2]]);
    } finally {
      stub.restore();
    }

    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0]!.url).toBe("https://api.openai.com/v1/embeddings");
    expect(authOf(stub.seen[0]!.init)).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(stub.seen[0]!.init.body as string) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("text-embedding-3-small");
    expect(body["input"]).toEqual(["hello"]);
  });

  it("supports mistral and gemini with their own defaults", async () => {
    const stub = stubFetch((url) => {
      if (url.includes("mistral")) {
        return json({ data: [{ embedding: [1] }] });
      }
      return json({ embeddings: [{ values: [2] }] });
    });

    try {
      expect(await createEmbeddingProvider("mistral", KEY).embed(["a"])).toEqual([
        [1],
      ]);
      expect(await createEmbeddingProvider("gemini", KEY).embed(["a"])).toEqual([
        [2],
      ]);
    } finally {
      stub.restore();
    }

    const bodies = stub.seen.map(
      (s) => JSON.parse(s.init.body as string) as Record<string, unknown>,
    );
    expect(bodies[0]!["model"]).toBe("mistral-embed");
    expect(stub.seen[1]!.url).toContain("text-embedding-004:batchEmbedContents");
  });

  it("honors an explicit model override", async () => {
    const stub = stubFetch(() =>
      json({ data: [{ embedding: [0] }] }),
    );

    try {
      await createEmbeddingProvider("openai", KEY, "text-embedding-3-large").embed([
        "a",
      ]);
    } finally {
      stub.restore();
    }

    const body = JSON.parse(stub.seen[0]!.init.body as string) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("text-embedding-3-large");
  });

  it("rejects unsupported providers and missing keys", () => {
    expect(() =>
      createEmbeddingProvider("cohere" as never, KEY),
    ).toThrowError(/Unsupported embedding provider/);
    expect(() => createEmbeddingProvider("openai", "")).toThrowError(
      /providerApiKey is required/,
    );
    expect(() => createEmbeddingProvider("openai", "  ")).toThrowError(
      /providerApiKey is required/,
    );
  });

  it("short-circuits empty input without network traffic", async () => {
    const stub = stubFetch(() => json({}));
    try {
      expect(await createEmbeddingProvider("openai", KEY).embed([])).toEqual([]);
    } finally {
      stub.restore();
    }
    expect(stub.seen).toHaveLength(0);
  });

  it("instances are stateless and independent", async () => {
    const stub = stubFetch(() =>
      json({ data: [{ embedding: [0] }] }),
    );

    try {
      const first = createEmbeddingProvider("openai", "sk-first");
      const second = createEmbeddingProvider("openai", "sk-second");
      await first.embed(["a"]);
      await second.embed(["b"]);
    } finally {
      stub.restore();
    }

    expect(authOf(stub.seen[0]!.init)).toBe("Bearer sk-first");
    expect(authOf(stub.seen[1]!.init)).toBe("Bearer sk-second");
  });
});

describe("batched embedding", () => {
  function scriptedProvider(
    script: (call: { texts: string[]; attempt: number }) => Promise<number[][]>,
    onCall?: (texts: string[]) => void,
  ): EmbeddingProvider & { calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      embed: async (texts: string[]) => {
        calls.push([...texts]);
        onCall?.(texts);
        return script({ texts, attempt: calls.length });
      },
    };
  }

  function retryable429(): ProviderUpstreamError {
    return new ProviderUpstreamError("openai", "status 429", { status: 429 });
  }

  it("windows large inputs preserving order", async () => {
    const provider = scriptedProvider(async ({ texts }) =>
      texts.map((t) => [Number(t.slice(1))]),
    );
    const texts = Array.from({ length: 70 }, (_, i) => `t${i}`);

    const vectors = await embedTextsBatched(provider, texts, 32, {
      sleep: async () => undefined,
    });

    expect(provider.calls.map((c) => c.length)).toEqual([32, 32, 6]);
    expect(vectors).toEqual(texts.map((_, i) => [i]));
  });

  it("returns [] for empty input without calling the provider", async () => {
    const provider = scriptedProvider(async (call) => {
      throw new Error(`must not be called: ${JSON.stringify(call.texts)}`);
    });
    expect(await embedTextsBatched(provider, [], 32)).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it("fails fast when the provider drops inputs", async () => {
    const provider = scriptedProvider(async () => [[1]]);
    await expect(
      embedTextsBatched(provider, ["a", "b"], 32, {
        sleep: async () => undefined,
      }),
    ).rejects.toThrowError(/does not match chunk count/);
    expect(provider.calls).toHaveLength(1);
  });

  it("retries transient rate limits with exponential backoff", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const provider = scriptedProvider(async () => {
      attempts += 1;
      if (attempts <= 2) throw retryable429();
      return [[0.1]];
    });

    const vectors = await embedTextsBatched(provider, ["a"], 32, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(vectors).toEqual([[0.1]]);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([
      DEFAULT_EMBED_BASE_DELAY_MS,
      DEFAULT_EMBED_BASE_DELAY_MS * 2,
    ]);
  });

  it("gives up after max attempts on persistent rate limits", async () => {
    const sleeps: number[] = [];
    const provider = scriptedProvider(async () => {
      throw retryable429();
    });

    await expect(
      embedTextsBatched(provider, ["a"], 32, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(ProviderUpstreamError);
    expect(provider.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it("never retries credential or validation failures", async () => {
    const sleeps: number[] = [];
    const unauthorized = scriptedProvider(async () => {
      throw new ProviderUpstreamError("openai", "status 401", { status: 401 });
    });
    await expect(
      embedTextsBatched(unauthorized, ["a"], 32, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(ProviderUpstreamError);
    expect(unauthorized.calls).toHaveLength(1);

    const malformed = scriptedProvider(async () => {
      throw new ProviderUpstreamError("openai", "invalid response");
    });
    await expect(
      embedTextsBatched(malformed, ["a"], 32, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(ProviderUpstreamError);
    expect(malformed.calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("honors maxAttempts: 1 as no retry", async () => {
    const provider = scriptedProvider(async () => {
      throw retryable429();
    });
    await expect(
      embedTextsBatched(provider, ["a"], 32, {
        maxAttempts: 1,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(ProviderUpstreamError);
    expect(provider.calls).toHaveLength(1);
  });
});
