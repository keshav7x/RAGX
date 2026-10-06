import {
  accessSync,
  constants,
  mkdirSync,
} from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import { envConfig, getStorageDir } from "@/config/envConfig";

/**
 * Object storage abstraction. The ingestion pipeline depends only on
 * this interface — never on a concrete provider. Binaries live here;
 * PostgreSQL stores only the `objectKey` reference.
 *
 * Swap the driver in `getObjectStorage()` for S3/R2/MinIO later
 * without touching the pipeline.
 */
export interface ObjectStorage {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Storage key for a document original. Tenant-scoped by construction. */
export function documentObjectKey(projectId: string, documentId: string): string {
  return `projects/${projectId}/documents/${documentId}/original`;
}

// Uploads are capped by the document pipeline (15MB), so downloads must
// never return more than that: a stored object replaced out of band is
// rejected instead of being buffered unboundedly into memory.
export const MAX_OBJECT_BYTES = 15 * 1024 * 1024;
const MAX_KEY_LENGTH = 512;

/**
 * Lexical key gate. Production keys are server-generated UUID paths
 * (`documentObjectKey`) and never contain user input, but every entry
 * point validates anyway so a future caller cannot smuggle traversal,
 * absolute paths, or NUL bytes past `path.resolve`.
 */
function assertValidKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new Error("Invalid storage key");
  }
  if (path.isAbsolute(key) || key.includes("\0")) {
    throw new Error("Invalid storage key");
  }
  if (key.split("/").some((segment) => segment === "..")) {
    throw new Error("Invalid storage key");
  }
}

/**
 * Filesystem driver (dev / single-node). Keys are jailed lexically and
 * re-verified against the real (symlink-resolved) storage root after
 * creating the parent directory, so a planted symlink can neither pull
 * reads/writes outside the root nor be followed on download/delete.
 * Writes are atomic (temp file + rename) so a concurrent download never
 * observes a partial object.
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly rootDir: string;
  private realRoot: string | null = null;

  constructor(rootDir: string) {
    if (!rootDir || rootDir.trim().length === 0) {
      throw new Error("Invalid storage key");
    }
    const absolute = path.resolve(rootDir);
    if (absolute === path.parse(absolute).root) {
      throw new Error("Invalid storage key");
    }
    this.rootDir = absolute;
  }

  private async getRealRoot(): Promise<string> {
    if (!this.realRoot) {
      await mkdir(this.rootDir, { recursive: true });
      this.realRoot = await realpath(this.rootDir);
    }
    return this.realRoot;
  }

  /**
   * Lexical resolve + parent realpath containment check. The parent is
   * created first so `realpath` never fails on a fresh tenant prefix;
   * the target itself is then `lstat`-checked by the caller (symlinks
   * and directories are refused) to close the file-symlink hole that a
   * parent-only check would leave open.
   */
  private async resolveWithinRoot(key: string): Promise<string> {
    assertValidKey(key);
    const root = path.resolve(this.rootDir);
    const filePath = path.resolve(root, key);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      throw new Error("Invalid storage key");
    }
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const [realDir, realRoot] = await Promise.all([
      realpath(dir),
      this.getRealRoot(),
    ]);
    if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return path.join(realDir, path.basename(filePath));
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<void> {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new Error("Invalid storage key");
    }
    if (data.length > MAX_OBJECT_BYTES) {
      throw new Error(
        `Object exceeds the ${MAX_OBJECT_BYTES} byte limit`,
      );
    }
    const filePath = await this.resolveWithinRoot(key);
    // Refuse to overwrite symlinks or directories planted at the target
    // (`lstat` does not follow links, unlike `stat`).
    const existing = await lstat(filePath).catch(() => null);
    if (existing && (existing.isSymbolicLink() || existing.isDirectory())) {
      throw new Error("Invalid storage key");
    }
    // NOTE: a file-symlink swapped in between this check and the rename
    // (TOCTOU) is not fully excluded. Production keys are random UUIDs,
    // so a planted link cannot be predicted; a privileged-attacker model
    // needs an S3-style driver instead.
    const dir = path.dirname(filePath);
    const tmpPath = path.join(
      dir,
      `.tmp-${crypto.randomBytes(8).toString("hex")}`,
    );
    try {
      await writeFile(tmpPath, data, { mode: 0o600 });
      await rename(tmpPath, filePath);
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  async download(key: string): Promise<Buffer> {
    const filePath = await this.resolveWithinRoot(key);
    // `lstat` first: refuse symlinks and directories without following
    // them; `stat` afterwards gives the real file size.
    const link = await lstat(filePath).catch(() => null);
    if (!link || link.isSymbolicLink() || !link.isFile()) {
      throw new Error(`Object not found: ${key}`);
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      throw new Error(`Object not found: ${key}`);
    }
    if (info.size > MAX_OBJECT_BYTES) {
      throw new Error(
        `Object exceeds the ${MAX_OBJECT_BYTES} byte limit`,
      );
    }
    const data = await readFile(filePath);
    // Re-check after the read: the file may have grown between stat and
    // read (TOCTOU). Never buffer more than the cap.
    if (data.length > MAX_OBJECT_BYTES) {
      throw new Error(
        `Object exceeds the ${MAX_OBJECT_BYTES} byte limit`,
      );
    }
    return data;
  }

  async delete(key: string): Promise<void> {
    const filePath = await this.resolveWithinRoot(key);
    const info = await lstat(filePath).catch(() => null);
    // Idempotent: missing objects are a no-op (the DB row is authoritative).
    if (!info) return;
    // Never unlink directories; unlinking a symlink removes the link
    // itself, never its target.
    if (info.isDirectory()) {
      throw new Error("Invalid storage key");
    }
    await unlink(filePath).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = await this.resolveWithinRoot(key);
      const info = await lstat(filePath);
      return info.isFile() && !info.isSymbolicLink();
    } catch {
      return false;
    }
  }
}

let singleton: ObjectStorage | null = null;

/** Process-wide driver. Override in tests via `resetObjectStorage()`. */
export function getObjectStorage(): ObjectStorage {
  if (!singleton) {
    singleton = new LocalObjectStorage(getStorageDir());
  }
  return singleton;
}

export function resetObjectStorage(driver?: ObjectStorage | null): void {
  singleton = driver ?? null;
}

/**
 * Boot check (called once from the server entry, never from tests):
 * resolves the configured dir, creates it, and proves writability.
 * Throws on any failure — the caller decides fail-closed (production)
 * vs warn-and-continue (development).
 */
export function ensureStorageDir(): string {
  const dir = getStorageDir();
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.W_OK);
  // Prove the jail itself resolves before serving traffic.
  if (!envConfig.STORAGE_DIR) {
    throw new Error("[storage] STORAGE_DIR is not configured");
  }
  return dir;
}
