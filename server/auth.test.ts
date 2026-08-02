import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  generateSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
  RESET_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
} from "./auth";

describe("password hashing", () => {
  test("accepts the correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("correct horse battery staple", stored), true);
  });

  test("rejects the wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("Correct horse battery staple", stored), false);
    assert.equal(verifyPassword("", stored), false);
  });

  test("salts each hash, so identical passwords never collide", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    assert.notEqual(a, b);
    // ...but both still verify.
    assert.equal(verifyPassword("same-password", a), true);
    assert.equal(verifyPassword("same-password", b), true);
  });

  test("never stores the plaintext", () => {
    const stored = hashPassword("hunter2");
    assert.ok(!stored.includes("hunter2"));
    const [salt, hash] = stored.split(":");
    assert.match(salt, /^[a-f0-9]{32}$/);
    assert.match(hash, /^[a-f0-9]{128}$/);
  });

  test("does not throw on malformed stored values", () => {
    for (const bad of ["", "nosalt", "a:b", ":", "x:".padEnd(50, "z")]) {
      assert.equal(verifyPassword("whatever", bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe("tokens", () => {
  test("session tokens are 64 hex chars and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const token = generateSessionToken();
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.equal(seen.has(token), false, "generated a duplicate token");
      seen.add(token);
    }
  });

  test("hashToken is stable and one-way", () => {
    const token = generateSessionToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.match(hashToken(token), /^[a-f0-9]{64}$/);
    assert.notEqual(hashToken(token), token, "stored hash must differ from the emailed token");
  });

  test("different tokens hash differently", () => {
    assert.notEqual(hashToken("a".repeat(64)), hashToken("b".repeat(64)));
  });
});

describe("token lifetimes", () => {
  test("reset links are short-lived, verify links and sessions are not", () => {
    assert.equal(RESET_TOKEN_TTL_MS, 60 * 60 * 1000);
    assert.ok(RESET_TOKEN_TTL_MS < VERIFY_TOKEN_TTL_MS);
    assert.ok(VERIFY_TOKEN_TTL_MS < SESSION_TTL_MS);
  });
});
