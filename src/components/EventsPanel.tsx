import React, { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { EventInfo } from '../types';
import { motion } from 'motion/react';

interface EventsPanelProps {
  events: EventInfo[];
}

function sfTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function parseEventYmd(raw: string): string | null {
  if (!raw?.trim() || /^date\s*tba$/i.test(raw) || /^tba$/i.test(raw.trim())) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 2024 || y > 2100) return null;
  return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function upcomingThisWeek(events: EventInfo[]): EventInfo[] {
  const start = sfTodayYmd();
  const end = addDaysYmd(start, 7);
  return events
    .map((event) => ({ event, ymd: parseEventYmd(event.date) }))
    .filter((row): row is { event: EventInfo; ymd: string } => !!row.ymd && row.ymd >= start && row.ymd <= end)
    .sort((a, b) => a.ymd.localeCompare(b.ymd))
    .map((row) => row.event);
}

export function EventsPanel({ events }: EventsPanelProps) {
  const upcoming = useMemo(() => upcomingThisWeek(events ?? []), [events]);

  if (!upcoming.length) {
    return (
      <div className="py-20 text-center border-t-2 border-ink">
        <p className="text-xl italic font-serif text-ink/40">No events in the next 7 days.</p>
        <p className="mt-3 text-sm text-ink/35 font-mono uppercase tracking-widest">Showing today through +7 days (SF time)</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/40 mb-6 px-4 md:px-0">
        Today – {addDaysYmd(sfTodayYmd(), 7)} · San Francisco
      </p>
      {upcoming.map((event, i) => (
        <motion.a
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          key={`${event.url}-${event.date}-${i}`}
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block border-t border-ink/20 first:border-t-2 first:border-ink py-10 hover:bg-ink/[0.02] transition-colors duration-500"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-12 items-start px-4 md:px-0">
            <div className="md:col-span-3 flex flex-col">
              <span className="text-accent font-mono text-[10px] uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-accent" />
                {event.source || "San Francisco"}
              </span>
              <span className="text-2xl md:text-3xl font-serif italic text-ink/90 leading-tight">
                {event.date}
              </span>
            </div>
            <div className="md:col-span-8 flex flex-col justify-center h-full">
              <h3 className="text-3xl md:text-4xl font-black font-serif leading-[1.1] text-ink group-hover:text-accent transition-colors duration-300">
                {event.title}
              </h3>
            </div>
            <div className="md:col-span-1 flex justify-start md:justify-end mt-4 md:mt-0">
              <div className="w-12 h-12 rounded-full border border-ink/10 flex items-center justify-center text-ink/40 group-hover:bg-accent group-hover:border-accent group-hover:text-paper group-hover:-translate-y-1 transition-all duration-300 shadow-sm">
                <ExternalLink size={18} />
              </div>
            </div>
          </div>
        </motion.a>
      ))}
      <div className="border-t-2 border-ink mt-2" />
    </div>
  );
}
