import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { rankDigestStories, type DigestCandidate } from "./agents";

function candidate(id: string, category: string): DigestCandidate {
  return { id, headline: `Headline ${id}`, dek: `Dek ${id}`, category, citationCount: 1 };
}

/**
 * These exercise the no-LLM path (pool <= target), which is where the deterministic
 * priority sort has to hold on its own — the same sort is applied to LLM output.
 */
describe("rankDigestStories priority ordering", () => {
  test("pins Tech and Funding above every other category", async () => {
    const pool = [
      candidate("a", "Culture"),
      candidate("b", "Transit"),
      candidate("c", "Funding"),
      candidate("d", "Food"),
      candidate("e", "Tech"),
    ];
    const picks = await rankDigestStories(pool, 10);
    const order = picks.map((p) => p.id);
    const categoryOf = new Map(pool.map((c) => [c.id, c.category]));
    const tiers = order.map((id) => (["Tech", "Funding"].includes(categoryOf.get(id)!) ? 0 : 1));
    assert.deepEqual(tiers, [...tiers].sort(), `priority beats were not first: ${order.join(",")}`);
    assert.deepEqual(order.slice(0, 2), ["c", "e"], "Funding and Tech should lead");
  });

  test("keeps relative order stable inside each tier", async () => {
    const pool = [
      candidate("first-tech", "Tech"),
      candidate("first-other", "Culture"),
      candidate("second-tech", "Funding"),
      candidate("second-other", "Food"),
    ];
    const order = (await rankDigestStories(pool, 10)).map((p) => p.id);
    assert.deepEqual(order, ["first-tech", "second-tech", "first-other", "second-other"]);
  });

  test("never returns more than the target count", async () => {
    const pool = Array.from({ length: 25 }, (_, i) => candidate(`id-${i}`, "Culture"));
    const picks = await rankDigestStories(pool, 10);
    assert.ok(picks.length <= 10, `expected <= 10, got ${picks.length}`);
  });

  test("only ever returns ids from the input pool", async () => {
    const pool = [candidate("x", "Tech"), candidate("y", "Food")];
    const picks = await rankDigestStories(pool, 10);
    const valid = new Set(pool.map((c) => c.id));
    for (const pick of picks) assert.ok(valid.has(pick.id), `hallucinated id: ${pick.id}`);
  });

  test("always supplies a blurb, falling back to the dek", async () => {
    const picks = await rankDigestStories([candidate("z", "Tech")], 10);
    assert.equal(picks[0].whyItMatters, "Dek z");
  });

  test("handles an all-priority pool and an empty pool", async () => {
    const allTech = [candidate("t1", "Tech"), candidate("t2", "Funding")];
    assert.equal((await rankDigestStories(allTech, 10)).length, 2);
    assert.deepEqual(await rankDigestStories([], 10), []);
  });
});
