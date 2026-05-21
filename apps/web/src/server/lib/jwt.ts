import "server-only";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "./env";

export interface SessionPayload {
  uid: string;
  email: string;
}

function secret(): string {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set (min 32 chars) on the API environment");
  }
  return env.JWT_SECRET;
}

export function signSession(payload: SessionPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, secret(), options);
}

export function verifySession(token: string): SessionPayload {
  const decoded = jwt.verify(token, secret());
  if (typeof decoded !== "object" || !decoded || !("uid" in decoded)) {
    throw new Error("Invalid session payload");
  }
  return decoded as SessionPayload;
}
