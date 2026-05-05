import React, { useState, useRef, useMemo } from "react";
import { Article } from "../types";
import { motion, AnimatePresence, useScroll, useSpring } from "motion/react";
import { X, ArrowLeft, Share2, Bookmark, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { formatDate, cn } from "../lib/utils";
import { DEFAULT_IMAGE } from "../services/newsService";
import { EntityHighlight } from "./EntityHighlight";
import { DataVisChart } from "./DataVisChart";

interface ReaderViewProps {
  article: Article | null;
  onClose: () => void;
  isBookmarked: boolean;
  onBookmark: () => void;
  onShare: () => void;
}

function ReaderContent({ article, onClose, isBookmarked, onBookmark, onShare }: { article: Article } & Omit<ReaderViewProps, 'article'>) {
  const [showSummary, setShowSummary] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { scrollYProgress } = useScroll({
    container: scrollRef
  });

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const processText = (children: any, allowCharts = true) => {
    return React.Children.toArray(children).flatMap(node => {
      if (typeof node !== 'string') return node;
      
      let result: (string | React.ReactNode)[] = [node];
      
      // Charts
      if (allowCharts) {
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
              parts.push(<DataVisChart key={`chart-${chartIdx}`} title={block.title} data={block.data} />);
            }
            lastIndex = chartRegex.lastIndex;
          }
          parts.push(part.slice(lastIndex));
          return parts;
        });
      }

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
          const entityData = article.entities?.find(e => e.name.toLowerCase() === entityName.toLowerCase());
          if (entityData) {
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
    });
  };

  const components = useMemo(() => ({
    p: ({ children }: any) => {
      const processed = processText(children);
      const hasChart = processed.some(child => React.isValidElement(child) && (child.type as any).name === 'DataVisChart');
      
      // Use div if contains block-level elements like charts to avoid invalid HTML
      const Component = hasChart ? 'div' : 'p';
      return <Component className="mb-8 leading-relaxed font-serif text-lg md:text-xl text-ink/80">{processed}</Component>;
    },
    li: ({ children }: any) => (
      <li className="mb-4 leading-relaxed font-serif text-lg text-ink/80 ml-6 list-disc">
        {processText(children, false)}
      </li>
    ),
    h1: ({ children }: any) => <h1 className="text-3xl font-black mt-12 mb-6">{processText(children, false)}</h1>,
    h2: ({ children }: any) => <h2 className="text-2xl font-black mt-10 mb-5">{processText(children, false)}</h2>,
    h3: ({ children }: any) => <h3 className="text-xl font-black mt-8 mb-4">{processText(children, false)}</h3>,
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
          <nav className="fixed top-0 left-0 right-0 z-[60] bg-paper/90 backdrop-blur-md border-b border-ink/5">
            <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={onClose} className="p-1 hover:text-accent transition-colors"><X size={20} /></button>
                <div className="hidden md:block w-[1px] h-4 bg-ink/10" />
                <span className="hidden md:block font-serif text-sm italic text-ink/40 line-clamp-1">{article.title}</span>
              </div>
              
              <div className="flex items-center gap-4">
                  <button 
                    onClick={onBookmark}
                    className={cn("hover:text-accent transition-colors", isBookmarked && "text-accent")}
                  >
                    <Bookmark size={18} className={cn(isBookmarked && "fill-accent")} />
                  </button>
                  <button onClick={onShare} className="hover:text-accent transition-colors">
                    <Share2 size={18} />
                  </button>
              </div>
            </div>
            <motion.div 
              className="h-[3px] bg-accent origin-left w-full absolute bottom-0 left-0 right-0"
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
                        {article.excerpt} This report explores {article.title.toLowerCase()} from a multi-disciplinary perspective, highlighting the socio-economic impact on San Francisco's evolving urban landscape.
                      </p>
                      
                      {article.tldr && (
                        <ul className="space-y-4">
                          <li className="flex gap-4">
                            <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-widest pt-1 shrink-0">Impact</span>
                            <p className="text-xs leading-relaxed text-ink/60">{article.tldr.whyItMatters}</p>
                          </li>
                          <li className="flex gap-4">
                            <span className="text-[10px] font-mono font-bold text-ink/40 uppercase tracking-widest pt-1 shrink-0">Context</span>
                            <p className="text-xs leading-relaxed text-ink/60">{article.tldr.whoIsAffected}</p>
                          </li>
                          <li className="flex gap-4">
                            <span className="text-[10px] font-mono font-bold text-ink/20 uppercase tracking-widest pt-1 shrink-0">Future</span>
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
               <p className="absolute bottom-4 md:bottom-6 right-4 md:right-6 bg-paper/80 backdrop-blur-md px-3 md:px-4 py-1 md:py-2 text-[8px] md:text-[9px] font-mono tracking-tighter uppercase whitespace-nowrap rounded-sm">
                 {article.imageCredit || "Field Photography / SF Archive"}
               </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="hidden lg:block lg:col-span-3">
                 <div className="sticky top-32 space-y-12 pr-8 border-r border-ink/5">
                    <div>
                      <h4 className="text-[10px] font-mono uppercase tracking-widest text-ink/30 mb-4">Metadata</h4>
                      <p className="text-[11px] leading-relaxed italic text-ink/50">
                        This story was verified by the Times of SF Editorial Board and follows strict local sourcing guidelines.
                      </p>
                    </div>
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
                <div className="markdown-body">
                  <ReactMarkdown components={components as any}>{article.content}</ReactMarkdown>
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
