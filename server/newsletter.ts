import { config } from "./config";
import type { DigestCandidatePost, DigestSubscriber } from "./db";
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

function articleUrl(slug: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}/articles/${encodeURIComponent(slug)}`;
}

function unsubscribeUrl(token: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Postal removes +notrack before delivery and leaves the destination URL unchanged. */
function postalNoTrackUrl(value: string): string {
  return value.replace(/^(https?):\/\//, "$1+notrack://");
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
export type DigestHtmlOptions = { postalNoTrack?: boolean };

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

function seedFor(slug: string): string {
  return slug.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "story";
}

/** Real article image when the post has one, otherwise a stable placeholder seed. */
function imageFor(post: DigestItem["post"], width: number, height: number): string {
  const real = post.imageUrl?.trim();
  if (real && /^https?:\/\//.test(real)) return real;
  return `https://picsum.photos/seed/timesofsf-${seedFor(post.slug)}/${width}/${height}`;
}

/** Readable date (e.g. "Monday, August 3, 2026") in the configured timezone. */
function localLongDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(at);
}

export function htmlForDigest(
  slot: DigestSlot,
  items: DigestItem[],
  unsubscribeToken: string,
  options: DigestHtmlOptions = {},
): string {
  const linkUrl = options.postalNoTrack === false ? (value: string) => value : postalNoTrackUrl;
  const unsubscribe = linkUrl(unsubscribeUrl(unsubscribeToken));
  const site = linkUrl(config.appUrl.replace(/\/+$/, ""));
  const date = localLongDate(config.newsletterTimezone);
  const label = escapeHtml(slotLabel(slot));

  const [lead, ...rest] = items;
  const topStory = lead
    ? (() => {
        const url = linkUrl(articleUrl(lead.post.slug));
        const category = escapeHtml(lead.post.category ?? "Story");
        const headline = escapeHtml(lead.post.headline);
        const summary = escapeHtml(lead.whyItMatters);
        const image = imageFor(lead.post, 1040, 560);
        return `
              <tr>
                <td class="email-pad" style="padding:0 40px 30px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#C9C4B8;">
                    <tr><td style="padding:26px;background-color:#A8171C;">
                      <div style="color:#F2E9D8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Top Story | ${category}</div>
                      <h1 class="lead-title" style="margin:8px 0 0;color:#FFFFFF;font:900 28px/1.2 Georgia,'Times New Roman',serif;"><a href="${escapeHtml(url)}" style="color:#FFFFFF;text-decoration:none;">${headline}</a></h1>
                    </td></tr>
                    <tr><td><a href="${escapeHtml(url)}"><img src="${escapeHtml(image)}" width="520" alt="" style="display:block;width:100%;height:auto;max-height:280px;object-fit:cover;border:0;"></a></td></tr>
                    <tr><td style="padding:22px 26px 26px;">
                      <p style="margin:0 0 18px;color:#3C3A35;font-size:14px;line-height:1.65;">${summary}</p>
                      <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 24px;background-color:#A8171C;color:#FFFFFF;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;text-transform:uppercase;">Read the full story</a>
                    </td></tr>
                  </table>
                </td>
              </tr>
        `;
      })()
    : "";

  const rows = rest
    .map((item) => {
      const url = linkUrl(articleUrl(item.post.slug));
      const category = escapeHtml(item.post.category ?? "Story");
      const headline = escapeHtml(item.post.headline);
      const summary = escapeHtml(item.whyItMatters);
      const image = imageFor(item.post, 192, 192);
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="story-row" style="border-bottom:1px solid #CFCABD;">
          <tr>
            <td width="96" valign="top" class="story-image-cell" style="width:96px;padding:20px 16px 20px 0;"><a href="${escapeHtml(url)}"><img src="${escapeHtml(image)}" width="96" height="96" alt="" style="display:block;width:96px;height:96px;object-fit:cover;border:0;"></a></td>
            <td valign="top" style="padding:20px 0;">
              <div style="margin:0 0 6px;color:#A8171C;font:700 10px/1.4 Helvetica,Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;">${category}</div>
              <h3 style="margin:0 0 7px;color:#151515;font:800 18px/1.25 Georgia,'Times New Roman',serif;">
                <a href="${escapeHtml(url)}" style="color:#151515;text-decoration:none;">${headline}</a>
              </h3>
              <p style="margin:0;color:#5A564F;font:400 14px/1.55 Helvetica,Arial,sans-serif;">${summary}</p>
            </td>
          </tr>
        </table>
      `;
    })
    .join("");

  const moreHeadlines = rest.length > 0
    ? `
              <tr><td class="email-pad" style="padding:0 40px;">
                <div style="padding-bottom:8px;border-bottom:2px solid #151515;color:#151515;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">More Headlines</div>
        ${rows}
              </td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>Times of SF ${label}</title>
  <style>
    @media only screen and (max-width:620px) {
      .email-shell { width:100% !important; }
      .email-pad { padding-left:22px !important; padding-right:22px !important; }
      .masthead { font-size:32px !important; }
      .lead-title { font-size:24px !important; }
      .story-image-cell { width:76px !important; padding-right:12px !important; }
      .story-image-cell img { width:76px !important; height:76px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#A8A49C;font-family:Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${label}: ${items.length} important San Francisco stories, selected for you.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#A8A49C;">
    <tr>
      <td align="center" style="padding:40px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="email-shell" style="width:600px;max-width:600px;background-color:#E8E3D8;">
          <tr>
            <td class="email-pad" style="padding:42px 40px 28px;text-align:center;">
              <div style="margin-bottom:10px;color:#A8171C;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;">San Francisco | ${label}</div>
              <div class="masthead" style="margin:0;color:#151515;font:900 40px/1.05 Georgia,'Times New Roman',serif;letter-spacing:-.5px;text-transform:uppercase;">Times of SF<br>Daily News</div>
              <p style="margin:14px 0 0;color:#4D4A44;font-size:14px;line-height:1.5;">The local stories that matter, selected for your interests.</p>
              <p style="margin:8px 0 0;color:#6B675F;font-size:11px;line-height:1.5;">${escapeHtml(date)}</p>
            </td>
          </tr>

          ${topStory}
          ${moreHeadlines}

          <tr><td class="email-pad" style="padding:32px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#A8171C;">
              <tr><td style="padding:28px;text-align:center;">
                <h2 style="margin:0 0 8px;color:#FFFFFF;font:900 22px/1.2 Georgia,'Times New Roman',serif;text-transform:uppercase;">Keep reading Times of SF</h2>
                <p style="margin:0 0 18px;color:#F6E7E7;font-size:14px;line-height:1.5;">Explore the latest reporting across tech, civics, funding, culture, transit, food, and events.</p>
                <a href="${escapeHtml(site)}" style="display:inline-block;padding:14px 28px;background-color:#151515;color:#FFFFFF;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;text-transform:uppercase;">Visit TimesOfSF.com</a>
              </td></tr>
            </table>
          </td></tr>

          <tr><td class="email-pad" style="padding:22px 40px 40px;border-top:1px solid #CFCABD;text-align:center;">
            <p style="margin:0 0 14px;color:#6B675F;font-size:12px;line-height:1.6;">You are receiving this because you subscribed to Times of SF topic updates.<br>San Francisco, California</p>
            <a href="${escapeHtml(unsubscribe)}" style="color:#6B675F;font-size:12px;text-decoration:underline;">Unsubscribe</a>
            <span style="padding:0 8px;color:#6B675F;">|</span>
            <a href="${escapeHtml(site)}" style="color:#6B675F;font-size:12px;text-decoration:underline;">Visit site</a>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    const {
      fetchActiveSubscribersForDigest,
      fetchAlreadyDelivered,
      fetchDigestCandidatePosts,
      hasDigestRun,
      markNewsletterDelivered,
      recordDigestRun,
    } = await import("./db");
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
    const { rankDigestStories } = await import("./agents");
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
