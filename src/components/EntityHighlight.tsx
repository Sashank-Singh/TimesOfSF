import { useState, useRef, useLayoutEffect } from "react";
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

export function EntityHighlight({ name, definition }: EntityHighlightProps) {
  const cleanDefinition = normalizeDefinition(definition);
  const [showTooltip, setShowTooltip] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 320, arrowLeft: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useLayoutEffect(() => {
    if (showTooltip && anchorRef.current) {
      const updatePosition = () => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const gutter = 20;
        const tooltipWidth = Math.min(360, viewportWidth - gutter * 2);
        
        let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        if (left < gutter) {
          left = gutter;
        } else if (left + tooltipWidth > viewportWidth - gutter) {
          left = viewportWidth - gutter - tooltipWidth;
        }

        const arrowLeft = (rect.left + rect.width / 2) - left;

        setCoords({
          top: Math.max(20, rect.top - 10),
          left: left,
          width: tooltipWidth,
          arrowLeft: arrowLeft
        });
      };

      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [showTooltip]);

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowTooltip(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 120); // Grace period to prevent flicker
  };

  // If no real definition, render the word plainly (no fake "?" tooltip).
  if (!cleanDefinition) {
    return <>{name}</>;
  }

  return (
    <span className="relative inline">
      <span
        ref={anchorRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip(!showTooltip);
        }}
        className="cursor-help inline-flex leading-none items-baseline border-b border-accent/60 bg-accent/[0.06] px-1.5 py-0.5 rounded-sm font-semibold text-accent/90 transition-all hover:bg-accent/[0.12] hover:border-accent/90 select-none"
      >
        {name}
      </span>
      
      {showTooltip && createPortal(
        <AnimatePresence>
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              transform: "translateY(-100%)",
            }}
            className="bg-paper border border-ink/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-4 pointer-events-auto max-h-[45vh] overflow-auto"
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
                className="absolute top-full -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-ink/10" 
              />
              <div 
                style={{ left: `${coords.arrowLeft}px` }}
                className="absolute top-full -translate-x-1/2 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-paper mt-[-1px]" 
              />
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </span>
  );
}
