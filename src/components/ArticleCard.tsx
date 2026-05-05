import { Article } from "../types";
import { cn, formatDate } from "../lib/utils";
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
  const isToday = article.date?.startsWith('2026-05-04') ?? false;

  if (featured) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group cursor-pointer border-b-2 border-ink pb-12 mb-12"
        onClick={() => onClick(article)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-8 overflow-hidden aspect-[16/8] relative rounded-xl shadow-lg">
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
              <div className="absolute top-4 left-4 bg-accent text-white px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-widest shadow-xl">
                Today
              </div>
            )}
          </div>
          <div className="lg:col-span-4 flex flex-col h-full">
            <div className="flex items-center gap-3 text-accent font-mono text-[10px] uppercase tracking-[0.25em] mb-6">
              <span className="w-8 h-[1px] bg-accent" />
              {article.category}
            </div>
            <h2 className="text-4xl md:text-5xl font-black leading-[1.05] mb-8 group-hover:text-accent transition-colors duration-500">
              {article.title}
            </h2>
            <p className="text-lg text-ink/70 leading-relaxed italic mb-10">
              {article.excerpt}
            </p>
            <div className="flex items-center gap-4 mb-4">
               <button 
                onClick={onBookmark}
                className={cn("p-2 border border-ink/10 hover:bg-ink hover:text-paper transition-all", isBookmarked && "bg-ink text-paper")}
                title={isBookmarked ? "Remove Bookmark" : "Bookmark Story"}
               >
                 <Bookmark size={16} />
               </button>
               <button 
                onClick={onShare}
                className="p-2 border border-ink/10 hover:bg-ink hover:text-paper transition-all"
                title="Share Story"
               >
                 <Share2 size={16} />
               </button>
            </div>
            <div className="mt-auto pt-8 border-t border-ink/5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-ink/40">
              <span>By {article.author}</span>
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
      <div className="flex items-center justify-between mb-4">
        <div className="text-accent font-mono text-[9px] uppercase tracking-[0.3em]">
          {article.category}
        </div>
      </div>
      <h3 className="text-2xl font-bold leading-tight mb-4 group-hover:text-accent transition-colors">
        {article.title}
      </h3>
      <p className="text-ink/60 text-[15px] leading-relaxed mb-6 flex-grow line-clamp-3">
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
