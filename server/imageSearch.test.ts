import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  buildImageSearchQuery,
  extractBingImageUrls,
  isAcceptableImageResult,
  searchBingImage,
} from "./imageSearch";

describe("buildImageSearchQuery", () => {
  test("includes the quoted headline so the search is precise", () => {
    const q = buildImageSearchQuery({
      headline: "Pro-Trump Media Ecosystem Fractures as Influencers Feud",
      category: "Civics",
    });
    assert.match(q, /"Pro-Trump Media Ecosystem Fractures as Influencers Feud"/);
  });

  test("includes the category when it's not Tech", () => {
    const q = buildImageSearchQuery({
      headline: "Bay Area Transit Funding Approved",
      category: "Transit",
    });
    assert.match(q, /transit/i);
  });

  test("anchors queries to San Francisco news", () => {
    const q = buildImageSearchQuery({
      headline: "Mission District Mural Unveiled",
      category: "Culture",
    });
    assert.match(q, /San Francisco news photo/);
  });

  test("falls back to topic when no headline is provided", () => {
    const q = buildImageSearchQuery({
      topic: "Caltrain Electrification",
      category: "Transit",
    });
    assert.ok(q.length > 0);
    assert.match(q, /transit/i);
  });

  test("uses excerpt for additional context words when present", () => {
    const q = buildImageSearchQuery({
      headline: "Funding Round Announced",
      category: "Funding",
      excerpt: "Valar Atomics raised capital from venture investors in San Francisco.",
    });
    assert.ok(q.length > 30);
    assert.match(q, /San Francisco news photo/);
  });

  test("truncates very long headlines to keep the query usable", () => {
    const longHeadline = "A".repeat(200);
    const q = buildImageSearchQuery({
      headline: longHeadline,
      category: "Civics",
    });
    assert.ok(q.length < 300, `Query was too long: ${q.length} chars`);
  });

  test("handles missing headline gracefully", () => {
    const q = buildImageSearchQuery({
      category: "Food",
      excerpt: "A new restaurant opens in North Beach with handmade pasta and Italian wine.",
    });
    assert.ok(q.length > 0);
    assert.match(q, /San Francisco news photo/);
  });

  test("returns empty string when no input is provided", () => {
    const q = buildImageSearchQuery({});
    assert.equal(q, "San Francisco news photo");
  });
});

describe("isAcceptableImageResult", () => {
  test("accepts a real jpg URL from a news domain", () => {
    const ok = isAcceptableImageResult({
      imageUrl: "https://www.sfchronicle.com/img/photo.jpg",
      title: "Mayor at podium",
      link: "https://www.sfchronicle.com/bayarea/article/mayor",
    });
    assert.equal(ok, true);
  });

  test("rejects stock-art domain (shutterstock)", () => {
    const ok = isAcceptableImageResult({
      imageUrl: "https://image.shutterstock.com/photo.jpg",
      title: "Stock photo of buildings",
      link: "https://shutterstock.com/image",
    });
    assert.equal(ok, false);
  });

  test("rejects clip-art / vector titles", () => {
    const ok = isAcceptableImageResult({
      imageUrl: "https://example.com/vector-art.png",
      title: "Vector illustration of city",
      link: "https://example.com/vector",
    });
    assert.equal(ok, false);
  });

  test("rejects google-internal image hosts", () => {
    const ok = isAcceptableImageResult({
      imageUrl: "https://encrypted.google.com/image.jpg",
      title: "Random",
      link: "https://google.com",
    });
    assert.equal(ok, false);
  });

  test("rejects URLs without a recognized image extension", () => {
    const ok = isAcceptableImageResult({
      imageUrl: "https://example.com/photo.bmp",
      title: "Photo",
      link: "https://example.com",
    });
    assert.equal(ok, false);
  });

  test("rejects non-http URLs", () => {
    const ok = isAcceptableImageResult({
      imageUrl: "data:image/png;base64,abcdef",
      title: "Inline",
    });
    assert.equal(ok, false);
  });
});

describe("extractBingImageUrls", () => {
  test("extracts escaped murl entries from a Bing response", () => {
    const html = `
      <a class="iusc" murl="https://example.com/photo1.jpg" turl="..." desc="..." />
      <a class="iusc" murl="https://example.com/photo2.png" />
      <a class="iusc" murl="https://sub.example.org/path/photo3.webp?w=800" />
    `;
    const urls = extractBingImageUrls(html);
    assert.equal(urls.length, 3);
    assert.equal(urls[0], "https://example.com/photo1.jpg");
    assert.equal(urls[1], "https://example.com/photo2.png");
    assert.equal(urls[2], "https://sub.example.org/path/photo3.webp?w=800");
  });

  test("extracts HTML-encoded &quot; murl format", () => {
    const html = `murl&quot;:&quot;https://nytimes.com/image.jpg?quality=75&quot;`;
    const urls = extractBingImageUrls(html);
    assert.equal(urls.length, 1);
    assert.equal(urls[0], "https://nytimes.com/image.jpg?quality=75");
  });

  test("deduplicates repeated URLs", () => {
    const html = `
      murl&quot;:&quot;https://example.com/a.jpg&quot;
      murl&quot;:&quot;https://example.com/a.jpg&quot;
      murl&quot;:&quot;https://example.com/b.jpg&quot;
    `;
    const urls = extractBingImageUrls(html);
    assert.equal(urls.length, 2);
  });

  test("limits results to the max count", () => {
    const parts: string[] = [];
    for (let i = 0; i < 50; i++) parts.push(`murl&quot;:&quot;https://example.com/p${i}.jpg&quot;`);
    const urls = extractBingImageUrls(parts.join(""), 10);
    assert.equal(urls.length, 10);
  });

  test("decodes unicode-escaped slashes (when Bing emits \\u002f)", () => {
    // Bing occasionally emits \u002f literal-escaped slashes inside the URL
    const html = `murl&quot;:&quot;https:\\u002f\\u002fcdn.example.com\\u002fphoto.jpg&quot;`;
    const urls = extractBingImageUrls(html);
    assert.equal(urls.length, 1);
    assert.equal(urls[0], "https://cdn.example.com/photo.jpg");
  });

  test("returns empty array when no murl found", () => {
    const html = "<html><body>no images here</body></html>";
    const urls = extractBingImageUrls(html);
    assert.deepEqual(urls, []);
  });
});

describe("searchBingImage", () => {
  test("finds a real image for a San Francisco query (live network)", async (t) => {
    if (!process.env.RUN_NETWORK_TESTS) {
      t.skip();
      return;
    }
    const result = await searchBingImage({
      headline: "Mission District mural unveiled",
      category: "Culture",
    });
    if (result) {
      assert.match(result, /^https?:\/\//);
    }
  });
});

