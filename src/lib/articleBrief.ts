import { stripMarkdown } from './utils';

/** A short read drawn from complete reporting paragraphs, preserving caveats and links. */
export function buildArticleBrief(content: string, summary: string): string {
  const normalize = (text: string) => stripMarkdown(text).replace(/\s+/g, ' ').trim().toLowerCase();
  const sections: { heading: string; paragraphs: string[] }[] = [];
  let current = { heading: '', paragraphs: [] as string[] };
  sections.push(current);
  for (const block of content.split(/\n\s*\n/)) {
    const heading = block.match(/^#{1,6}\s+([^\n]+)(?:\n|$)/);
    if (heading) {
      current = { heading: heading[1], paragraphs: [] };
      sections.push(current);
    }
    const prose = (heading ? block.slice(heading[0].length) : block)
      .replace(/\[CHART:\d+\]/g, '').trim();
    if (!prose || /^(?:!\[|[-*+]\s|\d+\.\s|\||```|>|---)/.test(prose)) continue;
    if (/^(?:the\s+)?(?:source notes?|sources?|citations?|references?|related links?)\b/i.test(current.heading)) continue;
    if (/^(?:source|credit|citation)s?:/i.test(prose)) continue;
    if (normalize(summary).includes(normalize(prose))) continue;
    current.paragraphs.push(prose);
  }
  const usable = sections.filter(section => section.paragraphs.length);
  const opening = usable[0];
  if (!opening) return '';
  const context = usable.find(section => /context|background/i.test(section.heading));
  const outlook = usable.find(section => /horizon|what.*(?:next|watch)|outlook|implications/i.test(section.heading));
  const preferred = [opening.paragraphs[0], context?.paragraphs[0], outlook?.paragraphs[0]];
  const selected = [...new Set([...preferred, ...usable.flatMap(section => section.paragraphs)].filter((p): p is string => !!p))].slice(0, 3);
  return selected.join('\n\n');
}
