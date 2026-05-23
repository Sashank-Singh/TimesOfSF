import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { KokoroTTS } from "kokoro-js";
import type { ProgressInfo } from "@huggingface/transformers";
import { Play, Pause, StopCircle, Loader2, Volume2, X } from "lucide-react";
import { cn } from "../lib/utils";

export type VoiceReaderStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

interface VoiceReaderProps {
  text: string;
  /** Reports the global word index (0-based) currently being spoken. */
  onWordChange?: (wordIndex: number) => void;
  onStatusChange?: (status: VoiceReaderStatus) => void;
  onComplete?: () => void;
  onClose?: () => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

function splitSentences(text: string): string[] {
  const result = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  return result ?? [text];
}

export function VoiceReader({ text, onWordChange, onStatusChange, onComplete, onClose }: VoiceReaderProps) {
  const [status, setStatus] = useState<VoiceReaderStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [voice, setVoice] = useState("af_bella");
  const [speedOpen, setSpeedOpen] = useState(false);
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const abortRef = useRef(false);
  const isPausedRef = useRef(false);
  const onWordRef = useRef(onWordChange);
  const lastWordRef = useRef(-1);

  // Keep callback ref fresh without causing re-renders
  useEffect(() => { onWordRef.current = onWordChange; }, [onWordChange]);

  const sentences = splitSentences(text);

  const totalWords = useMemo(() => {
    return sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).filter(Boolean).length, 0);
  }, [sentences]);

  const updateStatus = useCallback((s: VoiceReaderStatus) => {
    setStatus(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const loadModel = useCallback(async () => {
    updateStatus("loading");
    setError(null);
    setDownloadProgress(0);
    try {
      const tts = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
          dtype: "q8",
          device: "wasm",
          progress_callback: (p: ProgressInfo) => {
            if ((p.status === "download" || p.status === "progress") && typeof (p as any).progress === "number") {
              setDownloadProgress(Math.round((p as any).progress * 100));
            }
          },
        },
      );
      ttsRef.current = tts;
      const known: Array<{ id: string; name: string }> = [];
      for (const key of Object.keys(tts.voices)) {
        known.push({ id: key, name: key });
      }
      setVoices(known);
      updateStatus("ready");
    } catch (err) {
      console.error("Failed to load Kokoro model:", err);
      setError("Failed to load the voice model. Please try again later.");
      updateStatus("error");
    }
  }, [updateStatus]);

  const startPlayback = useCallback(async () => {
    abortRef.current = false;
    isPausedRef.current = false;
    lastWordRef.current = -1;

    if (!ttsRef.current) {
      await loadModel();
      if (!ttsRef.current) return;
    }

    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();

    updateStatus("playing");

    try {
      let cumulativeWords = 0;

      for (let i = 0; i < sentences.length; i++) {
        while (isPausedRef.current && !abortRef.current) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (abortRef.current) break;

        // Generate audio for this sentence
        const rawAudio = await ttsRef.current.generate(sentences[i], { voice: voice as any, speed });
        const buffer = ctx.createBuffer(1, rawAudio.audio.length, rawAudio.sampling_rate);
        buffer.getChannelData(0).set(rawAudio.audio);

        const sentenceWords = sentences[i].trim().split(/\s+/).filter(Boolean);
        if (sentenceWords.length === 0) continue;

        const wordDuration = buffer.duration / sentenceWords.length;
        const startTime = ctx.currentTime;

        // Start playback
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();

        // Track word position during playback
        const tracker = setInterval(() => {
          if (abortRef.current) { clearInterval(tracker); return; }
          if (ctx.state === "suspended") return;

          const elapsed = ctx.currentTime - startTime;
          const wi = Math.min(Math.floor(elapsed / wordDuration), sentenceWords.length - 1);
          const globalWi = cumulativeWords + wi;

          if (globalWi !== lastWordRef.current) {
            lastWordRef.current = globalWi;
            onWordRef.current?.(globalWi);
          }

          // Throttle progress state updates
          if (wi % 2 === 0 || wi === sentenceWords.length - 1) {
            setProgress(Math.round(((cumulativeWords + wi) / totalWords) * 100));
          }
        }, 40);

        // Wait for audio to finish
        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          // Safety timeout: if audio never ends, force continue
          setTimeout(() => resolve(), (buffer.duration * 1000) + 2000);
        });

        clearInterval(tracker);

        // Ensure final word is reported
        const finalWi = cumulativeWords + sentenceWords.length - 1;
        if (finalWi > lastWordRef.current) {
          lastWordRef.current = finalWi;
          onWordRef.current?.(finalWi);
        }

        cumulativeWords += sentenceWords.length;
        setProgress(Math.round((cumulativeWords / totalWords) * 100));
      }
    } catch (err) {
      console.error("Playback error:", err);
      if (!abortRef.current) {
        setError("An error occurred during playback.");
        updateStatus("error");
        return;
      }
    }

    if (!abortRef.current) {
      updateStatus("idle");
      onComplete?.();
    }
  }, [sentences, totalWords, voice, speed, loadModel, updateStatus, onComplete]);

  const togglePause = useCallback(() => {
    if (status === "playing") {
      isPausedRef.current = true;
      if (audioCtxRef.current?.state === "running") {
        audioCtxRef.current.suspend();
      }
      updateStatus("paused");
    } else if (status === "paused") {
      isPausedRef.current = false;
      audioCtxRef.current?.resume();
      updateStatus("playing");
    }
  }, [status, updateStatus]);

  const stop = useCallback(() => {
    abortRef.current = true;
    isPausedRef.current = false;
    updateStatus("idle");
    setProgress(0);
    lastWordRef.current = -1;
    onWordRef.current?.(-1);
  }, [updateStatus]);

  const handlePlay = useCallback(() => {
    if (status === "idle" || status === "ready" || status === "error") {
      startPlayback();
    } else if (status === "playing" || status === "paused") {
      togglePause();
    }
  }, [status, startPlayback, togglePause]);

  useEffect(() => {
    return () => {
      abortRef.current = true;
      audioCtxRef.current?.close();
    };
  }, []);

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

      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4">
        <div className="shrink-0">
          {isLoading ? (
            <Loader2 size={18} className="animate-spin text-ink/40" />
          ) : (
            <Volume2 size={18} className={cn(isPlaying ? "text-accent" : "text-ink/40")} />
          )}
        </div>

        {isLoading && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink/50">
              <span>Downloading voice model...</span>
              <span className="font-bold">{downloadProgress}%</span>
            </div>
            <div className="mt-1 h-1 bg-ink/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {status === "error" && !isLoading && (
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-red-600">{error}</p>
          </div>
        )}

        {!isLoading && status !== "error" && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink/50">
              <span className={cn(isPlaying && "text-accent font-bold")}>
                {isPlaying && "Speaking"}
                {isPaused && "Paused"}
                {status === "idle" && "Ready"}
                {status === "ready" && "Ready"}
              </span>
              {status !== "idle" && status !== "ready" && (
                <>
                  <span className="text-ink/20">·</span>
                  <span>{progress}%</span>
                </>
              )}
            </div>
          </div>
        )}

        {!isLoading && status !== "error" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handlePlay}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest transition-all rounded-sm",
                isPlaying
                  ? "bg-accent text-paper hover:bg-accent/90"
                  : "bg-ink/5 text-ink hover:bg-ink/10",
              )}
            >
              {isPlaying ? (
                <><Pause size={12} /> Pause</>
              ) : isPaused ? (
                <><Play size={12} /> Resume</>
              ) : (
                <><Play size={12} /> Listen</>
              )}
            </button>

            {(isPlaying || isPaused) && (
              <button
                onClick={stop}
                className="p-1.5 hover:bg-ink/5 rounded-sm transition-colors text-ink/40 hover:text-ink"
                title="Stop"
              >
                <StopCircle size={16} />
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => { setSpeedOpen(!speedOpen); setVoiceOpen(false); }}
                className="px-2 py-1.5 text-[10px] font-mono text-ink/50 hover:text-ink hover:bg-ink/5 rounded-sm transition-colors"
              >
                {speed}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-paper border border-ink/10 rounded-sm shadow-lg min-w-[72px] overflow-hidden">
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setSpeed(s); setSpeedOpen(false); }}
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
                title={voice}
              >
                {voice}
              </button>
              {voiceOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-paper border border-ink/10 rounded-sm shadow-lg max-h-48 overflow-y-auto min-w-[120px]">
                  {voices.length === 0 && (
                    <div className="px-3 py-2 text-[9px] font-mono text-ink/40">
                      Load model first
                    </div>
                  )}
                  {voices.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { setVoice(v.id); setVoiceOpen(false); }}
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

        {status === "error" && !isLoading && (
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
