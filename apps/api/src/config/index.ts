// NOTE: config barrel — single import point for app configuration.
// New code should `import { db, envConfig } from "@/config"` instead of
// reaching into per-file paths or `process.env` directly.
export { db } from "./database";
export {
  DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
  JWT_ALGORITHM,
  JWT_ISSUER,
  MIN_JWT_SECRET_LENGTH,
  envConfig,
  getAuthCookieMaxAgeMs,
  isProduction,
  isStrongJwtSecret,
  parseExpiresInToMs,
  resolveRagxEncryptionKeyRaw,
  validateStartupConfig,
} from "./envConfig";
export type { AppConfig } from "./envConfig";
