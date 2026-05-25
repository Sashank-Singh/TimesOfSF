import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, StopCircle, Loader2, ChevronUp, ChevronDown, Headphones } from "lucide-react";
import { cn } from "../lib/utils";

export type VoiceReaderStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

interface VoiceReaderProps {
  text: string;
  title?: string;
  onWordChange?: (wordIndex: number) => void;
  onStatusChange?: (status: VoiceReaderStatus) => void;
  onComplete?: () => void;
  onClose?: () => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

const VOICES: Array<{ id: string; name: string }> = [
  { id: "en-US-JennyNeural", name: "Jenny (US)" },
  { id: "en-US-GuyNeural", name: "Guy (US)" },
  { id: "en-US-AriaNeural", name: "Aria (US)" },
  { id: "en-US-DavisNeural", name: "Davis (US)" },
  { id: "en-GB-SoniaNeural", name: "Sonia (UK)" },
  { id: "en-GB-RyanNeural", name: "Ryan (UK)" },
  { id: "en-AU-NatashaNeural", name: "Natasha (AU)" },
  { id: "en-IN-NeerjaNeural", name: "Neerja (IN)" },
];

export function VoiceReader({ text, title, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
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

  useEffect(() => { return () => { cleanupAudio(); }; }, [cleanupAudio]);

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

      audio.onloadedmetadata = () => updateStatus("playing");

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

      audio.onerror = () => {
        setError("Playback failed.");
        updateStatus("error");
        cleanupAudio();
      };

      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate speech");
      updateStatus("error");
      cleanupAudio();
    }
  }, [text, voice, speed, totalWords, updateStatus, onComplete, cleanupAudio]);

  const togglePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (status === "playing") { audio.pause(); updateStatus("paused"); }
    else if (status === "paused") { audio.play().catch(() => { setError("Failed to resume."); updateStatus("error"); }); }
  }, [status, updateStatus]);

  const stop = useCallback(() => {
    cleanupAudio();
    updateStatus("idle");
    setProgress(0);
    lastWordRef.current = -1;
    onWordRef.current?.(-1);
  }, [updateStatus, cleanupAudio]);

  const handlePlay = useCallback(() => {
    if (status === "idle" || status === "ready" || status === "error") fetchAndPlay();
    else if (status === "playing" || status === "paused") togglePause();
  }, [status, fetchAndPlay, togglePause]);

  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const isLoading = status === "loading";
  const isActive = isPlaying || isPaused;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] bg-black/90 backdrop-blur-xl border-t border-white/10">
      {/* Progress bar */}
      <div className="h-[3px] bg-white/10 w-full">
        <div
          className="h-full bg-white transition-all duration-300 ease-out"
          style={{ width: `${isLoading ? 5 : isActive ? progress : 0}%` }}
        />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-4 sm:gap-6">
        {/* Now Playing info */}
        <div className="hidden sm:flex items-center gap-3 min-w-0 flex-1">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
            isLoading ? "bg-white/10" : isActive ? "bg-white/20" : "bg-white/5",
          )}>
            {isLoading ? (
              <Loader2 size={18} className="animate-spin text-white/70" />
            ) : (
              <Headphones size={18} className={cn(isActive ? "text-white" : "text-white/40")} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-white/90 truncate leading-tight">
              {isLoading ? "Generating audio..." : title || "Now Playing"}
            </p>
            <p className="text-[11px] text-white/40 truncate leading-tight mt-0.5">
              {isLoading ? "Using edge-tts neural voice" : isActive ? `${progress}% complete` : "Tap play to listen"}
            </p>
          </div>
        </div>

        {/* Mobile: minimal now playing */}
        <div className="sm:hidden flex items-center gap-2 min-w-0 flex-1">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
            isLoading ? "bg-white/10" : isActive ? "bg-white/20" : "bg-white/5",
          )}>
            {isLoading ? (
              <Loader2 size={14} className="animate-spin text-white/70" />
            ) : (
              <Headphones size={14} className={cn(isActive ? "text-white" : "text-white/40")} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-white/90 truncate leading-tight">
              {isLoading ? "Loading..." : isActive ? `${progress}%` : "Listen"}
            </p>
          </div>
        </div>

        {/* Controls */}
        {!isLoading && status !== "error" && (
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            {/* Play/Pause - circular Apple-style */}
            <button
              onClick={handlePlay}
              className={cn(
                "flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full transition-all duration-200",
                isActive
                  ? "bg-white text-black hover:bg-white/90 hover:scale-105 active:scale-95"
                  : "bg-white/10 text-white hover:bg-white/20 hover:scale-105 active:scale-95",
              )}
            >
              {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
            </button>

            {/* Stop */}
            {isActive && (
              <button
                onClick={stop}
                className="flex items-center justify-center w-7 h-7 sm:w-9 sm:h-9 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
                title="Stop"
              >
                <StopCircle size={14} />
              </button>
            )}

            {/* Speed selector */}
            <div className="relative">
              <button
                onClick={() => { setSpeedOpen(!speedOpen); setVoiceOpen(false); }}
                className="h-7 sm:h-9 px-2 sm:px-3 rounded-full text-[11px] sm:text-[12px] font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all tracking-wide"
              >
                {speed}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl min-w-[80px] overflow-hidden py-1">
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { stop(); setSpeed(s); setSpeedOpen(false); }}
                      className={cn(
                        "w-full px-4 py-2 text-[12px] font-medium text-left hover:bg-white/10 transition-colors",
                        speed === s ? "text-white" : "text-white/50",
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Voice selector */}
            <div className="relative">
              <button
                onClick={() => { setVoiceOpen(!voiceOpen); setSpeedOpen(false); }}
                className="hidden sm:flex h-9 px-3 rounded-full text-[11px] sm:text-[12px] font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all items-center gap-1"
              >
                {VOICES.find((v) => v.id === voice)?.name || voice}
                {voiceOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </button>
              {voiceOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-y-auto min-w-[170px] py-1 max-h-56">
                  {VOICES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { stop(); setVoice(v.id); setVoiceOpen(false); }}
                      className={cn(
                        "w-full px-4 py-2 text-[12px] font-medium text-left hover:bg-white/10 transition-colors",
                        voice === v.id ? "text-white" : "text-white/50",
                      )}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 sm:w-9 sm:h-9 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-all"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[12px] text-red-400 truncate max-w-[200px]">{error}</span>
            <button
              onClick={fetchAndPlay}
              className="h-8 px-4 rounded-full text-[11px] font-medium bg-white/10 text-white hover:bg-white/20 transition-all"
            >
              Retry
            </button>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        )}

        {/* Loading state on mobile */}
        {isLoading && (
          <div className="flex items-center gap-2 shrink-0 sm:hidden">
            <span className="text-[11px] text-white/40">Generating...</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceReader;
