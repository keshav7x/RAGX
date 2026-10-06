# RAGX — Issues

> Generated from a static audit (Read/Glob/Grep only, no execution).
> Format: severity + file:line evidence + why it matters + fix.
> Labels: `security, bug, backend, database, ingestion, retrieval, sdk, frontend, build, dx, docs, infra, performance`

---

## P0 — Critical / Security

### #1 Harden JWT and application secrets — `security, backend`
**Files:**
- `apps/api/src/config/envConfig.ts:47` — `JWT_SECRET: readEnv("JWT_SECRET","change-me-in-production")`
- `apps/api/src/config/envConfig.ts:30-40` — `readRequiredEnv` warns + returns `""` instead of throwing
- `apps/api/src/config/envConfig.ts:61-75` — production only `console.warn` on dev fallback / empty `RAGX_ENCRYPTION_KEY`
- `apps/api/src/Modules/Auth/utils/jwt.ts:14-20` — `jwt.sign/verify` with no `algorithms:[HS256]`, unchecked `JWT_EXPIRES_IN` cast, no `issuer/audience`; `authCookies.ts:7` hardcodes 7d cookie, desyncs from JWT lifetime
- `apps/api/.env.example:3` ships `JWT_SECRET=change-me-in-production`
- `apps/api/src/Utils/encryption.ts:12` reads `process.env.RAGX_ENCRYPTION_KEY` directly, bypassing central config

**Problems:**
- All deployments without env share a known secret → token forgery (`sub: victimId`).
- Empty `DATABASE_URL` / `RAGX_ENCRYPTION_KEY` / `GEMINI_GUARD_API_KEY` boot successfully, fail deep in request handling.
- Weak-key / malformed `JWT_EXPIRES_IN` / `PORT` cause runtime 500s.

**Fix:**
- Remove insecure default; `throw` on missing `DATABASE_URL`, `JWT_SECRET`, `RAGX_ENCRYPTION_KEY` (at least in `production`).
- Validate secret strength (min length/entropy), validate `JWT_EXPIRES_IN` format, pin `algorithm: HS256` (+ `issuer/audience` if used), align cookie `maxAge` with JWT lifetime.
- Route all reads through `envConfig`; document key format (`openssl rand -hex 32`) in `.env.example`.

### #2 Enforce project-level tenant isolation — `security, backend, database`
**Files:**
- `apps/api/src/Modules/Projects/Services/project.services.ts:20-32` — unscoped `findById` then `403` on owner mismatch (vs `Modules/Documents/Controller/document.controller.ts:36-47` which correctly returns `404` for both) → existence oracle
- `apps/api/src/Modules/Projects/Repository/project.repo.ts:35-42`, `apps/api/src/Modules/Documents/Repository/document.repo.ts:55-92` — `findById`, `markProcessing/Completed/Failed(documentId)` filter by `id` only
- `apps/api/src/Modules/Documents/Repository/document.repo.ts:179-187` — `deleteChunksByDocument(documentId, projectId?)` optional `projectId`
- `apps/api/src/Modules/KnowledgeBases/Repository/knowledge-base.repo.ts:96-108` — `isDocumentAttached(kbId,docId)` unscoped
- `apps/api/src/Modules/Projects/Services/project.services.ts:65-93` — check-then-act TOCTOU

**Fix:**
- Scope all repos by `projectId` (`WHERE id AND projectId` / `WHERE id AND userId RETURNING`), single-statement updates.
- Uniform `404` for missing + foreign (no `403` oracle), or deliberate `403` everywhere — pick one.
- Audit KB / vector-store / chunk paths for cross-project leakage.

### #3 Harden filesystem access and document uploads — `security, ingestion, backend`
**Files:**
- `apps/api/src/Modules/Storage/objectStorage.ts:33-54` — `path.resolve + startsWith` only; no `realpath`, symlink escape possible, `mkdir+writeFile` non-atomic, `rm(force:true)` follows symlinks, `readFile` unbounded
- `apps/api/src/Modules/Ingestion/Pipeline/ingestion.ts:151-188` — `ingestFile`: `path.resolve(filePath)` no jail, `stat`→`readFile` TOCTOU, unbounded read
- `apps/api/src/Modules/Documents/validation/document.validation.ts:10,22` — `contentBase64: z.string().min(1)` no `.max()`, no charset; `files: .max(20)` only
- `apps/api/src/Modules/Documents/Services/document.services.ts:104-125` — `Buffer.from(x,"base64")` non-strict, no `data:` strip
- `apps/api/src/app.ts:25` — `express.json({limit:"21mb"})` holds full body in memory before service checks
- `apps/api/src/config/envConfig.ts:55-56` — relative `./storage` default, no boot validation

**Fix:**
- Jail paths, `realpath` + symlink check, reject `/` / empty keys, atomic writes, validate `STORAGE_DIR` at boot (exists + writable, absolute).
- Strict base64 validation, per-file + per-batch byte caps before parsing, streaming where possible.

### #4 Prevent SSRF and provider configuration abuse — `security, backend`
**Files:**
- `apps/api/src/Modules/Providers/validation/provider.validation.ts:33-55` — `qdrant.url: z.string().url()` allows `localhost/127.0.0.1/169.254.169.254/private nets`; `connectionString: z.string().max(1000)` unrestricted
- `apps/api/src/Modules/Providers/Services/provider.services.ts:102-105` — stored encrypted then used by future drivers → stored SSRF
- `apps/api/src/Modules/Providers/Runtime/gemini.provider.ts:57,86` — `model` interpolated into URL path unencoded (`X-Provider-Model` ≤100 chars, no charset)
- `apps/api/src/Modules/Providers/Runtime/resolution.ts:39-60` — unbounded `X-Provider-Key`, arbitrary model (cost/model smuggling), no CRLF/control-char rejection
- `apps/api/src/Modules/Providers/Runtime/provider.ts:62-80` — `fetch` with no `timeout/AbortSignal` (guardrail has 30s, providers don't)

**Fix:**
- Validate URLs: allowlist schemes, block `localhost`, loopback, private CIDRs, `169.254.169.254`; validate `pgvector` connection strings similarly.
- Encode/whitelist model names (`^[A-Za-z0-9._:-]+$`), cap + sanitize header key/model, reject control chars, add upstream timeouts.

### #5 Harden authentication and request handling — `security, backend`
**Files:**
- `apps/api/src/app.ts:18` + `apps/api/src/Modules/Auth/Routes/auth.routes.ts:10-18` — no `express-rate-limit`; `register/login`, API-key auth, `uploadBatch` unthrottled
- `apps/api/src/Modules/Auth/validation/auth.validation.ts:3-7` — `password: min(8)` no `.max()`; `email` no `.trim().toLowerCase()`, `max(50)`
- `apps/api/src/Modules/Auth/utils/authCookies.ts:9-15` + `apps/api/src/app.ts:17-20` — cookie auth (`httpOnly, secure prod-only, sameSite:lax`) with no CSRF token / `Origin` check; `/api/v1/projects/*` mutating routes CSRF-able
- `apps/api/src/Modules/Auth/middleware/authenticateApiKey.ts:36-48` — no `try/catch→next(err)`, no length cap; DB outage → unhandled rejection/hang; `401 Missing` vs `401 Invalid` oracle
- `apps/api/src/Modules/Auth/Services/auth.services.ts:41-66` — `ConflictError("Email already exists")` oracle, `argon2.verify` only if user exists (timing), no `23505→409` race guard

**Fix:**
- Add rate limiting (global + stricter on `auth`, key auth, uploads), password `max` (e.g. 72/128 to bound argon2), email normalize, CSRF protection for cookie flows, fail-closed `500` on key-lookup DB errors, generic register/login messages + constant-time handling.

---

## P1 — Core correctness

### #6 Fix ingestion file-type contract — `bug, ingestion, backend`
- `apps/api/src/Modules/Ingestion/Pipeline/ingestion.ts:59-60` supports `.md/.markdown` but `Modules/Ingestion/Loaders/index.ts:67` only `.md` → `.markdown` throws in loader, succeeds in pipeline.
- `Loaders/index.ts:80-81` `.json` returns raw trimmed string; `Parsers/json.parser.ts:74` does `JSON.parse` + block structuring + `DocumentEmptyError` → divergent behavior.
- Structured loader wraps text as single page (`Loaders/index.ts:39-57`) vs `markdown.parser.ts:99-132` header/table blocks.
- Client MIME trusted (`ingestion.ts:64-75`), polyglot misparsed.

**Fix:** one source of truth for supported types; make loader/registry/pipeline agree; return `UnsupportedDocumentType` consistently; fix `.json/.markdown`.

### #7 Fix PDF/HTML/CSV parsing correctness — `bug, ingestion, backend`
- `Parsers/pdf.parser.ts:179` keeps non-contiguous page nums, `Pipeline/ingestion.ts:135` sets `pageCount = pages.length` → mismatch; `pdf.structured.loader.ts:134-135` uses different total.
- `Parsers/html.parser.ts:58-97` groups by tag (headers→tables→paragraphs), not document order; `pdf.parser.ts:154-173` appends text→tables→images per page; `Chunking/structured.chunking.ts:81-133` re-emits text→tables→images → citation order wrong.
- `pdf.parser.ts:120-128`, `pdf.structured.loader.ts:122-131` `.catch(()=>null)` silently drops tables/images.
- `pdf.structured.loader.ts:121-132` concurrent `PDFParse` calls (documented in `pdf.parser.ts:116-118` as `DataCloneError`-prone); `finally: destroy()` without catch.
- `html.loader.ts:16`, `html.parser.ts:100` body-only → fragments without `<body>` yield `""`.
- `csv.loader.ts:10-14` `columns:true` eats headerless first row; `csv.parser.ts:76-87` assumes row 0 is header + emits table + per-row text (2× embed cost).
- Whitespace: `html.loader.ts:18-20` collapses `\n\n` → `" "`; `text/markdown loaders` bare `.trim()` vs parser BOM/paragraph logic.
- `Document/adapters.ts:77-86` drops `metadata`; `tables.ts:9` forces first row as header.

**Fix:** preserve source order, normalize page numbering, surface table errors, serialize PDF extraction, handle bodiless HTML, detect headerless CSV, fix whitespace/metadata.

### #8 Harden ingestion against oversized documents — `security, ingestion, backend`
- `Pipeline/ingestion.ts:109-176` no size cap; `ingestFile: readFile` unbounded; `pdf.parser.ts:104-106` duplicates buffer.
- `Documents/Services/document.services.ts:112-118` base64 pre-check still holds ~20MB string + ~15MB buffer (~35MB transient); `+1024` slack; conflated `"empty or exceeds 15MB"` errors.
- `uploadBatch` (`document.services.ts:249-279`) no count/total-bytes cap; `Jobs/document.jobs.ts:24-53` unbounded in-memory queue `CONCURRENCY=2`, `pump: .catch(()=>{})` swallows errors.
- Char-based oversize split (`document.services.ts:159-173`, `8000/800` chars) not token-aware (CJK overflow).
- Legacy loaders return `""` silently (no `DocumentEmptyError`).

**Fix:** `MAX_DOCUMENT_BYTES` in pipeline + service, strict decoded-size validation with distinct errors, batch count/byte caps, backpressure/persistent queue, token-aware splitting, empty-doc rejection, streaming.

### #9 Fix chunking correctness — `bug, ingestion, retrieval`
- `sentence/sematic chunking` regex `/[^.!?]+[.!?]+/g` splits `e.g./Mr./v1.2/3.14`.
- `sentence:36-44`, `paragraph:26-34` emit oversize single units verbatim (100KB → 100KB chunk → embed rejection); `paragraph:13-16` only splits on blank lines.
- `structured.chunking.ts:100-115` tables `NEVER split` → 100k-row table = MB chunk (service post-splits, direct callers don't); retains full 2D array + text + markdown (3× RAM).
- Header context leaks across pages (`structured.chunking.ts:65-75`), level ignored; parser vs loader `headerPath` diverge.
- `semantic: similarityThreshold=0.75` unvalidated (`NaN/>1/<-1` inverts); `sentence/paragraph maxCharacters` `NaN<=0==false` merges unbounded; `chunkSize:NaN` single wrong chunk; `code.aware language` unvalidated → `//@ts-ignore` runtime throw.
- `fixed.token.chunking.ts:22` hardcodes `encoding_for_model("gpt-4o")`, no cache → wrong counts for mistral/gemini + WASM load per call.

**Fix:** abbreviation-aware splitting, secondary window for oversize units, split large tables, validate `chunkSize/overlap/threshold` (`Number.isFinite`, `overlap<chunkSize`, `threshold∈[-1,1]`), preserve metadata/language, per-model tokenizers.

### #10 Remove silent chunk-strategy fallbacks — `bug, dx, retrieval`
- `Chunking/chunk.registry.ts:49-58` `return chunker ?? semanticChunk` — typo `"semantc"` silently uses semantic; `index.ts:19-21` same; `DEFAULT_CHUNK_STRATEGY="semantic"` uncallable as `TextChunker`; arity mismatch hidden by `as unknown as TextChunker`; `requireChunker:61-69` exists but unused (`DocumentService:332` hardcodes `structuredChunk`).

**Fix:** throw `400 InvalidChunkStrategy` on unknown, validate strategy config centrally, remove dead registry or wire it.

### #11 Fix embedding batch and dimension validation — `bug, retrieval, backend`
- `Embeddings/embedding.registry.ts:86` correctly rejects `batchSize<=0` but `89-96` silently coerces invalid `maxAttempts/baseDelayMs` to defaults; `EMBED_BATCH_SIZE=32` duplicated (`document.services.ts:40` vs `embedding.types.ts:45`).
- `embedding.provider.ts:16-19` no per-text guards (`null`/non-string/`""`/10k-text single call).
- Batched loop checks cross-batch dims, but `postgres-jsonb.vector-store.ts:86-91` only within-batch → model change accumulates mixed dims; `search:132-137` silently filters mismatches → invisible recall loss.

**Fix:** reject `batchSize<=0/NaN`, validate dims per batch + globally, reject empty/oversized requests, single batch-size constant, warn/metric on dim skips.

### #12 Replace JSONB cosine with pgvector — `database, retrieval, performance`
- `DB/schema.ts:146` `embedding: jsonb()`; `postgres-jsonb.vector-store.ts:124,139-150` + `document.repo.ts:189-226` (no `limit/offset/orderBy`) load **all** project vectors into JS per query → 1M×1536d ≈12GB/query, CPU/OOM blowup; indexes only on `projectId/documentId`, no vector index.
- `postgres-jsonb.vector-store.ts:141` synthesizes `row.id ?? doc:page:index` (order undefined, no `ORDER BY`); `insertChunks:158-170` discards caller `id:${doc}:chunk-i` and uses `defaultRandom()` → `chunkId` unstable across re-ingest.
- `score>0` filter (`:148`) drops valid `0`/negative cosine; `ask:162-168` claims “no context” when chunks exist.
- Acknowledged as fallback (`postgres-jsonb.vector-store.ts:15-17`, `vector-store.registry.ts:9-10 TODO pgvector`) but is prod path.

**Fix:** store vectors as `pgvector`, add IVFFLAT/HNSW indexes, push similarity into Postgres, stable chunk IDs/indexes, explicit score threshold (filter `NaN` only or document it).

---

## P1 — API / SDK

### #13 Align API, SDK, shared types and docs — `sdk, dx, docs, bug`
- `README.md:90-128` `new RAGX({apiKey})` omits required `provider/providerApiKey` → throws; response `{id,name,status:"ready",chunks:421}` vs real `{id,filename,mimeType,size,status:PENDING|COMPLETED,…,createdAt}` (`packages/types/src/ragx.types.ts:79-87`); search response omits required `chunkId` (`ragx.types.ts:105`).
- `README.md:275-290` API table omits `POST /v1/documents/batch`, `POST /v1/ask`, `POST /:id/documents`, `projects/auth`.
- `SearchOptions` only `{topK?,knowledgeBase?}` but landing shows `{topK:5,minScore:0.7}` (dropped), `retrieve({query,…})` object form in `apps/web/app/dashboard/collections/page.tsx:168` vs SDK `retrieve(query:string,opts)`.
- Key prefixes: real `ragx_live_` (`generateApiKey.ts:19`) vs `toKeyPreview` `startsWith("ragx_")` vs dashboard mocks `rgx_live_/rgx_test_`.
- Statuses: API/DB `PENDING→PROCESSING→COMPLETED|FAILED` vs dashboard `ready/processing/failed` vs README `ready`.

**Fix:** one canonical contract (documents/search/ask/KB/projects/responses/statuses/errors); make README ↔ SDK ↔ API ↔ `@repo/types` agree.

### #14 Make `@ragx/sdk` publishable — `sdk, build, dx`
- `packages/sdk/package.json:4` `private:true`, `:2` `version:0.0.0`, `:6-9` `exports: ./src/index.ts`, `files:[src]` (ships tests), no `build`/`dist`/`.d.ts`, `check-types: tsc --noEmit`; `turbo.json:9` outputs only `.next/**`.
- `dependencies: @repo/types:*` unresolvable externally.

**Fix:** `private:false`, real version, build to `dist` + `.d.ts`, `exports` → `dist`, `files:[dist]`, publish config, verify `bun add @ragx/sdk` from fresh project works.

### #15 Make `@repo/types` publishable/consumable — `sdk, build, dx`
- `packages/types/package.json:4` `private:true`, `:6-9` raw-source `exports` (`./src/*.ts`), `files:[src]`; `src/index.ts:11-14` `.js`-suffixed re-exports assume `NodeNext` while web uses `Bundler`.

**Fix:** decide internal vs public; if public, build declarations, export stable types, remove raw-source contract.

### #16 Fix SDK runtime behavior — `sdk, bug`
- `packages/sdk/src/index.ts:150-152` stores untrimmed `apiKey` (checks `trim()` truthiness, keeps raw) → `Bearer <spaces>`; `:370` sends raw.
- `:380-407` envelope assumes `{data,message}`, ignores `success`, returns `null as T` for `void` deletes, swallows non-JSON; `success:false+200` treated as success.
- `:401-404` `throw new Error(RAGX …)` drops `status/fields/cause` (vs `apps/web/lib/ragx-api.ts:6-15 ApiError`).
- `:606-611` `retrieve(query:string)` breaks object-form callers; `search` guard saves null-deref today but typing lies (`request<T>` can return `null`).
- `deleteDocument` encoding correct (`encodeURIComponent`) — no fix needed.

**Fix:** trim/store correctly, handle `{success,data,error}` envelope fail-closed, normalize errors with `status`, align `retrieve/search` signatures, verify against live API.

### #17 Unify API base URL and response envelope — `sdk, backend, frontend, bug`
- SDK default `https://api.ragx.dev` (`packages/sdk/src/index.ts:39`) vs web `http://localhost:3000/api/v1` (`apps/web/lib/ragx-api.ts:3-4`) vs API `/api/v1/*` + `/v1` document-only alias (`apps/api/src/app.ts:31-37`) → SDK `/v1/knowledge-bases/*` 404s, web `/projects/:id/documents` has no SDK equiv.
- Envelopes: API `{success,message,data}` / `{success:false,message}`; web expects `{success,message,errors,data}` (always `undefined`); SDK expects `{message,data}` (ignores `success`).

**Fix:** define canonical base + `{success,data,error}` envelope; fix `/v1` alias to cover all routes or remove it; make SDK/web/API agree.

---

## P1 — Monorepo / Build

### #18 Make all packages buildable with Turbo — `build, infra`
- `packages/sdk|types|ui/package.json` no `build` scripts; `apps/api/package.json:12` `build: tsc --noEmit` (no artifact, `start: bun index.ts` runs source); `turbo.json:5-8` outputs only `.next/**` (no `dist/**`); `packages/ui: generate:component: turbo gen` with no generator; `apps/api/.turbo/*.log` stale.

**Fix:** add `build → dist` per package, update Turbo `outputs: [dist/**, .next/**]`, ensure `turbo run build` + caching pass.

### #19 Unify TypeScript module configuration — `build, dx`
- `packages/typescript-config/base.json:10-12` `NodeNext/NodeNext` vs `nextjs.json:6-7` `ESNext/Bundler` vs `apps/api/tsconfig.json:6,22` `Preserve/bundler + allowImportingTsExtensions`; `jsx: react-jsx` vs `preserve`; root `type:commonjs` vs workspaces `type:module` + dangling `main:index.js`; `engines: node>=24` + `devEngines: bun@1.4.2`.
- `apps/api/tsconfig paths @/*…` with no `baseUrl`/`bunfig`/`tsc-alias` → future emit breaks.

**Fix:** one module/resolution strategy per target (API/SDK/types/UI/web/docs), fix path aliases for emit.

### #20 Fix SDK Node.js type/runtime dependencies — `sdk, build`
- `packages/sdk/src/index.ts:2-3`, `loader.ts:2-3` static `node:fs/promises`, `node:path`, `Buffer` → breaks browser bundles; `src/node.d.ts:6-27` hand-rolled shim (incomplete overloads) instead of `@types/node` (absent from SDK deps).

**Fix:** add `@types/node`, dynamic-import Node-only paths / split node vs browser entry, ensure published `.d.ts` don’t reference unavailable types, verify Node + Bun.

### #21 Clean API dependencies — `backend, build, infra`
- Unused prod deps (0 imports in `src/**/*.ts`): `add@2.0.9` (stray artifact), `bun@1.4.2` (only `bun:test`), `rexa-agent@2.0.1` (pulls prisma/ink/keytar/winston), `sharp@0.35.4` (native libvips, unused), `unpdf@1.8.1` (PDF uses `pdf-parse`).
- Used — do NOT remove: `tiktoken` (`fixed.token.chunking.ts:1`), `pdf-parse`, `mammoth`, `csv-parse`, `cheerio`.
- `drizzle-kit` in `dependencies` (should be dev), `tsx` unused (scripts use `bun --watch`).

**Fix:** remove/audit unused, move dev-only deps, verify deployment compat (native modules, WASM).

---

## Dashboard

### #22 Connect dashboard to the real RAGX API — `frontend, backend`
- `apps/web/components/dashboard/data.ts:57-114` hardcoded (`Swap these imports for fetch() when backend is wired`); `dashboard/page.tsx:10-27` metrics/flow literals; `projects/page.tsx:22-35`, `collections/page.tsx:22-30` local `create()`; `search/page.tsx:101` `setTimeout 1100` + `chunks.slice(0,3)`; `chunks/page.tsx:6`, `usage/page.tsx:64-69`, `settings/page.tsx:14-100` static; only `documents/page.tsx:77-155` uses real `ragxApi` + polling.

**Fix:** replace mocks for projects/documents/search/ask/KB/usage/settings/API keys with `lib/ragx-api.ts`.

### #23 Remove duplicated frontend API types — `frontend, dx`
- `apps/web/lib/ragx-api.ts:17-44` re-declares `Project/ApiDocument/BatchDocumentSummary`; `components/dashboard/data.ts:1-55`, `ui.tsx:25`, `dashboard/documents/page.tsx:15` redefine `Project/DocItem/Collection/Chunk/ApiKey` with `status: ready|processing|failed`.

**Fix:** import from `@repo/types`, delete local duplicates.

### #24 Fix dashboard/API contract mismatches — `frontend, bug`
- `PENDING vs processing`, `COMPLETED vs ready` (`data.ts:15,68-71` vs `schema.ts:121-122`); `documents/page.tsx:30-53` maps correctly but seeds never emit canonical values.
- `ragx_live_` vs `rgx_` mocks (never match `secret.scanner.ts:23`).
- `retrieve({query})` object form, `minScore/rerank` local-only (`settings:98-100`, `page.tsx:439`) dropped by SDK/API (`document.validation.ts:40-53` only `topK,knowledgeBase`).
- `/api/v1` vs `/v1` prefix mismatch (#17).

**Fix:** emit canonical statuses/prefixes, remove unsupported `minScore` or implement it server-side.

---

## P2 — Production quality

### #25 Improve API error classification — `backend, bug`
- `project.controller.ts:92,164,…`, `provider.controller.ts:45,86,…`, `document.controller.ts:151,261,…`, `knowledge-base.controller.ts:106,132,…` all `getStatusCode(error,404)` → DB outage / storage / embedding / decrypt failures surface as `404`. Only `upload/list/search/ask` use `500` fallback.
- `Utils/httpError.ts:152-158` + `Middlewares/error.middleware.ts:40-42` `console.error(error)` logs raw pg/provider errors (possible secrets/document text).

**Fix:** map `400/401/403/404/409/413/422/429/500/502/503` correctly; redact logs; never `404` on infra failure.

### #26 Harden guardrails and secret scanning — `security, backend`
- `Guardrails/secret.scanner.ts:20-42` allowlist misses `xoxb-/sk_live-/AWS secret/Azure/Slack/high-entropy/connection-string-without-password`; bypass → credentials sent to `aiGuard.models.generateContent` (`output.guardrail.ts:55-62` only skips on hit).
- `:79,51-57` exact `includes` misses base64/hex/URL-encoded/chunked; placeholder heuristic weak.
- `output.guardrail.ts:92-100` `review` on exception/invalid JSON requires caller enforcement (`retrieval.services.ts:197-220` fail-closed today, future callers may treat as `allow`).

**Fix:** expand detectors, never send live provider credentials to Gemini, explicit fail-closed contract, document heuristic limits.

### #27 Harden provider/runtime configuration — `security, backend`
- `provider.validation.ts:3-6` `embeddingConfigSchema provider: enum(openai,mistral)` excludes `gemini` supported in `registry.ts:14` → forces per-request keys (exposure).
- `resolution.ts:41-54` arbitrary model/key passthrough; `registry.ts:21-27` reflects provider name; no startup/request-boundary config validation.

**Fix:** validate model charset/length, validate/sanitize headers, reject CRLF, encode model in URL, validate keys, unify stored vs header config.

### #28 Add database constraints and indexes — `database, backend, performance`
- `DB/schema.ts:26-132` missing indexes on `project.userId`, `document.projectId`, `api-keys.projectId` (FKs without index → full scans); `document_chunk` needs composite `(projectId,documentId)` for `listChunksByDocuments`; `document.status` (`listStuckDocuments`) unindexed.
- Missing `UNIQUE(projectId,name)` (projects/KBs/keys allow dupes); no `CHECK(status)` / `CHECK(size>=0)` — any string storable.
- Table `"api-keys"` hyphenated (quoting pain) + mixed `camelCase` vs `snake_case`; `drizzle.config.ts:13` `process.env.DATABASE_URL!` outside `envConfig`; `apps/api/.gitignore:3` ignores `drizzle/` (migrations unversioned); `_journal.json` out of sync (4 entries vs 2 extra migration files on disk).

**Fix:** add indexes/constraints, rename to `api_keys`, version migrations, sync journal.

### #29 Fix storage security and HTML handling — `security, backend, ingestion`
- `objectStorage.ts` realpath/symlink/root/empty-key gaps (#3); `STORAGE_DIR` relative/CWD-dependent, only `mkdir` on `upload`, never validated at boot (`index.ts:27-40`).
- Stored HTML parsers extract text but stored originals + retrieved chunks risk XSS if rendered as HTML downstream.

**Fix:** realpath + symlink protection + root validation + empty-key rejection + boot `stat/mkdir` + `STORAGE_DIR` absolute-path validation; sanitize/escape HTML on render.

### #30 Add pagination and query limits — `backend, database, performance`
- No `LIMIT/OFFSET` / `page/perPage` anywhere (grep only `topK` clamp `max(20)`): `document.repo: listByProject/listChunksByProject/listChunksByDocuments`, `project.repo: findByUserId/getApiKeys`, `knowledge-base.repo: listByProject/listDocumentIds`; controllers expose directly (`document.controller: list/dashboardList`, `project.controller`).

**Fix:** paginate all lists (limit/default/max + cursor/offset + `ORDER BY`), cap `topK≤20` already done — extend to lists.

---

## Umbrella

### #31 RAGX v0.1 production readiness audit — `infra, dx`
- [ ] Security (#1–#5, #26–#27, #29) closed
- [ ] Tenant isolation verified (#2)
- [ ] Ingestion tested (#6–#8)
- [ ] Chunking tested (#9–#10)
- [ ] pgvector working (#12)
- [ ] SDK builds + publish tested (#14–#16)
- [ ] Fresh external project works (#14, #17)
- [ ] Dashboard uses real API (#22–#24)
- [ ] API contracts aligned (#13, #17)
- [ ] Docker build works (no `Dockerfile/compose`, no `SIGTERM` draining `index.ts:42-43`, no healthcheck/volume)
- [ ] Production env validation works (#1)
- [ ] Error handling verified (#25)
- [ ] Integration tests pass
- [ ] README matches reality (#13)

**Freeze features until above is green. No new reranker / chunking strategies / agents / dashboard features.**

---

## Suggested labels / milestone
`security, bug, backend, database, ingestion, retrieval, sdk, frontend, build, dx, docs, infra, performance`
Milestone: `RAGX v0.1 — Production Hardening`
