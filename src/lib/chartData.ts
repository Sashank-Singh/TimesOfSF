import type { DataBlock } from '../types';

const meaningful = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/^(value|amount|metric|category|reported amount|data|unknown|n\/a)$/i.test(value.trim());
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Fail closed for legacy charts: never invent units, coordinates, values or sources. */
export function isSourceLinkedChart(block: unknown): block is DataBlock {
  if (!block || typeof block !== 'object') return false;
  const b = block as DataBlock;
  if (!['bar', 'line', 'scatter', 'histogram', 'chart'].includes(b.type)) return false;
  if (![b.title, b.metric, b.unit, b.sourceName, b.xAxisLabel, b.yAxisLabel].every(meaningful)) return false;
  try { if (!['https:', 'http:'].includes(new URL(b.sourceUrl!).protocol)) return false; } catch { return false; }
  if (!Array.isArray(b.data) || b.data.length < 2) return false;
  return b.data.every(p => p && meaningful(p.sourceQuote) && meaningful(p.label) && p.unit === b.unit && p.metric === b.metric && (
    b.type === 'line' || b.type === 'scatter' ? finite(p.x) && finite(p.y) : finite(p.value)
  ));
}


/** Check exact source excerpts, rather than treating the generated article as evidence. */
export function chartMatchesSource(block: unknown, sources: { articleUrl: string; textExcerpt: string }[]): boolean {
  if (!isSourceLinkedChart(block)) return false;
  const source = sources.find(s => s.articleUrl === block.sourceUrl);
  if (!source) return false;
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const excerpt = normalize(source.textExcerpt);
  return block.data.every(point => {
    const quote = normalize(point.sourceQuote!);
    if (quote.length < 12 || !excerpt.includes(quote)) return false;
    const numbers = (quote.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => Number(n.replace(/,/g, '')));
    const required = block.type === 'line' || block.type === 'scatter' ? [point.x!, point.y!] : [point.value!];
    return required.every(value => numbers.includes(value));
  });
}
