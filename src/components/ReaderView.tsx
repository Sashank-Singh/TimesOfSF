import React, { useState, useRef, useMemo, useEffect } from "react";
import { Article, ArticleEntity } from "../types";
import { NewsletterCta } from "./NewsletterCta";
import { AdSlot } from "./AdSlot";
import { pickRelatedArticles, RelatedArticles } from "./RelatedArticles";
import { categoryPath } from "../lib/routes";
import { motion, AnimatePresence, useScroll, useSpring } from "motion/react";
import { X, ArrowLeft, Share2, Bookmark, ExternalLink, Headphones } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { formatPublishedTimestamp, cn, stripCitationSectionsForTts, stripMarkdown, buildEditorialSummary } from "../lib/utils";

import { EntityHighlight } from "./EntityHighlight";
import { buildArticleBrief } from "../lib/articleBrief";
import { isSourceLinkedChart } from "../lib/chartData";
import { DataVisChart } from "./DataVisChart";
import { TipBox } from "./TipBox";
import { lookupGlossaryDefinition } from "../lib/glossary";

const VoiceReader = React.lazy(() => import("./VoiceReader"));

interface ReaderViewProps {
  article: Article | null;
  allArticles?: Article[];
  onClose: () => void;
  onNavigate?: (path: string) => void;
  onOpenArticle?: (article: Article) => void;
  isBookmarked: boolean;
  onBookmark: () => void;
  onShare: (e?: React.MouseEvent) => void;
}

function ReaderContent({ article, allArticles = [], onClose, onNavigate, onOpenArticle, isBookmarked, onBookmark, onShare }: { article: Article } & Omit<ReaderViewProps, "article">) {
  const related = pickRelatedArticles(article, allArticles, 3);
  const [briefOnly, setBriefOnly] = useState(false);
  const editorialSummary = useMemo(
    () => buildEditorialSummary({ summary: article.summary, excerpt: article.excerpt, tldr: article.tldr }),
    [article.summary, article.excerpt, article.tldr],
  );
  const content = article.content;
  const briefText = useMemo(() => buildArticleBrief(content, editorialSummary), [content, editorialSummary]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [activeWord, setActiveWord] = useState(-1);
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const wordElsRef = useRef<HTMLElement[]>([]);
  const wordSpansAppliedRef = useRef(false);

  const plainText = useMemo(() => stripCitationSectionsForTts(stripMarkdown(content)), [content]);

  const { scrollYProgress } = useScroll({
    container: scrollRef
  });

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const chartTokensPresent = content.includes("[CHART:");

  const components = useMemo(() => {
    const entities: ArticleEntity[] = article.entities ?? [];
    const knownSources = new Set([
      ...(article.sourceUrls ?? []),
      ...(article.credits ?? []).map(c => c.articleUrl),
      ...(article.citations ?? []).map(c => c.sourceUrl),
    ]);
    // Preserve indices so a rejected chart cannot shift another chart into its placeholder.
    const dataBlocks = (article.dataBlocks ?? []).map(block =>
      isSourceLinkedChart(block) && knownSources.has(block.sourceUrl!) ? block : null,
    );

    const isAlphaNum = (ch: string) => /[A-Za-z0-9]/.test(ch);

    // Fallback highlight: when the LLM doesn't insert [[Entity]] markers in bodyMarkdown,
    // still highlight entity names if they appear verbatim in the prose.
    const autoHighlightEntities = (text: string): (string | React.ReactNode)[] => {
      const usable: ArticleEntity[] = entities
        .filter((e): e is ArticleEntity => !!e?.name)
        .map((e) => {
          const def = e.definition?.trim() || lookupGlossaryDefinition(e.name);
          return { name: e.name, definition: def } as ArticleEntity;
        })
        .filter((e) => !!e.definition && e.name.trim().length >= 3);

      if (usable.length === 0) return [text];

      const textLower = text.toLowerCase();
      type Match = { start: number; end: number; entity: ArticleEntity };
      const matches: Match[] = [];

      for (const entity of usable) {
        const needleLower = entity.name.toLowerCase();
        if (!needleLower.trim()) continue;

        let idx = 0;
        while (idx < textLower.length) {
          const found = textLower.indexOf(needleLower, idx);
          if (found < 0) break;

          const start = found;
          const end = found + needleLower.length;

          const before = start > 0 ? text[start - 1] : "";
          const after = end < text.length ? text[end] : "";

          // Avoid highlighting inside larger alphanumeric tokens.
          if ((start > 0 && isAlphaNum(before)) || (end < text.length && isAlphaNum(after))) {
            idx = end;
            continue;
          }

          matches.push({ start, end, entity });
          idx = end;
        }
      }

      if (matches.length === 0) return [text];

      // Sort by earliest match; for ties prefer longer matches.
      matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

      const nodes: (string | React.ReactNode)[] = [];
      let cursor = 0;
      let lastEnd = 0;

      for (const m of matches) {
        if (m.start < lastEnd) continue;
        if (cursor < m.start) nodes.push(text.slice(cursor, m.start));
        nodes.push(
          <EntityHighlight
            key={`entity-auto-${m.entity.name}-${m.start}`}
            name={m.entity.name}
            definition={m.entity.definition}
          />,
        );
        cursor = m.end;
        lastEnd = m.end;
      }

      if (cursor < text.length) nodes.push(text.slice(cursor));
      return nodes;
    };

    return {
      p: ({ children }: any) => {
        const processText = (text: string): (string | React.ReactNode)[] => {
          let result: (string | React.ReactNode)[] = [text];

          // Charts
          result = result.flatMap((part) => {
            if (typeof part !== "string") return part;
            const chartRegex = /\[CHART:(\d+)\]/g;
            const parts: (string | React.ReactNode)[] = [];
            let lastIndex = 0;
            let match;
            while ((match = chartRegex.exec(part)) !== null) {
              parts.push(part.slice(lastIndex, match.index));
              const chartIdx = parseInt(match[1], 10);
              const block = dataBlocks[chartIdx];
              if (block && block.title && Array.isArray(block.data)) {
                parts.push(
                  <DataVisChart
                    key={`chart-${chartIdx}`}
                    title={block.title}
                    type={block.type}
                    xAxisLabel={block.xAxisLabel}
                    yAxisLabel={block.yAxisLabel}
                    data={block.data}
                    sourceName={block.sourceName}
                    sourceUrl={block.sourceUrl}
                    metric={block.metric}
                    unit={block.unit}
                  />,
                );
              }
              lastIndex = chartRegex.lastIndex;
            }
            parts.push(part.slice(lastIndex));
            return parts;
          });

          // Entities
          result = result.flatMap((part) => {
            if (typeof part !== "string") return part;

            const entityRegex = /\[\[(.*?)\]\]/g;
            const parts: (string | React.ReactNode)[] = [];
            let lastIndex = 0;
            let match;
            let foundExplicit = false;
            let insertedExplicit = false;

            while ((match = entityRegex.exec(part)) !== null) {
              foundExplicit = true;
              parts.push(part.slice(lastIndex, match.index));
              const raw = match[1];
              const pipeIdx = raw.indexOf("|");
              const entityName = pipeIdx >= 0 ? raw.slice(0, pipeIdx).trim() : raw;
              const inlineDef = pipeIdx >= 0 ? raw.slice(pipeIdx + 1).trim() : "";
              const entityData = entities.find((e) => e?.name?.toLowerCase() === entityName?.toLowerCase());
              const explicitDefinition = entityData?.definition?.trim();
              const fallbackDefinition = !explicitDefinition && !inlineDef ? lookupGlossaryDefinition(entityName) : "";
              const resolvedDefinition = explicitDefinition || inlineDef || fallbackDefinition;
              const resolvedName = entityData?.name || entityName;

              if (resolvedDefinition) {
                parts.push(
                  <EntityHighlight
                    key={`entity-${entityName}-${match.index}`}
                    name={resolvedName}
                    definition={resolvedDefinition}
                  />,
                );
                insertedExplicit = true;
              } else {
                parts.push(entityName);
              }
              lastIndex = entityRegex.lastIndex;
            }

            // Fallback if no explicit [[...]] markers were present in this string chunk.
            // When markers ARE present, the while loop already handled them
            // (pushing EntityHighlight for known entities or plain text for unknown ones).
            // Don't fall back — autoHighlightEntities doesn't strip [[ brackets ]].
            if (!foundExplicit) return autoHighlightEntities(part);

            parts.push(part.slice(lastIndex));
            return parts;
          });

          return result;
        };

        const finalChildren = React.Children.toArray(children).flatMap((node) => {
          if (typeof node === "string") return processText(node);
          return node;
        });

        return <div className="article-paragraph">{finalChildren}</div>;
      },

      // If the model omitted [CHART:n] placeholders, still render charts beneath "The Data Insight" heading.
      h3: ({ children }: any) => {
        const headingText = React.Children.toArray(children)
          .map((c) => (typeof c === "string" ? c : ""))
          .join("");

        const normalized = headingText.toLowerCase().replace(/\s+/g, " ").trim();
        const isDataInsightHeading = normalized.includes("the data insight");
        // Give legacy generated section titles concise labels without changing reporting.
        const sectionLabels: Record<string, string> = {
          "the dispatch: the immediate news and its primary impact": "What happened",
          "the context: historical background and broader industry trends": "The context",
          "the data insight: a rigorous analysis of the underlying numbers": "By the numbers",
          "the horizon: long-term implications and the future outlook": "What to watch",
        };

        return (
          <>
            <h3>{sectionLabels[normalized] ?? children}</h3>
            {isDataInsightHeading && dataBlocks.length > 0 && !chartTokensPresent && (
              <div className="mt-6">
                {dataBlocks.map((block, idx) => block && (
                  <DataVisChart
                    key={`auto-chart-${idx}`}
                    title={block.title}
                    type={block.type}
                    xAxisLabel={block.xAxisLabel}
                    yAxisLabel={block.yAxisLabel}
                    data={block.data}
                    sourceName={block.sourceName}
                    sourceUrl={block.sourceUrl}
                    metric={block.metric}
                    unit={block.unit}
                  />
                ))}
              </div>
            )}
          </>
        );
      },
    };
  }, [article, content, chartTokensPresent]);

  // Process DOM: wrap every word in a span when voice reader activates
  useEffect(() => {
    if (!voiceActive || !bodyRef.current) {
      wordSpansAppliedRef.current = false;
      return;
    }

    // Avoid re-processing if already applied (unless content changed)
    if (wordSpansAppliedRef.current) return;

    const walker = document.createTreeWalker(
      bodyRef.current,
      NodeFilter.SHOW_TEXT,
      null,
    );

    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    let wordIdx = 0;
    const allSpans: HTMLElement[] = [];

    for (const node of textNodes) {
      const text = node.textContent || "";
      if (text.trim().length === 0) continue;

      const parts = text.split(/(\s+)/);
      const fragment = document.createDocumentFragment();

      for (const part of parts) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          fragment.appendChild(document.createTextNode(part));
        } else {
          const span = document.createElement("span");
          span.className =
            "vr-word inline transition-all duration-75 rounded-sm cursor-default";
          span.dataset.wi = String(wordIdx++);
          span.textContent = part;
          fragment.appendChild(span);
          allSpans.push(span);
        }
      }

      node.parentNode?.replaceChild(fragment, node);
    }

    wordElsRef.current = allSpans;
    wordSpansAppliedRef.current = true;
  }, [voiceActive, content]);

  return (
    <motion.div
      ref={scrollRef}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="article-reader fixed left-0 right-0 bottom-0 z-50 bg-paper overflow-y-auto selection:bg-black selection:text-white"
      style={{ top: "var(--site-chrome-h, 0px)" }}
    >
      {/* Article toolbar — pinned to the top of the reader pane */}
          <nav className="sticky top-0 z-50 bg-paper/95 backdrop-blur-md border-b border-ink/10 flex flex-col">
            <div className="px-4 md:px-6 py-3 flex items-center justify-between">
              <button 
                onClick={onClose}
              className="flex items-center gap-3 text-[10px] font-mono font-bold uppercase tracking-[0.2em] group"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              Front page
            </button>
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-4 md:gap-6">
                <button 
                  title={isBookmarked ? "Remove Bookmark" : "Bookmark Article"} 
                  onClick={onBookmark}
                  className={cn("group p-2 hover:bg-ink/5 rounded-full transition-colors relative", isBookmarked && "text-accent")}
                >
                  <Bookmark size={18} className={cn(isBookmarked && "fill-accent")} />
                </button>
                <div className="w-px h-4 bg-ink/10" />
                <button
                  title="Share News"
                  onClick={onShare}
                  type="button"
                  className="group flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest hover:text-accent transition-colors"
                >
                  <Share2 size={16} />
                  <span className="hidden sm:inline">Share</span>
                </button>
                <button
                  title="Listen to Article"
                  onClick={() => {
                    if (!voiceActive) {
                      // Unlock AudioContext during the user gesture so autoplay can start on first chunk.
                      try {
                        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
                        const ctx = new Ctx();
                        void ctx.resume().finally(() => { void ctx.close(); });
                      } catch { /* ignore */ }
                      setBriefOnly(false);
                      setVoiceActive(true);
                    } else {
                      setVoiceActive(false);
                    }
                  }}
                  className={cn(
                    "group flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors",
                    voiceActive ? "text-accent" : "hover:text-accent",
                  )}
                >
                  <Headphones size={16} className={cn(voiceActive && "animate-pulse")} />
                  <span className="hidden sm:inline">{voiceActive ? "Close" : "Listen"}</span>
                </button>
                <button aria-label="Close article" onClick={onClose} className="p-1 hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
            </div>
          </div>
            <motion.div 
              className="h-[2px] bg-accent origin-left w-full absolute bottom-[-1px] left-0 right-0 z-50"
              style={{ scaleX }}
            />
          </nav>

          <article className="article-shell">
            <div className={cn("article-opening", (!article.imageUrl || heroImageFailed) && "article-opening--text")}>
              <header className="article-heading">
                <button type="button" className="article-category" onClick={() => onNavigate?.(categoryPath(article.category))}>{article.category} <span aria-hidden="true">↗</span></button>
                <h1 id="article-headline">{article.title}</h1>
                {article.excerpt && <p className="article-deck">{article.excerpt}</p>}
                <div className="article-byline">
                  <span>By <strong>{article.author}</strong></span>
                  <span>{article.readTime} read</span>
                </div>
                <time className="article-date" dateTime={article.publishedAt}>{formatPublishedTimestamp(article.publishedAt)}</time>
                {article.updatedAt && article.updatedAt !== article.publishedAt && <time className="article-date" dateTime={article.updatedAt}>Updated {formatPublishedTimestamp(article.updatedAt)}</time>}
              </header>
              {article.imageUrl && !heroImageFailed && (
                <figure className="article-cover">
                  <img src={article.imageUrl} alt={article.title} referrerPolicy="no-referrer" fetchPriority="high" decoding="async" onError={() => setHeroImageFailed(true)} />
                  {article.imageCredit && <figcaption>{article.imageCredit}</figcaption>}
                </figure>
              )}
            </div>

            {editorialSummary && (
              <section className="article-brief" aria-label="Story summary">
                <div className="article-brief-label">The short version<span>Get the story in seconds.</span></div>
                <p className="tldr-answer-engine">{editorialSummary}</p>
              </section>
            )}

            <div className={cn("article-reading-layout", briefOnly && "article-reading-layout--brief")}>
              <aside className="article-context" aria-label="Story context" hidden={briefOnly}>
                <div className="article-context-inner">
                  {article.tldr?.whyItMatters && <section><h2>Why it matters</h2><p>{article.tldr.whyItMatters}</p></section>}
                  {article.tldr?.whoIsAffected && <section><h2>Who it affects</h2><p>{article.tldr.whoIsAffected}</p></section>}
                  {article.tldr?.whatIsNext && <section><h2>What’s next</h2><p>{article.tldr.whatIsNext}</p></section>}
                </div>
              </aside>
              <div className="article-story">
                {briefText && (
                  <div className="article-reading-mode" role="group" aria-label="Reading format">
                    <button type="button" aria-pressed={!briefOnly} aria-controls="article-full-story article-brief-story" onClick={() => setBriefOnly(false)}>Full story</button>
                    <button type="button" aria-pressed={briefOnly} aria-controls="article-full-story article-brief-story" onClick={() => { setBriefOnly(true); setVoiceActive(false); }}>Just the brief</button>
                    <span>{briefOnly ? "You’re caught up." : article.readTime + " read"}</span>
                  </div>
                )}
                {briefOnly && (
                  <section id="article-brief-story" className="article-brief-story" aria-label="Just the brief">
                    <h2>The brief</h2>
                    <div className="markdown-body article-prose">
                      <ReactMarkdown components={components as any}>{briefText}</ReactMarkdown>
                    </div>
                  </section>
                )}
                <div id="article-full-story" hidden={briefOnly}>
                  <div ref={bodyRef} className="markdown-body article-prose">
                    <ReactMarkdown components={components as any}>{content}</ReactMarkdown>
                  </div>
                  {!!article.additionalImages?.length && (
                    <section className="article-gallery" aria-label="More images from the story">
                      {article.additionalImages.map((img, idx) => <figure key={`${img.url}-${idx}`}>
                        <img src={img.url} alt={img.caption} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} />
                        <figcaption>{img.caption}{img.credit && <span>{img.credit}</span>}</figcaption>
                      </figure>)}
                    </section>
                  )}
                </div>
                {!!article.citations?.length && (
                  <details className="article-sources">
                    <summary>Behind the story <span>{article.citations.length} source notes</span></summary>
                    <ul>{article.citations.map((citation, idx) => <li key={`${citation.sourceUrl}-${idx}`}>
                      <a href={citation.sourceUrl} target="_blank" rel="noreferrer"><span>{citation.claim}<small>{citation.sourceName}</small></span><ExternalLink size={15} aria-hidden="true" /></a>
                    </li>)}</ul>
                  </details>
                )}
              </div>
            </div>

            <AdSlot slotId="article-below-body" />

            {onOpenArticle && onNavigate && (
              <RelatedArticles
                article={article}
                related={related}
                onOpenArticle={onOpenArticle}
                onNavigate={onNavigate}
              />
            )}

            <div className="mt-12">
              <NewsletterCta
                variant="compact"
                defaultTopics={[article.category]}
              />
            </div>

            <p className="mt-8 text-center text-xs">
              <button
                type="button"
                className="font-mono uppercase tracking-widest text-accent"
                onClick={() => onNavigate?.(categoryPath(article.category))}
              >
                More {article.category} news
              </button>
            </p>

            <div className="mt-12">
              <TipBox postSlug={article.slug} />
            </div>

            <footer className="mt-20 md:mt-32 pt-12 md:pt-16 border-t-[3px] border-ink">
               <div className="flex flex-col md:flex-row justify-between items-start gap-8 md:gap-12 leading-none">
                  <div>
                    <h2 className="text-3xl md:text-5xl font-serif font-black uppercase tracking-tighter mb-4 text-center md:text-left">Times of San Francisco</h2>
                    <p className="text-[10px] font-mono uppercase tracking-widest opacity-30">Independent San Francisco Journalism</p>
                  </div>
                  <button onClick={onClose} className="w-full md:w-auto group relative px-8 md:px-10 py-4 md:py-5 bg-ink text-paper text-[10px] font-bold uppercase tracking-[0.2em] md:tracking-[0.3em] overflow-hidden">
                    <span className="relative z-10">Return to Front Page</span>
                    <div className="absolute inset-0 bg-accent translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                  </button>
               </div>
            </footer>
          </article>

          {voiceActive && (
            <React.Suspense fallback={null}>
              <VoiceReader
                text={plainText}
                title={article.title}
                autoPlay
                onWordChange={setActiveWord}
                onClose={() => setVoiceActive(false)}
              />
            </React.Suspense>
          )}

          {/* Bottom padding when voice reader is active */}
          {voiceActive && <div className="h-24" />}
    </motion.div>
  );
}

export function ReaderView({ article, allArticles, onClose, onNavigate, onOpenArticle, isBookmarked, onBookmark, onShare }: ReaderViewProps) {
  return (
    <AnimatePresence>
      {article && (
        <ReaderContent
          key={article.id}
          article={article}
          allArticles={allArticles}
          onClose={onClose}
          onNavigate={onNavigate}
          onOpenArticle={onOpenArticle}
          isBookmarked={isBookmarked}
          onBookmark={onBookmark}
          onShare={onShare}
        />
      )}
    </AnimatePresence>
  );
}
