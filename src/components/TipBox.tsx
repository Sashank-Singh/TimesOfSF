import { useState } from "react";
import { toast } from "sonner";
import { submitTip } from "../services/newsService";
import { cn } from "../lib/utils";

type TipBoxProps = {
  postSlug?: string;
  className?: string;
};

export function TipBox({ postSlug, className }: TipBoxProps) {
  const [kind, setKind] = useState<"tip" | "correction">("correction");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      toast.error("A few more details would help — at least 10 characters.");
      return;
    }
    try {
      setLoading(true);
      await submitTip({
        postSlug,
        kind,
        message: trimmed,
        contactEmail: contactEmail.trim() || undefined,
      });
      setMessage("");
      setContactEmail("");
      setSent(true);
      toast.success("Thanks — sent to the newsroom.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit right now.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className={cn("border border-ink/10 bg-ink/[0.02] p-5 text-sm text-ink/60", className)}>
        Received — thanks for the note.
      </div>
    );
  }

  return (
    <div className={cn("border border-ink/10 bg-ink/[0.02] p-5", className)}>
      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-accent mb-2">
        Newsroom
      </p>
      <h3 className="text-xl font-black tracking-tight mb-3">Spot an error? Have a tip?</h3>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2" aria-label="Report type">
          {(["correction", "tip"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              disabled={loading}
              onClick={() => setKind(option)}
              className={cn(
                "border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-50",
                kind === option
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/20 text-ink/60 hover:border-accent hover:text-accent",
              )}
            >
              {option === "correction" ? "Correction" : "Tip"}
            </button>
          ))}
        </div>
        <textarea
          required
          rows={3}
          placeholder={kind === "correction" ? "What did we get wrong?" : "What should we look into?"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={loading}
          className="w-full bg-transparent border border-ink/20 rounded-sm py-2 px-3 text-sm focus:border-accent outline-none resize-none"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="email"
            placeholder="Email (optional, if you want a reply)"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={loading}
            className="bg-transparent border-b border-ink/20 py-2 text-sm focus:border-accent outline-none flex-grow"
          />
          <button
            type="submit"
            disabled={loading}
            className="text-[10px] font-mono font-bold uppercase tracking-widest px-5 py-2 bg-ink text-paper hover:bg-accent disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
