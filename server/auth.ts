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

/**
 * Tokens emailed to users (verify / reset) are stored only as a hash, so a database
 * leak cannot be replayed into working links. No salt needed: the token is already
 * 32 bytes of CSPRNG output, so there is nothing to brute-force.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "tosf_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
