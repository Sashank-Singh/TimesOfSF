import { config } from "./config";
import { fetchPendingNewsletterBatches, markNewsletterDelivered, NewsletterBatch, NewsletterPost } from "./db";

let newsletterRunInFlight = false;

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

function plainTextForPosts(batch: NewsletterBatch): string {
  const posts = batch.posts;
  return [
    "New Times of SF stories for your selected topics:",
    "",
    ...posts.flatMap((post) => [
      `${post.category ?? "Story"}: ${post.headline}`,
      post.dek,
      articleUrl(post.slug),
      "",
    ]),
    "You are receiving this because you subscribed to Times of SF topic updates.",
    `Unsubscribe: ${unsubscribeUrl(batch.unsubscribeToken)}`,
  ].join("\n");
}

function htmlForPosts(batch: NewsletterBatch): string {
  const unsubscribe = unsubscribeUrl(batch.unsubscribeToken);
  const posts = batch.posts;
  const items = posts.map((post) => {
    const url = articleUrl(post.slug);
    return `
      <li style="margin:0 0 22px 0;">
        <div style="font:700 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#9a3412;">
          ${escapeHtml(post.category ?? "Story")}
        </div>
        <h2 style="margin:4px 0 8px 0;font:700 22px/1.15 Georgia,serif;color:#111827;">
          <a href="${escapeHtml(url)}" style="color:#111827;text-decoration:none;">${escapeHtml(post.headline)}</a>
        </h2>
        <p style="margin:0 0 10px 0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#374151;">
          ${escapeHtml(post.dek)}
        </p>
        <a href="${escapeHtml(url)}" style="font:700 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#9a3412;text-decoration:none;">
          Read story
        </a>
      </li>
    `;
  }).join("");

  return `
    <div style="margin:0;padding:24px;background:#f8f3ea;">
      <main style="max-width:680px;margin:0 auto;background:#fffaf0;border:1px solid #111827;padding:28px;">
        <div style="font:800 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#111827;">
          Times of SF
        </div>
        <h1 style="margin:10px 0 22px 0;font:900 30px/1.05 Georgia,serif;color:#111827;">
          New stories for your topics
        </h1>
        <ul style="list-style:none;margin:0;padding:0;">${items}</ul>
        <p style="margin:28px 0 0 0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#6b7280;">
          You are receiving this because you subscribed to Times of SF topic updates.
          <a href="${escapeHtml(unsubscribe)}" style="color:#6b7280;">Unsubscribe</a>.
        </p>
      </main>
    </div>
  `;
}

function subjectForBatch(batch: NewsletterBatch): string {
  const first = batch.posts[0];
  if (batch.posts.length === 1) return `Times of SF: ${first.headline}`;
  return `Times of SF: ${batch.posts.length} new stories for ${batch.preferences.join(", ")}`;
}

async function sendWithPostal(batch: NewsletterBatch) {
  if (!config.postalApiUrl || !config.postalApiKey || !config.newsletterFrom) {
    throw new Error("Newsletter email is not configured. Set POSTAL_API_URL, POSTAL_API_KEY, and NEWSLETTER_FROM.");
  }

  const response = await fetch(`${config.postalApiUrl}/api/v1/send/message`, {
    method: "POST",
    headers: {
      "X-Server-API-Key": config.postalApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.newsletterFrom,
      to: [batch.email],
      reply_to: config.newsletterReplyTo,
      subject: subjectForBatch(batch),
      html_body: htmlForPosts(batch),
      plain_body: plainTextForPosts(batch),
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "success") {
    throw new Error(`Postal returned ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
}

export function isNewsletterSenderConfigured(): boolean {
  return Boolean(config.postalApiUrl && config.postalApiKey && config.newsletterFrom && !config.disableNewsletterSender);
}

export async function runNewsletterSender() {
  if (!isNewsletterSenderConfigured()) return { sent: 0, skipped: "not_configured" as const };
  if (newsletterRunInFlight) return { sent: 0, skipped: "in_flight" as const };

  newsletterRunInFlight = true;
  let sent = 0;
  try {
    const batches = await fetchPendingNewsletterBatches(config.newsletterBatchLimit);
    for (const batch of batches) {
      if (batch.posts.length === 0) continue;
      await sendWithPostal(batch);
      await markNewsletterDelivered(batch.subscriberId, batch.posts.map((post) => post.id));
      sent += 1;
    }
    return { sent };
  } finally {
    newsletterRunInFlight = false;
  }
}
