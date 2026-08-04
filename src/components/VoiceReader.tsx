import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, StopCircle, Loader2, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "../lib/utils";
import { getApiBase } from "../services/newsService";
import { trackEvent } from "../services/posthog";

export type VoiceReaderStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

interface VoiceReaderProps {
  text: string;
  title?: string;
  /** Start playback as soon as the first PCM chunk arrives (within ~5s on warm TTS). */
  autoPlay?: boolean;
  onWordChange?: (wordIndex: number) => void;
  onStatusChange?: (status: VoiceReaderStatus) => void;
  onComplete?: () => void;
  onClose?: () => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
const SKIP_SECONDS = 10;
const DEFAULT_SAMPLE_RATE = 24000;

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** base64 int16 PCM → Float32Array (aligned buffer copy). */
function decodePcm(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const i16 = new Int16Array(copy);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
  return out;
}

export function VoiceReader({ text, title, autoPlay = false, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
  const [status, setStatus] = useState<VoiceReaderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(DEFAULT_SAMPLE_RATE);
  const totalSamplesRef = useRef(0);
  const playbackStartRef = useRef(-1);
  const scheduledEndRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamDoneRef = useRef(false);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);

  const onWordRef = useRef(onWordChange);
  const lastWordRef = useRef(-1);
  const barRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const pendingPlayRef = useRef(false);
  const audioStartedTrackedRef = useRef(false);
  const speedRef = useRef(speed);
  const statusRef = useRef(status);

  useEffect(() => { onWordRef.current = onWordChange; }, [onWordChange]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const totalWords = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  const updateStatus = useCallback((s: VoiceReaderStatus) => {
    if (!mountedRef.current) return;
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const ensureAudioCtx = useCallback(async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      try {
        audioCtxRef.current = new AudioContext({ sampleRate: sampleRateRef.current });
      } catch {
        audioCtxRef.current = new AudioContext();
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
  }, []);

  const scheduleChunk = useCallback((float32: Float32Array) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;
    const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;

    const buf = ctx.createBuffer(1, float32.length, rate);
    buf.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speedRef.current;
    src.connect(ctx.destination);

    const when = Math.max(scheduledEndRef.current, ctx.currentTime);
    src.start(when);
    scheduledEndRef.current = when + float32.length / (rate * speedRef.current);
    sourceNodesRef.current.push(src);
  }, []);

  const playBuffered = useCallback(async () => {
    const ctx = await ensureAudioCtx();
    const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;
    // Stop any previously scheduled sources by closing/recreating context for a clean timeline
    if (sourceNodesRef.current.length > 0 && playbackStartRef.current !== -1) {
      try { await ctx.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
      const fresh = await ensureAudioCtx();
      playbackStartRef.current = fresh.currentTime;
      scheduledEndRef.current = fresh.currentTime;
      sourceNodesRef.current = [];
      for (const chunk of pcmChunksRef.current) {
        const buf = fresh.createBuffer(1, chunk.length, rate);
        buf.getChannelData(0).set(chunk);
        const src = fresh.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = speedRef.current;
        src.connect(fresh.destination);
        const when = Math.max(scheduledEndRef.current, fresh.currentTime);
        src.start(when);
        scheduledEndRef.current = when + chunk.length / (rate * speedRef.current);
        sourceNodesRef.current.push(src);
      }
      return;
    }

    playbackStartRef.current = ctx.currentTime;
    scheduledEndRef.current = ctx.currentTime;
    sourceNodesRef.current = [];
    for (const chunk of pcmChunksRef.current) {
      scheduleChunk(chunk);
    }
  }, [ensureAudioCtx, scheduleChunk]);

  const acceptChunk = useCallback((b64: string) => {
    if (!mountedRef.current) return;
    try {
      const float32 = decodePcm(b64);
      if (float32.length === 0) return;
      pcmChunksRef.current.push(float32);
      totalSamplesRef.current += float32.length;
      const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;
      setDuration(totalSamplesRef.current / (rate * speedRef.current));

      if (audioCtxRef.current && audioCtxRef.current.state !== "closed" && playbackStartRef.current !== -1) {
        scheduleChunk(float32);
      }
    } catch {
      /* skip corrupt chunk */
    }
  }, [scheduleChunk]);

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
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;

    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  const startStream = useCallback(() => {
    if (!mountedRef.current) return;
    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    streamDoneRef.current = false;
    audioStartedTrackedRef.current = false;
    pcmChunksRef.current = [];
    totalSamplesRef.current = 0;
    sampleRateRef.current = DEFAULT_SAMPLE_RATE;
    setError(null);
    updateStatus("loading");

    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    const controller = streamAbortRef.current;
    const url = `${getApiBase()}/api/tts/chunked`;

    (async () => {
      try {
        // POST avoids URL-length truncation that breaks long articles on GET.
        let resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify({ text: truncated }),
          signal: controller.signal,
        });
        // Older deploys only expose GET — fall back so Listen still works mid-rollout.
        if (resp.status === 404 || resp.status === 405) {
          const qs = new URLSearchParams({ text: truncated });
          resp = await fetch(`${url}?${qs}`, {
            headers: { Accept: "application/x-ndjson" },
            signal: controller.signal,
          });
        }
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({} as { error?: string }));
          throw new Error(errData.error || `Server ${resp.status}`);
        }
        if (!resp.body) throw new Error("TTS stream had no body");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const data = JSON.parse(t) as { sampleRate?: number; pcm?: string; done?: boolean; error?: string };
              if (data.error) throw new Error(data.error);
              if (typeof data.sampleRate === "number" && data.sampleRate > 0) {
                sampleRateRef.current = data.sampleRate;
              }
              if (data.pcm) {
                acceptChunk(data.pcm);
                if (mountedRef.current && (statusRef.current === "loading" || statusRef.current === "ready")) {
                  if (statusRef.current === "loading") updateStatus("ready");
                  if (pendingPlayRef.current) {
                    pendingPlayRef.current = false;
                    setPendingPlay(false);
                    await playBuffered();
                    updateStatus("playing");
                    if (!audioStartedTrackedRef.current) {
                      trackEvent("article_audio_started", { title_present: Boolean(title) });
                      audioStartedTrackedRef.current = true;
                    }
                  }
                }
              } else if (data.done) {
                streamDoneRef.current = true;
                if (totalSamplesRef.current === 0) {
                  throw new Error("TTS engine returned no audio — model may not be ready on the server");
                }
                return;
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message.startsWith("TTS")) throw parseErr;
              if (parseErr instanceof Error && parseErr.message.includes("model may not")) throw parseErr;
              /* skip malformed NDJSON line */
            }
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (autoPlay) {
        pendingPlayRef.current = true;
        setPendingPlay(true);
        try {
          await ensureAudioCtx();
        } catch {
          /* gesture may still unlock on Play tap */
        }
      }
      if (!cancelled) startStream();
    })();
    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "playing") return;

    const interval = setInterval(() => {
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state === "closed" || playbackStartRef.current === -1) return;

      const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;
      const ct = Math.max(0, ctx.currentTime - playbackStartRef.current);
      const tot = totalSamplesRef.current / (rate * speedRef.current);

      setCurrentTime(ct);
      if (tot > 0) setProgress(Math.min(100, Math.round((ct / tot) * 100)));

      const rawWi = tot > 0 ? Math.round((ct / tot) * totalWords) : 0;
      const wi = Math.min(Math.max(totalWords - 1, 0), rawWi);
      if (wi > lastWordRef.current) {
        lastWordRef.current = wi;
        onWordRef.current?.(wi);
      }

      if (streamDoneRef.current && scheduledEndRef.current > 0 && ctx.currentTime >= scheduledEndRef.current - 0.05) {
        stopAll();
        setProgress(100);
        setCurrentTime(0);
        setDuration(0);
        lastWordRef.current = -1;
        onWordRef.current?.(totalWords - 1);
        updateStatus("idle");
        trackEvent("article_audio_completed", { title_present: Boolean(title) });
        onComplete?.();
      }
    }, 250);

    return () => clearInterval(interval);
  }, [status, totalWords, updateStatus, onComplete, stopAll]);

  const togglePause = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;
    if (ctx.state === "running") {
      await ctx.suspend();
      updateStatus("paused");
    } else if (ctx.state === "suspended") {
      await ctx.resume();
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

  const skip = useCallback(async (delta: number) => {
    const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed" || playbackStartRef.current === -1) return;

    const ct = ctx.currentTime - playbackStartRef.current;
    const tot = totalSamplesRef.current / (rate * speedRef.current);
    if (tot <= 0) return;

    const newPos = Math.max(0, Math.min(tot, ct + delta));
    const newSample = Math.round(newPos * rate * speedRef.current);
    const clamped = Math.min(newSample, totalSamplesRef.current);

    try { await ctx.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    const newCtx = await ensureAudioCtx();
    playbackStartRef.current = newCtx.currentTime;
    scheduledEndRef.current = newCtx.currentTime;
    sourceNodesRef.current = [];

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

    const newWi = tot > 0 ? Math.min(totalWords - 1, Math.round((newPos / tot) * totalWords)) : 0;
    lastWordRef.current = newWi;
    onWordRef.current?.(newWi);
  }, [ensureAudioCtx, scheduleChunk, totalWords]);

  const handlePlay = useCallback(async () => {
    switch (statusRef.current) {
      case "idle":
      case "error":
        pendingPlayRef.current = true;
        setPendingPlay(true);
        // Unlock audio on the click gesture before the stream returns.
        await ensureAudioCtx();
        startStream();
        break;
      case "loading":
        pendingPlayRef.current = true;
        setPendingPlay(true);
        await ensureAudioCtx();
        if (pcmChunksRef.current.length > 0) {
          pendingPlayRef.current = false;
          setPendingPlay(false);
          await playBuffered();
          updateStatus("playing");
          if (!audioStartedTrackedRef.current) {
            trackEvent("article_audio_started", { title_present: Boolean(title) });
            audioStartedTrackedRef.current = true;
          }
        }
        break;
      case "ready":
        await ensureAudioCtx();
        await playBuffered();
        updateStatus("playing");
        if (!audioStartedTrackedRef.current) {
          trackEvent("article_audio_started", { title_present: Boolean(title) });
          audioStartedTrackedRef.current = true;
        }
        break;
      case "playing":
      case "paused":
        await togglePause();
        break;
    }
  }, [startStream, playBuffered, togglePause, updateStatus, ensureAudioCtx]);

  const seekFromEvent = useCallback(async (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const tot = totalSamplesRef.current / (rate * speedRef.current);
    if (tot <= 0) return;
    const newPos = ratio * tot;
    const newSample = Math.round(newPos * rate * speedRef.current);
    const clamped = Math.min(newSample, totalSamplesRef.current);

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") {
      try { await ctx.close(); } catch { /* ignore */ }
    }
    audioCtxRef.current = null;
    const newCtx = await ensureAudioCtx();
    playbackStartRef.current = newCtx.currentTime;
    scheduledEndRef.current = newCtx.currentTime;
    sourceNodesRef.current = [];

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

    setCurrentTime(newPos);
    setProgress(Math.round(ratio * 100));
    const newWi = tot > 0 ? Math.min(totalWords - 1, Math.round((newPos / tot) * totalWords)) : 0;
    lastWordRef.current = newWi;
    onWordRef.current?.(newWi);
    if (statusRef.current === "paused" || statusRef.current === "ready") {
      updateStatus("playing");
    }
  }, [ensureAudioCtx, scheduleChunk, totalWords, updateStatus]);

  const handleSpeedChange = useCallback(async (s: number) => {
    const prev = speedRef.current;
    const rate = sampleRateRef.current || DEFAULT_SAMPLE_RATE;
    const ctx = audioCtxRef.current;
    let sampleAt = 0;
    if (ctx && ctx.state !== "closed" && playbackStartRef.current !== -1) {
      const ct = Math.max(0, ctx.currentTime - playbackStartRef.current);
      const oldTot = totalSamplesRef.current / (rate * prev);
      sampleAt = Math.round((ct / Math.max(oldTot, 0.001)) * totalSamplesRef.current);
    }
    setSpeed(s);
    speedRef.current = s;
    setSpeedOpen(false);
    setDuration(totalSamplesRef.current / (rate * s));

    if ((statusRef.current === "playing" || statusRef.current === "paused") && pcmChunksRef.current.length > 0) {
      if (ctx && ctx.state !== "closed") {
        try { await ctx.close(); } catch { /* ignore */ }
      }
      audioCtxRef.current = null;
      const newCtx = await ensureAudioCtx();
      playbackStartRef.current = newCtx.currentTime;
      scheduledEndRef.current = newCtx.currentTime;
      sourceNodesRef.current = [];
      let remaining = Math.min(sampleAt, totalSamplesRef.current);
      for (const chunk of pcmChunksRef.current) {
        if (remaining <= 0) scheduleChunk(chunk);
        else if (remaining < chunk.length) {
          scheduleChunk(chunk.slice(remaining));
          remaining = -1;
        } else remaining -= chunk.length;
      }
      if (statusRef.current === "paused") await newCtx.suspend();
    }
  }, [ensureAudioCtx, scheduleChunk]);

  const onBarMouseDown = useCallback((e: React.MouseEvent) => {
    setIsSeeking(true);
    void seekFromEvent(e.clientX);
  }, [seekFromEvent]);

  useEffect(() => {
    if (!isSeeking) return;
    const onMove = (e: MouseEvent) => { void seekFromEvent(e.clientX); };
    const onUp = () => setIsSeeking(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isSeeking, seekFromEvent]);

  const onBarTouchStart = useCallback((e: React.TouchEvent) => {
    setIsSeeking(true);
    void seekFromEvent(e.touches[0].clientX);
  }, [seekFromEvent]);

  useEffect(() => {
    if (!isSeeking) return;
    const onMove = (e: TouchEvent) => { void seekFromEvent(e.touches[0].clientX); };
    const onEnd = () => setIsSeeking(false);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
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
              {isLoading ? (pendingPlay ? "Starting stream…" : "Buffering audio…") : isReady ? "Ready to play" : title || "Now Playing"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-white/40 truncate leading-tight mt-0.5">
              {isLoading ? (pendingPlay ? "First audio should start within a few seconds" : "Warming TTS engine") : isReady ? "Tap play to listen" : hasAudio ? fmtTime(currentTime) : ""}
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
