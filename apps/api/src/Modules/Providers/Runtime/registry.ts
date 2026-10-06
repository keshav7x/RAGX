import { BadRequestError } from "@/Utils/httpError";

import { RAGX_PROVIDER_NAMES, isRAGXProviderName } from "@repo/types";
import type { RAGXProviderName } from "@repo/types";

import { GeminiProvider } from "./gemini.provider";
import { MistralProvider } from "./mistral.provider";
import { OpenAIProvider } from "./openai.provider";
import type { RAGXProvider } from "./provider";

const providers: Record<RAGXProviderName, RAGXProvider> = {
  openai: new OpenAIProvider(),
  mistral: new MistralProvider(),
  gemini: new GeminiProvider(),
};

/**
 * Resolve the internal provider by name. Adding a provider later means
 * adding an implementation here — the public RAGX API never changes.
 */
export function getRAGXProvider(name: string): RAGXProvider {
  if (!isRAGXProviderName(name)) {
    // Sanitize before reflecting: names arrive from request headers and
    // land in error responses + logs. Cap length and strip newlines so a
    // crafted `X-Provider` cannot forge log lines.
    const shown =
      typeof name === "string"
        ? name.replace(/[\r\n]/g, "").slice(0, 100)
        : typeof name;
    throw new BadRequestError(
      `Unsupported provider "${shown}". Supported: ${RAGX_PROVIDER_NAMES.join(", ")}`,
    );
  }
  return providers[name];
}
