import { useEffect, useState } from 'react';
import { Article } from './types';
import { fetchArticles, fetchEvents } from './services/newsService';
import { ArticleCard } from './components/ArticleCard';
import { ReaderView } from './components/ReaderView';
import { EventsPanel } from './components/EventsPanel';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Menu, Calendar, MapPin, X, Bookmark as BookmarkIcon } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [filteredArticles, setFilteredArticles] = useState<Article[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('sf-bookmarks');
    return saved ? JSON.parse(saved) : [];
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    
    async function init() {
      // Safety timeout: force loading to false after 10s no matter what
      const safetyTimeout = setTimeout(() => {
        if (active) setLoading(false);
      }, 10000);

      try {
        const [data, eventsData] = await Promise.all([fetchArticles(), fetchEvents()]);
        if (!active) return;
        
        setArticles(data);
        setFilteredArticles(data);
        setEvents(eventsData);

        // Deep linking: check URL for articleId (slug or id)
        const params = new URLSearchParams(window.location.search);
        const articleParam = params.get('articleId')?.toLowerCase();
        
        if (articleParam) {
          const article = data.find(a => 
            a.slug?.toLowerCase() === articleParam || 
            a.id?.toLowerCase() === articleParam
          );
          if (article) {
            console.log("Deep link success: Opening", article.title);
            setSelectedArticle(article);
          } else {
            console.warn("Deep link failed: Could not find article with slug", articleParam);
          }
        }
      } catch (err) {
        if (active) toast.error("Could not reach live news wire.");
      } finally {
        clearTimeout(safetyTimeout);
        if (active) setLoading(false);
      }
    }
    init();

    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedArticle) {
      params.set('articleId', selectedArticle.slug);
    } else {
      params.delete('articleId');
    }
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [selectedArticle]);

  const [searchLoading, setSearchLoading] = useState(false);

  // AI-Powered Search Enhancement
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 3) return;

    let activeSearch = true;
    const aiSearch = async () => {
      setSearchLoading(true);
      try {
        const data = await fetchArticles(searchQuery);
        if (!activeSearch) return;
        
        setArticles(prev => {
          const existingIds = new Set(prev.map(a => a.id));
          const newArticles = data.filter(a => !existingIds.has(a.id));
          return [...newArticles, ...prev];
        });
        toast.success(`Stories found for "${searchQuery}"`);
      } catch (err) {
        // fail silently for secondary search
      } finally {
        if (activeSearch) setSearchLoading(false);
      }
    };

    const timer = setTimeout(aiSearch, 1500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const TODAY = new Date();
    const SEVEN_DAYS_AGO = new Date(TODAY);
    SEVEN_DAYS_AGO.setDate(TODAY.getDate() - 8); // 8 days for buffer

    let result = articles;
    
    // Filter by timestamp (within ~8 days)
    result = result.filter(a => {
      const articleDate = new Date(a.date);
      return articleDate >= SEVEN_DAYS_AGO;
    });

    // Sort by date (newest first)
    result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (selectedCategory) {
      if (selectedCategory === 'Bookmarks') {
        result = result.filter(a => bookmarkedIds.includes(a.id));
      } else {
        result = result.filter(a => a.category === selectedCategory);
      }
    }
    if (searchQuery) {
      result = result.filter(a => 
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.excerpt.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    setFilteredArticles(result);
  }, [searchQuery, selectedCategory, articles, bookmarkedIds]);

  useEffect(() => {
    localStorage.setItem('sf-bookmarks', JSON.stringify(bookmarkedIds));
  }, [bookmarkedIds]);

  const handleBookmark = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBookmarkedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
    toast.success(bookmarkedIds.includes(id) ? 'Removed from reading list' : 'Added to reading list');
  };

  const handleShare = (article: Article, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const shareUrl = `${window.location.origin}${window.location.pathname}?articleId=${article.slug}`;
    if (navigator.share) {
      navigator.share({
        title: article.title,
        text: article.excerpt,
        url: shareUrl,
      }).catch((err) => {
        // user clicked cancel, squash the error
      });
    } else {
      navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied to clipboard');
    }
  };

  const categories = ['Civics', 'Culture', 'Tech', 'Transit', 'Food'];

  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-paper z-[200]">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center px-6"
        >
          <div className="mb-8 relative">
            <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-2">Times of SF</h1>
            <div className="h-0.5 w-16 bg-accent mx-auto" />
          </div>
          
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-1">
                {[1, 2, 3].map(i => (
                  <motion.div 
                    key={i}
                    animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                    className="w-1.5 h-1.5 bg-accent rounded-full"
                  />
                ))}
              </div>
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink/40">
                Synchronizing Live Wire
              </p>
            </div>

            <button 
              onClick={() => setLoading(false)}
              className="text-[9px] font-mono uppercase tracking-widest text-ink/20 hover:text-accent transition-colors pt-8 block mx-auto underline underline-offset-4"
            >
              Skip to Archive
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-black selection:text-white overflow-x-hidden">
      <Toaster position="top-center" richColors />
      
      {/* Live Dispatch Ticker */}
      <div className="bg-paper border-b border-ink/10 relative overflow-hidden py-2 whitespace-nowrap group">
        <div className="inline-flex animate-marquee group-hover:pause-marquee gap-12 items-center">
          {[...filteredArticles, ...filteredArticles].slice(0, 10).map((a, i) => (
            <div 
              key={`${a.id}-${i}`} 
              className="flex items-center gap-3 cursor-pointer hover:text-accent transition-colors"
              onClick={() => setSelectedArticle(a)}
            >
              <span className="text-accent font-black text-[10px] tracking-widest uppercase">Headline:</span>
              <span className="font-serif italic text-xs tracking-tight">{a.title}</span>
              <span className="text-ink/20 opacity-50">—</span>
            </div>
          ))}
        </div>
      </div>

      {/* Auth Modal Overlay */}

      <AnimatePresence>
        {isAuthModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-ink/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-paper p-8 max-w-md w-full border-t-8 border-accent"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-black uppercase tracking-tighter">Join the Times</h2>
                <button onClick={() => setIsAuthModalOpen(false)}><X size={24} /></button>
              </div>
              <p className="text-sm italic mb-8 opacity-60">Support independent San Francisco journalism and unlock the full digital archive.</p>
              <div className="space-y-4">
                <button 
                  onClick={() => { toast.success("Google Login sequence initiated..."); setIsAuthModalOpen(false); }}
                  className="w-full py-4 bg-ink text-paper text-[10px] uppercase font-bold tracking-widest hover:bg-accent transition-colors"
                >
                  Sign in with Google
                </button>
                <button 
                  onClick={() => { toast.success("Access request sent."); setIsAuthModalOpen(false); }}
                  className="w-full py-4 border border-ink/20 text-[10px] uppercase font-bold tracking-widest hover:bg-ink hover:text-paper transition-all"
                >
                  Subscription Options
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-paper p-8 flex flex-col items-center justify-center text-center"
          >
            <button 
              onClick={() => setIsMenuOpen(false)}
              className="absolute top-8 right-8 p-2 hover:text-accent transition-colors"
            >
              <X size={32} />
            </button>
            <h2 className="text-4xl font-black uppercase tracking-tighter mb-12">Sections</h2>
            
            {/* Search in Menu */}
            <div className="relative mb-12 w-full max-w-sm">
              <input 
                type="text"
                placeholder="Search stories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-ink/5 border-b-2 border-ink py-4 px-4 text-xl font-serif outline-none focus:border-accent transition-colors"
              />
              {searchLoading ? (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                   <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30" />
              )}
            </div>

            <div className="space-y-6">
              <button 
                onClick={() => { setSelectedCategory(null); setIsMenuOpen(false); }}
                className={cn("text-2xl font-serif block w-full", !selectedCategory && "text-accent italic")}
              >
                Front Page
              </button>
              {['Civics', 'Culture', 'Tech', 'Funding', 'Transit', 'Food'].map(cat => (
                <button 
                  key={cat}
                  onClick={() => { setSelectedCategory(cat); setIsMenuOpen(false); }}
                  className={cn("text-2xl font-serif block w-full", selectedCategory === cat && "text-accent italic")}
                >
                  {cat}
                </button>
              ))}
              <div className="h-px w-12 bg-ink/10 mx-auto my-6" />
              <button 
                onClick={() => { setSelectedCategory('Bookmarks'); setIsMenuOpen(false); }}
                className={cn("text-2xl font-serif block w-full flex items-center justify-center gap-2", selectedCategory === 'Bookmarks' && "text-accent italic")}
              >
                <BookmarkIcon size={24} />
                Reading List
              </button>
              <button 
                onClick={() => { setIsAuthModalOpen(true); setIsMenuOpen(false); }}
                className="text-xl font-mono uppercase tracking-widest text-accent font-bold"
              >
                Subscribe / Login
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editorial Header */}
      <div className="border-b-[4px] border-ink bg-paper pt-2 md:pt-4 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-2 md:gap-4 mb-2 md:mb-4 border-b border-ink pb-2 md:pb-4">
             {/* Top Meta Bar */}
             <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-[0.2em] opacity-40 leading-relaxed">
               <div className="flex items-center gap-4 md:gap-8">

                 <button 
                  onClick={() => setIsMenuOpen(true)}
                  className="flex items-center gap-2 hover:text-accent transition-colors"
                 >
                   <Menu size={18} />
                   <span className="hidden sm:inline">Sections</span>
                 </button>
               </div>

               <div className="hidden lg:block text-center flex-grow">
                 <span>San Francisco, CA</span>


               </div>
               
               <div className="flex items-center gap-4">
                 <div className="hidden sm:block lg:hidden text-right mr-4">
                   <span>{currentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                 </div>
                 <button 
                  onClick={() => setIsMenuOpen(true)}
                  className="p-2 hover:text-accent transition-colors hidden sm:block"
                  title="Search"
                 >
                   <Search size={16} />
                 </button>
                 <button 
                  onClick={() => setIsAuthModalOpen(true)}
                  className="text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-2 border border-ink/20 hover:bg-ink hover:text-paper transition-all opacity-100 whitespace-nowrap"
                 >
                  Subscribe / Login
                 </button>
               </div>
             </div>

             {/* Big Title on its own line */}
             <h1 
              onClick={() => { setSelectedCategory(null); setSearchQuery(""); }}
              className="text-[clamp(1.5rem,7.8vw,120px)] font-black tracking-tighter uppercase text-center w-full select-none cursor-pointer hover:text-accent transition-colors duration-500 leading-none pt-1 md:pt-2 pb-0 block whitespace-nowrap"
            >
                Times of San Francisco
             </h1>

             <div className="text-center mt-[-4px] md:mt-[-8px] mb-1">
               <span className="inline-block text-[10px] md:text-[11px] font-mono font-medium uppercase tracking-[0.4em] text-ink opacity-60">
                 {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
               </span>
             </div>
          </div>
          
          <nav className="flex items-center justify-center py-1 md:py-2 text-[10px] md:text-[11px] font-mono font-bold uppercase tracking-[0.2em] md:tracking-[0.3em]">
            <div className="flex items-center gap-4 md:gap-8 flex-wrap justify-center">
              {['Civics', 'Culture', 'Tech', 'Funding', 'Transit', 'Food', 'Events'].map(cat => (
                <button 
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "hover:text-accent transition-colors border-b-2 whitespace-nowrap pb-1",
                    selectedCategory === cat ? "border-accent text-accent" : "border-transparent hover:border-accent"
                  )}
                >
                  {cat}
                </button>
              ))}
              <div className="w-px h-4 bg-ink/10 hidden sm:block mx-2" />
              <button 
                onClick={() => setSelectedCategory('Bookmarks')}
                className={cn(
                  "hover:text-accent transition-colors border-b-2 whitespace-nowrap flex items-center gap-1 pb-1",
                  selectedCategory === 'Bookmarks' ? "border-accent text-accent" : "border-transparent hover:border-accent"
                )}
              >
                <BookmarkIcon size={12} />
                <span className="hidden sm:inline">Reading List</span>
              </button>
            </div>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-20 lg:py-24">
        {selectedCategory === 'Events' ? (
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl font-serif font-black mb-12 border-b-2 border-ink pb-4">Upcoming SF Events</h1>
            <EventsPanel events={events} />
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-12">
            <div className="flex-grow">
              {filteredArticles.length === 0 ? (
                <div className="py-32 text-center">
                  <p className="text-xl italic font-serif text-ink/40">No stories available. The agent pipeline is currently fetching real data.</p>
                  <button 
                    onClick={() => { setSelectedCategory(null); setSearchQuery(""); }}
                    className="mt-6 text-accent font-mono text-[10px] uppercase tracking-widest border-b border-accent"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <>
                  <AnimatePresence mode="popLayout">
                    {filteredArticles.length > 0 && !selectedCategory && !searchQuery && (
                      <div key="featured" className="mb-16">
                        <ArticleCard 
                          article={filteredArticles[0]} 
                          onClick={setSelectedArticle} 
                          featured 
                          isBookmarked={bookmarkedIds.includes(filteredArticles[0].id)}
                          onBookmark={(e) => handleBookmark(filteredArticles[0].id, e)}
                          onShare={(e) => handleShare(filteredArticles[0], e)}
                        />
                      </div>
                    )}
                  </AnimatePresence>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-16">
                    {( (!selectedCategory && !searchQuery) ? filteredArticles.slice(1) : filteredArticles ).map((article) => (
                      <ArticleCard 
                        key={article.id} 
                        article={article} 
                        onClick={setSelectedArticle}
                        isBookmarked={bookmarkedIds.includes(article.id)}
                        onBookmark={(e) => handleBookmark(article.id, e)}
                        onShare={(e) => handleShare(article, e)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-32 pt-16 border-t-2 border-ink pb-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div className="lg:col-span-2">
             <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter mb-6 whitespace-nowrap">Times of SF</h2>
             <p className="max-w-sm text-ink/60 text-sm leading-relaxed mb-8 italic">
               Independent. Local. Essential. The Times of SF is dedicated to chronicling the vibrant soul of the Bay Area through rigorous journalism and elegant design.
             </p>
             <div className="flex items-center gap-4 mb-8">
               <input 
                 type="email" 
                 placeholder="your@email.com" 
                 className="bg-transparent border-b border-ink/20 py-2 text-sm focus:border-accent outline-none flex-grow max-w-[200px]"
               />
               <button 
                 onClick={() => toast.success("Thank you for subscribing to our morning briefing.")}
                 className="text-[10px] font-mono font-bold uppercase tracking-widest px-6 py-2 bg-ink text-paper hover:bg-accent transition-colors"
                >
                 Join the Newsletter
               </button>
             </div>
          </div>
          <div>
            <h4 className="text-xs font-mono uppercase tracking-widest mb-6 opacity-40">Categories</h4>
            <ul className="space-y-3 text-sm font-medium">
              <li onClick={() => { setSelectedCategory('Civics'); window.scrollTo(0,0); }} className="hover:text-accent cursor-pointer transition-colors">Civics</li>
              <li onClick={() => { setSelectedCategory('Culture'); window.scrollTo(0,0); }} className="hover:text-accent cursor-pointer transition-colors">Culture</li>
              <li onClick={() => { setSelectedCategory('Tech'); window.scrollTo(0,0); }} className="hover:text-accent cursor-pointer transition-colors">Tech & Future</li>
              <li onClick={() => { setSelectedCategory('Food'); window.scrollTo(0,0); }} className="hover:text-accent cursor-pointer transition-colors">Food & Drink</li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-mono uppercase tracking-widest mb-6 opacity-40">Connect</h4>
            <ul className="space-y-3 text-sm font-medium">
              <li onClick={() => toast.info("Newsletter preferences coming soon")} className="hover:text-accent cursor-pointer transition-colors">Newsletter</li>
              <li className="hover:text-accent cursor-pointer transition-colors">Instagram</li>
              <li className="hover:text-accent cursor-pointer transition-colors">Twitter (X)</li>
              <li onClick={() => { setSelectedCategory(null); window.scrollTo(0,0); }} className="hover:text-accent cursor-pointer transition-colors">Archive</li>
            </ul>
          </div>
        </footer>
      </main>

      <ReaderView 
        article={selectedArticle} 
        onClose={() => setSelectedArticle(null)} 
        isBookmarked={selectedArticle ? bookmarkedIds.includes(selectedArticle.id) : false}
        onBookmark={() => selectedArticle && handleBookmark(selectedArticle.id)}
        onShare={() => selectedArticle && handleShare(selectedArticle)}
      />
    </div>
  );
}
