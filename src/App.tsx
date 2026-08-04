import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { Article, ArticleCategory, EventInfo } from './types';
import {
  fetchArticles,
  fetchEvents,
  fetchCurrentUser,
  fetchBookmarks,
  addBookmarkRemote,
  removeBookmarkRemote,
  login,
  signup,
  logout,
  updatePreferences,
  requestPasswordReset,
  subscribeToNewsletter,
  type AccountUser,
} from './services/newsService';
import { ArticleCard } from './components/ArticleCard';
import { NewsletterCta } from './components/NewsletterCta';
import { SponsorSlot } from './components/SponsorSlot';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Menu, Calendar, MapPin, X, Bookmark as BookmarkIcon } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';
import { SeoHead } from './components/SeoHead';
import { articlePath } from './lib/site';
import {
  ARTICLE_CATEGORIES,
  CATEGORY_SEO,
  digestPath,
  guidePath,
  listPathFromRoute,
  parseAppPath,
  type AppRoute,
} from './lib/routes';
import { getGuideBySlug, EVERGREEN_GUIDES, } from './content/evergreen';
import { BOOSTED_EVENTS } from './content/monetization';
import { trackPageView, trackEvent, identifyUser, posthog } from './services/posthog';

// Code-split the heavy views: article reader, digest, guides, topic hubs, events,
// password reset, and the jobs board only load their JS when actually opened.
// This keeps the initial bundle small for fast first paint / LCP (an SEO factor).
const ReaderView = lazy(() => import('./components/ReaderView').then((m) => ({ default: m.ReaderView })));
const DigestView = lazy(() => import('./components/DigestView').then((m) => ({ default: m.DigestView })));
const GuidePage = lazy(() => import('./components/GuidePage').then((m) => ({ default: m.GuidePage })));
const ResetPasswordPage = lazy(() =>
  import('./components/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const TopicHub = lazy(() => import('./components/TopicHub').then((m) => ({ default: m.TopicHub })));
const EventsPanel = lazy(() => import('./components/EventsPanel').then((m) => ({ default: m.EventsPanel })));
const JobsBoard = lazy(() => import('./components/JobsBoard').then((m) => ({ default: m.JobsBoard })));

const NEWSLETTER_CATEGORIES: Array<{ value: ArticleCategory; label: string }> = [
  { value: "Tech", label: "Tech" },
  { value: "Civics", label: "Politics / Civics" },
  { value: "Funding", label: "Funding" },
  { value: "Culture", label: "Culture" },
  { value: "Transit", label: "Transit" },
  { value: "Food", label: "Food" },
  { value: "Events", label: "Events" },
];

function routeFromLocation(location: Location): AppRoute {
  const parsed = parseAppPath(location.pathname);
  if (parsed.kind === "article") return parsed;
  const params = new URLSearchParams(location.search);
  const legacy = params.get("articleId") ?? params.get("id");
  if (legacy) return { kind: "article", slug: legacy.toLowerCase() };
  return parsed;
}

function stripSeoBootstrap() {
  // Keep #seo-ssr in the DOM for AI crawlers that execute JS; it is visually hidden via CSS.
}

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [filteredArticles, setFilteredArticles] = useState<Article[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const tickerTrackRef = useRef<HTMLDivElement>(null);
  const [tickerDuration, setTickerDuration] = useState(45);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("q") ?? "";
    } catch {
      return "";
    }
  });
  const [searchResults, setSearchResults] = useState<Article[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appRoute, setAppRoute] = useState<AppRoute>(() => routeFromLocation(window.location));
  const [selectedCategory, setSelectedCategory] = useState<string | null>(() => {
    const route = routeFromLocation(window.location);
    if (route.kind === "category") return route.category;
    if (route.kind === "events") return "Events";
    if (route.kind === "bookmarks") return "Bookmarks";
    return null;
  });
  const listPathRef = useRef(listPathFromRoute(routeFromLocation(window.location)));
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('sf-bookmarks');
    return saved ? JSON.parse(saved) : [];
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AccountUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [apiError, setApiError] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterPreferences, setNewsletterPreferences] = useState<ArticleCategory[]>(["Tech", "Civics"]);
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const deepLinkedRef = useRef(false);

  const applyListRoute = useCallback((route: AppRoute, push = true) => {
    const next: AppRoute =
      route.kind === "article" || route.kind === "unknown" ? { kind: "home" } : route;
    setSelectedArticle(null);
    setAppRoute(next);
    const path = listPathFromRoute(next);
    listPathRef.current = path;
    if (next.kind === "category") setSelectedCategory(next.category);
    else if (next.kind === "events") setSelectedCategory("Events");
    else if (next.kind === "bookmarks") setSelectedCategory("Bookmarks");
    else if (next.kind === "home") setSelectedCategory(null);
    else setSelectedCategory(null);

    if (push) window.history.pushState({}, "", path);
    else window.history.replaceState({}, "", path);
  }, []);

  const navigateTo = useCallback((path: string) => {
    const route = parseAppPath(path);
    if (route.kind === "article") {
      window.history.pushState({}, "", path);
      setAppRoute(route);
      return;
    }
    applyListRoute(route, true);
    window.scrollTo(0, 0);
  }, [applyListRoute]);

  const openCategory = useCallback((category: string | null) => {
    if (!category) {
      applyListRoute({ kind: "home" });
      setSearchQuery("");
      window.scrollTo(0, 0);
      return;
    }
    if (category === "Bookmarks") {
      applyListRoute({ kind: "bookmarks" });
      window.scrollTo(0, 0);
      return;
    }
    if (category === "Events") {
      applyListRoute({ kind: "events" });
      window.scrollTo(0, 0);
      return;
    }
    applyListRoute({ kind: "category", category: category as ArticleCategory, slug: category.toLowerCase() });
    window.scrollTo(0, 0);
  }, [applyListRoute]);


  const toggleNewsletterPreference = (category: ArticleCategory) => {
    setNewsletterPreferences((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const handleNewsletterSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = newsletterEmail.trim();
    if (!email) {
      toast.error("Enter your email first.");
      return;
    }
    if (newsletterPreferences.length === 0) {
      toast.error("Choose at least one newsletter topic.");
      return;
    }

    try {
      setNewsletterLoading(true);
      await subscribeToNewsletter(email, newsletterPreferences);
      trackEvent("newsletter_subscribed", { topics: newsletterPreferences, source: "footer", topic_count: newsletterPreferences.length });
      setNewsletterEmail("");
      toast.success("Thank you for subscribing. Your topic preferences are saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not subscribe right now.");
    } finally {
      setNewsletterLoading(false);
    }
  };

  useEffect(() => {
    stripSeoBootstrap();
    const p = window.location.pathname.replace(/\/+$/, "") || "/";
    if (p === "/admin/from-link") {
      window.history.replaceState({}, "", "/");
      applyListRoute({ kind: "home" }, false);
    }
  }, [applyListRoute]);

  useEffect(() => {
    const onPop = () => {
      const route = routeFromLocation(window.location);
      if (route.kind === "article") {
        setAppRoute(route);
        return;
      }
      applyListRoute(route, false);
      setSelectedArticle(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyListRoute]);

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
        setApiError(false);

        const route = routeFromLocation(window.location);
        if (route.kind === "article") {
          const article = data.find(a =>
            a.slug?.toLowerCase() === route.slug ||
            a.id?.toLowerCase() === route.slug
          );
          if (article) {
            setSelectedArticle(article);
            setAppRoute(route);
          } else {
            toast.error('That article link is no longer available.');
            applyListRoute({ kind: "home" }, false);
          }
        } else {
          applyListRoute(route, false);
        }
      } catch (err) {
        if (active) {
          setApiError(true);
          toast.error("Could not reach live news wire.");
          const route = routeFromLocation(window.location);
          if (route.kind !== "article") applyListRoute(route, false);
        }
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
    let active = true;
    (async () => {
      try {
        const user = await fetchCurrentUser();
        if (!active) return;
        if (user) {
          setCurrentUser(user);
          identifyUser(user.id, user.email);
          try {
            const serverBookmarks = await fetchBookmarks();
            setBookmarkedIds(serverBookmarks);
          } catch {
            /* keep local bookmarks if this fails */
          }
        }
      } finally {
        if (active) setAuthChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedArticle) {
      deepLinkedRef.current = true;
      window.history.replaceState({}, '', articlePath(selectedArticle.slug));
      setAppRoute({ kind: "article", slug: selectedArticle.slug });
    } else if (deepLinkedRef.current) {
      deepLinkedRef.current = false;
      window.history.replaceState({}, '', listPathRef.current || '/');
      setAppRoute(parseAppPath(listPathRef.current || '/'));
    }
  }, [selectedArticle]);

  // PostHog pageview tracking on every visible route (SPA navigation included).
  useEffect(() => {
    const current = window.location.pathname.replace(/\/+$/, "") || "/";
    trackPageView(current);
    if (selectedArticle) {
      trackEvent("article_viewed", { slug: selectedArticle.slug, category: selectedArticle.category });
    }
  }, [selectedArticle?.slug, appRoute.kind, appRoute.kind === "category" ? appRoute.category : null]);

  useEffect(() => {
    const TODAY = new Date();
    const RECENT_CUTOFF = new Date(TODAY);
    // Show posts from the last 90 days (API already returns newest first, limit 50).
    // A tight 8-day window hid everything when the pipeline had not run recently.
    RECENT_CUTOFF.setDate(TODAY.getDate() - 90);

    let result = articles;

    result = result.filter((a) => {
      const articleDate = new Date(a.date);
      return articleDate >= RECENT_CUTOFF;
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
    if (!selectedCategory && !searchQuery && currentUser && currentUser.preferences.length > 0) {
      const preferred = new Set(currentUser.preferences);
      result = [...result].sort((a, b) => Number(preferred.has(b.category)) - Number(preferred.has(a.category)));
    }
    setFilteredArticles(result);
  }, [searchQuery, selectedCategory, articles, bookmarkedIds, currentUser]);

  // Live search dropdown in the menu overlay — hits the backend so it covers
  // the full archive (headline/dek/body), not just the ~100 articles already loaded.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await fetchArticles(q);
        setSearchResults(results.slice(0, 8));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    // Only the logged-out list belongs in localStorage. Mirroring server bookmarks here
    // would leak one account's reading list to the next person on a shared browser.
    if (currentUser) return;
    localStorage.setItem('sf-bookmarks', JSON.stringify(bookmarkedIds));
  }, [bookmarkedIds, currentUser]);

  // Keep the news-tape scroll speed relative to viewport width — a fixed px/sec
  // reads as way too fast on a narrow phone screen and barely perceptible on a
  // wide desktop screen, so aim for a constant "seconds to cross the viewport".
  useEffect(() => {
    const track = tickerTrackRef.current;
    if (!track) return;

    const SECONDS_PER_VIEWPORT = 9;
    const MIN_DURATION = 20;
    const MAX_DURATION = 70;

    const recompute = () => {
      const singleCopyWidth = track.scrollWidth / 2;
      if (!singleCopyWidth) return;
      const pxPerSecond = window.innerWidth / SECONDS_PER_VIEWPORT;
      const duration = singleCopyWidth / pxPerSecond;
      setTickerDuration(Math.min(MAX_DURATION, Math.max(MIN_DURATION, duration)));
    };

    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [articles]);

  useEffect(() => {
    const route = routeFromLocation(window.location);
    if (route.kind === "article" && articles.length > 0) {
      const found = articles.find(a => a.id === route.slug || a.slug === route.slug);
      if (found) setSelectedArticle(found);
      else {
        toast.error('That article link is no longer available.');
        applyListRoute({ kind: "home" }, false);
      }
    }
  }, [articles, applyListRoute]);

  const handleBookmark = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const wasBookmarked = bookmarkedIds.includes(id);
    setBookmarkedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
    toast.success(wasBookmarked ? 'Removed from reading list' : 'Added to reading list');
    trackEvent("bookmark_updated", { action: wasBookmarked ? "removed" : "added", article_id: id });
    if (currentUser) {
      const sync = wasBookmarked ? removeBookmarkRemote(id) : addBookmarkRemote(id);
      sync.catch(() => {
        toast.error('Could not sync bookmark — try again.');
        setBookmarkedIds(prev =>
          prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
      });
    }
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = authEmail.trim();
    if (!email || authPassword.length < 8) {
      toast.error("Enter an email and an 8+ character password.");
      return;
    }
    try {
      setAuthLoading(true);
      const user = authMode === "login" ? await login(email, authPassword) : await signup(email, authPassword);
      setCurrentUser(user);
      setAuthEmail("");
      setAuthPassword("");
      setIsAuthModalOpen(false);
      identifyUser(user.id, user.email);
      trackEvent("authentication_completed", { method: authMode });
      try {
        // Carry anything bookmarked while logged out into the account rather than dropping it.
        const local: string[] = JSON.parse(localStorage.getItem('sf-bookmarks') || '[]');
        const server = await fetchBookmarks();
        const toUpload = local.filter((id) => !server.includes(id));
        await Promise.allSettled(toUpload.map((id) => addBookmarkRemote(id)));
        setBookmarkedIds(toUpload.length > 0 ? await fetchBookmarks() : server);
      } catch {
        /* non-fatal */
      }
      toast.success(authMode === "login" ? "Signed in." : "Account created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign in right now.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = authEmail.trim();
    if (!email) {
      toast.error("Enter your email above first, then tap this.");
      return;
    }
    try {
      setAuthLoading(true);
      toast.success(await requestPasswordReset(email));
      trackEvent("password_reset_requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send that email right now.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* clear client state regardless */
    }
    posthog.reset();
    setCurrentUser(null);
    const saved = localStorage.getItem('sf-bookmarks');
    setBookmarkedIds(saved ? JSON.parse(saved) : []);
    toast.success("Signed out.");
  };

  const handleTogglePreference = async (category: ArticleCategory) => {
    if (!currentUser) return;
    const next = currentUser.preferences.includes(category)
      ? currentUser.preferences.filter((c) => c !== category)
      : [...currentUser.preferences, category];
    setCurrentUser({ ...currentUser, preferences: next });
    try {
      await updatePreferences(next);
      trackEvent("preference_updated", {
        category,
        action: next.includes(category) ? "added" : "removed",
        preference_count: next.length,
      });
    } catch {
      toast.error('Could not save preference.');
    }
  };

  const handleShare = (article: Article, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const shareUrl = `${window.location.origin}${articlePath(article.slug)}`;
    trackEvent("article_shared", { article_slug: article.slug, category: article.category });
    if (navigator.share) {
      navigator.share({
        title: article.title,
        text: article.excerpt,
        url: shareUrl,
      }).then(() => {
        posthog.capture("article_shared", { method: "native_share" });
      }).catch(() => {
        // User cancelled the share sheet.
      });
    } else {
      navigator.clipboard.writeText(shareUrl).then(() => {
        posthog.capture("article_shared", { method: "copy_link" });
        toast.success('Link copied to clipboard');
      }).catch(() => {});
    }
  };

  const categories = ARTICLE_CATEGORIES;
  const activeRoute: AppRoute = selectedArticle
    ? { kind: "article", slug: selectedArticle.slug }
    : appRoute;
  const activeGuide = appRoute.kind === "guide" ? getGuideBySlug(appRoute.slug) : null;


  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty("--site-chrome-h", `${el.offsetHeight}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [articles.length, selectedArticle]);

  useEffect(() => {
    if (!selectedArticle) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedArticle]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-paper z-[200]">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center px-6"
        >
          <div className="mb-8 relative">
            <h1 className="text-4xl md:text-7xl font-serif font-black tracking-tighter uppercase mb-2 text-center">Times of San Francisco</h1>
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
      <SeoHead
        article={selectedArticle}
        articles={articles}
        route={activeRoute}
      />
      {authChecked && !currentUser && <NewsletterCta variant="exit" />}
      <a
        href="#main-stream"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[300] focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-paper focus:outline-none"
      >
        Skip to main content
      </a>
      <Toaster position="top-center" richColors />
      
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
                <h2 className="text-3xl font-black uppercase tracking-tighter">
                  {currentUser ? "Your account" : authMode === "login" ? "Sign in" : "Create account"}
                </h2>
                <button onClick={() => setIsAuthModalOpen(false)}><X size={24} /></button>
              </div>

              {currentUser ? (
                <div className="space-y-6">
                  <p className="text-sm opacity-70">{currentUser.email}</p>
                  <div>
                    <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink/40 mb-3">
                      Personalize your feed
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {NEWSLETTER_CATEGORIES.map(({ value, label }) => {
                        const selected = currentUser.preferences.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => handleTogglePreference(value)}
                            className={cn(
                              "border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors",
                              selected ? "border-ink bg-ink text-paper" : "border-ink/20 text-ink/60 hover:border-accent hover:text-accent",
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => { handleLogout(); setIsAuthModalOpen(false); }}
                    className="w-full py-4 border border-ink/20 text-[10px] uppercase font-bold tracking-widest hover:bg-ink hover:text-paper transition-all"
                  >
                    Log out
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  <p className="text-sm italic mb-2 opacity-60">
                    {authMode === "login" ? "Sign in to sync your bookmarks and personalize your feed." : "Create an account to save bookmarks and personalize your feed."}
                  </p>
                  <input
                    type="email"
                    required
                    placeholder="your@email.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    disabled={authLoading}
                    className="w-full bg-transparent border-b border-ink/20 py-3 text-sm focus:border-accent outline-none"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Password (8+ characters)"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    disabled={authLoading}
                    className="w-full bg-transparent border-b border-ink/20 py-3 text-sm focus:border-accent outline-none"
                  />
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-4 bg-ink text-paper text-[10px] uppercase font-bold tracking-widest hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    {authLoading ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}
                    className="w-full text-center text-[10px] font-mono uppercase tracking-widest text-ink/50 hover:text-accent"
                  >
                    {authMode === "login" ? "Need an account? Create one" : "Have an account? Sign in"}
                  </button>
                  {authMode === "login" && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={authLoading}
                      className="w-full text-center text-[10px] font-mono uppercase tracking-widest text-ink/40 hover:text-accent disabled:opacity-50"
                    >
                      Forgot your password?
                    </button>
                  )}
                </form>
              )}
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
              {searchQuery.length >= 3 && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                   <Search className="opacity-30" size={16} />
                </div>
              )}
            </div>

            {searchQuery.trim().length >= 2 && (
              <div className="w-full max-w-sm mb-12 text-left max-h-72 overflow-y-auto border border-ink/10 rounded-sm divide-y divide-ink/10 bg-paper">
                {searching ? (
                  <p className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-ink/40">Searching...</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-ink/40">No stories found.</p>
                ) : (
                  searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => {
                        setSelectedArticle(result);
                        setIsMenuOpen(false);
                        setSearchQuery("");
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-ink/5 transition-colors"
                    >
                      <span className="block text-[9px] font-mono uppercase tracking-widest text-accent mb-1">{result.category}</span>
                      <span className="block text-sm font-serif font-bold leading-snug">{result.title}</span>
                    </button>
                  ))
                )}
              </div>
            )}

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
                {currentUser ? currentUser.email : "Subscribe / Login"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Site chrome — fixed so it never scrolls away */}
      <div
        ref={chromeRef}
        className="fixed top-0 inset-x-0 z-[60] border-b-[4px] border-ink bg-paper"
      >
        {/* News tape — always at the very top, scrolls right → left */}
        {articles.length > 0 && (
          <div className="relative overflow-hidden border-b border-ink/10 bg-paper py-2">
            <div
              ref={tickerTrackRef}
              className="flex w-max animate-marquee gap-12 items-center will-change-transform"
              style={{ animationDuration: `${tickerDuration}s` }}
            >
              {[...articles.slice(0, 12), ...articles.slice(0, 12)].map((a, i) => (
                <button
                  type="button"
                  key={`${a.id}-tape-${i}`}
                  className="flex items-center gap-3 cursor-pointer hover:text-accent transition-colors shrink-0"
                  onClick={() => setSelectedArticle(a)}
                >
                  <span className="text-accent font-black text-[10px] tracking-widest uppercase">Headline:</span>
                  <span className="font-serif italic text-xs tracking-tight">{a.title}</span>
                  <span className="text-ink/20 opacity-50">—</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Full masthead only on the feed — reading mode uses a compact brand strip */}
        {selectedArticle ? (
          <div className="px-4 md:px-6 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div />
            <button
              type="button"
              onClick={() => openCategory(null)}
              className="font-serif font-black uppercase tracking-tight text-xl md:text-3xl hover:text-accent transition-colors text-center justify-self-center"
            >
              Times of San Francisco
            </button>
            <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-[0.25em] text-ink/40 justify-self-end">
              Special Report
            </span>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 md:px-6 pt-2 md:pt-4">
            <div className="flex flex-col gap-2 md:gap-4 mb-2 md:mb-4 border-b border-ink pb-2 md:pb-4">
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
                    className="text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-2 border border-ink/20 hover:bg-ink hover:text-paper transition-all opacity-100 whitespace-nowrap max-w-[160px] truncate"
                  >
                    {currentUser ? currentUser.email : "Subscribe / Login"}
                  </button>
                </div>
              </div>

              <div
                role="banner"
                onClick={() => openCategory(null)}
                className="masthead-title font-serif font-black tracking-tighter uppercase text-center w-full mx-auto select-none cursor-pointer hover:text-accent transition-colors duration-500 block px-2"
              >
                Times of San Francisco
              </div>

              <div className="text-center mt-1 md:mt-2">
                <span className="inline-block text-[9px] md:text-[11px] font-mono font-medium uppercase tracking-[0.3em] md:tracking-[0.4em] text-ink opacity-60">
                  {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            </div>

            <nav className="relative">
              <div className="flex items-center overflow-x-auto no-scrollbar py-3 px-4 md:px-0 md:justify-center text-[10px] md:text-[11px] font-mono font-bold uppercase tracking-[0.2em] md:tracking-[0.3em]">
                <div className="flex items-center gap-6 md:gap-10 flex-nowrap min-w-max md:min-w-0">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => openCategory(cat)}
                      className={cn(
                        "hover:text-accent transition-colors border-b-2 whitespace-nowrap pb-1",
                        (selectedCategory === cat || (cat === "Events" && appRoute.kind === "events")) ? "border-accent text-accent" : "border-transparent hover:border-accent"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                  <button
                    onClick={() => navigateTo(digestPath())}
                    className={cn(
                      "hover:text-accent transition-colors border-b-2 whitespace-nowrap pb-1",
                      appRoute.kind === "digest" ? "border-accent text-accent" : "border-transparent hover:border-accent"
                    )}
                  >
                    Digest
                  </button>
                  <div className="w-px h-4 bg-ink/10 mx-2" />
                  <button
                    onClick={() => openCategory('Bookmarks')}
                    className={cn(
                      "hover:text-accent transition-colors border-b-2 whitespace-nowrap flex items-center gap-1 pb-1",
                      selectedCategory === 'Bookmarks' ? "border-accent text-accent" : "border-transparent hover:border-accent"
                    )}
                  >
                    <BookmarkIcon size={12} />
                    <span>Reading List</span>
                  </button>
                </div>
              </div>
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-paper to-transparent pointer-events-none md:hidden" />
            </nav>
          </div>
        )}
      </div>
      {/* Spacer so feed content clears the fixed chrome */}
      <div aria-hidden className="shrink-0" style={{ height: "var(--site-chrome-h, 0px)" }} />

      {/* Main Content */}
      <main id="main-stream" tabIndex={-1} className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-12 lg:py-16 outline-none">
        {!selectedArticle && (appRoute.kind === "home" || appRoute.kind === "category") && (
          <SponsorSlot placement={appRoute.kind === "home" ? "homepage" : "category"} />
        )}

        {appRoute.kind === "reset-password" && !selectedArticle ? (
          <Suspense fallback={<div className="py-24 text-center text-ink/40 italic">Loading…</div>}>
            <ResetPasswordPage onDone={() => navigateTo("/")} />
          </Suspense>
        ) : appRoute.kind === "digest" && !selectedArticle ? (
          <Suspense fallback={<div className="py-24 text-center text-ink/40 italic">Loading…</div>}>
            <DigestView
              articles={articles}
              onOpenArticle={setSelectedArticle}
              onNavigate={navigateTo}
            />
          </Suspense>
        ) : appRoute.kind === "guide" && !selectedArticle ? (
          activeGuide ? (
            <Suspense fallback={<div className="py-24 text-center text-ink/40 italic">Loading…</div>}>
              <GuidePage guide={activeGuide} onNavigate={navigateTo} />
            </Suspense>
          ) : (
            <div className="py-24 text-center">
              <p className="text-xl italic font-serif text-ink/40">Guide not found.</p>
              <button type="button" onClick={() => navigateTo(digestPath())} className="mt-6 text-accent font-mono text-[10px] uppercase tracking-widest border-b border-accent">
                Back to digest
              </button>
            </div>
          )
        ) : appRoute.kind === "topic" && !selectedArticle ? (
          <Suspense fallback={<div className="py-24 text-center text-ink/40 italic">Loading…</div>}>
            <TopicHub
              topicSlug={appRoute.slug}
              articles={articles}
              onOpenArticle={setSelectedArticle}
            />
          </Suspense>
        ) : appRoute.kind === "events" ? (
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl font-serif font-black mb-4 border-b-2 border-ink pb-4">Upcoming SF Events</h1>
            <p className="text-sm text-ink/60 mb-8 leading-relaxed">
              Public listings with source links. Verify times on the organizer page before you go.
            </p>
            <SponsorSlot placement="events" />
            {BOOSTED_EVENTS.filter((e) => e.active).map((boost) => (
              <a
                key={boost.id}
                href={boost.href}
                className="block mb-8 border border-accent/40 bg-accent/[0.04] px-4 py-3"
                rel={boost.href.startsWith("http") ? "sponsored noopener noreferrer" : undefined}
              >
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-accent mb-1">Boosted</p>
                <p className="font-bold">{boost.title}</p>
                <p className="text-xs text-ink/50">{boost.venue}</p>
              </a>
            ))}
            <Suspense fallback={<div className="py-24 text-center text-ink/40 italic">Loading…</div>}>
              <EventsPanel events={events} />
            </Suspense>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-12">
            <div className="flex-grow">
              {appRoute.kind === "category" && (
                <header className="mb-10 max-w-3xl">
                  <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-3">
                    {CATEGORY_SEO[appRoute.category]?.title ?? `${appRoute.category} news`}
                  </h1>
                  <p className="text-sm text-ink/60 leading-relaxed">
                    {CATEGORY_SEO[appRoute.category]?.description}
                  </p>
                </header>
              )}
              {filteredArticles.length === 0 ? (
                <div className="py-32 text-center">
                  {apiError ? (
                    <>
                      <p className="text-xl italic font-serif text-ink/40">Could not reach the news wire. The server may be restarting.</p>
                      <p className="mt-2 text-sm font-mono text-ink/30">If this persists, check that the API service is running and VITE_API_URL is correctly configured.</p>
                    </>
                  ) : !loading ? (
                    <p className="text-xl italic font-serif text-ink/40">No stories yet. The agent pipeline generates new articles every few minutes.</p>
                  ) : null}
                  <button 
                    onClick={() => openCategory(null)}
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

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 md:gap-x-8 gap-y-10 md:gap-y-12">
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

        {((appRoute.kind === "category" && (appRoute.category === "Tech" || appRoute.category === "Funding"))
          || selectedCategory === "Tech"
          || selectedCategory === "Funding") && (
          <div className="max-w-3xl">
            <Suspense fallback={<div className="py-12 text-center text-ink/40 italic">Loading jobs…</div>}>
              <JobsBoard desk={appRoute.kind === "category" ? appRoute.category : (selectedCategory as string)} />
            </Suspense>
          </div>
        )}

        {(appRoute.kind === "home" || appRoute.kind === "category") && (
          <aside className="mt-16 max-w-3xl">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/40 mb-4">SF guides</h2>
            <ul className="flex flex-wrap gap-3 mb-8">
              {EVERGREEN_GUIDES.map((guide) => (
                <li key={guide.slug}>
                  <button
                    type="button"
                    onClick={() => navigateTo(guidePath(guide.slug))}
                    className="text-xs font-mono uppercase tracking-widest border border-ink/15 px-3 py-2 hover:border-accent hover:text-accent"
                  >
                    {guide.title}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => navigateTo(digestPath())}
                  className="text-xs font-mono uppercase tracking-widest border border-ink/15 px-3 py-2 hover:border-accent hover:text-accent"
                >
                  Weekly digest
                </button>
              </li>
            </ul>
            <NewsletterCta variant="compact" />
          </aside>
        )}

        <section
          className="mt-24 max-w-3xl mx-auto border-t border-ink/10 pt-16 px-1"
          aria-labelledby="faq-heading"
        >
          <h2 id="faq-heading" className="text-lg font-black uppercase tracking-tight mb-8">
            About this publication
          </h2>
          <dl className="space-y-8 text-sm text-ink/75 leading-relaxed">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-widest text-accent mb-2">
                What is Times of San Francisco?
              </dt>
              <dd>
                {`Times of San Francisco (Times of SF) is a San Francisco–focused news reader. Stories combine RSS and web sources with editorial synthesis so readers get context, citations, and clear limits on what is confirmed versus inferred.`}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-widest text-accent mb-2">
                How are articles produced?
              </dt>
              <dd>
                An automated pipeline ingests public sources (feeds and pages), deduplicates overlapping coverage, and
                uses an LLM only after source text is available. Published pieces include credits and links back to
                originals where possible.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-widest text-accent mb-2">
                Which topics does Times of SF cover?
              </dt>
              <dd>
                Regular sections include civics, culture, tech, funding, transit, food, and local events—centered on
                San Francisco and immediate civic relevance.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-widest text-accent mb-2">
                Where is Times of SF based?
              </dt>
              <dd>Editorial focus and datelines are San Francisco, California, United States.</dd>
            </div>
          </dl>
        </section>

        {/* Footer */}
        <footer className="mt-32 pt-16 border-t-2 border-ink pb-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div className="lg:col-span-2">
             <h2 className="text-3xl md:text-5xl font-serif font-black uppercase tracking-tighter mb-6 text-center md:text-left">Times of San Francisco</h2>
             <p className="max-w-sm text-ink/60 text-sm leading-relaxed mb-8 italic">
               Independent. Local. Essential. The Times of San Francisco is dedicated to chronicling the vibrant soul of the Bay Area through rigorous journalism and elegant design.
             </p>
             <form onSubmit={handleNewsletterSubmit} className="mb-8 max-w-xl space-y-4">
               <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                 <input
                   type="email"
                   placeholder="your@email.com"
                   value={newsletterEmail}
                   onChange={(event) => setNewsletterEmail(event.target.value)}
                   disabled={newsletterLoading}
                   required
                   className="bg-transparent border-b border-ink/20 py-2 text-sm focus:border-accent outline-none flex-grow max-w-[260px]"
                 />
                 <button
                   type="submit"
                   disabled={newsletterLoading}
                   className="text-[10px] font-mono font-bold uppercase tracking-widest px-6 py-2 bg-ink text-paper hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                   {newsletterLoading ? "Joining..." : "Join the Newsletter"}
                 </button>
               </div>
               <div className="flex flex-wrap gap-2" aria-label="Newsletter topics">
                 {NEWSLETTER_CATEGORIES.map((category) => {
                   const selected = newsletterPreferences.includes(category.value);
                   return (
                     <button
                       key={category.value}
                       type="button"
                       aria-pressed={selected}
                       disabled={newsletterLoading}
                       onClick={() => toggleNewsletterPreference(category.value)}
                       className={cn(
                         "border px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                         selected
                           ? "border-ink bg-ink text-paper"
                           : "border-ink/20 text-ink/60 hover:border-accent hover:text-accent",
                       )}
                     >
                       {category.label}
                     </button>
                   );
                 })}
               </div>
             </form>
          </div>
          <div>
            <h4 className="text-xs font-mono uppercase tracking-widest mb-6 opacity-40">Categories</h4>
            <ul className="space-y-3 text-sm font-medium">
              <li onClick={() => openCategory('Civics')} className="hover:text-accent cursor-pointer transition-colors">Civics</li>
              <li onClick={() => openCategory('Culture')} className="hover:text-accent cursor-pointer transition-colors">Culture</li>
              <li onClick={() => openCategory('Tech')} className="hover:text-accent cursor-pointer transition-colors">Tech & Future</li>
              <li onClick={() => openCategory('Food')} className="hover:text-accent cursor-pointer transition-colors">Food & Drink</li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-mono uppercase tracking-widest mb-6 opacity-40">Connect</h4>
            <ul className="space-y-3 text-sm font-medium">
              <li onClick={() => toast.info("Choose your newsletter topics in the signup form.")} className="hover:text-accent cursor-pointer transition-colors">Newsletter</li>
              <li>
                <a
                  href="https://x.com/_timesofsf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  X
                </a>
              </li>
              <li onClick={() => openCategory(null)} className="hover:text-accent cursor-pointer transition-colors">Archive</li>
            </ul>
          </div>
        </footer>
      </main>

      <Suspense fallback={<div className="py-24 text-center text-ink/40 italic">Loading reader…</div>}>
        <ReaderView 
          article={selectedArticle}
          allArticles={articles}
          onClose={() => {
            setSelectedArticle(null);
            const path = listPathRef.current || "/";
            window.history.replaceState({}, "", path);
            setAppRoute(parseAppPath(path));
          }}
          onNavigate={navigateTo}
          onOpenArticle={setSelectedArticle}
          isBookmarked={selectedArticle ? bookmarkedIds.includes(selectedArticle.id) : false}
          onBookmark={() => selectedArticle && handleBookmark(selectedArticle.id)}
          onShare={(e) => selectedArticle && handleShare(selectedArticle, e)}
        />
      </Suspense>
    </div>
  );
}
