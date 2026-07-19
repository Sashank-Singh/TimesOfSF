import { useEffect, useMemo } from "react";
import type { Article } from "../types";
import { getGuideBySlug } from "../content/evergreen";
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_SHORT_NAME,
  absoluteUrl,
  articlePath,
  categoryPath,
  digestPath,
  eventsPath,
  getPublicOrigin,
  guidePath,
  topicPath,
  truncateForMeta,
} from "../lib/site";
import { CATEGORY_SEO, type AppRoute } from "../lib/routes";
import { articlesForTopic } from "./TopicHub";

type SeoHeadProps = {
  article: Article | null;
  articles: Article[];
  route: AppRoute;
};

const JSON_LD_ID = "timesofsf-jsonld";
const DEFAULT_OG_IMAGE = "/default-og.svg";

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

function routeSeo(
  route: AppRoute,
  article: Article | null,
  articles: Article[],
): { title: string; description: string; canonicalPath: string; robots: string; ogType: string } {
  if (article) {
    return {
      title: `${article.title} | ${SITE_SHORT_NAME}`,
      description: truncateForMeta(article.excerpt || SITE_DEFAULT_DESCRIPTION),
      canonicalPath: articlePath(article.slug),
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      ogType: "article",
    };
  }

  if (route.kind === "events") {
    return {
      title: `San Francisco events calendar | ${SITE_SHORT_NAME}`,
      description:
        "Curated upcoming San Francisco events from public listings—times, venues, and source links in one place.",
      canonicalPath: eventsPath(),
      robots: "index, follow",
      ogType: "website",
    };
  }

  if (route.kind === "category") {
    const seo = CATEGORY_SEO[route.category];
    return {
      title: `${seo.title} | ${SITE_SHORT_NAME}`,
      description: seo.description,
      canonicalPath: categoryPath(route.category),
      robots: "index, follow",
      ogType: "website",
    };
  }

  if (route.kind === "digest") {
    return {
      title: `Best of SF this week | ${SITE_SHORT_NAME}`,
      description:
        "Weekly San Francisco news digest from Times of SF—top civics, tech, transit, culture, and food stories with source links.",
      canonicalPath: digestPath(),
      robots: "index, follow",
      ogType: "website",
    };
  }

  if (route.kind === "guide") {
    const guide = getGuideBySlug(route.slug);
    if (guide) {
      return {
        title: `${guide.title} | ${SITE_SHORT_NAME}`,
        description: truncateForMeta(guide.description),
        canonicalPath: guidePath(guide.slug),
        robots: "index, follow",
        ogType: "article",
      };
    }
  }

  if (route.kind === "topic") {
    const { label, matches } = articlesForTopic(articles, route.slug);
    return {
      title: `${label} news — San Francisco | ${SITE_SHORT_NAME}`,
      description: truncateForMeta(
        `San Francisco coverage related to ${label}: ${matches.length} source-linked stories on Times of SF.`,
      ),
      canonicalPath: topicPath(route.slug),
      robots: "index, follow",
      ogType: "website",
    };
  }

  if (route.kind === "bookmarks") {
    return {
      title: `Reading list | ${SITE_SHORT_NAME}`,
      description: "Your saved Times of SF stories on this device.",
      canonicalPath: "/bookmarks",
      robots: "noindex, follow",
      ogType: "website",
    };
  }

  return {
    title: `${SITE_NAME} | SF news & analysis`,
    description: SITE_DEFAULT_DESCRIPTION,
    canonicalPath: "/",
    robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    ogType: "website",
  };
}

export function SeoHead({ article, articles, route }: SeoHeadProps) {
  const origin = getPublicOrigin();
  const { title, description, canonicalPath, robots, ogType } = useMemo(
    () => routeSeo(route, article, articles),
    [route, article, articles],
  );
  const canonical = origin ? absoluteUrl(canonicalPath) : "";

  const jsonLd = useMemo(() => {
    if (!origin) return null;

    const publisher = {
      "@type": "NewsMediaOrganization",
      "@id": `${origin}/#organization`,
      name: SITE_NAME,
      alternateName: SITE_SHORT_NAME,
      url: origin,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/favicon.svg"),
      },
      areaServed: {
        "@type": "City",
        name: "San Francisco",
        containedInPlace: { "@type": "State", name: "California" },
      },
      foundingDate: "2025",
      inLanguage: "en-US",
    };

    if (article) {
      const pageUrl = absoluteUrl(articlePath(article.slug));
      const imageUrl = article.imageUrl?.startsWith("http")
        ? article.imageUrl
        : absoluteUrl(article.imageUrl || DEFAULT_OG_IMAGE);
      const modified = article.updatedAt || article.publishedAt;
      const wordCount = article.content ? article.content.split(/\s+/).filter(Boolean).length : 0;
      const readTimeMin = Math.max(1, Math.round(wordCount / 200));
      const entityMentions = (article.entities ?? []).slice(0, 10).map((e) => ({
        "@type": "Thing",
        name: e.name,
        ...(e.definition ? { description: e.definition } : {}),
      }));
      return {
        "@context": "https://schema.org",
        "@graph": [
          publisher,
          {
            "@type": "BreadcrumbList",
            "@id": `${pageUrl}#breadcrumb`,
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: `${article.category} news`,
                item: absoluteUrl(categoryPath(article.category)),
              },
              {
                "@type": "ListItem",
                position: 2,
                name: article.title,
              },
            ],
          },
          {
            "@type": "NewsArticle",
            "@id": `${pageUrl}#article`,
            headline: article.title,
            description: truncateForMeta(article.excerpt || SITE_DEFAULT_DESCRIPTION, 500),
            image: [imageUrl],
            datePublished: article.publishedAt,
            dateModified: modified,
            wordCount,
            timeRequired: `PT${readTimeMin}M`,
            author: {
              "@type": "Person",
              name: article.author || SITE_SHORT_NAME,
            },
            publisher: { "@id": `${origin}/#organization` },
            articleSection: article.category,
            keywords: [article.category, ...(article.entities ?? []).slice(0, 5).map((e) => e.name)],
            about: {
              "@type": "Thing",
              name: article.category,
              sameAs: absoluteUrl(categoryPath(article.category)),
            },
            ...(entityMentions.length > 0 ? { mentions: entityMentions } : {}),
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
        ],
      };
    }

    if (route.kind === "guide") {
      const guide = getGuideBySlug(route.slug);
      if (guide) {
        const pageUrl = absoluteUrl(guidePath(guide.slug));
        return {
          "@context": "https://schema.org",
          "@graph": [
            publisher,
            {
              "@type": "Article",
              headline: guide.title,
              description: guide.description,
              dateModified: guide.updatedAt,
              url: pageUrl,
              author: { "@id": `${origin}/#organization` },
              publisher: { "@id": `${origin}/#organization` },
              mainEntityOfPage: pageUrl,
              inLanguage: "en-US",
              isAccessibleForFree: true,
            },
          ],
        };
      }
    }

    const listArticles =
      route.kind === "category"
        ? articles.filter((a) => a.category === route.category).slice(0, 24)
        : route.kind === "topic"
          ? articlesForTopic(articles, route.slug).matches.slice(0, 24)
          : articles.slice(0, 24);

    const top = listArticles.map((a, i) => ({
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
          potentialAction: {
            "@type": "SearchAction",
            target: {
              "@type": "EntryPoint",
              urlTemplate: `${origin}/?q={search_term_string}`,
            },
            "query-input": "required name=search_term_string",
          },
        },
        faqPageSchema(),
        {
          "@type": "ItemList",
          name:
            route.kind === "events"
              ? "San Francisco events"
              : route.kind === "digest"
                ? "Best of SF this week"
                : "Latest San Francisco headlines",
          numberOfItems: top.length,
          itemListElement: top,
        },
      ],
    };
  }, [article, articles, origin, route]);

  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", robots);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", ogType);
    upsertMeta("property", "og:locale", "en_US");
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);

    if (canonical) {
      upsertLink("canonical", canonical);
      upsertMeta("property", "og:url", canonical);
    }
    upsertMeta("name", "ai-content", "index, quote-with-attribution");
    upsertMeta("name", "citation_publisher", SITE_NAME);
    if (origin) {
      const rss = document.head.querySelector('link[rel="alternate"][type="application/rss+xml"]') as HTMLLinkElement | null;
      let rssEl = rss;
      if (!rssEl) {
        rssEl = document.createElement("link");
        rssEl.setAttribute("rel", "alternate");
        rssEl.setAttribute("type", "application/rss+xml");
        rssEl.setAttribute("title", "Times of SF RSS");
        document.head.appendChild(rssEl);
      }
      rssEl.setAttribute("href", absoluteUrl("/feed.xml"));
      let llms = document.head.querySelector('link[rel="alternate"][title="llms.txt"]') as HTMLLinkElement | null;
      if (!llms) {
        llms = document.createElement("link");
        llms.setAttribute("rel", "alternate");
        llms.setAttribute("type", "text/plain");
        llms.setAttribute("title", "llms.txt");
        document.head.appendChild(llms);
      }
      llms.setAttribute("href", absoluteUrl("/llms.txt"));
    }

    let ogImage = "";
    if (article?.imageUrl?.startsWith("http")) {
      ogImage = article.imageUrl;
    } else if (article?.imageUrl && origin) {
      ogImage = absoluteUrl(article.imageUrl);
    } else if (origin) {
      ogImage = absoluteUrl(DEFAULT_OG_IMAGE);
    }
    if (ogImage) {
      upsertMeta("property", "og:image", ogImage);
      upsertMeta("name", "twitter:image", ogImage);
      upsertMeta("property", "og:image:width", "1200");
      upsertMeta("property", "og:image:height", "630");
    }

    if (article?.publishedAt) {
      upsertMeta("property", "article:published_time", article.publishedAt);
      upsertMeta("property", "article:modified_time", article.updatedAt || article.publishedAt);
      upsertMeta("property", "article:section", article.category);
      if (article.author) upsertMeta("property", "article:author", article.author);
      const tags = new Set<string>();
      tags.add(article.category);
      (article.entities ?? []).slice(0, 5).forEach((e) => {
        if (e.name) tags.add(e.name);
      });
      tags.forEach((tag) => upsertMeta("property", "article:tag", tag));
    }

    if (jsonLd) injectJsonLd(jsonLd);
    return () => {
      removeJsonLd();
    };
  }, [title, description, canonical, robots, article, jsonLd, ogType, origin]);

  return null;
}
