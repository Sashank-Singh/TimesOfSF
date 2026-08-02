import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { htmlForDigest, localDateAndHour, plainTextForDigest, type DigestItem } from "./newsletter";

function item(id: number, headline: string, category: string, why = "why it matters"): DigestItem {
  return {
    post: { id, headline, slug: `slug-${id}`, dek: "dek", category, citationCount: 1 },
    whyItMatters: why,
  };
}

describe("localDateAndHour", () => {
  test("converts UTC into the configured zone", () => {
    // 2026-08-02T03:30Z is still Aug 1, 20:30 in Los Angeles (UTC-7 in summer).
    const at = new Date("2026-08-02T03:30:00Z");
    const la = localDateAndHour("America/Los_Angeles", at);
    assert.equal(la.dateKey, "2026-08-01");
    assert.equal(la.hour, 20);
  });

  test("same instant lands on a different day in UTC", () => {
    const at = new Date("2026-08-02T03:30:00Z");
    assert.equal(localDateAndHour("UTC", at).dateKey, "2026-08-02");
  });

  test("normalizes midnight to hour 0, never 24", () => {
    const at = new Date("2026-08-02T07:15:00Z"); // 00:15 in LA
    const la = localDateAndHour("America/Los_Angeles", at);
    assert.equal(la.hour, 0);
    assert.equal(la.dateKey, "2026-08-02");
  });

  test("handles a PST/PDT boundary without crashing", () => {
    const at = new Date("2026-11-01T09:30:00Z");
    const la = localDateAndHour("America/Los_Angeles", at);
    assert.match(la.dateKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(la.hour >= 0 && la.hour <= 23);
  });
});

describe("digest rendering", () => {
  const items = [item(1, "Muni adds a line", "Transit"), item(2, "Startup raises", "Funding")];

  test("html includes every headline and a working article link", () => {
    const html = htmlForDigest("morning", items, "tok123");
    assert.ok(html.includes("Muni adds a line"));
    assert.ok(html.includes("Startup raises"));
    assert.ok(html.includes("/articles/slug-1"));
    assert.ok(html.includes("Morning Briefing"));
  });

  test("night slot is labelled differently from morning", () => {
    assert.ok(htmlForDigest("night", items, "t").includes("Evening Briefing"));
    assert.ok(!htmlForDigest("night", items, "t").includes("Morning Briefing"));
  });

  test("every digest carries its unsubscribe token", () => {
    assert.ok(htmlForDigest("morning", items, "tok123").includes("tok123"));
    assert.ok(plainTextForDigest("morning", items, "tok123").includes("tok123"));
  });

  test("escapes HTML in headlines so a story title cannot inject markup", () => {
    const nasty = [item(9, `<script>alert(1)</script>`, "Tech")];
    const html = htmlForDigest("morning", nasty, "t");
    assert.ok(!html.includes("<script>alert(1)</script>"), "raw script tag leaked into the email");
    assert.ok(html.includes("&lt;script&gt;"));
  });

  test("escapes HTML in the LLM-written blurb too", () => {
    const nasty = [item(9, "Fine headline", "Tech", `"><img src=x onerror=alert(1)>`)];
    const html = htmlForDigest("morning", nasty, "t");
    assert.ok(!html.includes("<img src=x"), "raw img tag leaked into the email");
  });

  test("plain text numbers the stories in order", () => {
    const text = plainTextForDigest("morning", items, "t");
    assert.ok(text.includes("1. [Transit] Muni adds a line"));
    assert.ok(text.includes("2. [Funding] Startup raises"));
  });

  test("renders an empty list without throwing", () => {
    assert.doesNotThrow(() => htmlForDigest("morning", [], "t"));
    assert.doesNotThrow(() => plainTextForDigest("morning", [], "t"));
  });
});
