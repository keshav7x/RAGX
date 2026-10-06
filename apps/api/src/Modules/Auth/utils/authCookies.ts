import type { CookieOptions, Response } from "express";

import {
  DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
  envConfig,
  getAuthCookieMaxAgeMs,
} from "@/config/envConfig";

export const AUTH_COOKIE_NAME = "access_token";

// Kept for backwards-compatible imports; prefer `getAuthCookieMaxAgeMs()`
// so cookie lifetime tracks `JWT_EXPIRES_IN` instead of drifting from it.
export const AUTH_COOKIE_MAX_AGE = DEFAULT_AUTH_COOKIE_MAX_AGE_MS;

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: envConfig.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: getAuthCookieMaxAgeMs(),
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...baseCookieOptions(),
  });
}
