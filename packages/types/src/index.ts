// NOTE: shared workspace contract (`@repo/types`).
//
// Canonical SDK/server types live in `ragx.types.ts` (provider names,
// documents, search/ask results). `provider.types.ts` and `llm.types.ts`
// are legacy config shapes kept for backwards compatibility — new code
// should prefer `ragx.types.ts` and treat the others as frozen.
//
// WHY one package: API, SDK, and (eventually) web must agree on `Document`
// / `SearchResult` / `AskResult` wire shapes. Duplicating them per app
// caused the `collections`/`kb_*` drift documented in the web audit.
export * from "./ragx.types.js";
export * from "./project.types.js";
export * from "./provider.types.js";
export * from "./llm.types.js";
