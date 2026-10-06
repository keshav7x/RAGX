import { describe, expect, it } from "bun:test";

import {
  BadRequestError,
  getErrorMessage,
  getStatusCode,
  isPayloadTooLargeError,
} from "./httpError";

function silenceConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

describe("payload too large mapping", () => {
  it("detects body-parser limit errors by status and type", () => {
    const err = Object.assign(new Error("request entity too large"), {
      status: 413,
      type: "entity.too.large",
    });
    expect(isPayloadTooLargeError(err)).toBe(true);
    expect(getStatusCode(err)).toBe(413);
    expect(getErrorMessage(err, "Internal server error")).toBe(
      "Request body too large.",
    );
  });

  it("detects status-only variants without logging", () => {
    expect(isPayloadTooLargeError({ status: 413 })).toBe(true);
    expect(getStatusCode({ type: "entity.too.large" })).toBe(413);
    expect(getErrorMessage({ status: 413 }, "fallback")).toBe(
      "Request body too large.",
    );
  });

  it("leaves other errors untouched", () => {
    expect(isPayloadTooLargeError(new Error("boom"))).toBe(false);
    expect(isPayloadTooLargeError(null)).toBe(false);
    expect(isPayloadTooLargeError("entity.too.large")).toBe(false);
    expect(getStatusCode(new BadRequestError("bad"))).toBe(400);
    expect(getErrorMessage(new BadRequestError("bad"), "fallback")).toBe(
      "bad",
    );
    silenceConsoleError(() => {
      expect(getStatusCode(new Error("boom"))).toBe(500);
      expect(getErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
    });
  });
});
