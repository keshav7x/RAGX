import crypto from "node:crypto";

import { resolveRagxEncryptionKeyRaw } from "@/config/envConfig";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = "v1";
// Refuse absurdly large payloads before base64-decoding them into memory.
const MAX_ENCRYPTED_PAYLOAD_CHARS = 64 * 1024;

function resolveKey(): Buffer {
  // Read at call time (not import time) so tests and key rotation
  // can set the variable before first use. `envConfig` is the only module
  // allowed to touch `process.env`; everything else reads it from here.
  const raw = resolveRagxEncryptionKeyRaw();

  if (!raw) {
    throw new Error(
      "RAGX_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }

  // Accept 64-char hex, 44-char base64, or a raw 32-char secret.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const asBase64 = Buffer.from(raw, "base64");
  if (raw.length >= 40 && asBase64.length === KEY_BYTES) {
    return asBase64;
  }

  const asUtf8 = Buffer.from(raw, "utf8");
  if (asUtf8.length === KEY_BYTES) {
    return asUtf8;
  }

  throw new Error(
    "RAGX_ENCRYPTION_KEY must be 32 bytes (64 hex chars, base64, or 32 raw chars)",
  );
}

/**
 * Authenticated encryption for provider credentials (AES-256-GCM).
 * Server-side only. Never log inputs or outputs.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt an empty secret");
  }

  const key = resolveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("Invalid encrypted payload");
  }
  if (payload.length > MAX_ENCRYPTED_PAYLOAD_CHARS) {
    throw new Error("Invalid encrypted payload");
  }
  const [prefix, ivB64, tagB64, dataB64] = payload.split(".");

  if (prefix !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload");
  }

  const key = resolveKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

  return (
    decipher.update(Buffer.from(dataB64, "base64url")).toString("utf8") +
    decipher.final("utf8")
  );
}
