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

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** base64 int16 PCM → Float32Array */
function decodePcm(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
  return out;
}

export function VoiceReader({ text, title, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
  // ── state ──
  const [status, setStatus] = useState<VoiceReaderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);

  // ── refs — streaming + Web Audio ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);               // raw 1x sample count
  const playbackStartRef = useRef(-1);              // ctx.currentTime when play started; -1 = not started
  const scheduledEndRef = useRef(0);                // ctx.currentTime when last scheduled chunk ends
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamDoneRef = useRef(false);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);

  // ── refs — UI / lifecycle ──
  const onWordRef = useRef(onWordChange);
  const lastWordRef = useRef(-1);
  const barRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const pendingPlayRef = useRef(false);
  const speedRef = useRef(speed);
  const statusRef = useRef(status);

  useEffect(() => { onWordRef.current = onWordChange; }, [onWordChange]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const totalWords = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  // ── helpers ──
  const updateStatus = useCallback((s: VoiceReaderStatus) => {
    if (!mountedRef.current) return;
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  /** Schedule a PCM chunk for playback on the current AudioContext */
  const scheduleChunk = useCallback((float32: Float32Array) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;

    const buf = ctx.createBuffer(1, float32.length, 24000);
    buf.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speedRef.current;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const when = Math.max(scheduledEndRef.current, now);
    src.start(when);
    scheduledEndRef.current = when + float32.length / (24000 * speedRef.current);
    sourceNodesRef.current.push(src);
  }, []);

  /** Schedule ALL currently buffered chunks */
  const playBuffered = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    playbackStartRef.current = ctx.currentTime;
    scheduledEndRef.current = ctx.currentTime;
    sourceNodesRef.current = [];

    for (const chunk of pcmChunksRef.current) {
      const buf = ctx.createBuffer(1, chunk.length, 24000);
      buf.getChannelData(0).set(chunk);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = speedRef.current;
      src.connect(ctx.destination);
      const when = Math.max(scheduledEndRef.current, ctx.currentTime);
      src.start(when);
      scheduledEndRef.current = when + chunk.length / (24000 * speedRef.current);
      sourceNodesRef.current.push(src);
    }
  }, []);

  /** Accept a PCM chunk from the stream */
  const acceptChunk = useCallback((b64: string) => {
    if (!mountedRef.current) return;
    try {
      const float32 = decodePcm(b64);
      if (float32.length === 0) return;
      pcmChunksRef.current.push(float32);
      totalSamplesRef.current += float32.length;
      setDuration(totalSamplesRef.current / (24000 * speedRef.current));

      // If playback already started, schedule immediately
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed" && playbackStartRef.current !== -1) {
        scheduleChunk(float32);
      }
    } catch { /* skip corrupt chunk */ }
  }, [scheduleChunk]);

  /** Clean shutdown — close AudioContext, abort stream, reset refs */
  const stopAll = useCallback(() => {
    pendingPlayRef.current = false;
    setPendingPlay(false);
    sourceNodesRef.current = [];
    playbackStartRef.current = -1;
    scheduledEndRef.current = 0;
    streamDoneRef.current = false;
    pcmChunksRef.current = [];
    totalSamplesRef.current = 0;

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close();
    }
    audioCtxRef.current = null;

    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  // ── NDJSON stream reader ──
  const startStream = useCallback(() => {
    if (!mountedRef.current) return;
    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    streamDoneRef.current = false;
    pcmChunksRef.current = [];
    totalSamplesRef.current = 0;
    setError(null);
    updateStatus("loading");

    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    const controller = streamAbortRef.current;

    (async () => {
      try {
        const resp = await fetch(`/api/tts/chunked?text=${encodeURIComponent(truncated)}`, {
          signal: controller.signal,
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `Server ${resp.status}`);
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let gotMetadata = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";               // keep incomplete line

          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const data = JSON.parse(t);
              if (data.sampleRate && !gotMetadata) {
                gotMetadata = true;
              } else if (data.pcm) {
                gotMetadata = true;
                acceptChunk(data.pcm);
                // On first PCM chunk → mark ready
                if (statusRef.current === "loading" && mountedRef.current) {
                  updateStatus("ready");
                  if (pendingPlayRef.current) {
                    pendingPlayRef.current = false;
                    setPendingPlay(false);
                    playBuffered();
                    updateStatus("playing");
                  }
                }
              } else if (data.done) {
                streamDoneRef.current = true;
                return;
              }
            } catch { /* skip malformed */ }
          }
        }
        if (totalSamplesRef.current === 0) {
          throw new Error("TTS engine returned no audio data — model may not be ready");
        }
        streamDoneRef.current = true;
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Stream failed");
        updateStatus("error");
      }
    })();
  }, [text, updateStatus, acceptChunk, playBuffered]);

  // Preload stream on mount
  useEffect(() => {
    startStream();
    return () => { stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── progress + completion watcher ──
  useEffect(() => {
    if (status !== "playing") return;

    const interval = setInterval(() => {
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state === "closed" || playbackStartRef.current === -1) return;

      const ct = ctx.currentTime - playbackStartRef.current;
      const tot = totalSamplesRef.current / (24000 * speedRef.current);

      setCurrentTime(ct);
      if (tot > 0) setProgress(Math.min(100, Math.round((ct / tot) * 100)));

      // word tracking — monotonic forward only to prevent oscillation
      const rawWi = tot > 0 ? Math.round((ct / tot) * totalWords) : 0;
      const wi = Math.min(totalWords - 1, rawWi);
      if (wi > lastWordRef.current) {
        lastWordRef.current = wi;
        onWordRef.current?.(wi);
      }

      // completion
      if (streamDoneRef.current && scheduledEndRef.current > 0 && ctx.currentTime >= scheduledEndRef.current) {
        stopAll();
        setProgress(100);
        setCurrentTime(0);
        setDuration(0);
        lastWordRef.current = -1;
        onWordRef.current?.(totalWords - 1);
        updateStatus("idle");
        onComplete?.();
      }
    }, 250);

    return () => clearInterval(interval);
  }, [status, totalWords, updateStatus, onComplete, stopAll]);

  // ── transport controls ──
  const togglePause = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;
    if (ctx.state === "running") {
      ctx.suspend();
      updateStatus("paused");
    } else if (ctx.state === "suspended") {
      ctx.resume();
      updateStatus("playing");
    }
  }, [updateStatus]);

  const stop = useCallback(() => {
    stopAll();
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    lastWordRef.current = -1;
    onWordRef.current?.(-1);
    updateStatus("idle");
  }, [updateStatus, stopAll]);

  const skip = useCallback((delta: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;

    const ct = ctx.currentTime - playbackStartRef.current;
    const tot = totalSamplesRef.current / (24000 * speedRef.current);
    if (tot <= 0) return;

    const newPos = Math.max(0, Math.min(tot, ct + delta));
    const newSample = Math.round(newPos * 24000 * speedRef.current);
    const clamped = Math.min(newSample, totalSamplesRef.current);

    // Close old AudioContext, create fresh
    ctx.close();
    const newCtx = new AudioContext();
    audioCtxRef.current = newCtx;
    playbackStartRef.current = newCtx.currentTime;
    scheduledEndRef.current = newCtx.currentTime;
    sourceNodesRef.current = [];

    // Reschedule from clamped sample onward
    let remaining = clamped;
    for (const chunk of pcmChunksRef.current) {
      if (remaining <= 0) {
        scheduleChunk(chunk);
      } else if (remaining < chunk.length) {
        scheduleChunk(chunk.slice(remaining));
        remaining = -1;
      } else {
        remaining -= chunk.length;
      }
    }

    if (newCtx.state === "suspended") newCtx.resume();

    // Emit correct word immediately after seek
    const newWi = tot > 0 ? Math.min(totalWords - 1, Math.round((newPos / tot) * totalWords)) : 0;
    lastWordRef.current = newWi;
    onWordRef.current?.(newWi);
  }, [scheduleChunk, totalWords]);

  const handlePlay = useCallback(() => {
    switch (statusRef.current) {
      case "idle":
      case "error":
        pendingPlayRef.current = true;
        setPendingPlay(true);
        startStream();
        break;
      case "loading":
        // Create AudioContext inside click gesture so autoplay works
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContext();
          playbackStartRef.current = audioCtxRef.current.currentTime;
          scheduledEndRef.current = audioCtxRef.current.currentTime;
          // Schedule any chunks that already buffered
          for (const chunk of pcmChunksRef.current) {
            const ctx = audioCtxRef.current!;
            const buf = ctx.createBuffer(1, chunk.length, 24000);
            buf.getChannelData(0).set(chunk);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.playbackRate.value = speedRef.current;
            src.connect(ctx.destination);
            const when = Math.max(scheduledEndRef.current, ctx.currentTime);
            src.start(when);
            scheduledEndRef.current = when + chunk.length / (24000 * speedRef.current);
            sourceNodesRef.current.push(src);
          }
        }
        pendingPlayRef.current = false;
        setPendingPlay(false);
        updateStatus("playing");
        break;
      case "ready":
        playBuffered();
        updateStatus("playing");
        break;
      case "playing":
        togglePause();
        break;
      case "paused":
        togglePause();
        break;
    }
  }, [startStream, playBuffered, togglePause, updateStatus]);

  // ── progress bar seeking ──
  const seekFromEvent = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const tot = totalSamplesRef.current / (24000 * speedRef.current);
    if (tot <= 0) return;
    const newPos = ratio * tot;
    const newSample = Math.round(newPos * 24000 * speedRef.current);
    const clamped = Math.min(newSample, totalSamplesRef.current);

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") ctx.close();
    const newCtx = new AudioContext();
    audioCtxRef.current = newCtx;
    playbackStartRef.current = newCtx.currentTime;
    scheduledEndRef.current = newCtx.currentTime;
    sourceNodesRef.current = [];

    let remaining = clamped;
    for (const chunk of pcmChunksRef.current) {
      if (remaining <= 0) {
        (buf => {
          const c = newCtx;
          const b = c.createBuffer(1, buf.length, 24000);
          b.getChannelData(0).set(buf);
          const src = c.createBufferSource();
          src.buffer = b;
          src.playbackRate.value = speedRef.current;
          src.connect(c.destination);
          const when = Math.max(scheduledEndRef.current, c.currentTime);
          src.start(when);
          scheduledEndRef.current = when + buf.length / (24000 * speedRef.current);
          sourceNodesRef.current.push(src);
        })(chunk);
      } else if (remaining < chunk.length) {
        const sliced = chunk.slice(remaining);
        (buf => {
          const c = newCtx;
          const b = c.createBuffer(1, buf.length, 24000);
          b.getChannelData(0).set(buf);
          const src = c.createBufferSource();
          src.buffer = b;
          src.playbackRate.value = speedRef.current;
          src.connect(c.destination);
          const when = Math.max(scheduledEndRef.current, c.currentTime);
          src.start(when);
          scheduledEndRef.current = when + buf.length / (24000 * speedRef.current);
          sourceNodesRef.current.push(src);
        })(sliced);
        remaining = -1;
      } else {
        remaining -= chunk.length;
      }
    }

    setCurrentTime(newPos);
    setProgress(Math.min(100, Math.round(ratio * 100)));
    if (newCtx.state === "suspended") newCtx.resume();

    // Emit correct word immediately after seek
    const newWi = tot > 0 ? Math.min(totalWords - 1, Math.round((newPos / tot) * totalWords)) : 0;
    lastWordRef.current = newWi;
    onWordRef.current?.(newWi);
  }, [totalWords]);

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

  // ── speed ──
  const handleSpeedChange = useCallback((s: number) => {
    for (const src of sourceNodesRef.current) src.playbackRate.value = s;
    setSpeed(s);
    setSpeedOpen(false);
  }, []);

  // ── render ──
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

          <div className="min-w-0 flex-1">
            <p className="text-[12px] sm:text-[13px] font-medium text-white/90 truncate leading-tight">
              {isLoading ? "Preparing audio..." : isReady ? "Ready to play" : title || "Now Playing"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-white/40 truncate leading-tight mt-0.5">
              {isLoading ? (pendingPlay ? "Will play when ready" : "Processing locally") : isReady ? "Tap play to listen" : hasAudio ? fmtTime(currentTime) : ""}
            </p>
          </div>

          {hasAudio && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-white/40">
              <span className="text-white/70">{fmtTime(currentTime)}</span>
              <span>/</span>
              <span>{fmtTime(duration)}</span>
            </div>
          )}

          {status === "error" && (
            <span className="sm:hidden text-[10px] text-red-400 truncate max-w-[100px]">{error}</span>
          )}
          {status === "error" && (
            <button
              onClick={handlePlay}
              className="sm:hidden h-7 px-3 rounded-full text-[10px] font-medium bg-white/10 text-white hover:bg-white/20 transition-all shrink-0"
            >
              Retry
            </button>
          )}
        </div>

        {/* Controls row */}
        {!isLoading && status !== "error" && (
          <div className="flex items-center justify-center sm:justify-between gap-1 sm:gap-2">
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
                        onClick={() => handleSpeedChange(s)}
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

            <div className="flex items-center gap-1 sm:gap-2">
              {isActive && (
                <button
                  onClick={() => skip(-SKIP_SECONDS)}
                  className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                  title="Back 10s"
                >
                  <RotateCcw size={13} />
                </button>
              )}

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

              {isActive && (
                <button
                  onClick={() => skip(SKIP_SECONDS)}
                  className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                  title="Forward 10s"
                >
                  <RotateCw size={13} />
                </button>
              )}

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

            <div className="flex items-center gap-1">

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
                        onClick={() => handleSpeedChange(s)}
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

        {status === "error" && (
          <div className="hidden sm:flex items-center justify-center gap-3 mt-1">
            <span className="text-[12px] text-red-400">{error}</span>
            <button
              onClick={handlePlay}
              className="h-8 px-4 rounded-full text-[11px] font-medium bg-white/10 text-white hover:bg-white/20 transition-all"
            >
              Retry
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center sm:hidden mt-1">
            <span className="text-[10px] text-white/40">Generating audio...</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceReader;
