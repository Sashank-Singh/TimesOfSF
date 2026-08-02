import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { categoryPath, entityToTopicSlug, listPathFromRoute, parseAppPath, slugToCategory } from "./routes";

describe("parseAppPath", () => {
  test("maps the core routes", () => {
    assert.deepEqual(parseAppPath("/"), { kind: "home" });
    assert.deepEqual(parseAppPath("/events"), { kind: "events" });
    assert.deepEqual(parseAppPath("/digest"), { kind: "digest" });
    assert.deepEqual(parseAppPath("/bookmarks"), { kind: "bookmarks" });
    assert.deepEqual(parseAppPath("/reading-list"), { kind: "bookmarks" });
    assert.deepEqual(parseAppPath("/reset-password"), { kind: "reset-password" });
  });

  test("ignores a trailing slash", () => {
    assert.deepEqual(parseAppPath("/events/"), { kind: "events" });
    assert.deepEqual(parseAppPath("///"), { kind: "home" });
  });

  test("parses article slugs and lowercases them", () => {
    assert.deepEqual(parseAppPath("/articles/Some-Slug"), { kind: "article", slug: "some-slug" });
  });

  test("decodes percent-encoded slugs", () => {
    assert.deepEqual(parseAppPath("/articles/a%20b"), { kind: "article", slug: "a b" });
  });

  test("survives a malformed percent-encoding instead of throwing", () => {
    assert.doesNotThrow(() => parseAppPath("/articles/%E0%A4%A"));
    assert.equal(parseAppPath("/articles/%E0%A4%A").kind, "article");
  });

  test("known categories resolve, unknown ones do not", () => {
    assert.deepEqual(parseAppPath("/category/tech"), { kind: "category", category: "Tech", slug: "tech" });
    assert.equal(parseAppPath("/category/not-a-desk").kind, "unknown");
  });

  test("unrecognized paths report unknown", () => {
    assert.deepEqual(parseAppPath("/nope"), { kind: "unknown", path: "/nope" });
  });
});

describe("route helpers round-trip", () => {
  test("every list route maps back to a parseable path", () => {
    const routes = [
      { kind: "home" },
      { kind: "events" },
      { kind: "digest" },
      { kind: "bookmarks" },
      { kind: "reset-password" },
      { kind: "category", category: "Civics", slug: "civics" },
    ] as const;
    for (const route of routes) {
      const path = listPathFromRoute(route as any);
      assert.equal(parseAppPath(path).kind, route.kind, `round-trip failed for ${path}`);
    }
  });

  test("categoryPath and slugToCategory agree", () => {
    for (const name of ["Tech", "Civics", "Food"] as const) {
      const slug = categoryPath(name).replace("/category/", "");
      assert.equal(slugToCategory(slug), name);
    }
  });

  test("slugToCategory is case-insensitive and rejects junk", () => {
    assert.equal(slugToCategory("TECH"), "Tech");
    assert.equal(slugToCategory("  tech "), "Tech");
    assert.equal(slugToCategory("nonsense"), null);
  });
});

describe("entityToTopicSlug", () => {
  test("produces url-safe slugs", () => {
    assert.equal(entityToTopicSlug("Mayor's Office"), "mayors-office");
    assert.equal(entityToTopicSlug("  BART  "), "bart");
    assert.equal(entityToTopicSlug("A/B & C"), "a-b-c");
  });

  test("caps length and never leaves stray dashes", () => {
    const slug = entityToTopicSlug("x ".repeat(200));
    assert.ok(slug.length <= 80);
    assert.ok(!slug.startsWith("-") && !slug.endsWith("-"));
  });
});
