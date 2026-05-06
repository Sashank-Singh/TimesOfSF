import { useState, useRef, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

interface EntityHighlightProps {
  name: string;
  definition: string;
}

export function EntityHighlight({ name, definition }: EntityHighlightProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [offset, setOffset] = useState(0);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (showTooltip && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const gutter = 16;
      const tooltipWidth = Math.min(260, window.innerWidth - (gutter * 2));
      
      const preferredX = rect.left + rect.width / 2;
      const halfWidth = tooltipWidth / 2;
      
      let actualX = preferredX;
      if (preferredX - halfWidth < gutter) {
        actualX = gutter + halfWidth;
      } else if (preferredX + halfWidth > window.innerWidth - gutter) {
        actualX = window.innerWidth - gutter - halfWidth;
      }

      setOffset(actualX - preferredX);
    }
  }, [showTooltip]);

  return (
    <span className="relative inline" ref={anchorRef}>
      <span
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => setShowTooltip(!showTooltip)}
        className="cursor-help border-b border-accent/30 bg-accent/[0.03] px-1 rounded-sm font-semibold transition-all hover:bg-accent/[0.08] hover:border-accent/60"
      >
        {name}
      </span>
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ 
              left: `calc(50% + ${offset}px)`,
              transform: 'translateX(-50%)',
              width: Math.min(260, window.innerWidth - 32)
            }}
            className="absolute bottom-full mb-3 z-[60] p-4 bg-paper border border-ink/10 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] pointer-events-none"
          >
            <div className="flex flex-col gap-2">
              <h5 className="text-[10px] font-mono uppercase tracking-[0.2em] font-black text-accent/60">
                Context
              </h5>
              <p className="text-[13px] leading-relaxed text-ink/80 font-serif italic">
                {definition}
              </p>
            </div>
            
            {/* The Arrow - Centered on Anchor */}
            <div 
              style={{ left: `calc(50% - ${offset}px)` }}
              className="absolute top-full -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-ink/10" 
            />
            <div 
              style={{ left: `calc(50% - ${offset}px)` }}
              className="absolute top-full -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-paper mt-[-1px]" 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
