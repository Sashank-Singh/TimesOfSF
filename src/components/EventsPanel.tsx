import React from 'react';
import { Calendar, ExternalLink, MapPin } from 'lucide-react';
import { EventInfo } from '../types';
import { motion } from 'motion/react';

interface EventsPanelProps {
  events: EventInfo[];
}

export function EventsPanel({ events }: EventsPanelProps) {
  if (!events || events.length === 0) {
    return (
      <div className="py-20 text-center border-t-2 border-ink">
        <p className="text-xl italic font-serif text-ink/40">No upcoming events found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {events.map((event, i) => (
        <motion.a
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          key={i}
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block border-t border-ink/20 first:border-t-2 first:border-ink py-10 hover:bg-ink/[0.02] transition-colors duration-500"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-12 items-start px-4 md:px-0">
            {/* Left Column: Date & Source */}
            <div className="md:col-span-3 flex flex-col">
              <span className="text-accent font-mono text-[10px] uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-accent" />
                {event.source || "San Francisco"}
              </span>
              <span className="text-2xl md:text-3xl font-serif italic text-ink/90 leading-tight">
                {event.date}
              </span>
            </div>

            {/* Middle Column: Title */}
            <div className="md:col-span-8 flex flex-col justify-center h-full">
              <h3 className="text-3xl md:text-4xl font-black font-serif leading-[1.1] text-ink group-hover:text-accent transition-colors duration-300">
                {event.title}
              </h3>
            </div>

            {/* Right Column: Icon */}
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
