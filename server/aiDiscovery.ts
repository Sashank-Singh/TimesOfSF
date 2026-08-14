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

/**
 * Ping IndexNow (Bing, Yandex, Seznam) the moment an article publishes so it can appear in
 * search results in minutes instead of days. No-op unless INDEXNOW_KEY is configured.
 */
export async function indexNowPing(slug: string): Promise<void> {
  const key = config.indexNowKey;
  const base = config.appUrl.replace(/\/+$/, "");
  if (!key || !/^[a-zA-Z0-9-]+$/.test(key)) return;
  try {
    const url = `${base}/articles/${encodeURIComponent(slug)}`;
    const body = JSON.stringify({ host: new URL(base).hostname, key, keyLocation: `${base}/${key}.txt`, urlList: [url] });
    // IndexNow accepts a GET (one URL) or POST (batch). POST with a single URL is the reliable path.
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "TimesOfSF/1.0 (instant indexing)" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.warn("IndexNow ping failed:", error instanceof Error ? error.message : error);
  }
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

export function markdownToPlain(md: string): string {
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

/** Render the article's markdown body to clean semantic HTML for server-side (SSR) output. */
function markdownToHtml(md: string): string {
  const escapeInline = (s: string) =>
    s
      .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

  const stripGlossaryMarkers = (s: string) => s.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1");

  const inline = (s: string): string => {
    let out = stripGlossaryMarkers(s);
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, alt, src) => {
      const safeAlt = escapeInline(alt);
      const safeSrc = escapeInline(src.replace(/&amp;/g, "&"));
      return ` <figure><img src="${safeSrc}" alt="${safeAlt}" loading="lazy" /><figcaption>${safeAlt}</figcaption></figure> `;
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => {
      const safeText = escapeInline(text);
      const safeHref = escapeInline(href.replace(/&amp;/g, "&"));
      return `<a href="${safeHref}" rel="noopener">${safeText}</a>`;
    });
    out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeInline(code)}</code>`);
    out = out.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
    out = out.replace(/(\*|_)(.+?)\1/g, "<em>$2</em>");
    return out;
  };

  const blocks: string[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");

  let i = 0;
  let paragraph: string[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map(inline).join("<br />")}</p>`);
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (inCode) {
      if (/^\s*```/.test(line)) {
        inCode = false;
        blocks.push(`<pre><code>${escapeInline(codeBuffer.join("\n"))}</code></pre>`);
        codeBuffer = [];
        i += 1;
        continue;
      }
      codeBuffer.push(line);
      i += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushParagraph();
      inCode = true;
      codeBuffer = [];
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*&gt;\s?/.test(line) || /^>\s?/.test(line)) {
      flushParagraph();
      const quote = line.replace(/^\s*&gt;\s?/, "").replace(/^>\s?/, "");
      blocks.push(`<blockquote>${inline(quote)}</blockquote>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*]\s+/, "").trim()));
        i += 1;
      }
      blocks.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*\d+\.\s+/, "").trim()));
        i += 1;
      }
      blocks.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^\s*---+$/.test(line.trim())) {
      flushParagraph();
      blocks.push("<hr />");
      i += 1;
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  if (inCode && codeBuffer.length > 0) {
    blocks.push(`<pre><code>${escapeInline(codeBuffer.join("\n"))}</code></pre>`);
  }
  flushParagraph();

  return blocks.join("\n");
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
    `Sitemap: ${base}/news-sitemap.xml`,
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
  const bodyHtml = markdownToHtml(String(post.body_markdown || "")) || "<p>Full article available at the canonical URL.</p>";
  const category = String(post.category || "News");

  return `
<article id="seo-ssr" data-ai-source="times-of-sf" itemscope itemtype="https://schema.org/NewsArticle">
  <p class="article-category" itemprop="articleSection" style="font:700 11px/1.4 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#9a3412">${escapeHtml(category)}</p>
  <h1 id="article-headline" itemprop="headline" style="font:800 2rem/1.2 Georgia,serif;margin:.25rem 0 .5rem">${escapeHtml(post.headline)}</h1>
  ${dek ? `<p class="article-lead" itemprop="description" style="font:italic 1.2rem/1.5 Georgia,serif;color:#444;margin:0 0 1rem"><em>${escapeHtml(dek)}</em></p>` : ""}
  <p class="article-meta" style="font:600 .85rem/1.5 ui-monospace,monospace;color:#666;margin:0 0 1.5rem">Times of San Francisco · ${escapeHtml(category)} · ${escapeHtml(toIso(post.created_at ?? post.publishedAt).slice(0, 10))}</p>
  <div class="article-body" itemprop="articleBody" style="font:1.05rem/1.75 Georgia,serif;color:#1a1a1a;max-width:70ch">${bodyHtml}</div>
  <p class="tldr-answer-engine" style="font:.9rem/1.5 ui-monospace,monospace;color:#555;margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd"><strong>Cite as:</strong> Times of San Francisco — <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>. Free to quote with attribution.</p>
  <p style="font:.85rem/1.5 ui-monospace,monospace;color:#666">Markdown: <a href="${escapeHtml(url)}.md">${escapeHtml(url)}.md</a> · Plain text: <a href="${escapeHtml(url)}.txt">${escapeHtml(url)}.txt</a></p>
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
