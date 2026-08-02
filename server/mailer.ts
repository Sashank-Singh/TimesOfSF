import { config } from "./config";

export function isMailConfigured(): boolean {
  return Boolean(config.postalApiUrl && config.postalApiKey && config.newsletterFrom);
}

/** Send one message through the Postal HTTP API. Throws on any non-success response. */
export async function sendMail(input: { to: string; subject: string; html: string; text: string }) {
  if (!config.postalApiUrl || !config.postalApiKey || !config.newsletterFrom) {
    throw new Error("Email is not configured. Set POSTAL_API_URL, POSTAL_API_KEY, and NEWSLETTER_FROM.");
  }

  const response = await fetch(`${config.postalApiUrl}/api/v1/send/message`, {
    method: "POST",
    headers: {
      "X-Server-API-Key": config.postalApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.newsletterFrom,
      to: [input.to],
      reply_to: config.newsletterReplyTo,
      subject: input.subject,
      html_body: input.html,
      plain_body: input.text,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "success") {
    throw new Error(`Postal returned ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
}

const PAPER = "#F9F8F6";
const INK = "#121212";
const ACCENT = "#8B0000";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared masthead shell for one-off transactional mail, matching the site's look. */
export function transactionalHtml(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:24px 0 0 0;">
         <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${INK};color:${PAPER};text-decoration:none;padding:14px 26px;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;text-transform:uppercase;">
           ${escapeHtml(cta.label)}
         </a>
       </p>`
    : "";

  return `
    <div style="margin:0;padding:32px 16px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
        <tr>
          <td style="padding-bottom:24px;border-bottom:3px solid ${INK};text-align:center;">
            <div style="font:900 22px/1 Georgia,'Times New Roman',serif;letter-spacing:-0.02em;text-transform:uppercase;color:${INK};">
              Times of San Francisco
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 0 0 0;">
            <h1 style="margin:0 0 14px 0;font:700 22px/1.25 Georgia,'Times New Roman',serif;color:${INK};">${escapeHtml(heading)}</h1>
            ${bodyHtml}
            ${button}
          </td>
        </tr>
        <tr>
          <td style="padding:32px 0 0 0;">
            <p style="margin:0;font:400 11px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:rgba(18,18,18,0.45);">
              If you did not expect this email you can safely ignore it.
            </p>
          </td>
        </tr>
      </table>
    </div>
  `;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;font:400 14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:rgba(18,18,18,0.75);">${escapeHtml(text)}</p>`;
}

export function linkFallback(url: string): string {
  return `<p style="margin:18px 0 0 0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:rgba(18,18,18,0.45);word-break:break-all;">
    Or paste this link into your browser:<br /><a href="${escapeHtml(url)}" style="color:${ACCENT};">${escapeHtml(url)}</a>
  </p>`;
}
