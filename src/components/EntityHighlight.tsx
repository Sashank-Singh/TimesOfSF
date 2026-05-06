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
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useLayoutEffect(() => {
    if (showTooltip && anchorRef.current) {
      const updatePosition = () => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const gutter = 20;
        const tooltipWidth = Math.min(300, viewportWidth - (gutter * 2));
        
        let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        if (left < gutter) {
          left = gutter;
        } else if (left + tooltipWidth > viewportWidth - gutter) {
          left = viewportWidth - gutter - tooltipWidth;
        }

        const arrowLeft = (rect.left + rect.width / 2) - left;

        setCoords({
          top: rect.top - 10, 
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
    }, 150); // Grace period to prevent flicker
  };

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
        className="cursor-help border-b border-accent/30 bg-accent/[0.03] px-1 rounded-sm font-semibold transition-all hover:bg-accent/[0.08] hover:border-accent/60 select-none"
      >
        {name}
      </span>
      
      {showTooltip && createPortal(
        <div 
          className="fixed inset-0 z-[9999] pointer-events-none"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 5, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{ 
                position: 'fixed',
                top: `${coords.top}px`,
                left: `${coords.left}px`,
                width: `${coords.width}px`,
                transform: 'translateY(-100%)'
              }}
              className="bg-paper border border-ink/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-4 pointer-events-auto"
            >
              <div className="flex flex-col gap-2">
                <h5 className="text-[10px] font-mono uppercase tracking-[0.2em] font-black text-accent/60">
                  Context
                </h5>
                <p className="text-[13px] leading-relaxed text-ink/80 font-serif italic">
                  {definition}
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
          </AnimatePresence>
        </div>,
        document.body
      )}
    </span>
  );
}
