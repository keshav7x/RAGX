// NOTE: shared HTTP error hierarchy for the API layer.
//
// Controllers map these to status codes via `getStatusCode()`; the global
// error middleware (`src/middleware/error.middleware.ts`) is the final
// backstop for errors that escape controller try/catch blocks. Domain
// modules (ingestion, providers) throw subclasses of HttpError so the HTTP
// layer never has to inspect provider-specific error shapes.
//
// WHY: a single `HttpError` base with explicit subclasses keeps error
// handling predictable across Auth / Projects / Documents / Providers
// without leaking provider messages, API keys, or document contents.

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Invalid request") {
    super(400, message);
  }
}

// Alias kept for validation failures so services can throw a semantic
// error without importing HTTP status codes directly.
export class ValidationError extends BadRequestError {
  constructor(message = "Validation failed") {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

// Alias kept so auth code reads as domain language (`throw new
// AuthenticationError(...)`) while preserving the 401 wire contract.
export class AuthenticationError extends UnauthorizedError {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

// Alias kept so authorization checks read as domain language while
// preserving the 403 wire contract.
export class AuthorizationError extends ForbiddenError {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super(404, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Resource already exists") {
    super(409, message);
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message = "Payload too large") {
    super(413, message);
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor(message = "Unsupported media type") {
    super(415, message);
  }
}

// Thrown when a document cannot be processed (parse/clean/chunk/embed
// failure). Controllers surface only the safe `message`; the optional
// `cause` stays server-side for logs.
export class ProcessingError extends HttpError {
  constructor(message = "Document processing failed", options?: { cause?: unknown }) {
    super(422, message);
    this.name = "ProcessingError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// Thrown when an upstream embedding/chat provider fails. The message must
// stay generic (no keys, no request bodies); details belong in `cause`.
export class ProviderError extends HttpError {
  constructor(message = "Embedding provider failed", options?: { cause?: unknown }) {
    super(502, message);
    this.name = "ProviderError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

/**
 * Body-parser limit errors (e.g. `entity.too.large`) are plain Errors with
 * a `status`/`type` shape, not `HttpError`s. Detect them centrally so an
 * oversized upload or batch surfaces as a clean 413 instead of a 500 —
 * without any route touching body-parser internals.
 */
export function isPayloadTooLargeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record["status"] === 413 || record["type"] === "entity.too.large";
}

export function getStatusCode(error: unknown, fallback = 500): number {
  if (error instanceof HttpError) {
    return error.statusCode;
  }
  if (isPayloadTooLargeError(error)) {
    return 413;
  }
  return fallback;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    return error.message;
  }
  if (isPayloadTooLargeError(error)) {
    // Static message: the parser error carries limits, never content —
    // and there is nothing to gain from logging it.
    return "Request body too large.";
  }
  if (error instanceof Error) {
    //! Never forward raw provider/DB messages to clients — they may
    // contain keys, connection strings, or document contents. Log
    // server-side and return the safe fallback instead.
    console.error(error);
  }
  return fallback;
}
