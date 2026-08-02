import { useState } from "react";
import { toast } from "sonner";
import { resetPassword } from "../services/newsService";

type ResetPasswordPageProps = {
  onDone: () => void;
};

export function ResetPasswordPage({ onDone }: ResetPasswordPageProps) {
  const token = (() => {
    try {
      return new URLSearchParams(window.location.search).get("token") ?? "";
    } catch {
      return "";
    }
  })();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Those passwords do not match.");
      return;
    }
    try {
      setLoading(true);
      await resetPassword(token, password);
      setDone(true);
      toast.success("Password updated — you can sign in now.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset your password.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="max-w-md mx-auto py-24 text-center">
        <h1 className="text-3xl font-serif font-black mb-4">Reset link missing</h1>
        <p className="text-sm text-ink/60 mb-8">This page needs a valid reset link from your email.</p>
        <button onClick={onDone} className="font-mono text-[10px] uppercase tracking-widest text-accent border-b border-accent">
          Back to front page
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto py-24 text-center">
        <h1 className="text-3xl font-serif font-black mb-4">Password updated</h1>
        <p className="text-sm text-ink/60 mb-8">You have been signed out everywhere. Sign in with your new password.</p>
        <button onClick={onDone} className="font-mono text-[10px] uppercase tracking-widest text-accent border-b border-accent">
          Back to front page
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-20">
      <h1 className="text-3xl font-serif font-black mb-2">Choose a new password</h1>
      <p className="text-sm text-ink/60 mb-8">Reset links expire an hour after they are sent and work only once.</p>
      <form onSubmit={submit} className="space-y-4">
        <input
          type="password"
          required
          minLength={8}
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          className="w-full bg-transparent border-b border-ink/20 py-3 text-sm focus:border-accent outline-none"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading}
          className="w-full bg-transparent border-b border-ink/20 py-3 text-sm focus:border-accent outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-ink text-paper text-[10px] uppercase font-bold tracking-widest hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
