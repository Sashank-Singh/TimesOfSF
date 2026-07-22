import React, { useState, useRef, useMemo, useEffect } from "react";
import { Article, ArticleEntity } from "../types";
import { NewsletterCta } from "./NewsletterCta";
import { AdSlot } from "./AdSlot";
import { pickRelatedArticles, RelatedArticles } from "./RelatedArticles";
import { categoryPath } from "../lib/routes";
import { motion, AnimatePresence, useScroll, useSpring } from "motion/react";
import { X, ArrowLeft, Share2, Bookmark, ChevronDown, ChevronUp, ExternalLink, Headphones } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { formatPublishedTimestamp, cn, stripCitationSectionsForTts, stripMarkdown, buildEditorialSummary } from "../lib/utils";

import { EntityHighlight } from "./EntityHighlight";
import { DataVisChart } from "./DataVisChart";
import { lookupGlossaryDefinition } from "../lib/glossary";

const categoryGradients: Record<string, string> = {
  Tech: "from-indigo-900/80 via-indigo-800/60 to-transparent",
  Funding: "from-emerald-900/80 via-emerald-800/60 to-transparent",
  Civics: "from-slate-800/80 via-slate-700/60 to-transparent",
  Culture: "from-violet-900/80 via-violet-800/60 to-transparent",
  Transit: "from-sky-900/80 via-sky-800/60 to-transparent",
  Food: "from-amber-900/80 via-amber-800/60 to-transparent",
  Events: "from-rose-900/80 via-rose-800/60 to-transparent",
};

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
  const [showSummary, setShowSummary] = useState(true);
  const editorialSummary = useMemo(
    () => buildEditorialSummary({ summary: article.summary, excerpt: article.excerpt, tldr: article.tldr }),
    [article.summary, article.excerpt, article.tldr],
  );
  const content = article.content;
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
    const dataBlocks = article.dataBlocks ?? [];

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

        return <div className="mb-8 leading-relaxed font-serif text-lg md:text-xl text-ink/80">{finalChildren}</div>;
      },

      // If the model omitted [CHART:n] placeholders, still render charts beneath "The Data Insight" heading.
      h3: ({ children }: any) => {
        const headingText = React.Children.toArray(children)
          .map((c) => (typeof c === "string" ? c : ""))
          .join("");

        const normalized = headingText.toLowerCase().replace(/\s+/g, " ").trim();
        const isDataInsightHeading = normalized.includes("the data insight");

        return (
          <>
            <h3>{children}</h3>
            {isDataInsightHeading && dataBlocks.length > 0 && !chartTokensPresent && (
              <div className="mt-6">
                {dataBlocks.map((block, idx) => (
                  <DataVisChart
                    key={`auto-chart-${idx}`}
                    title={block.title}
                    type={block.type}
                    xAxisLabel={block.xAxisLabel}
                    yAxisLabel={block.yAxisLabel}
                    data={block.data}
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
      className="fixed left-0 right-0 bottom-0 z-50 bg-paper overflow-y-auto selection:bg-black selection:text-white"
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
              Close
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
                <button onClick={onClose} className="p-1 hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
            </div>
          </div>
            <motion.div 
              className="h-[2px] bg-accent origin-left w-full absolute bottom-[-1px] left-0 right-0 z-50"
              style={{ scaleX }}
            />
          </nav>

          <article className="max-w-4xl mx-auto px-4 md:px-6 py-12 md:py-32">
            <header className="mb-12 md:mb-20 text-center max-w-2xl mx-auto">
               <div className="flex items-center justify-center gap-4 text-accent font-mono text-[10px] md:text-[11px] uppercase tracking-[0.4em] mb-8 md:mb-10">
                  <span className="w-8 md:w-12 h-[1px] bg-accent/20" />
                  {article.category}
                  <span className="w-8 md:w-12 h-[1px] bg-accent/20" />
               </div>
               <h1 id="article-headline" className="text-4xl sm:text-5xl md:text-7xl font-black leading-[0.95] tracking-tight mb-8 md:mb-12">
                  {article.title}
               </h1>
               <div className="flex flex-col items-center gap-3 text-xs text-ink/40">
                {article.excerpt &&
                  article.excerpt.trim().toLowerCase() !== editorialSummary.trim().toLowerCase() && (
                  <span className="article-lead italic font-serif text-base md:text-lg text-ink/60 mb-2 px-4">
                    {article.excerpt}
                  </span>
                )}
                  <div className="flex flex-col items-center gap-1 font-mono uppercase tracking-[0.1em]">
                    <span className="flex items-center gap-4">
                      <span>By {article.author}</span>
                      <span className="w-1 h-1 bg-ink/10 rounded-full" />
                      <span>{article.readTime} read</span>
                    </span>
                    <time
                      dateTime={article.publishedAt}
                      className="text-[10px] tracking-widest text-ink/45 normal-case"
                      title={article.publishedAt}
                    >
                      Published {formatPublishedTimestamp(article.publishedAt)}
                    </time>
                    {article.updatedAt && article.updatedAt !== article.publishedAt && (
                      <time
                        dateTime={article.updatedAt}
                        className="text-[10px] tracking-widest text-ink/45 normal-case"
                        title={article.updatedAt}
                      >
                        Updated {formatPublishedTimestamp(article.updatedAt)}
                      </time>
                    )}
                  </div>
               </div>
            </header>

            {/* Summary Section */}
            {editorialSummary && (
              <div className="max-w-xl mx-auto mb-12 md:mb-20 border border-ink/10 p-6 bg-ink/[0.02]">
                <button
                  type="button"
                  onClick={() => setShowSummary(!showSummary)}
                  className="w-full flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-widest text-ink/50"
                  aria-expanded={showSummary}
                >
                  <span>In Brief</span>
                  {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <AnimatePresence initial={false}>
                  {showSummary && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <p className="tldr-answer-engine mt-4 pt-6 border-t border-ink/5 text-[15px] font-serif leading-relaxed text-ink/75">
                        {editorialSummary}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Main content area */}

            <div className="relative aspect-video md:aspect-[21/9] mb-12 md:mb-24 overflow-hidden rounded-2xl shadow-2xl transition-all duration-1000 ease-out group/hero">
               {article.imageUrl && !heroImageFailed ? (
                 <img
                   src={article.imageUrl}
                   alt={`${article.title} — ${article.category}`}
                   className="w-full h-full object-cover group-hover/hero:scale-105 transition-transform duration-1000"
                   referrerPolicy="no-referrer"
                   fetchPriority="high"
                   decoding="async"
                   onError={() => setHeroImageFailed(true)}
                 />
               ) : (
                 <div className={`w-full h-full bg-gradient-to-br ${categoryGradients[article.category] || categoryGradients.Tech}`} />
               )}
               {article.imageCredit && (
                 <div className="absolute bottom-4 md:bottom-8 right-4 md:right-8 flex flex-col items-end gap-1">
                   <div className="flex items-center gap-2 bg-paper/90 backdrop-blur-md px-3 md:px-4 py-1.5 md:py-2 rounded-sm border border-ink/10 shadow-lg">
                     <span className="text-[8px] md:text-[9px] font-mono font-bold tracking-widest uppercase text-ink/60">
                       {article.imageCredit}
                     </span>
                     <sup className="text-[8px] font-mono text-accent font-bold">(2)</sup>
                   </div>
                   <span className="text-[7px] font-mono uppercase tracking-tighter opacity-30 text-ink mr-1">Source-linked dispatch</span>
                 </div>
               )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="hidden lg:block lg:col-span-3">
                 <div className="sticky top-32 space-y-12 pr-8 border-r border-ink/5">
                    {article.additionalImages && article.additionalImages.length > 0 && (
                      <div className="space-y-6">
                        <h4 className="text-[10px] font-mono uppercase tracking-widest text-ink/30">Visual Evidence</h4>
                        {article.additionalImages.map((img, idx) => (
                          <div key={idx} className="group flex flex-col gap-3">
                            <div className="aspect-[4/3] overflow-hidden bg-ink/5 rounded-lg shadow-md">
                              <img
                                src={img.url}
                                alt={img.caption}
                                className="w-full h-full object-cover group-hover:scale-105 transition-all duration-500"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                decoding="async"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            </div>
                            <p className="text-[9px] leading-tight text-ink/50 uppercase tracking-tight">{img.caption}</p>
                            <p className="text-[8px] font-mono text-ink/30 uppercase">{img.credit}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div>
                      <h4 className="text-[10px] font-mono uppercase tracking-widest text-ink/30 mb-4">Keywords</h4>
                      <div className="flex flex-wrap gap-2 uppercase font-mono text-[9px] tracking-tighter">
                        <span className="px-2 py-1 bg-ink/5">#Local</span>
                        <span className="px-2 py-1 bg-ink/5">#Archive</span>
                        <span className="px-2 py-1 bg-ink/5">#Report</span>
                      </div>
                    </div>
                 </div>
              </div>

              <div className="lg:col-span-8 lg:col-start-5">
                <div ref={bodyRef} className="markdown-body">
                  <ReactMarkdown components={components as any}>{content}</ReactMarkdown>
                </div>

                {(!!article.citations?.length) && (
                  <section className="mt-16 md:mt-20 border-t-[3px] border-ink pt-10">
                    <div className="mb-8">
                      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.3em] text-accent mb-3">Receipts</p>
                      <h3 className="text-3xl md:text-4xl font-black tracking-tight">Sources & Evidence</h3>
                      <p className="mt-3 text-xs text-ink/50 leading-relaxed max-w-2xl">
                        One-line linked receipts for claims used in this report.
                      </p>
                    </div>

                    {!!article.citations?.length && (
                      <div className="mb-10">
                        <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink/40 mb-3">Claim Notes</h4>
                        <ul className="border border-ink/10 rounded-sm divide-y divide-ink/10">
                          {article.citations.map((citation, idx) => (
                            <li key={`${citation.sourceUrl}-${idx}`}>
                              <a
                                href={citation.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/[0.03] transition-colors group"
                              >
                                <span className="flex-1 min-w-0 text-xs text-ink/80 truncate">{citation.claim}</span>
                                <span className="shrink-0 text-[10px] font-mono uppercase tracking-tight text-ink/35">
                                  {citation.sourceName}
                                </span>
                                <ExternalLink size={14} className="text-accent shrink-0 opacity-40 group-hover:opacity-100" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}
                
                {/* Mobile/Tablet Additional Images */}
                <div className="lg:hidden mt-20 space-y-12">
                  <h4 className="text-[10px] font-mono uppercase tracking-widest text-ink/30 text-center mb-8">Additional Dispatch Imagery</h4>
                  {article.additionalImages?.map((img, idx) => (
                    <figure key={idx} className="space-y-4">
                      <div className="aspect-video bg-ink/5 overflow-hidden">
                        <img
                          src={img.url}
                          alt={img.caption}
                          className="w-full h-full object-cover grayscale brightness-90 transition-all duration-500"
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                      <figcaption className="flex justify-between items-start gap-4">
                        <p className="text-[10px] font-mono leading-relaxed text-ink/60 uppercase max-w-[70%]">{img.caption}</p>
                        <p className="text-[9px] font-mono text-ink/30 uppercase shrink-0">{img.credit}</p>
                      </figcaption>
                    </figure>
                  ))}
                </div>
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

            <footer className="mt-20 md:mt-32 pt-12 md:pt-16 border-t-[3px] border-ink">
               <div className="flex flex-col md:flex-row justify-between items-start gap-8 md:gap-12 leading-none">
                  <div>
                    <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter mb-4 whitespace-nowrap">Times of SF</h2>
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
          key="reader"
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
