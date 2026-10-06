import { ProviderUpstreamError } from "./provider";

/**
 * Shared safety primitives for provider configuration and upstream calls.
 *
 * Two trust boundaries are guarded here:
 * 1. Stored configuration (dashboard): Qdrant URLs and pgvector
 *    connection strings are persisted encrypted and later dialed by a
 *    vector-store driver — a stored `http://169.254.169.254/` would be a
 *    stored SSRF against the cloud metadata service. Validation rejects
 *    loopback, private, link-local, and other non-public targets.
 * 2. Per-request SDK headers + upstream fetch: provider keys and model
 *    names are caller-controlled, so control characters are rejected,
 *    model names are allow-listed before interpolation into the Gemini
 *    URL path, and every upstream call carries a timeout so a hanging
 *    provider cannot pin the document queue (CONCURRENCY=2) forever.
 *
 * NOTE (documented limitation): hostname allow-listing is literal-only.
 * A public-resolving DNS name (`evil.example.com → 127.0.0.1`), a
 * single-label docker name (`http://qdrant:6333`), or DNS rebinding
 * cannot be judged without resolving at request time. Runtime egress
 * controls (no metadata access, private-link firewalling) remain the
 * backstop; this module closes the trivially-exploitable literal cases.
 * Self-hosters pointing at docker-internal names keep working.
 */

// Matches the guardrail model's own 30s budget.
export const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_MODEL_NAME_LENGTH = 100;
export const MAX_HEADER_KEY_LENGTH = 500;

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const CONTROL_CHARS_PATTERN = /[\x00-\x1f\x7f]/;

/** Model allow-list: `text-embedding-3-small`, `mistral-embed`, … */
export function isValidModelName(model: string): boolean {
  return (
    typeof model === "string" &&
    model.length > 0 &&
    model.length <= MAX_MODEL_NAME_LENGTH &&
    MODEL_NAME_PATTERN.test(model)
  );
}

/** Header/key hygiene: bounded, no CRLF or other control characters. */
export function isSafeHeaderValue(value: string, maxLength: number): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARS_PATTERN.test(value)
  );
}

/**
 * Validate then percent-encode a model name for URL-path interpolation
 * (Gemini `.../models/${model}:…`). Throws when the name is not
 * allow-listed, so `x?foo=bar` or `../` can never alter the path/query.
 */
export function encodeModelPathSegment(model: string): string {
  if (!isValidModelName(model)) {
    throw new Error("Invalid provider model name");
  }
  return encodeURIComponent(model);
}

function parseIPv4ToInt(host: string): number | null {
  // inet_aton-style: 1-4 parts, each decimal, octal (leading 0), or hex
  // (0x). Covers `127.0.0.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`.
  const trimmed = host.trim();
  if (trimmed.length === 0) return null;
  if (/^[0-9]+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    return n;
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const n = Number.parseInt(trimmed, 16);
    if (n < 0 || n > 0xffffffff) return null;
    return n;
  }
  const parts = trimmed.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const values: number[] = [];
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*|0)$/i.test(part)) return null;
    let n: number;
    if (/^0x/i.test(part)) n = Number.parseInt(part, 16);
    else if (/^0[0-9]+$/.test(part)) n = Number.parseInt(part, 8);
    else n = Number.parseInt(part, 10);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    values.push(n);
  }
  if (values.length === 1) return values[0]!;
  if (values.some((v) => v > 255)) return null;
  let result = 0;
  if (values.length === 2) {
    if (values[1]! > 0xffffff) return null;
    result = values[0]! * 0x1000000 + values[1]!;
  } else if (values.length === 3) {
    if (values[2]! > 0xffff) return null;
    result = values[0]! * 0x1000000 + values[1]! * 0x10000 + values[2]!;
  } else {
    result =
      values[0]! * 0x1000000 +
      values[1]! * 0x10000 +
      values[2]! * 0x100 +
      values[3]!;
  }
  return result >>> 0;
}

function isBlockedIPv4Int(ip: number): boolean {
  const inCidr = (base: number, bits: number): boolean => {
    const mask =
      bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((ip ^ base) & mask) === 0;
  };
  return (
    inCidr(0x7f000000, 8) || // 127.0.0.0/8 loopback
    inCidr(0x0a000000, 8) || // 10.0.0.0/8 private
    inCidr(0xac100000, 12) || // 172.16.0.0/12 private
    inCidr(0xc0a80000, 16) || // 192.168.0.0/16 private
    inCidr(0xa9fe0000, 16) || // 169.254.0.0/16 link-local (incl. metadata)
    inCidr(0x64400000, 10) || // 100.64.0.0/10 carrier-grade NAT
    inCidr(0xe0000000, 4) || // 224.0.0.0/4 multicast
    inCidr(0x00000000, 8) || // 0.0.0.0/8 "this network"
    inCidr(0xf0000000, 4) || // 240.0.0.0/4 reserved
    inCidr(0xc0000200, 24) || // 192.0.2.0/24 TEST-NET-1
    inCidr(0xc6336400, 24) || // 198.51.100.0/24 TEST-NET-2
    inCidr(0xcb007100, 24) || // 203.0.113.0/24 TEST-NET-3
    ip === 0xffffffff // 255.255.255.255 broadcast
  );
}

function expandIPv6(host: string): number[] | null {
  // Returns 8 hextets or null when malformed.
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parseGroup = (group: string): number[] | null => {
    if (group === "") return [];
    const out: number[] = [];
    for (const part of group.split(":")) {
      if (part.includes(".")) {
        // Embedded IPv4 (e.g. ::ffff:127.0.0.1).
        const v4 = parseIPv4ToInt(part);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
        out.push(Number.parseInt(part, 16));
      }
    }
    return out;
  };
  if (halves.length === 1) {
    const full = parseGroup(halves[0]!);
    return full && full.length === 8 ? full : null;
  }
  const head = parseGroup(halves[0]!);
  const tail = parseGroup(halves[1]!);
  if (!head || !tail || head.length + tail.length > 7) return null;
  return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
}

function isBlockedIPv6(host: string): boolean {
  const groups = expandIPv6(host);
  if (!groups) return true; // Malformed literals are refused, not dialed.
  const first = groups[0]!;
  if (groups.every((g) => g === 0)) return true; // ::
  if (
    groups.slice(0, 7).every((g) => g === 0) &&
    groups[7] === 1
  )
    return true; // ::1 loopback
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (
    groups.slice(0, 5).every((g) => g === 0) &&
    groups[5] === 0xffff
  ) {
    // ::ffff:0:0/96 mapped — judge the embedded IPv4.
    const embedded = ((groups[6]! << 16) | groups[7]!) >>> 0;
    return isBlockedIPv4Int(embedded);
  }
  return false;
}

/**
 * True for hostnames that must never be dialed from stored configuration:
 * localhost variants, IP literals (v4 incl. decimal/hex/octal encodings,
 * v6 incl. mapped forms) in loopback/private/link-local/reserved ranges.
 * Plain DNS names and single-label docker names are allowed here (see
 * module note) — runtime egress controls remain the backstop for those.
 */
export function isBlockedHost(hostname: string): boolean {
  // `URL.hostname` keeps IPv6 brackets (`[::1]`) — strip them before the
  // literal checks, or every v6 literal would bypass the block-list.
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
  if (host.length === 0) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = parseIPv4ToInt(host);
  if (v4 !== null) return isBlockedIPv4Int(v4);
  if (/^[0-9a-f:.]+$/i.test(host) && host.includes(":")) {
    return isBlockedIPv6(host);
  }
  return false;
}

/** Public http(s) URL whose host is not block-listed. */
export function isPublicHttpUrl(value: string): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Credentials in the URL leak into logs and error messages; Qdrant
  // Cloud authenticates via API-key header instead.
  if (url.username || url.password) return false;
  if (CONTROL_CHARS_PATTERN.test(value)) return false;
  return !isBlockedHost(url.hostname);
}

/**
 * pgvector connection-string gate. Absent/empty means the managed local
 * database (preferred). When present it must be an explicit TCP postgres
 * URL with a public host — no local sockets, no internal addresses.
 */
export function isSafeConnectionString(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (CONTROL_CHARS_PATTERN.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return false;
  }
  if (!url.hostname) return false;
  return !isBlockedHost(url.hostname);
}

/**
 * Upstream fetch with a hard timeout. Timeouts and unreachable transports
 * are retryable (same instance/key/model); HTTP statuses are classified
 * by `readJsonResponse` as before.
 */
export async function fetchWithTimeout(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    throw new ProviderUpstreamError(
      provider,
      timedOut ? "timed out" : "unreachable",
      { retryable: true },
    );
  }
  return res;
}
