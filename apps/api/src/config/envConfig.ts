// NOTE: Centralized environment/configuration layer.
//
// All server code must read configuration from `envConfig` — never from
// `process.env` directly (except this module and `drizzle.config.ts`, which
// runs outside the app lifecycle). This keeps required-variable validation,
// insecure-default warnings, and secret handling in exactly one place.
//
// WHY: scattered `process.env.X` reads make missing-variable failures
// surface deep inside request handling instead of at startup, and make it
// easy to accidentally expose server secrets to client bundles.

export interface AppConfig {
  DATABASE_URL: string;
  PORT: number;
  JWT_SECRET: string;
  NODE_ENV: string;
  JWT_EXPIRES_IN: string;
  RAGX_ENCRYPTION_KEY: string;
  GEMINI_GUARD_API_KEY: string;
  WEB_APP_URL: string;
  STORAGE_DIR: string;
}

export const JWT_ALGORITHM = "HS256" as const;
export const JWT_ISSUER = "ragx-api";
export const MIN_JWT_SECRET_LENGTH = 32;
export const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const INSECURE_JWT_SECRETS = new Set([
  "",
  "change-me-in-production",
  "changeme",
  "secret",
  "test",
  "dev-only-secret-change-in-production",
]);

function readEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value !== undefined && value.length > 0) return value;
  return fallback;
}

function readRequiredEnv(name: string): string | undefined {
  const value = readEnv(name);
  // NOTE: warn instead of throwing so `bun test` / `turbo check-types`
  // work without a live database. The database layer throws a clear error
  // only when a connection is actually attempted. Production boot calls
  // `validateStartupConfig()` (see index.ts) which throws instead.
  if (value === undefined) {
    console.warn(`[config] ${name} is not set; using empty placeholder until configured.`);
    return "";
  }
  return value;
}

/**
 * Parse jsonwebtoken-style `expiresIn` ("60", "60s", "15m", "12h", "7d", "1w")
 * into milliseconds for cookie alignment. Returns null when malformed.
 */
export function parseExpiresInToMs(value: string): number | null {
  const raw = (value ?? "").trim();
  if (raw.length === 0) return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
    return seconds * 1000;
  }
  const match = /^(\d+)\s*([smhdw])$/i.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return amount * multipliers[unit]!;
}

export function isStrongJwtSecret(secret: string): boolean {
  if (!secret || INSECURE_JWT_SECRETS.has(secret)) return false;
  return secret.length >= MIN_JWT_SECRET_LENGTH;
}

/**
 * Central live reader for the encryption key. This module is the only place
 * (besides `drizzle.config.ts`, which runs outside the app lifecycle) allowed
 * to read `process.env` directly, so tests and key rotation can set the
 * variable after import while all other code reads it from here.
 */
export function resolveRagxEncryptionKeyRaw(): string {
  const live = process.env.RAGX_ENCRYPTION_KEY;
  if (live !== undefined && live.length > 0) return live;
  return envConfig.RAGX_ENCRYPTION_KEY;
}

function isValidEncryptionKeyRaw(raw: string): boolean {
  if (!raw) return false;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true;
  if (raw.length >= 40) {
    try {
      if (Buffer.from(raw, "base64").length === 32) return true;
    } catch {
      // fall through to utf8 check
    }
  }
  return Buffer.from(raw, "utf8").length === 32;
}

/** Cookie lifetime derived from JWT lifetime so sessions expire together. */
export function getAuthCookieMaxAgeMs(): number {
  const parsed = parseExpiresInToMs(envConfig.JWT_EXPIRES_IN);
  if (parsed === null) {
    console.warn(
      `[config] JWT_EXPIRES_IN=${JSON.stringify(envConfig.JWT_EXPIRES_IN)} is malformed; falling back to 7d for cookie maxAge.`,
    );
    return DEFAULT_AUTH_COOKIE_MAX_AGE_MS;
  }
  return parsed;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `[config] PORT=${JSON.stringify(value)} is invalid; expected an integer between 1 and 65535.`,
    );
  }
  return port;
}

//! Never log envConfig itself: it contains database credentials, JWT secrets,
// encryption keys, and API keys. Log only individual non-secret fields.
export const envConfig: AppConfig = {
  DATABASE_URL: readRequiredEnv("DATABASE_URL") ?? "",
  PORT: parsePort(readEnv("PORT", "3000")),
  // NOTE: the insecure fallback only keeps `bun test` / typechecks working
  // without env. Production boot rejects it via `validateStartupConfig()`.
  JWT_SECRET: readEnv("JWT_SECRET", "change-me-in-production")!,
  NODE_ENV: readEnv("NODE_ENV", "development")!,
  JWT_EXPIRES_IN: readEnv("JWT_EXPIRES_IN", "7d")!,
  RAGX_ENCRYPTION_KEY: readEnv("RAGX_ENCRYPTION_KEY", "")!,
  GEMINI_GUARD_API_KEY: readEnv("GEMINI_GUARD_API_KEY", "")!,
  WEB_APP_URL: readEnv("WEB_APP_URL", "http://localhost:3000")!,
  // NOTE: `RAGX_STORAGE_DIR` is the canonical variable. `STORAGE_DIR` is
  // accepted as a legacy alias so existing deployments keep working.
  STORAGE_DIR:
    readEnv("RAGX_STORAGE_DIR", readEnv("STORAGE_DIR", "./storage"))!,
};

/**
 * Fail-closed startup validation. Called once from the server entry before
 * `app.listen` (never at import, so tests/typechecks stay side-effect free).
 * Production throws on missing/weak secrets and malformed values;
 * development/test warn instead, except for values that would crash anyway
 * (PORT, JWT_EXPIRES_IN), which always throw.
 */
export function validateStartupConfig(): void {
  // Always fail fast: a NaN/out-of-range port or unparsable expiry is a
  // config bug in every environment (jsonwebtoken would 500 per request).
  envConfig.PORT = parsePort(process.env.PORT ?? String(envConfig.PORT));
  if (parseExpiresInToMs(envConfig.JWT_EXPIRES_IN) === null) {
    throw new Error(
      `[config] JWT_EXPIRES_IN=${JSON.stringify(envConfig.JWT_EXPIRES_IN)} is invalid; expected seconds ("3600") or a number with s/m/h/d/w suffix ("15m", "12h", "7d").`,
    );
  }

  const isProd = envConfig.NODE_ENV === "production";
  const problems: string[] = [];

  if (!envConfig.DATABASE_URL) {
    problems.push("DATABASE_URL is missing");
  }
  if (!isStrongJwtSecret(envConfig.JWT_SECRET)) {
    problems.push(
      `JWT_SECRET is missing, known-insecure, or shorter than ${MIN_JWT_SECRET_LENGTH} chars`,
    );
  }
  if (!isValidEncryptionKeyRaw(resolveRagxEncryptionKeyRaw())) {
    problems.push(
      "RAGX_ENCRYPTION_KEY is missing or not 32 bytes (64 hex chars, base64, or 32 raw chars; generate with: openssl rand -hex 32)",
    );
  }

  if (problems.length === 0) return;

  const message = `[config] invalid production configuration: ${problems.join("; ")}`;
  if (isProd) {
    throw new Error(message);
  }
  for (const problem of problems) {
    console.warn(`[config] ${problem}; continuing because NODE_ENV=${envConfig.NODE_ENV}.`);
  }
}

export const isProduction = envConfig.NODE_ENV === "production";
