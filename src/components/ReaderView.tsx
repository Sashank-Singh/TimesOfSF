import React, { useState, useRef, useMemo } from "react";
import { Article } from "../types";
import { motion, AnimatePresence, useScroll, useSpring } from "motion/react";
import { X, ArrowLeft, Share2, Bookmark, ChevronDown, ChevronUp, ExternalLink, ShieldCheck, AlertTriangle, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { formatDate, cn } from "../lib/utils";
import { DEFAULT_IMAGE } from "../services/newsService";
import { EntityHighlight } from "./EntityHighlight";
import { DataVisChart } from "./DataVisChart";

import { expandArticle } from "../services/newsService";

interface ReaderViewProps {
  article: Article | null;
  onClose: () => void;
  isBookmarked: boolean;
  onBookmark: () => void;
  onShare: () => void;
}

function ReaderContent({ article, onClose, isBookmarked, onBookmark, onShare }: { article: Article } & Omit<ReaderViewProps, 'article'>) {
  const [showSummary, setShowSummary] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [content, setContent] = useState(article.content);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourceCount = article.credits?.length ?? 0;
  const confirmedFactCount = article.credits?.reduce((count, credit) => count + (credit.factBullets?.length ?? 0), 0) ?? 0;
  const citationCount = article.citations?.length ?? 0;
  const sourceTypeLabel = (type?: string) => (type || "reporting").replace(/_/g, " ");
  
  const { scrollYProgress } = useScroll({
    container: scrollRef
  });

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const components = useMemo(() => ({
    p: ({ children }: any) => {
      const processText = (text: string): (string | React.ReactNode)[] => {
        let result: (string | React.ReactNode)[] = [text];
        
        // Charts
        result = result.flatMap(part => {
          if (typeof part !== 'string') return part;
          const chartRegex = /\[CHART:(\d+)\]/g;
          const parts: (string | React.ReactNode)[] = [];
          let lastIndex = 0;
          let match;
          while ((match = chartRegex.exec(part)) !== null) {
            parts.push(part.slice(lastIndex, match.index));
            const chartIdx = parseInt(match[1], 10);
            if (article.dataBlocks?.[chartIdx]) {
              const block = article.dataBlocks[chartIdx];
              if (block.title && Array.isArray(block.data)) {
                parts.push(<DataVisChart key={`chart-${chartIdx}`} title={block.title} data={block.data} />);
              }
            }
            lastIndex = chartRegex.lastIndex;
          }
          parts.push(part.slice(lastIndex));
          return parts;
        });

        // Entities
        result = result.flatMap(part => {
          if (typeof part !== 'string') return part;
          const entityRegex = /\[\[(.*?)\]\]/g;
          const parts: (string | React.ReactNode)[] = [];
          let lastIndex = 0;
          let match;
          while ((match = entityRegex.exec(part)) !== null) {
            parts.push(part.slice(lastIndex, match.index));
            const entityName = match[1];
            const entityData = article.entities?.find(e => e?.name?.toLowerCase() === entityName?.toLowerCase());
            if (entityData?.name && entityData?.definition) {
              parts.push(<EntityHighlight key={`entity-${entityName}`} name={entityData.name} definition={entityData.definition} />);
            } else {
              parts.push(entityName);
            }
            lastIndex = entityRegex.lastIndex;
          }
          parts.push(part.slice(lastIndex));
          return parts;
        });

        return result;
      };

      const finalChildren = React.Children.toArray(children).flatMap(node => {
        if (typeof node === 'string') return processText(node);
        return node;
      });

      return <div className="mb-8 leading-relaxed font-serif text-lg md:text-xl text-ink/80">{finalChildren}</div>;
    }
  }), [article]);

  return (
    <motion.div
      ref={scrollRef}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 bg-paper overflow-y-auto selection:bg-black selection:text-white"
    >
      {/* Subtle Progress Header */}
          <nav className="sticky top-0 z-50 bg-paper/90 backdrop-blur-sm border-b border-ink/5 flex flex-col">
            <div className="px-6 py-4 flex items-center justify-between">
              <button 
                onClick={onClose}
              className="flex items-center gap-3 text-[10px] font-mono font-bold uppercase tracking-[0.2em] group"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              Close
            </button>
            <div className="flex items-center gap-8">
              <div className="hidden lg:block text-[10px] font-mono uppercase tracking-widest opacity-30 whitespace-nowrap">
                Times of SF / Special Report
              </div>
              <div className="flex items-center gap-6">
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
                  className="group flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest hover:text-accent transition-colors"
                >
                  <Share2 size={16} />
                  <span className="hidden sm:inline">Share</span>
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
               <h1 className="text-4xl sm:text-5xl md:text-7xl font-black leading-[0.95] tracking-tight mb-8 md:mb-12">
                  {article.title}
               </h1>
               <div className="flex flex-col items-center gap-3 text-xs text-ink/40">
                <span className="italic font-serif text-base md:text-lg text-ink/60 mb-2 px-4">{article.excerpt}</span>
                <div className="flex flex-wrap items-center justify-center gap-2 text-[9px] font-mono uppercase tracking-widest text-ink/45">
                  <span className="px-2 py-1 border border-ink/10 bg-paper">Sources: {sourceCount || "review below"}</span>
                  <span className="px-2 py-1 border border-ink/10 bg-paper">Evidence facts: {confirmedFactCount}</span>
                  <span className="px-2 py-1 border border-ink/10 bg-paper">Citations: {citationCount}</span>
                </div>
                  <div className="flex items-center gap-4 font-mono uppercase tracking-[0.1em]">
                    <span>By {article.author}</span>
                    <span className="w-1 h-1 bg-ink/10 rounded-full" />
                    <span>{formatDate(article.date)}</span>
                  </div>
               </div>
            </header>

            {/* Summary Section */}
            <div className="max-w-xl mx-auto mb-12 md:mb-20 border border-ink/10 p-6 bg-ink/[0.02]">
              <button 
                onClick={() => setShowSummary(!showSummary)}
                className="w-full flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-widest"
              >
                <span>Editorial Summary</span>
                {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <AnimatePresence>
                {showSummary && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 pt-6 border-t border-ink/5 flex flex-col gap-6">
                      <p className="text-sm font-serif italic text-ink/70 leading-relaxed">
                        {article.excerpt} This AI-assisted report is generated from linked source material. Review the source list and claim notes below before relying on any specific detail.
                      </p>
                      
                      {article.tldr && (
                        <ul className="space-y-4">
                          <li className="flex gap-4">
                            <div className="shrink-0 pt-1">
                              <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-widest px-2 py-1 bg-accent/5 rounded-sm">The Stakes</span>
                            </div>
                            <p className="text-xs leading-relaxed text-ink/70 font-medium">{article.tldr.whyItMatters}</p>
                          </li>
                          <li className="flex gap-4">
                            <div className="shrink-0 pt-1">
                              <span className="text-[10px] font-mono font-bold text-ink/40 uppercase tracking-widest px-2 py-1 bg-ink/5 rounded-sm">The Backdrop</span>
                            </div>
                            <p className="text-xs leading-relaxed text-ink/60">{article.tldr.whoIsAffected}</p>
                          </li>
                          <li className="flex gap-4">
                            <div className="shrink-0 pt-1">
                              <span className="text-[10px] font-mono font-bold text-ink/20 uppercase tracking-widest px-2 py-1 bg-ink/5 rounded-sm">The Horizon</span>
                            </div>
                            <p className="text-xs leading-relaxed text-ink/60">{article.tldr.whatIsNext}</p>
                          </li>
                        </ul>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Main content area */}

            <div className="relative aspect-video md:aspect-[21/9] mb-12 md:mb-24 overflow-hidden rounded-2xl shadow-2xl transition-all duration-1000 ease-out group/hero">
               <img 
                 src={article.imageUrl}
                 alt={article.title}
                 className="w-full h-full object-cover group-hover/hero:scale-105 transition-transform duration-1000"
                 referrerPolicy="no-referrer"
                 onError={(e) => {
                   (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
                 }}
               />
               <div className="absolute bottom-4 md:bottom-8 right-4 md:right-8 flex flex-col items-end gap-1">
                 <div className="flex items-center gap-2 bg-paper/90 backdrop-blur-md px-3 md:px-4 py-1.5 md:py-2 rounded-sm border border-ink/10 shadow-lg">
                   <span className="text-[8px] md:text-[9px] font-mono font-bold tracking-widest uppercase text-ink/60">
                     {article.imageCredit || "Field Photography / SF Archive"}
                   </span>
                   <sup className="text-[8px] font-mono text-accent font-bold">(2)</sup>
                 </div>
                 <span className="text-[7px] font-mono uppercase tracking-tighter opacity-30 text-ink mr-1">Press Dispatch / Verified</span>
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="hidden lg:block lg:col-span-3">
                 <div className="sticky top-32 space-y-12 pr-8 border-r border-ink/5">
                    <div>
                      <h4 className="text-[10px] font-mono uppercase tracking-widest text-ink/30 mb-4">Truth Status</h4>
                      <div className="space-y-3 text-[11px] leading-relaxed text-ink/55">
                        <div className="flex items-start gap-2">
                          <ShieldCheck size={14} className="text-accent shrink-0 mt-0.5" />
                          <span>{confirmedFactCount} source-backed fact notes from {sourceCount || "linked"} source{sourceCount === 1 ? "" : "s"}.</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={14} className="text-ink/35 shrink-0 mt-0.5" />
                          <span>AI-assisted synthesis. Source notes below show what is confirmed, unclear, and attributed.</span>
                        </div>
                      </div>
                    </div>
                    {!!article.credits?.length && (
                      <div>
                        <h4 className="text-[10px] font-mono uppercase tracking-widest text-ink/30 mb-4">Source Map</h4>
                        <div className="space-y-3">
                          {article.credits.slice(0, 8).map((credit, idx) => (
                            <a
                              key={`${credit.articleUrl}-${idx}`}
                              href={credit.articleUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block border border-ink/10 p-3 hover:border-accent/40 hover:bg-accent/[0.02] transition-colors"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink/70">{credit.sourceName}</span>
                                <ExternalLink size={12} className="text-accent shrink-0" />
                              </div>
                              <p className="mt-2 text-[9px] font-mono uppercase tracking-tight text-ink/35">{sourceTypeLabel(credit.sourceType)} / {credit.confidence || "medium"} confidence</p>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
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
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
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
                <section className="mb-12 md:mb-16 border-2 border-ink bg-paper shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-ink">
                    <div className="p-5">
                      <div className="flex items-center gap-2 text-accent mb-3">
                        <ShieldCheck size={16} />
                        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Confirmed</h3>
                      </div>
                      <p className="text-3xl font-black leading-none mb-2">{confirmedFactCount}</p>
                      <p className="text-[11px] leading-relaxed text-ink/55">fact notes attached to named sources.</p>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 text-ink/50 mb-3">
                        <FileText size={16} />
                        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Receipts</h3>
                      </div>
                      <p className="text-3xl font-black leading-none mb-2">{sourceCount}</p>
                      <p className="text-[11px] leading-relaxed text-ink/55">linked sources used in this article, not a generic source count.</p>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 text-ink/40 mb-3">
                        <AlertTriangle size={16} />
                        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">Unknowns</h3>
                      </div>
                      <p className="text-3xl font-black leading-none mb-2">Open</p>
                      <p className="text-[11px] leading-relaxed text-ink/55">uncertainty is called out inside the report, not hidden.</p>
                    </div>
                  </div>
                </section>

                <div className="markdown-body">
                  <ReactMarkdown components={components as any}>{content}</ReactMarkdown>
                </div>

                {(!!article.citations?.length || !!article.credits?.length) && (
                  <section className="mt-16 md:mt-20 border-t-[3px] border-ink pt-10">
                    <div className="mb-8">
                      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.3em] text-accent mb-3">Receipts</p>
                      <h3 className="text-3xl md:text-4xl font-black tracking-tight">Sources & Evidence</h3>
                      <p className="mt-3 text-sm text-ink/55 leading-relaxed max-w-2xl">
                        These are the sources and claim notes used for this AI-assisted report. The article does not claim to be based on hundreds of sources; it cites the specific evidence used.
                      </p>
                    </div>

                    {!!article.citations?.length && (
                      <div className="mb-10">
                        <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink/40 mb-4">Claim Notes</h4>
                        <div className="grid grid-cols-1 gap-3">
                          {article.citations.map((citation, idx) => (
                            <a
                              key={`${citation.sourceUrl}-${idx}`}
                              href={citation.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="group border border-ink/10 p-4 hover:border-accent/40 hover:bg-accent/[0.02] transition-colors"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-sm font-bold leading-snug text-ink/85">{citation.claim}</p>
                                  <p className="mt-2 text-xs leading-relaxed text-ink/55">{citation.quoteOrFact}</p>
                                </div>
                                <ExternalLink size={14} className="text-accent shrink-0 mt-1 opacity-60 group-hover:opacity-100" />
                              </div>
                              <p className="mt-3 text-[9px] font-mono uppercase tracking-widest text-ink/35">{citation.sourceName}</p>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {!!article.credits?.length && (
                      <div>
                        <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink/40 mb-4">Source Cards</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {article.credits.map((credit, idx) => (
                            <article key={`${credit.articleUrl}-${idx}`} className="border border-ink/10 bg-ink/[0.015] p-5">
                              <div className="flex items-start justify-between gap-4 mb-4">
                                <div>
                                  <h5 className="text-sm font-black leading-tight">{credit.sourceName}</h5>
                                  <p className="mt-1 text-[9px] font-mono uppercase tracking-widest text-ink/35">
                                    {sourceTypeLabel(credit.sourceType)} / {credit.confidence || "medium"} confidence
                                  </p>
                                  {credit.publishedAt && (
                                    <p className="mt-1 text-[9px] font-mono uppercase tracking-widest text-ink/25">{formatDate(credit.publishedAt)}</p>
                                  )}
                                </div>
                                <a
                                  href={credit.articleUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 text-[9px] font-mono font-bold uppercase tracking-widest text-accent hover:text-ink transition-colors"
                                >
                                  Source <ExternalLink size={12} />
                                </a>
                              </div>
                              {!!credit.factBullets?.length && (
                                <ul className="space-y-2">
                                  {credit.factBullets.map((fact, factIdx) => (
                                    <li key={factIdx} className="text-xs leading-relaxed text-ink/65 border-l border-accent/30 pl-3">
                                      {fact}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
                
                <div className="mt-16 p-8 border-2 border-ink bg-paper shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group/expand">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-2">
                      <h4 className="text-xs font-mono font-bold uppercase tracking-widest">Deepen this report</h4>
                      <p className="text-[10px] font-mono text-ink/40 uppercase tracking-tight">Synthesize a longer, feature-length version using AI analysis.</p>
                    </div>
                    <button 
                      onClick={async () => {
                        setIsExpanding(true);
                        const expanded = await expandArticle(article.id);
                        if (expanded) setContent(expanded);
                        setIsExpanding(false);
                      }}
                      disabled={isExpanding}
                      className="px-8 py-3 bg-accent text-paper text-[10px] font-bold uppercase tracking-widest hover:bg-ink transition-colors disabled:opacity-50 flex items-center gap-3"
                    >
                      {isExpanding ? "Synthesizing..." : "Expand Full Feature"}
                      <ChevronDown size={14} className={cn("transition-transform", isExpanding && "animate-bounce")} />
                    </button>
                  </div>
                </div>
                
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
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
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
    </motion.div>
  );
}

export function ReaderView({ article, onClose, isBookmarked, onBookmark, onShare }: ReaderViewProps) {
  return (
    <AnimatePresence>
      {article && (
        <ReaderContent
          key="reader"
          article={article}
          onClose={onClose}
          isBookmarked={isBookmarked}
          onBookmark={onBookmark}
          onShare={onShare}
        />
      )}
    </AnimatePresence>
  );
}
