import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ArticleCategory } from "../types";
import { subscribeToNewsletter } from "../services/newsService";
import { cn } from "../lib/utils";
import posthog from "../lib/posthog";

const TOPIC_OPTIONS: ArticleCategory[] = [
  "Tech",
  "Civics",
  "Funding",
  "Culture",
  "Transit",
  "Food",
  "Events",
];

type NewsletterCtaProps = {
  variant?: "inline" | "exit" | "compact";
  defaultTopics?: ArticleCategory[];
  className?: string;
};

export function NewsletterCta({
  variant = "inline",
  defaultTopics = ["Tech", "Civics"],
  className,
}: NewsletterCtaProps) {
  const [email, setEmail] = useState("");
  const [topics, setTopics] = useState<ArticleCategory[]>(defaultTopics);
  const [loading, setLoading] = useState(false);
  const [dismissedExit, setDismissedExit] = useState(() => {
    try {
      return sessionStorage.getItem("tosf-exit-nl") === "1";
    } catch {
      return false;
    }
  });
  const [showExit, setShowExit] = useState(false);

  useEffect(() => {
    if (variant !== "exit" || dismissedExit) return;

    const onMouseOut = (event: MouseEvent) => {
      if (event.clientY > 0) return;
      setShowExit(true);
    };

    document.addEventListener("mouseout", onMouseOut);
    return () => document.removeEventListener("mouseout", onMouseOut);
  }, [variant, dismissedExit]);

  const toggleTopic = (topic: ArticleCategory) => {
    setTopics((current) =>
      current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic],
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter your email first.");
      return;
    }
    if (topics.length === 0) {
      toast.error("Choose at least one topic.");
      return;
    }
    try {
      setLoading(true);
      await subscribeToNewsletter(trimmed, topics);
      posthog.capture("newsletter_subscribed", {
        source: variant,
        topic_count: topics.length,
      });
      setEmail("");
      toast.success("Subscribed — topic preferences saved.");
      if (variant === "exit") {
        setShowExit(false);
        setDismissedExit(true);
        try {
          sessionStorage.setItem("tosf-exit-nl", "1");
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not subscribe right now.");
    } finally {
      setLoading(false);
    }
  };

  const dismissExit = () => {
    setShowExit(false);
    setDismissedExit(true);
    try {
      sessionStorage.setItem("tosf-exit-nl", "1");
    } catch {
      /* ignore */
    }
  };

  if (variant === "exit" && !showExit) return null;

  const form = (
    <form onSubmit={submit} className={cn("space-y-4", className)}>
      <div>
        <p className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-accent mb-2">
          Newsletter
        </p>
        <h3 className="text-xl md:text-2xl font-black tracking-tight mb-2">
          SF briefings by topic
        </h3>
        <p className="text-sm text-ink/60 leading-relaxed">
          One focused email when we publish in the desks you choose—no generic blast.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          className="bg-transparent border-b border-ink/20 py-2 text-sm focus:border-accent outline-none flex-grow"
        />
        <button
          type="submit"
          disabled={loading}
          className="text-[10px] font-mono font-bold uppercase tracking-widest px-5 py-2 bg-ink text-paper hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {loading ? "Joining..." : "Subscribe"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Newsletter topics">
        {TOPIC_OPTIONS.map((topic) => {
          const selected = topics.includes(topic);
          return (
            <button
              key={topic}
              type="button"
              aria-pressed={selected}
              disabled={loading}
              onClick={() => toggleTopic(topic)}
              className={cn(
                "border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-50",
                selected
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/20 text-ink/60 hover:border-accent hover:text-accent",
              )}
            >
              {topic}
            </button>
          );
        })}
      </div>
    </form>
  );

  if (variant === "exit") {
    return (
      <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-ink/40 p-4">
        <div className="w-full max-w-md bg-paper border-2 border-ink p-6 shadow-xl relative">
          <button
            type="button"
            onClick={dismissExit}
            className="absolute top-3 right-3 text-[10px] font-mono uppercase tracking-widest text-ink/40 hover:text-accent"
          >
            Close
          </button>
          {form}
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className={cn("border border-ink/10 bg-ink/[0.02] p-5", className)}>{form}</div>
    );
  }

  return <div className={cn("border-t border-ink/10 pt-10", className)}>{form}</div>;
}
