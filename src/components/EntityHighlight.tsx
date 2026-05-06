import { useState, useRef, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";

interface EntityHighlightProps {
  name: string;
  definition: string;
}

export function EntityHighlight({ name, definition }: EntityHighlightProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 280, arrowLeft: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (showTooltip && anchorRef.current) {
      const updatePosition = () => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const gutter = 20;
        const tooltipWidth = Math.min(300, viewportWidth - (gutter * 2));
        
        // Horizontal centering
        let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        
        // Clamp to edges
        if (left < gutter) {
          left = gutter;
        } else if (left + tooltipWidth > viewportWidth - gutter) {
          left = viewportWidth - gutter - tooltipWidth;
        }

        // Calculate arrow position relative to tooltip box
        // The arrow should point to rect.left + rect.width/2
        const arrowLeft = (rect.left + rect.width / 2) - left;

        setCoords({
          top: rect.top - 12, // Appear above the word
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

  return (
    <span className="relative inline-block">
      <span
        ref={anchorRef}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip(!showTooltip);
        }}
        className="cursor-help border-b border-accent/30 bg-accent/[0.03] px-1 rounded-sm font-semibold transition-all hover:bg-accent/[0.08] hover:border-accent/60"
      >
        {name}
      </span>
      
      {showTooltip && createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-none">
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 5, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              style={{ 
                position: 'fixed',
                top: `${coords.top}px`,
                left: `${coords.left}px`,
                width: `${coords.width}px`,
                transform: 'translateY(-100%)'
              }}
              className="bg-paper border border-ink/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] p-4 pointer-events-auto"
            >
              <div className="flex flex-col gap-2">
                <h5 className="text-[10px] font-mono uppercase tracking-[0.2em] font-black text-accent/60">
                  Context
                </h5>
                <p className="text-[13px] leading-relaxed text-ink/80 font-serif italic">
                  {definition}
                </p>
              </div>
              
              {/* The Arrow */}
              <div 
                style={{ left: `${coords.arrowLeft}px` }}
                className="absolute top-full -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-ink/10" 
              />
              <div 
                style={{ left: `${coords.arrowLeft}px` }}
                className="absolute top-full -translate-x-1/2 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-paper mt-[-1px]" 
              />
            </motion.div>
          </AnimatePresence>
        </div>,
        document.body
      )}
    </span>
  );
}
