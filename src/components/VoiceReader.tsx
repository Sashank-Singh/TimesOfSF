import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, StopCircle, Loader2, ChevronUp, ChevronDown, RotateCcw, RotateCw } from "lucide-react";
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
const SKIP_SECONDS = 10;
const FETCH_TIMEOUT = 45_000;

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceReader({ text, title, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
  const [status, setStatus] = useState<VoiceReaderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const preloadUrlRef = useRef<string | null>(null);
  const onWordRef = useRef(onWordChange);
  const lastWordRef = useRef(-1);
  const barRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { onWordRef.current = onWordChange; }, [onWordChange]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const totalWords = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  const updateStatus = useCallback((s: VoiceReaderStatus) => {
    if (!mountedRef.current) return;
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const cleanupAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
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

  /** Release preloaded-but-unused blob so GC can collect it */
  const discardPreload = useCallback(() => {
    if (preloadUrlRef.current) {
      URL.revokeObjectURL(preloadUrlRef.current);
      preloadUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudio();
      discardPreload();
    };
  }, [cleanupAudio, discardPreload]);

  // ── Preload audio as soon as the reader mounts ──
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    if (!truncated.trim()) {
      updateStatus("idle");
      return;
    }

    updateStatus("loading");
    setError(null);

    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    (async () => {
      try {
        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: truncated, voice: "en-US-JennyNeural" }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `Server error (${resp.status})`);
        }

        const blob = await resp.blob();
        if (!blob.size) throw new Error("Empty audio response");
        if (cancelled) { URL.revokeObjectURL(preloadUrlRef.current ?? ""); return; }

        preloadUrlRef.current = URL.createObjectURL(blob);
        if (!cancelled) updateStatus("ready");
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Request timed out. Try again.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to generate speech");
        }
        if (!cancelled) updateStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Start playback from preloaded audio ──
  const startPlayback = useCallback((url: string) => {
    discardPreload();

    const audio = new Audio(url);
    audio.playbackRate = speed;
    audioRef.current = audio;
    blobUrlRef.current = url;

    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
      updateStatus("playing");
    };

    audio.ontimeupdate = () => {
      if (isSeeking) return;
      if (audio.duration && audio.duration > 0) {
        const ct = audio.currentTime;
        setCurrentTime(ct);
        const pct = Math.round((ct / audio.duration) * 100);
        setProgress(pct);
        const wi = Math.round((ct / audio.duration) * totalWords);
        if (wi !== lastWordRef.current) {
          lastWordRef.current = wi;
          onWordRef.current?.(wi);
        }
      }
    };

    audio.onended = () => {
      cleanupAudio();
      setProgress(100);
      setCurrentTime(0);
      setDuration(0);
      onWordRef.current?.(totalWords - 1);
      updateStatus("idle");
      onComplete?.();
    };

    audio.onerror = () => {
      setError("Playback failed. Tap to retry.");
      updateStatus("error");
      cleanupAudio();
    };

    audio.play().catch(() => {
      setError("Playback failed to start.");
      updateStatus("error");
      cleanupAudio();
    });
  }, [speed, totalWords, updateStatus, onComplete, cleanupAudio, discardPreload, isSeeking]);

  // ── Fallback fetch+play (when preload failed) ──
  const fetchAndPlay = useCallback(async () => {
    setError(null);
    updateStatus("loading");
    const controller = new AbortController();
    abortRef.current = controller;

    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

    try {
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: truncated, voice: "en-US-JennyNeural" }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${response.status})`);
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error("Empty audio response");

      const url = URL.createObjectURL(blob);
      startPlayback(url);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out. Try again.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to generate speech");
      }
      updateStatus("error");
      cleanupAudio();
    }
  }, [text, totalWords, updateStatus, cleanupAudio, startPlayback]);

  const togglePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (status === "playing") { audio.pause(); updateStatus("paused"); }
    else if (status === "paused") { audio.play().catch(() => { setError("Resume failed."); updateStatus("error"); }); }
  }, [status, updateStatus]);

  const stop = useCallback(() => {
    cleanupAudio();
    discardPreload();
    updateStatus("idle");
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    lastWordRef.current = -1;
    onWordRef.current?.(-1);
  }, [updateStatus, cleanupAudio, discardPreload]);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const newTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    const pct = Math.round((newTime / audio.duration) * 100);
    setProgress(pct);
  }, []);

  const handlePlay = useCallback(() => {
    if (status === "idle") {
      fetchAndPlay();
    } else if (status === "ready") {
      if (preloadUrlRef.current) startPlayback(preloadUrlRef.current);
      else fetchAndPlay();
    } else if (status === "error") {
      fetchAndPlay();
    } else if (status === "playing" || status === "paused") {
      togglePause();
    }
  }, [status, fetchAndPlay, startPlayback, togglePause]);

  // Progress bar dragging
  const seekFromEvent = useCallback((clientX: number) => {
    const bar = barRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !audio.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = ratio * audio.duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    setProgress(Math.round(ratio * 100));
  }, []);

  const onBarMouseDown = useCallback((e: React.MouseEvent) => {
    setIsSeeking(true);
    seekFromEvent(e.clientX);
  }, [seekFromEvent]);

  useEffect(() => {
    if (!isSeeking) return;
    const onMove = (e: MouseEvent) => seekFromEvent(e.clientX);
    const onUp = () => setIsSeeking(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isSeeking, seekFromEvent]);

  const onBarTouchStart = useCallback((e: React.TouchEvent) => {
    setIsSeeking(true);
    seekFromEvent(e.touches[0].clientX);
  }, [seekFromEvent]);

  useEffect(() => {
    if (!isSeeking) return;
    const onMove = (e: TouchEvent) => seekFromEvent(e.touches[0].clientX);
    const onEnd = () => setIsSeeking(false);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
  }, [isSeeking, seekFromEvent]);

  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const isLoading = status === "loading";
  const isReady = status === "ready";
  const isActive = isPlaying || isPaused;
  const hasAudio = isActive && duration > 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] bg-black/95 backdrop-blur-xl border-t border-white/10">
      {/* Scrubable progress bar */}
      <div
        ref={barRef}
        className="group relative h-1.5 bg-white/10 w-full cursor-pointer"
        onMouseDown={onBarMouseDown}
        onTouchStart={onBarTouchStart}
      >
        <div
          className={cn(
            "h-full bg-white transition-[width] duration-75",
            isSeeking && "bg-white/80",
          )}
          style={{ width: `${isLoading || isReady ? 0 : isActive ? progress : 0}%` }}
        />
        {/* Thumb */}
        {hasAudio && (
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg -ml-[7px]",
              "transition-opacity duration-150",
              isSeeking ? "opacity-100 scale-110" : "opacity-0 group-hover:opacity-100",
            )}
            style={{ left: `${progress}%` }}
          />
        )}
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-2.5 sm:py-4">
        {/* Info row */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 mb-2 sm:mb-0">
          {/* Status icon */}
          <div className={cn(
            "w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0",
            isLoading ? "bg-white/10" : isActive ? "bg-white/20" : isReady ? "bg-accent/20" : "bg-white/5",
          )}>
            {isLoading ? (
              <Loader2 size={14} className="animate-spin text-white/70" />
            ) : (
              <Play size={14} className={cn(isReady && "text-accent", isActive && "text-white", !isReady && !isActive && "text-white/40")} />
            )}
          </div>

          {/* Now playing */}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] sm:text-[13px] font-medium text-white/90 truncate leading-tight">
              {isLoading ? "Preparing audio..." : isReady ? "Ready to play" : title || "Now Playing"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-white/40 truncate leading-tight mt-0.5">
              {isLoading ? "Generating with neural voice" : isReady ? "Tap play to listen" : hasAudio ? fmtTime(currentTime) : ""}
            </p>
          </div>

          {/* Time display - desktop */}
          {hasAudio && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-white/40">
              <span className="text-white/70">{fmtTime(currentTime)}</span>
              <span>/</span>
              <span>{fmtTime(duration)}</span>
            </div>
          )}

          {/* Error on mobile */}
          {status === "error" && (
            <span className="sm:hidden text-[10px] text-red-400 truncate max-w-[100px]">{error}</span>
          )}

          {/* Retry on mobile */}
          {status === "error" && (
            <button
              onClick={fetchAndPlay}
              className="sm:hidden h-7 px-3 rounded-full text-[10px] font-medium bg-white/10 text-white hover:bg-white/20 transition-all shrink-0"
            >
              Retry
            </button>
          )}
        </div>

        {/* Controls row */}
        {!isLoading && status !== "error" && (
          <div className="flex items-center justify-center sm:justify-between gap-1 sm:gap-2">
            {/* Left: speed (desktop) */}
            <div className="hidden sm:flex items-center gap-1">
              <div className="relative">
                <button
                  onClick={() => setSpeedOpen(!speedOpen)}
                  className="h-8 px-3 rounded-full text-[11px] font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all"
                >
                  {speed}x
                </button>
                {speedOpen && (
                  <div className="absolute top-full left-0 mt-2 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl min-w-[72px] overflow-hidden py-1 z-10">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { if (isActive) skip(0); setSpeed(s); setSpeedOpen(false); }}
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
            </div>

            {/* Center: transport controls */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* -10s */}
              {isActive && (
                <button
                  onClick={() => skip(-SKIP_SECONDS)}
                  className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                  title="Back 10s"
                >
                  <RotateCcw size={13} />
                </button>
              )}

              {/* Play/Pause */}
              <button
                onClick={handlePlay}
                className={cn(
                  "flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full transition-all duration-200 active:scale-90",
                  isActive
                    ? "bg-white text-black hover:bg-white/90"
                    : isReady
                      ? "bg-accent text-white hover:bg-accent/90"
                      : "bg-white/10 text-white hover:bg-white/20",
                )}
              >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
              </button>

              {/* +10s */}
              {isActive && (
                <button
                  onClick={() => skip(SKIP_SECONDS)}
                  className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                  title="Forward 10s"
                >
                  <RotateCw size={13} />
                </button>
              )}

              {/* Stop */}
              {isActive && (
                <button
                  onClick={stop}
                  className="hidden sm:flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
                  title="Stop"
                >
                  <StopCircle size={15} />
                </button>
              )}
            </div>

            {/* Right: close + mobile extras */}
            <div className="flex items-center gap-1">
              {/* Mobile speed */}
              <div className="sm:hidden relative">
                <button
                  onClick={() => setSpeedOpen(!speedOpen)}
                  className="h-7 px-2 rounded-full text-[10px] font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all"
                >
                  {speed}x
                </button>
                {speedOpen && (
                  <div className="absolute top-full right-0 mt-2 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl min-w-[64px] overflow-hidden py-1 z-10">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { if (isActive) skip(0); setSpeed(s); setSpeedOpen(false); }}
                        className={cn(
                          "w-full px-3 py-1.5 text-[11px] font-medium text-left hover:bg-white/10 transition-colors",
                          speed === s ? "text-white" : "text-white/50",
                        )}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                className="flex items-center justify-center w-8 h-8 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Error state desktop */}
        {status === "error" && (
          <div className="hidden sm:flex items-center justify-center gap-3 mt-1">
            <span className="text-[12px] text-red-400">{error}</span>
            <button
              onClick={fetchAndPlay}
              className="h-8 px-4 rounded-full text-[11px] font-medium bg-white/10 text-white hover:bg-white/20 transition-all"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center sm:hidden mt-1">
            <span className="text-[10px] text-white/40">Generating speech...</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceReader;
