import { Article } from "../types";
import { cn, formatPublishedTimestamp } from "../lib/utils";
import { motion } from "motion/react";
import { Bookmark, Share2 } from "lucide-react";
import { DEFAULT_IMAGE } from "../services/newsService";

interface ArticleCardProps {
  article: Article;
  onClick: (article: Article) => void;
  featured?: boolean;
  isBookmarked: boolean;
  onBookmark: (e: React.MouseEvent) => void;
  onShare: (e: React.MouseEvent) => void;
}

export function ArticleCard({ article, onClick, featured, isBookmarked, onBookmark, onShare }: ArticleCardProps) {
  const isToday = article.publishedAt
    ? new Date(article.publishedAt).toDateString() === new Date().toDateString()
    : false;

  if (featured) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group cursor-pointer border-b-2 border-ink pb-12 mb-12"
        onClick={() => onClick(article)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-6 overflow-hidden relative rounded-xl shadow-lg aspect-[16/9] max-h-[400px]">
            <img 
              src={article.imageUrl}
              alt={article.title}
              className="w-full h-full object-cover transition-all duration-1000 group-hover:scale-[1.02]"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
              }}
            />
            {isToday && (
              <div className="absolute top-6 left-6 bg-accent text-white px-4 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest shadow-2xl">
                Today's Feature
              </div>
            )}
          </div>
          <div className="lg:col-span-6 flex flex-col justify-center py-4 lg:py-8">
            <div className="flex items-center gap-3 text-accent font-mono text-[10px] uppercase tracking-[0.3em] mb-6">
              <span className="w-10 h-[1px] bg-accent/30" />
              {article.category}
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-4xl font-black leading-[0.95] mb-5 group-hover:text-accent transition-colors duration-500 tracking-tighter">
              {article.title}
            </h2>
            <p className="text-sm md:text-base text-ink/70 leading-relaxed italic mb-6 border-l-2 border-ink/5 pl-6 py-1">
              {article.excerpt}
            </p>
            <div className="flex items-center gap-4 mb-6">
               <button 
                onClick={onBookmark}
                className={cn("flex items-center gap-2 px-4 py-2 border border-ink/10 hover:bg-ink hover:text-paper transition-all text-[10px] font-mono uppercase tracking-widest", isBookmarked && "bg-ink text-paper")}
               >
                 <Bookmark size={14} className={cn(isBookmarked && "fill-paper")} />
                 {isBookmarked ? "Saved" : "Save Story"}
               </button>
               <button 
                onClick={onShare}
                className="flex items-center gap-2 px-4 py-2 border border-ink/10 hover:bg-ink hover:text-paper transition-all text-[10px] font-mono uppercase tracking-widest"
               >
                 <Share2 size={14} />
                 Share
               </button>
            </div>
            <div className="mt-8 pt-8 border-t-2 border-ink flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-[11px] font-mono uppercase tracking-widest text-ink/50">
              <span className="font-bold">By {article.author}</span>
              <div className="flex flex-col sm:items-end gap-1 normal-case tracking-tight">
                <span className="text-[10px] text-ink/35">Published</span>
                <span className="text-ink/65">{formatPublishedTimestamp(article.publishedAt)}</span>
              </div>
              <span>{article.readTime} Read</span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="group cursor-pointer flex flex-col h-full border-b border-ink/10 pb-10 news-grid-item"
      onClick={() => onClick(article)}
    >
      <div className="overflow-hidden aspect-[16/10] mb-6 rounded-xl shadow-md relative bg-ink/5">
        <img 
          src={article.imageUrl}
          alt={article.title}
          className="w-full h-full object-cover transition-all duration-700 group-hover:scale-105"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
          }}
        />
        {isToday && (
          <div className="absolute top-3 left-3 bg-accent text-white px-2 py-0.5 text-[8px] font-mono font-bold uppercase tracking-widest shadow-lg rounded-sm">
            Today
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="text-accent font-mono text-[9px] uppercase tracking-[0.3em]">
          {article.category}
        </div>
        <time
          dateTime={article.publishedAt}
          className="text-[9px] font-mono text-ink/45 uppercase tracking-widest shrink-0"
          title={article.publishedAt}
        >
          {formatPublishedTimestamp(article.publishedAt)}
        </time>
      </div>
      <h3 className="text-xl font-bold leading-tight mb-3 group-hover:text-accent transition-colors line-clamp-2">
        {article.title}
      </h3>
      <p className="text-ink/60 text-sm leading-relaxed mb-4 flex-grow line-clamp-3 opacity-80">
        {article.excerpt}
      </p>
      <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-ink/40 pt-4 border-t border-ink/5">
        <div className="flex items-center gap-3">
          <span className="font-bold text-ink/60">{article.author}</span>
          <span className="w-1 h-1 bg-ink/10 rounded-full" />
          <span>{article.readTime}</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            className={cn("hover:text-accent transition-colors p-1", isBookmarked && "text-accent fill-accent")}
            onClick={onBookmark}
            title="Bookmark"
          >
            <Bookmark size={12} />
          </button>
          <button 
            className="hover:text-accent transition-colors p-1"
            onClick={onShare}
            title="Share"
          >
            <Share2 size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
