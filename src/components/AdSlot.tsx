import { adsEnabled } from "../content/monetization";

type Props = {
  /** Reserve space below the article lead / mid-list — never in the hero. */
  slotId?: string;
};

/**
 * Display-ad mount point. Renders nothing until VITE_ENABLE_ADS=true
 * (after AdSense/network approval and real traffic).
 */
export function AdSlot({ slotId = "below-fold" }: Props) {
  if (!adsEnabled()) return null;

  return (
    <aside
      className="my-10 min-h-[90px] border border-dashed border-ink/15 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-ink/30"
      data-ad-slot={slotId}
      aria-label="Advertisement"
    >
      Ad placement ({slotId})
    </aside>
  );
}
