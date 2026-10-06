import { describe, expect, it } from "bun:test";

import { resolveRequestProvider } from "./resolution";
import {
  encodeModelPathSegment,
  isBlockedHost,
  isPublicHttpUrl,
  isSafeConnectionString,
  isSafeHeaderValue,
  isValidModelName,
} from "./safety";

describe("provider request safety", () => {
  it("blocks internal hosts while allowing public ones", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "a.localhost",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "2130706433",
      "0x7f000001",
      "0177.0.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "::ffff:127.0.0.1",
      "fe80::1",
      "fc00::1",
      "",
    ]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
    for (const host of [
      "xyz.cloud.qdrant.io",
      "db.example.com",
      "93.184.216.34",
      "8.8.8.8",
      "2001:db8::1",
      "qdrant",
    ]) {
      expect(isBlockedHost(host), host).toBe(false);
    }
  });

  it("accepts only public http(s) URLs without credentials", () => {
    expect(isPublicHttpUrl("https://xyz.cloud.qdrant.io")).toBe(true);
    expect(isPublicHttpUrl("http://93.184.216.34:6333")).toBe(true);
    for (const url of [
      "http://localhost:6333",
      "http://127.0.0.1:6333",
      "http://169.254.169.254/",
      "ftp://files.example.com/x",
      "https://user:pass@xyz.cloud.qdrant.io",
      "not-a-url",
      "https://qdrant.local:6333/x\r\ninjected",
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it("gates connection strings to public TCP postgres hosts", () => {
    expect(isSafeConnectionString(undefined)).toBe(true);
    expect(isSafeConnectionString("")).toBe(true);
    expect(
      isSafeConnectionString("postgresql://u:p@db.example.com:5432/r"),
    ).toBe(true);
    for (const cs of [
      "postgresql://u:p@localhost:5432/r",
      "postgresql://u:p@127.0.0.1:5432/r",
      "postgresql://u:p@10.0.0.5:5432/r",
      "mysql://db.example.com:3306/r",
      "postgresql:///r?host=/var/run/postgresql",
      "not-a-url",
    ]) {
      expect(isSafeConnectionString(cs), String(cs)).toBe(false);
    }
  });

  it("allow-lists model names and encodes them for URL paths", () => {
    expect(isValidModelName("text-embedding-3-small")).toBe(true);
    expect(isValidModelName("mistral-embed")).toBe(true);
    for (const model of ["", "x?foo=bar", "../m", "a b", "m\n", "é"]) {
      expect(isValidModelName(model), JSON.stringify(model)).toBe(false);
    }
    expect(encodeModelPathSegment("text-embedding-3-small")).toBe(
      "text-embedding-3-small",
    );
    expect(() => encodeModelPathSegment("x?foo=bar")).toThrow();
  });

  it("rejects header values with control characters or bad lengths", () => {
    expect(isSafeHeaderValue("sk-valid-key-123", 500)).toBe(true);
    expect(isSafeHeaderValue("sk-bad\r\nkey", 500)).toBe(false);
    expect(isSafeHeaderValue("", 500)).toBe(false);
    expect(isSafeHeaderValue("x".repeat(501), 500)).toBe(false);
  });

  it("resolution rejects malicious provider headers with 400", async () => {
    await expect(
      resolveRequestProvider("p1", {
        providerName: "openai",
        providerKey: "sk-test-key-12345678",
        providerModel: "x?foo=bar",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      resolveRequestProvider("p1", {
        providerName: "openai",
        providerKey: "sk-test\r\nInjected: 1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      resolveRequestProvider("p1", {
        providerName: "openai",
        providerKey: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      resolveRequestProvider("p1", {
        providerName: "openai",
        providerKey: "short",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const resolved = await resolveRequestProvider("p1", {
      providerName: "openai",
      providerKey: "sk-test-key-12345678",
    });
    expect(resolved.provider).toBe("openai");
    expect(resolved.embeddingModel).toBe("text-embedding-3-small");
  });
});
