import { config } from "./config";
import {
  DigestCandidatePost,
  DigestSubscriber,
  fetchActiveSubscribersForDigest,
  fetchAlreadyDelivered,
  fetchDigestCandidatePosts,
  hasDigestRun,
  markNewsletterDelivered,
  recordDigestRun,
} from "./db";
import { rankDigestStories } from "./agents";
import { isMailConfigured, sendMail } from "./mailer";

export type DigestSlot = "morning" | "night";

let newsletterRunInFlight = false;

/** Typical send size per digest (7-10 stories); ranking goes deeper than this so night can still
 * find fresh material after morning's picks are excluded per-subscriber. */
const DIGEST_SEND_MAX = 10;
const DIGEST_RANK_DEPTH = 30;
/** Rolling candidate window — wide enough that a quiet news day still has plenty to choose from;
 * per-subscriber delivery tracking (not this window) is what prevents repeats. */
const DIGEST_LOOKBACK_DAYS = 30;

const PAPER = "#F9F8F6";
const INK = "#121212";
const ACCENT = "#8B0000";

function articleUrl(slug: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}/articles/${encodeURIComponent(slug)}`;
}

function unsubscribeUrl(token: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slotLabel(slot: DigestSlot): string {
  return slot === "morning" ? "Morning Briefing" : "Evening Briefing";
}

/** current date (YYYY-MM-DD) and hour (0-23) in the configured timezone */
export function localDateAndHour(timezone: string, at: Date = new Date()): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number.parseInt(get("hour"), 10) % 24;
  return { dateKey, hour };
}

export type DigestItem = { post: DigestCandidatePost; whyItMatters: string };

export function plainTextForDigest(slot: DigestSlot, items: DigestItem[], unsubscribeToken: string): string {
  return [
    `Times of SF — ${slotLabel(slot)}`,
    "",
    ...items.flatMap((item, i) => [
      `${i + 1}. [${item.post.category ?? "Story"}] ${item.post.headline}`,
      item.whyItMatters,
      articleUrl(item.post.slug),
      "",
    ]),
    "You are receiving this because you subscribed to Times of SF topic updates.",
    `Unsubscribe: ${unsubscribeUrl(unsubscribeToken)}`,
  ].join("\n");
}

export function htmlForDigest(slot: DigestSlot, items: DigestItem[], unsubscribeToken: string): string {
  const unsubscribe = unsubscribeUrl(unsubscribeToken);
  const rows = items
    .map((item, i) => {
      const url = articleUrl(item.post.slug);
      return `
        <tr>
          <td style="padding:0 0 28px 0;border-bottom:1px solid rgba(18,18,18,0.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:36px;vertical-align:top;padding-top:2px;">
                  <div style="font:800 20px/1 Georgia,'Times New Roman',serif;color:${ACCENT};">${i + 1}</div>
                </td>
                <td style="vertical-align:top;">
                  <div style="font:700 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;text-transform:uppercase;color:${ACCENT};margin:0 0 6px 0;">
                    ${escapeHtml(item.post.category ?? "Story")}
                  </div>
                  <h2 style="margin:0 0 8px 0;font:700 21px/1.25 Georgia,'Times New Roman',serif;color:${INK};">
                    <a href="${escapeHtml(url)}" style="color:${INK};text-decoration:none;">${escapeHtml(item.post.headline)}</a>
                  </h2>
                  <p style="margin:0 0 10px 0;font:400 14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:rgba(18,18,18,0.7);">
                    ${escapeHtml(item.whyItMatters)}
                  </p>
                  <a href="${escapeHtml(url)}" style="font:700 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;text-transform:uppercase;color:${ACCENT};text-decoration:none;">
                    Read story →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="margin:0;padding:32px 16px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
        <tr>
          <td style="padding-bottom:28px;border-bottom:3px solid ${INK};text-align:center;">
            <div style="font:900 26px/1 Georgia,'Times New Roman',serif;letter-spacing:-0.02em;text-transform:uppercase;color:${INK};">
              Times of San Francisco
            </div>
            <div style="margin-top:8px;font:700 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.25em;text-transform:uppercase;color:${ACCENT};">
              ${escapeHtml(slotLabel(slot))}
            </div>
          </td>
        </tr>
        <tr><td style="height:28px;"></td></tr>
        ${rows}
        <tr>
          <td style="padding:28px 0 0 0;text-align:center;">
            <p style="margin:0 0 6px 0;font:400 11px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:rgba(18,18,18,0.45);">
              You are receiving this because you subscribed to Times of SF topic updates.
            </p>
            <a href="${escapeHtml(unsubscribe)}" style="font:400 11px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:rgba(18,18,18,0.45);">
              Unsubscribe
            </a>
          </td>
        </tr>
      </table>
    </div>
  `;
}

export function isNewsletterSenderConfigured(): boolean {
  return Boolean(isMailConfigured() && !config.disableNewsletterSender);
}

function groupSubscribersByPreferences(subscribers: DigestSubscriber[]): Map<string, DigestSubscriber[]> {
  const groups = new Map<string, DigestSubscriber[]>();
  for (const subscriber of subscribers) {
    const key = [...subscriber.preferences].sort().join(",");
    const group = groups.get(key);
    if (group) group.push(subscriber);
    else groups.set(key, [subscriber]);
  }
  return groups;
}

export async function buildAndSendDigest(slot: DigestSlot) {
  if (!isNewsletterSenderConfigured()) return { sent: 0, skipped: "not_configured" as const };
  if (newsletterRunInFlight) return { sent: 0, skipped: "in_flight" as const };

  newsletterRunInFlight = true;
  try {
    const { dateKey } = localDateAndHour(config.newsletterTimezone);
    const digestKey = `${dateKey}-${slot}`;
    if (await hasDigestRun(digestKey)) return { sent: 0, skipped: "already_run" as const };

    // A wide rolling pool (not "since last digest") so a quiet news day still has enough to send —
    // per-subscriber delivery tracking (below) is what actually prevents repeats, not the window.
    const windowStart = new Date(Date.now() - DIGEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await fetchDigestCandidatePosts(windowStart);
    if (candidates.length === 0) {
      await recordDigestRun(digestKey);
      return { sent: 0, skipped: "no_candidates" as const };
    }

    const subscribers = await fetchActiveSubscribersForDigest();
    const groups = groupSubscribersByPreferences(subscribers);
    const delivered = await fetchAlreadyDelivered(candidates.map((c) => c.id));

    let sent = 0;
    let failed = 0;
    for (const [key, groupSubscribers] of groups) {
      const preferences = key ? key.split(",") : [];
      const filtered = preferences.length === 0 ? candidates : candidates.filter((c) => c.category && preferences.includes(c.category));
      if (filtered.length === 0) continue;

      // Rank deeper than what any single subscriber receives (DIGEST_SEND_MAX) — morning and night
      // draw from the same ranked pool, so there must be enough ranked depth left for the per-subscriber
      // "already delivered" filter below to still surface a fresh 7-10 at night, not an empty list.
      const picks = await rankDigestStories(
        filtered.map((c) => ({
          id: String(c.id),
          headline: c.headline,
          dek: c.dek,
          category: c.category ?? "",
          citationCount: c.citationCount,
        })),
        Math.min(filtered.length, DIGEST_RANK_DEPTH),
      );
      const byId = new Map(filtered.map((c) => [String(c.id), c]));
      const ordered: DigestItem[] = picks
        .map((p) => ({ post: byId.get(p.id), whyItMatters: p.whyItMatters }))
        .filter((item): item is DigestItem => Boolean(item.post));

      for (const subscriber of groupSubscribers) {
        const items = ordered.filter((item) => !delivered.has(`${subscriber.id}:${item.post.id}`)).slice(0, DIGEST_SEND_MAX);
        if (items.length === 0) continue;

        // Isolate per subscriber: one bad address must not abort the run, or the slot never gets
        // recorded and the whole digest (LLM ranking included) re-fires every 60s for the hour.
        try {
          const subject = `Times of SF — ${slotLabel(slot)}: ${items.length} ${items.length === 1 ? "story" : "stories"}`;
          await sendMail({
            to: subscriber.email,
            subject,
            html: htmlForDigest(slot, items, subscriber.unsubscribeToken),
            text: plainTextForDigest(slot, items, subscriber.unsubscribeToken),
          });
          await markNewsletterDelivered(subscriber.id, items.map((item) => item.post.id));
          sent += 1;
        } catch (err) {
          failed += 1;
          console.error(`Newsletter ${slot} digest failed for subscriber ${subscriber.id}:`, err);
        }
      }
    }

    await recordDigestRun(digestKey);
    return { sent, failed };
  } finally {
    newsletterRunInFlight = false;
  }
}

/** Slot due right now in the configured timezone, if any (used by the internal scheduler). */
export function dueDigestSlot(at: Date = new Date()): DigestSlot | null {
  const { hour } = localDateAndHour(config.newsletterTimezone, at);
  if (config.newsletterDigestHours.includes(hour)) {
    // Morning = earliest configured hour of the day, everything else counts as night.
    const sorted = [...config.newsletterDigestHours].sort((a, b) => a - b);
    return hour === sorted[0] ? "morning" : "night";
  }
  return null;
}
