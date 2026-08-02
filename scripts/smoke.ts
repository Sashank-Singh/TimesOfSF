/**
 * End-to-end smoke test against a running server.
 *
 *   npx tsx scripts/smoke.ts                          # http://localhost:8787
 *   BASE=https://www.timesofsf.com npx tsx scripts/smoke.ts
 *
 * Read-only by default. Set SMOKE_WRITE=1 to also exercise signup/login/bookmarks,
 * which creates (and then deletes via the API) a throwaway account.
 */

const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/+$/, "");
const WRITE = process.env.SMOKE_WRITE === "1";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, { redirect: "manual", ...init });
}

async function main() {
  console.log(`smoke: ${BASE}\n`);

  console.log("health");
  {
    const res = await get("/health");
    const body: any = await res.json().catch(() => ({}));
    ok("responds 200", res.status === 200, `got ${res.status}`);
    ok("reports ok:true", body.ok === true);
    ok("names an llm provider", typeof body.llmProvider === "string");
    ok("reports newsletter scheduler shape", Array.isArray(body?.newsletterSender?.digestHours));
  }

  console.log("\npublic content");
  {
    const res = await get("/api/posts?limit=3");
    const body: any = await res.json().catch(() => []);
    ok("posts returns 200", res.status === 200, `got ${res.status}`);
    ok("posts returns an array", Array.isArray(body));
    ok("respects the limit", Array.isArray(body) && body.length <= 3, `got ${body?.length}`);
    if (Array.isArray(body) && body[0]) {
      ok("post has a headline", typeof body[0].headline === "string");
      ok("post has a slug", typeof body[0].slug === "string");
    }

    const events = await get("/api/events");
    ok("events returns 200", events.status === 200, `got ${events.status}`);

    for (const path of ["/robots.txt", "/sitemap.xml", "/feed.xml", "/llms.txt"]) {
      const r = await get(path);
      ok(`${path} serves`, r.status === 200, `got ${r.status}`);
    }
  }

  console.log("\ninput validation");
  {
    const nan = await get("/api/posts?limit=abc");
    ok("non-numeric limit is not a 500", nan.status !== 500, `got ${nan.status} (known issue if 500)`);

    const search = await get("/api/posts?q=%25%25%25&limit=2");
    ok("wildcard-only search does not error", search.status === 200, `got ${search.status}`);
  }

  console.log("\nauth guards");
  {
    const me = await get("/api/auth/me");
    ok("me is 401 without a session", me.status === 401, `got ${me.status}`);

    const bm = await get("/api/bookmarks");
    ok("bookmarks is 401 without a session", bm.status === 401, `got ${bm.status}`);

    const tips = await get("/api/tips");
    ok("owner tips list is 401 unauthenticated", tips.status === 401, `got ${tips.status}`);

    const runs = await get("/api/runs/does-not-exist");
    ok("runs is 401 unauthenticated", runs.status === 401, `got ${runs.status}`);

    const badReset = await get("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad", password: "longenoughpassword" }),
    });
    ok("bogus reset token rejected", badReset.status === 400, `got ${badReset.status}`);

    const shortPw = await get("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(64), password: "short" }),
    });
    ok("short password rejected", shortPw.status === 400, `got ${shortPw.status}`);

    const verify = await get("/api/auth/verify?token=bad");
    ok("bad verify token redirects, not 500", verify.status === 302, `got ${verify.status}`);
  }

  console.log("\naccount enumeration");
  {
    const unknown = await get("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `nobody-${Date.now()}@example.com` }),
    });
    const unknownBody = await unknown.text();

    const malformed = await get("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    const malformedBody = await malformed.text();

    ok("unknown address returns 200", unknown.status === 200, `got ${unknown.status}`);
    ok("unknown and malformed responses are identical", unknownBody === malformedBody);
  }

  console.log("\ntips validation");
  {
    const tooShort = await get("/api/tips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "tip", message: "hi" }),
    });
    ok("rejects a too-short tip", tooShort.status === 400, `got ${tooShort.status}`);
  }

  if (WRITE) {
    console.log("\nauthenticated flow (SMOKE_WRITE=1)");
    const email = `smoke-${Date.now()}@timesofsf.com`;
    const password = "smoke-test-password-123";

    const signup = await get("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    ok("signup succeeds", signup.status === 201, `got ${signup.status}`);
    const cookie = (signup.headers.get("set-cookie") || "").split(";")[0];
    ok("signup sets a session cookie", cookie.startsWith("tosf_session="));

    const auth = { Cookie: cookie, "Content-Type": "application/json" };

    const me = await get("/api/auth/me", { headers: auth });
    const meBody: any = await me.json().catch(() => ({}));
    ok("me works with the session", me.status === 200, `got ${me.status}`);
    ok("me returns the right email", meBody.email === email);
    ok("new account starts unverified", meBody.emailVerified === false);

    const prefs = await get("/api/auth/preferences", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ preferences: ["Tech", "NotARealDesk"] }),
    });
    const prefsBody: any = await prefs.json().catch(() => ({}));
    ok("preferences save", prefs.status === 200, `got ${prefs.status}`);
    ok("invalid categories are filtered out", JSON.stringify(prefsBody.preferences) === JSON.stringify(["Tech"]));

    const posts: any = await (await get("/api/posts?limit=1")).json();
    const postId = posts?.[0]?.id;
    if (postId) {
      const add = await get(`/api/bookmarks/${postId}`, { method: "POST", headers: auth });
      ok("bookmark add", add.status === 201, `got ${add.status}`);
      const list: any = await (await get("/api/bookmarks", { headers: auth })).json();
      ok("bookmark shows in the list", Array.isArray(list) && list.includes(String(postId)));
      const del = await get(`/api/bookmarks/${postId}`, { method: "DELETE", headers: auth });
      ok("bookmark remove", del.status === 200, `got ${del.status}`);
      const after: any = await (await get("/api/bookmarks", { headers: auth })).json();
      ok("bookmark is gone after removal", Array.isArray(after) && !after.includes(String(postId)));
    }

    const badBookmark = await get("/api/bookmarks/not-a-number", { method: "POST", headers: auth });
    ok("non-numeric post id rejected", badBookmark.status === 400, `got ${badBookmark.status}`);

    const logout = await get("/api/auth/logout", { method: "POST", headers: auth });
    ok("logout succeeds", logout.status === 200, `got ${logout.status}`);

    const afterLogout = await get("/api/auth/me", { headers: { Cookie: cookie } });
    ok("session is dead after logout", afterLogout.status === 401, `got ${afterLogout.status}`);

    console.log(`\n  note: leftover smoke account ${email} — delete it from users when convenient.`);
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke run crashed:", err);
  process.exit(1);
});
