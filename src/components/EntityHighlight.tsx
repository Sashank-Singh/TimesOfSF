import { useState, useRef, useLayoutEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";

interface EntityHighlightProps {
  name: string;
  definition: string;
}

/** Strip noise (e.g. "?" filler, empty strings) so we don't show meaningless tooltips. */
function normalizeDefinition(raw: string | undefined | null): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.trim();
  if (!cleaned) return "";
  if (/^[?!.\-—–]+$/.test(cleaned)) return "";
  return cleaned;
}

const GUTTER = 16;

export function EntityHighlight({ name, definition }: EntityHighlightProps) {
  const cleanDefinition = normalizeDefinition(definition);
  const [showTooltip, setShowTooltip] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 320, arrowLeft: 0, above: true });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const tooltipWidth = Math.min(360, viewportWidth - GUTTER * 2);

    // Horizontal — center on anchor, clamped to viewport
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    if (left < GUTTER) left = GUTTER;
    else if (left + tooltipWidth > viewportWidth - GUTTER) left = viewportWidth - GUTTER - tooltipWidth;
    const arrowLeft = rect.left + rect.width / 2 - left;

    // Vertical — prefer above, fall back to below
    const tooltipHeight = tooltipRef.current?.offsetHeight ?? 180;
    const above = rect.top - GUTTER >= tooltipHeight || rect.top >= window.innerHeight - rect.bottom;

    setCoords({
      top: above ? rect.top - GUTTER : rect.bottom + GUTTER,
      left,
      width: tooltipWidth,
      arrowLeft,
      above,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showTooltip) return;
    // Wait one frame so the tooltip DOM node is present for measurement
    const raf = requestAnimationFrame(() => updatePosition());
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    window.addEventListener("resize", updatePosition, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updatePosition, { capture: true });
      window.removeEventListener("resize", updatePosition);
    };
  }, [showTooltip, updatePosition]);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowTooltip(true);
  }, []);

  const hide = useCallback(() => {
    timeoutRef.current = setTimeout(() => setShowTooltip(false), 120);
  }, []);

  // No real definition — render as plain text with no interaction
  if (!cleanDefinition) return <>{name}</>;

  return (
    <span className="relative inline">
      <span
        ref={anchorRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip((v) => !v);
        }}
        className="cursor-help inline-flex leading-none items-baseline border-b border-accent/60 bg-accent/[0.06] px-1.5 py-0.5 rounded-sm font-semibold text-accent/90 transition-all hover:bg-accent/[0.12] hover:border-accent/90 select-none"
      >
        {name}
      </span>

      {createPortal(
        <AnimatePresence>
          {showTooltip && (
            <motion.div
              ref={tooltipRef}
              role="tooltip"
              initial={{ opacity: 0, y: coords.above ? -6 : 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: coords.above ? -6 : 6, scale: 0.97 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              onMouseEnter={show}
              onMouseLeave={hide}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: coords.above ? `${coords.top}px` : "auto",
                bottom: coords.above ? "auto" : `${window.innerHeight - coords.top}px`,
                left: `${coords.left}px`,
                width: `${coords.width}px`,
              }}
              className="z-50 bg-paper border border-ink/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-4 pointer-events-auto max-h-[45vh] overflow-auto"
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest font-black text-accent">
                  <span>{name}</span>
                  <span className="opacity-40">→</span>
                  <span className="opacity-40">What it means</span>
                </div>
                <p className="text-[14px] leading-relaxed text-ink/85 font-sans not-italic">
                  {cleanDefinition}
                </p>
              </div>

              <div
                style={{ left: `${coords.arrowLeft}px` }}
                className={`absolute ${coords.above ? "top-full" : "bottom-full"} -translate-x-1/2 w-0 h-0
                  ${coords.above
                    ? "border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-ink/10"
                    : "border-l-[8px] border-r-[8px] border-b-[8px] border-l-transparent border-r-transparent border-b-ink/10"
                  }`}
              />
              <div
                style={{ left: `${coords.arrowLeft}px` }}
                className={`absolute ${coords.above ? "top-full" : "bottom-full"} -translate-x-1/2 w-0 h-0
                  ${coords.above
                    ? "border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-paper mt-[-1px]"
                    : "border-l-[7px] border-r-[7px] border-b-[7px] border-l-transparent border-r-transparent border-b-paper mb-[-1px]"
                  }`}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
