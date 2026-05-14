// Next fire time for PIPELINE_CRON (same string Inngest uses in server/inngest.ts).
// Computed in UTC to align with typical Inngest Cloud cron behavior.
//
// Supported cron shapes:
// - Star-slash-N five-field cron (every N minutes within the hour), e.g. every 30 minutes at :00, :30 UTC.
// - "0 * * * *" — start of every UTC hour.
//
// Other expressions return null (health still shows raw pipelineCron).

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/** Seconds from UTC hour start [0, 3600). */
function secondsIntoUtcHour(from: Date): number {
  return (
    from.getUTCMinutes() * 60 +
    from.getUTCSeconds() +
    from.getUTCMilliseconds() / 1000
  );
}

function utcHourStartMs(from: Date): number {
  return Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    from.getUTCHours(),
    0,
    0,
    0,
  );
}

// Next UTC instant strictly after `from` for star-slash-N every-N-minutes cron.
function nextUtcEveryNMinutes(from: Date, everyNMinutes: number): Date {
  const periodSec = everyNMinutes * 60;
  const into = secondsIntoUtcHour(from);
  let slotEndSec = Math.floor(into / periodSec) * periodSec;
  if (slotEndSec <= into) slotEndSec += periodSec;

  const hourStart = utcHourStartMs(from);
  let nextMs = hourStart + slotEndSec * 1000;

  // slotEndSec can be 3600 → next hour :00
  if (slotEndSec >= 3600) {
    nextMs = hourStart + 3600 * 1000;
  }

  while (nextMs <= from.getTime()) {
    nextMs += periodSec * 1000;
  }

  return new Date(nextMs);
}

function nextUtcTopOfHour(from: Date): Date {
  const start = utcHourStartMs(from);
  let nextMs = start + 3600 * 1000;
  while (nextMs <= from.getTime()) {
    nextMs += 3600 * 1000;
  }
  return new Date(nextMs);
}

export type PipelineCronHealth = {
  pipelineCron: string;
  timezone: "UTC";
  nextPipelineRunAt: string;
  msUntilNextPipelineRun: number;
  humanApproxWait: string;
  parseNote: string;
};

export function getPipelineCronHealth(cronExpr: string, from: Date = new Date()): PipelineCronHealth | null {
  const raw = cronExpr.trim();
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return null;

  const [minF, hourF, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;

  let next: Date | null = null;

  const everyMin = minF.match(/^\*\/(\d+)$/);
  if (everyMin && hourF === "*") {
    const n = Number.parseInt(everyMin[1], 10);
    if (n >= 1 && n <= 59) next = nextUtcEveryNMinutes(from, n);
  } else if (minF === "0" && hourF === "*") {
    next = nextUtcTopOfHour(from);
  }

  if (!next) return null;

  const msUntil = Math.max(0, next.getTime() - from.getTime());
  return {
    pipelineCron: raw,
    timezone: "UTC",
    nextPipelineRunAt: next.toISOString(),
    msUntilNextPipelineRun: msUntil,
    humanApproxWait: formatDurationMs(msUntil),
    parseNote:
      "UTC estimate for when Inngest may invoke runPipeline (same cron as server). A new article is not guaranteed each tick.",
  };
}
