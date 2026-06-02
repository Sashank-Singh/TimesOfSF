import { useEffect, useMemo } from "react";
import type { Article } from "../types";
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_SHORT_NAME,
  absoluteUrl,
  articlePath,
  getPublicOrigin,
  truncateForMeta,
} from "../lib/site";
type SeoMode = "article" | "events" | "category" | "home";

export type SeoHeadProps = {
  article: Article | null;
  articles: Article[];
  mode: SeoMode;
  categoryLabel: string | null;
};

const JSON_LD_ID = "timesofsf-jsonld";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  const sel = `meta[${attr}="${CSS.escape(key)}"]`;
  let el = document.head.querySelector(sel) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  const sel = `link[rel="${CSS.escape(rel)}"]`;
  let el = document.head.querySelector(sel) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function removeJsonLd() {
  document.getElementById(JSON_LD_ID)?.remove();
}

function injectJsonLd(data: unknown) {
  removeJsonLd();
  const script = document.createElement("script");
  script.id = JSON_LD_ID;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

function faqPageSchema() {
  return {
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Times of San Francisco?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `${SITE_NAME} (${SITE_SHORT_NAME}) is a San Francisco–focused news reader. Stories combine RSS and web sources with editorial synthesis so readers get context, citations, and clear limits on what is confirmed versus inferred.`,
        },
      },
      {
        "@type": "Question",
        name: "How are articles produced?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "An automated pipeline ingests public sources (feeds and pages), deduplicates overlapping coverage, and uses an LLM only after source text is available. Published pieces include credits and links back to originals where possible.",
        },
      },
      {
        "@type": "Question",
        name: "Which topics does Times of SF cover?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Regular sections include civics, culture, tech, funding, transit, food, and local events—centered on San Francisco and immediate civic relevance.",
        },
      },
      {
        "@type": "Question",
        name: "Where is Times of SF based?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Editorial focus and datelines are San Francisco, California, United States.",
        },
      },
    ],
  };
}

export function SeoHead({ article, articles, mode, categoryLabel }: SeoHeadProps) {
  const origin = getPublicOrigin();

  const { title, description, canonicalPath, robots } = useMemo(() => {
    if (article) {
      const path = articlePath(article.slug);
      return {
        title: `${article.title} | ${SITE_SHORT_NAME}`,
        description: truncateForMeta(article.excerpt || SITE_DEFAULT_DESCRIPTION),
        canonicalPath: path,
        robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      };
    }
    if (mode === "events") {
      return {
        title: `San Francisco events calendar | ${SITE_SHORT_NAME}`,
        description:
          "Curated upcoming San Francisco events from public listings—times, venues, and source links in one place.",
        canonicalPath: "/",
        robots: "index, follow",
      };
    }
    if (mode === "category" && categoryLabel && categoryLabel !== "Bookmarks") {
      return {
        title: `${categoryLabel} news — San Francisco | ${SITE_SHORT_NAME}`,
        description: `Latest ${categoryLabel.toLowerCase()} coverage focused on San Francisco: headlines, context, and source-linked reporting.`,
        canonicalPath: "/",
        robots: "index, follow",
      };
    }
    return {
      title: `${SITE_NAME} | SF news & analysis`,
      description: SITE_DEFAULT_DESCRIPTION,
      canonicalPath: "/",
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    };
  }, [article, mode, categoryLabel]);

  const canonical = origin ? absoluteUrl(canonicalPath) : "";

  const jsonLd = useMemo(() => {
    if (!origin) return null;

    const publisher = {
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: SITE_NAME,
      alternateName: SITE_SHORT_NAME,
      url: origin,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/web-app-manifest-512x512.png"),
      },
      areaServed: {
        "@type": "City",
        name: "San Francisco",
        containedInPlace: { "@type": "State", name: "California" },
      },
    };

    if (article) {
      const pageUrl = absoluteUrl(articlePath(article.slug));
      const imageUrl = article.imageUrl?.startsWith("http") ? article.imageUrl : absoluteUrl(article.imageUrl || "/");
      const graph: Record<string, unknown>[] = [
        publisher,
        {
          "@type": "NewsArticle",
          "@id": `${pageUrl}#article`,
          headline: article.title,
          description: truncateForMeta(article.excerpt || SITE_DEFAULT_DESCRIPTION, 500),
          image: [imageUrl],
          datePublished: article.publishedAt,
          dateModified: article.publishedAt,
          author: {
            "@type": "Person",
            name: article.author || SITE_SHORT_NAME,
          },
          publisher: { "@id": `${origin}/#organization` },
          articleSection: article.category,
          inLanguage: "en-US",
          isAccessibleForFree: true,
          mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
          speakable: {
            "@type": "SpeakableSpecification",
            cssSelector: ["#article-headline", ".article-lead", ".tldr-answer-engine"],
          },
          citation: (article.citations ?? []).slice(0, 12).map((c) => ({
            "@type": "WebPage",
            name: c.sourceName,
            url: c.sourceUrl,
          })),
        },
      ];
      return { "@context": "https://schema.org", "@graph": graph };
    }

    const top = articles.slice(0, 24).map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "NewsArticle",
        headline: a.title,
        url: absoluteUrl(articlePath(a.slug)),
        datePublished: a.publishedAt,
        articleSection: a.category,
      },
    }));

    return {
      "@context": "https://schema.org",
      "@graph": [
        publisher,
        {
          "@type": "WebSite",
          "@id": `${origin}/#website`,
          name: SITE_NAME,
          alternateName: SITE_SHORT_NAME,
          url: origin,
          description: SITE_DEFAULT_DESCRIPTION,
          publisher: { "@id": `${origin}/#organization` },
          inLanguage: "en-US",
        },
        faqPageSchema(),
        {
          "@type": "ItemList",
          name: "Latest San Francisco headlines",
          numberOfItems: top.length,
          itemListElement: top,
        },
      ],
    };
  }, [article, articles, origin]);

  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", robots);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", article ? "article" : "website");
    upsertMeta("property", "og:locale", "en_US");
    upsertMeta("name", "twitter:card", article ? "summary_large_image" : "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);

    if (canonical) {
      upsertLink("canonical", canonical);
      upsertMeta("property", "og:url", canonical);
    }

    if (article?.imageUrl?.startsWith("http")) {
      upsertMeta("property", "og:image", article.imageUrl);
      upsertMeta("name", "twitter:image", article.imageUrl);
    } else if (article?.imageUrl && origin) {
      const ogImg = absoluteUrl(article.imageUrl);
      upsertMeta("property", "og:image", ogImg);
      upsertMeta("name", "twitter:image", ogImg);
    }

    if (jsonLd) injectJsonLd(jsonLd);
    return () => {
      removeJsonLd();
    };
  }, [title, description, canonical, robots, article, jsonLd]);

  return null;
}
