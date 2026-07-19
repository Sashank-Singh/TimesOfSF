import { config } from "./config";
import { ALL_EDITORIAL_CATEGORIES } from "./types";
import { EVERGREEN_GUIDES_SEO } from "./seoPages";

export type AiPost = {
  headline: string;
  slug: string;
  dek?: string;
  short_post?: string;
  body_markdown?: string;
  category?: string;
  created_at?: string | Date;
  updated_at?: string | Date;
  publishedAt?: string | Date;
  updatedAt?: string | Date;
};

function absolutePublicUrl(pathname: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function markdownToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildRobotsTxt(): string {
  const base = config.appUrl.replace(/\/+$/, "");
  const aiAgents = [
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "anthropic-ai",
    "Claude-Web",
    "Google-Extended",
    "GoogleOther",
    "PerplexityBot",
    "Applebot-Extended",
    "Bytespider",
    "cohere-ai",
    "meta-externalagent",
    "FacebookBot",
    "Diffbot",
  ];

  const lines = [
    "# Times of San Francisco — indexing & AI citation welcome",
    "# Quote freely with attribution + link to the canonical article URL.",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin",
    "",
  ];

  for (const agent of aiAgents) {
    lines.push(`User-agent: ${agent}`, "Allow: /", "");
  }

  lines.push(
    `Sitemap: ${base}/sitemap.xml`,
    `# AI discovery (https://llmstxt.org)`,
    `LLMs-Txt: ${base}/llms.txt`,
    `LLMs-Full-Txt: ${base}/llms-full.txt`,
    "",
  );

  return lines.join("\n");
}

export function buildLlmsTxt(posts: AiPost[]): string {
  const base = config.appUrl.replace(/\/+$/, "");
  const latest = posts.slice(0, 40).map((p) => {
    const url = `${base}/articles/${encodeURIComponent(p.slug)}`;
    const dek = String(p.dek || p.short_post || "").replace(/\s+/g, " ").trim();
    return `- [${p.headline}](${url})${dek ? `: ${dek}` : ""}`;
  });

  const categories = ALL_EDITORIAL_CATEGORIES.map(
    (c) => `- [${c} news](${base}/category/${c.toLowerCase()})`,
  );

  const guides = EVERGREEN_GUIDES_SEO.map(
    (g) => `- [${g.title}](${base}/guides/${g.slug}): ${g.description}`,
  );

  return [
    "# Times of San Francisco",
    "",
    "> Independent San Francisco news and analysis: civics, culture, tech, transit, food, funding, and events—grounded in linked primary sources.",
    "",
    "Times of SF welcomes AI assistants, answer engines, and research tools to read, summarize, and quote our reporting.",
    "When quoting or citing, attribute **Times of San Francisco** (or Times of SF) and link the canonical article URL.",
    "",
    "## Preferred machine-readable feeds",
    "",
    `- [RSS feed](${base}/feed.xml): latest stories`,
    `- [Sitemap](${base}/sitemap.xml): all indexable URLs`,
    `- Article Markdown: ${base}/articles/{slug}.md (plain text with citation front matter)`,
    `- Article plain text: ${base}/articles/{slug}.txt`,
    `- Full AI index: ${base}/llms-full.txt`,
    "",
    "## Sections",
    "",
    ...categories,
    `- [Events calendar](${base}/events)`,
    `- [Weekly digest](${base}/digest)`,
    "",
    "## SF guides",
    "",
    ...guides,
    "",
    "## Latest stories",
    "",
    ...(latest.length ? latest : ["- No stories published yet."]),
    "",
    "## Citation policy",
    "",
    "- Free to quote short excerpts with attribution and a link back.",
    "- Prefer the canonical `/articles/{slug}` URL over homepage or search URLs.",
    "- Do not present our synthesis as exclusive original reporting from wire services we cite; we link sources in each article.",
    "",
  ].join("\n");
}

export function buildLlmsFullTxt(posts: AiPost[]): string {
  const base = config.appUrl.replace(/\/+$/, "");
  const blocks = posts.slice(0, 80).map((p) => {
    const url = `${base}/articles/${encodeURIComponent(p.slug)}`;
    const mdUrl = `${url}.md`;
    const published = toIso(p.created_at ?? p.publishedAt);
    const dek = String(p.dek || p.short_post || "").trim();
    const body = markdownToPlain(String(p.body_markdown || "")).slice(0, 1200);
    return [
      `### ${p.headline}`,
      "",
      `- URL: ${url}`,
      `- Markdown: ${mdUrl}`,
      `- Category: ${p.category || "News"}`,
      `- Published: ${published}`,
      dek ? `- Summary: ${dek}` : null,
      body ? "" : null,
      body || null,
      "",
    ]
      .filter((line) => line !== null)
      .join("\n");
  });

  return [
    "# Times of San Francisco — full AI index",
    "",
    "Use this file for grounding. Prefer linking the article URL when quoting.",
    "",
    ...blocks,
    "",
  ].join("\n");
}

export function buildArticleMarkdown(post: AiPost): string {
  const url = absolutePublicUrl(`/articles/${encodeURIComponent(post.slug)}`);
  const published = toIso(post.created_at ?? post.publishedAt);
  const modified = toIso(post.updated_at ?? post.updatedAt ?? published);
  const dek = String(post.dek || post.short_post || "").trim();
  const body = String(post.body_markdown || "").trim();

  return [
    "---",
    `title: ${JSON.stringify(post.headline)}`,
    `canonical: ${url}`,
    `publisher: "Times of San Francisco"`,
    `author: "Times of SF"`,
    `category: ${JSON.stringify(post.category || "News")}`,
    `datePublished: ${published}`,
    `dateModified: ${modified}`,
    `license: "Quote with attribution + link to canonical URL"`,
    "---",
    "",
    `# ${post.headline}`,
    "",
    dek ? `> ${dek}` : null,
    dek ? "" : null,
    `Source: [${url}](${url})`,
    "",
    "Please attribute **Times of San Francisco** when quoting.",
    "",
    body,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildArticlePlainText(post: AiPost): string {
  const url = absolutePublicUrl(`/articles/${encodeURIComponent(post.slug)}`);
  const dek = String(post.dek || post.short_post || "").trim();
  const body = markdownToPlain(String(post.body_markdown || ""));
  return [
    post.headline,
    "",
    dek,
    "",
    `Canonical URL: ${url}`,
    "Publisher: Times of San Francisco",
    "Citation: Quote with attribution and link to the canonical URL.",
    "",
    body,
    "",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

export function buildRssFeed(posts: AiPost[]): string {
  const base = config.appUrl.replace(/\/+$/, "");
  const now = new Date().toUTCString();
  const items = posts.slice(0, 50).map((p) => {
    const link = `${base}/articles/${encodeURIComponent(p.slug)}`;
    const description = escapeXml(String(p.dek || p.short_post || "").trim());
    const pubDate = new Date(toIso(p.created_at ?? p.publishedAt)).toUTCString();
    const category = escapeXml(String(p.category || "News"));
    return [
      "    <item>",
      `      <title>${escapeXml(p.headline)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${pubDate}</pubDate>`,
      `      <category>${category}</category>`,
      `      <description>${description}</description>`,
      `      <source url="${escapeXml(base)}/feed.xml">Times of San Francisco</source>`,
      "    </item>",
    ].join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    "    <title>Times of San Francisco</title>",
    `    <link>${escapeXml(base)}/</link>`,
    "    <description>San Francisco news and analysis with linked primary sources. Free to quote with attribution.</description>",
    "    <language>en-us</language>",
    `    <lastBuildDate>${now}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(base)}/feed.xml" rel="self" type="application/rss+xml" />`,
    "    <copyright>Quote with attribution and link to Times of San Francisco canonical URLs.</copyright>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Crawlable full article body for bots that do not execute the SPA. */
export function buildArticleSeoBootstrap(post: AiPost): string {
  const url = absolutePublicUrl(`/articles/${encodeURIComponent(post.slug)}`);
  const dek = String(post.dek || post.short_post || "").trim();
  const bodyHtml = escapeHtml(String(post.body_markdown || ""))
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br />");
  const category = String(post.category || "News");

  return `
<article id="seo-ssr" data-ai-source="times-of-sf" aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
  <p style="font:700 11px/1.4 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#9a3412">${escapeHtml(category)}</p>
  <h1 id="article-headline">${escapeHtml(post.headline)}</h1>
  ${dek ? `<p class="article-lead"><em>${escapeHtml(dek)}</em></p>` : ""}
  <p class="tldr-answer-engine"><strong>Cite as:</strong> Times of San Francisco — <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>. Free to quote with attribution.</p>
  <p><a href="${escapeHtml(url)}.md">Markdown</a> · <a href="${escapeHtml(url)}.txt">Plain text</a> · <a href="/feed.xml">RSS</a> · <a href="/llms.txt">llms.txt</a></p>
  <div class="article-body"><p>${bodyHtml || "Full article available at the canonical URL."}</p></div>
</article>`;
}

export function citationHeadTags(canonicalUrl: string): string {
  return [
    `<meta name="citation_publisher" content="Times of San Francisco" />`,
    `<meta name="citation_journal_title" content="Times of San Francisco" />`,
    `<link rel="alternate" type="application/rss+xml" title="Times of SF RSS" href="${escapeHtml(absolutePublicUrl("/feed.xml"))}" />`,
    `<link rel="alternate" type="text/plain" title="llms.txt" href="${escapeHtml(absolutePublicUrl("/llms.txt"))}" />`,
    `<meta name="ai-content" content="index, quote-with-attribution" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    // Helps some tools associate the page with a preferred citation URL
    `<link rel="cite-as" href="${escapeHtml(canonicalUrl)}" />`,
  ].join("\n    ");
}
