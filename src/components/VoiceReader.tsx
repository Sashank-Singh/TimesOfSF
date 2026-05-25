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

const VOICES: Array<{ id: string; name: string }> = [
  { id: "en-US-JennyNeural", name: "English (US) — Jenny (female)" },
  { id: "en-US-GuyNeural", name: "English (US) — Guy (male)" },
  { id: "en-US-AriaNeural", name: "English (US) — Aria (female)" },
  { id: "en-US-DavisNeural", name: "English (US) — Davis (male)" },
  { id: "en-GB-SoniaNeural", name: "English (UK) — Sonia (female)" },
  { id: "en-GB-RyanNeural", name: "English (UK) — Ryan (male)" },
  { id: "en-AU-NatashaNeural", name: "English (AU) — Natasha (female)" },
  { id: "en-IN-NeerjaNeural", name: "English (IN) — Neerja (female)" },
];

export function VoiceReader({ text, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
  const [status, setStatus] = useState<VoiceReaderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [voice, setVoice] = useState(VOICES[0].id);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const onWordRef = useRef(onWordChange);
  const lastWordRef = useRef(-1);

  useEffect(() => { onWordRef.current = onWordChange; }, [onWordChange]);

  const totalWords = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  const updateStatus = useCallback((s: VoiceReaderStatus) => {
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanupAudio(); };
  }, [cleanupAudio]);

  const fetchAndPlay = useCallback(async () => {
    setError(null);
    updateStatus("loading");

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audio.playbackRate = speed;
      audioRef.current = audio;

      audio.onloadedmetadata = () => {
        updateStatus("playing");
      };

      audio.ontimeupdate = () => {
        if (audio.duration && audio.duration > 0) {
          const pct = Math.round((audio.currentTime / audio.duration) * 100);
          setProgress(pct);
          const wi = Math.round((audio.currentTime / audio.duration) * totalWords);
          if (wi !== lastWordRef.current) {
            lastWordRef.current = wi;
            onWordRef.current?.(wi);
          }
        }
      };

      audio.onended = () => {
        cleanupAudio();
        setProgress(100);
        onWordRef.current?.(totalWords - 1);
        updateStatus("idle");
        onComplete?.();
      };

      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        setError("Playback failed.");
        updateStatus("error");
        cleanupAudio();
      };

      await audio.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate speech";
      console.error("TTS error:", err);
      setError(message);
      updateStatus("error");
      cleanupAudio();
    }
  }, [text, voice, speed, totalWords, updateStatus, onComplete, cleanupAudio]);

  const togglePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (status === "playing") {
      audio.pause();
      updateStatus("paused");
    } else if (status === "paused") {
      audio.play().catch((err) => {
        console.error("Resume failed:", err);
        setError("Failed to resume playback.");
        updateStatus("error");
      });
    }
  }, [status, updateStatus]);

  const stop = useCallback(() => {
    cleanupAudio();
    updateStatus("idle");
    setProgress(0);
    lastWordRef.current = -1;
    onWordRef.current?.(-1);
  }, [updateStatus, cleanupAudio]);

  const handlePlay = useCallback(() => {
    if (status === "idle" || status === "ready" || status === "error") {
      fetchAndPlay();
    } else if (status === "playing" || status === "paused") {
      togglePause();
    }
  }, [status, fetchAndPlay, togglePause]);

  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const isLoading = status === "loading";

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
          {isLoading ? (
            <Loader2 size={16} className="animate-spin text-accent" />
          ) : (
            <Volume2 size={16} className={cn(isPlaying ? "text-accent" : "text-ink/40")} />
          )}
        </div>

        {isLoading && (
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-ink/50 truncate">Generating audio...</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-red-600 truncate">{error}</p>
          </div>
        )}

        {!isLoading && status !== "error" && (
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

        {!isLoading && status !== "error" && (
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
                title={VOICES.find((v) => v.id === voice)?.name || voice}
              >
                {voice}
              </button>
              {voiceOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-paper border border-ink/10 rounded-sm shadow-lg max-h-48 overflow-y-auto min-w-[160px]">
                  {VOICES.map((v) => (
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
              onClick={fetchAndPlay}
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
