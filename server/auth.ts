import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const storedBuf = Buffer.from(hashHex, "hex");
  if (candidate.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(candidate, storedBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export const SESSION_COOKIE_NAME = "tosf_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
