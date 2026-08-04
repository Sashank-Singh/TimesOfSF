import posthog from "posthog-js";

const HOST = import.meta.env.VITE_POSTHOG_HOST?.trim().replace(/\/+$/, "");
const KEY = import.meta.env.VITE_POSTHOG_KEY?.trim();

let initialized = false;

function isEnabled(): boolean {
  return Boolean(HOST && KEY);
}

function reportMissingConfiguration(): void {
  if (import.meta.env.DEV) {
    if (!HOST) console.error("VITE_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_HOST is configured");
    if (!KEY) console.error("VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured");
  }
}

export function initializePostHog(): void {
  reportMissingConfiguration();
  if (!isEnabled() || initialized) return;

  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false,
  });
  posthog.startExceptionAutocapture();
  initialized = true;
}

export function trackPageView(path?: string): void {
  if (!isEnabled()) return;
  const current = path ?? window.location.pathname;
  if (!current || current.startsWith("/api")) return;
  posthog.capture("$pageview", { $current_url: `${window.location.origin}${current}`, path: current });
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  posthog.capture(name, properties);
}

export function identifyUser(id: string | number, email: string): void {
  if (!isEnabled() || !id || !email) return;
  posthog.identify(String(id), { email });
}

export function resetAnalytics(): void {
  if (!isEnabled()) return;
  posthog.reset();
}

/** The PostHog instance, for call sites that need direct access (e.g. `posthog.capture`). */
export { posthog };
