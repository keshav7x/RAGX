import jwt from "jsonwebtoken";

import {
  JWT_ALGORITHM,
  JWT_ISSUER,
  envConfig,
  parseExpiresInToMs,
} from "@/config/envConfig";

export interface AuthTokenPayload {
  sub: string;
}

const JWT_SECRET = (): string => envConfig.JWT_SECRET;

export function signAuthToken(userId: string): string {
  const payload: AuthTokenPayload = { sub: userId };

  if (parseExpiresInToMs(envConfig.JWT_EXPIRES_IN) === null) {
    throw new Error(
      "[auth] JWT_EXPIRES_IN is invalid; expected seconds or a number with s/m/h/d/w suffix.",
    );
  }

  return jwt.sign(payload, JWT_SECRET(), {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    expiresIn: envConfig.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET(), {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
  }) as AuthTokenPayload;

  if (!decoded || typeof decoded.sub !== "string" || decoded.sub.length === 0) {
    throw new Error("Invalid token payload");
  }

  return { sub: decoded.sub };
}
