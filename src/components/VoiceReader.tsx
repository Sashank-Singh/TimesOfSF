import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, StopCircle, Loader2, Volume2, X } from "lucide-react";
import { cn } from "../lib/utils";

export type VoiceReaderStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

interface VoiceReaderProps {
  text: string;
  onWordChange?: (wordIndex: number) => void;
  onStatusChange?: (status: VoiceReaderStatus) => void;
  onComplete?: () => void;
  onClose?: () => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

/** Map a character index to the word index in the original text. */
function charIndexToWordIndex(text: string, charIndex: number): number {
  const before = text.slice(0, Math.min(charIndex, text.length));
  return before.split(/\s+/).filter(Boolean).length;
}

export function VoiceReader({ text, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
  const [status, setStatus] = useState<VoiceReaderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [voice, setVoice] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onWordRef = useRef(onWordChange);
  const lastWordRef = useRef(-1);
  const pendingRef = useRef(false);

  useEffect(() => { onWordRef.current = onWordChange; }, [onWordChange]);

  const totalWords = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  const updateStatus = useCallback((s: VoiceReaderStatus) => {
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  // Enumerate available voices on mount
  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available.map((v) => ({ id: v.name, name: `${v.name} (${v.lang})` })));
        setVoice(available[0].name);
      }
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const stopPlayback = useCallback(() => {
    window.speechSynthesis.cancel();
    pendingRef.current = false;
    lastWordRef.current = -1;
    utteranceRef.current = null;
  }, []);

  const startPlayback = useCallback(() => {
    if (!window.speechSynthesis) {
      setError("Speech synthesis is not available in this browser.");
      updateStatus("error");
      return;
    }

    stopPlayback();
    pendingRef.current = true;
    lastWordRef.current = -1;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.voice = voices.find((v) => v.id === voice) ? window.speechSynthesis.getVoices().find((v) => v.name === voice) ?? null : null;

    utterance.onboundary = (e) => {
      if (e.name === "word" && typeof e.charIndex === "number") {
        const wi = charIndexToWordIndex(text, e.charIndex);
        if (wi !== lastWordRef.current) {
          lastWordRef.current = wi;
          onWordRef.current?.(wi);
          setProgress(Math.round((wi / totalWords) * 100));
        }
      }
    };

    utterance.onstart = () => {
      updateStatus("playing");
    };

    utterance.onend = () => {
      pendingRef.current = false;
      setProgress(100);
      onWordRef.current?.(totalWords - 1);
      updateStatus("idle");
      onComplete?.();
    };

    utterance.onerror = (e) => {
      if (pendingRef.current) {
        console.error("Speech synthesis error:", e);
        setError("An error occurred during playback.");
        updateStatus("error");
      }
      pendingRef.current = false;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [text, speed, voice, voices, totalWords, updateStatus, onComplete, stopPlayback]);

  const togglePause = useCallback(() => {
    if (status === "playing") {
      window.speechSynthesis.pause();
      updateStatus("paused");
    } else if (status === "paused") {
      window.speechSynthesis.resume();
      updateStatus("playing");
    }
  }, [status, updateStatus]);

  const stop = useCallback(() => {
    stopPlayback();
    updateStatus("idle");
    setProgress(0);
    lastWordRef.current = -1;
    onWordRef.current?.(-1);
  }, [updateStatus, stopPlayback]);

  const handlePlay = useCallback(() => {
    if (status === "idle" || status === "ready" || status === "error") {
      startPlayback();
    } else if (status === "playing" || status === "paused") {
      togglePause();
    }
  }, [status, startPlayback, togglePause]);

  useEffect(() => {
    return () => { stopPlayback(); };
  }, [stopPlayback]);

  const isPlaying = status === "playing";
  const isPaused = status === "paused";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] border-t border-ink/10 bg-paper/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="h-[2px] bg-ink/5 w-full">
        <div
          className="h-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="max-w-4xl mx-auto px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4">
        <div className="shrink-0">
          {voices.length === 0 ? (
            <Loader2 size={16} className="animate-spin text-ink/40" />
          ) : (
            <Volume2 size={16} className={cn(isPlaying ? "text-accent" : "text-ink/40")} />
          )}
        </div>

        {voices.length === 0 && (
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-ink/50 truncate">Loading speech engine...</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-red-600 truncate">{error}</p>
          </div>
        )}

        {voices.length > 0 && status !== "error" && (
          <div className="hidden sm:block flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink/50">
              <span className={cn(isPlaying && "text-accent font-bold")}>
                {isPlaying && "Speaking"}
                {isPaused && "Paused"}
                {(status === "idle" || status === "ready") && "Ready"}
              </span>
              {(status === "playing" || status === "paused") && (
                <>
                  <span className="text-ink/20">·</span>
                  <span>{progress}%</span>
                </>
              )}
            </div>
          </div>
        )}

        {voices.length > 0 && status !== "error" && (
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              onClick={handlePlay}
              className={cn(
                "flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest transition-all rounded-sm",
                isPlaying
                  ? "bg-accent text-paper hover:bg-accent/90"
                  : "bg-ink/5 text-ink hover:bg-ink/10",
              )}
            >
              {isPlaying ? (
                <><Pause size={12} /> <span className="hidden sm:inline">Pause</span></>
              ) : isPaused ? (
                <><Play size={12} /> <span className="hidden sm:inline">Resume</span></>
              ) : (
                <><Play size={12} /> <span className="hidden sm:inline">Listen</span></>
              )}
            </button>

            {(isPlaying || isPaused) && (
              <button
                onClick={stop}
                className="p-1.5 hover:bg-ink/5 rounded-sm transition-colors text-ink/40 hover:text-ink"
                title="Stop"
              >
                <StopCircle size={14} />
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => { setSpeedOpen(!speedOpen); setVoiceOpen(false); }}
                className="px-1.5 sm:px-2 py-1.5 text-[10px] font-mono text-ink/50 hover:text-ink hover:bg-ink/5 rounded-sm transition-colors"
              >
                {speed}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-paper border border-ink/10 rounded-sm shadow-lg min-w-[72px] overflow-hidden">
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { stop(); setSpeed(s); setSpeedOpen(false); }}
                      className={cn(
                        "w-full px-3 py-1.5 text-[10px] font-mono text-left hover:bg-ink/5 transition-colors",
                        speed === s ? "text-accent font-bold" : "text-ink/60",
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => { setVoiceOpen(!voiceOpen); setSpeedOpen(false); }}
                className="hidden sm:block px-2 py-1.5 text-[10px] font-mono text-ink/50 hover:text-ink hover:bg-ink/5 rounded-sm transition-colors max-w-[80px] truncate"
                title={voice || "Voice"}
              >
                {voice || "Voice"}
              </button>
              {voiceOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-paper border border-ink/10 rounded-sm shadow-lg max-h-48 overflow-y-auto min-w-[160px]">
                  {voices.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { stop(); setVoice(v.id); setVoiceOpen(false); }}
                      className={cn(
                        "w-full px-3 py-1.5 text-[10px] font-mono text-left hover:bg-ink/5 transition-colors",
                        voice === v.id ? "text-accent font-bold" : "text-ink/60",
                      )}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-ink/5 rounded-sm transition-colors text-ink/30 hover:text-ink"
              title="Close reader"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={startPlayback}
              className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-accent text-paper rounded-sm hover:bg-accent/90 transition-colors"
            >
              Retry
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-ink/5 rounded-sm transition-colors text-ink/30 hover:text-ink">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceReader;
