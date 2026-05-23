import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/** Full dispatch publish time for Times of SF articles (local timezone). */
/** Strip markdown syntax to get plain text for TTS. */
export function stripMarkdown(md: string): string {
  return md
    // Remove [[Entity]] markers, keep the entity name
    .replace(/\[\[(.*?)\]\]/g, "$1")
    // Remove [CHART:n] markers
    .replace(/\[CHART:\d+\]/g, "")
    // Remove links but keep text [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Remove image syntax ![alt](url) → alt text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Remove bold/italic markers (*, **, _)
    .replace(/[*_]{1,3}([^*_]*)[*_]{1,3}/g, "$1")
    // Remove inline code
    .replace(/`([^`]*)`/g, "$1")
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove horizontal rules
    .replace(/^---+\s*$/gm, "")
    // Remove blockquote markers
    .replace(/^>\s+/gm, "")
    // Remove HTML tags
    .replace(/<[^>]*>/g, "")
    // Remove empty bracket pairs sometimes left by chart removal
    .replace(/\[\]/g, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatPublishedTimestamp(dateString: string) {
  const d = new Date(dateString);
  if (!Number.isFinite(d.getTime())) return dateString;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
