'use client';

import { useEffect, useRef } from 'react';
import { AgentEvent } from '@/types/agent';

interface ActivityFeedProps {
  events: AgentEvent[];
  isRunning: boolean;
}

const eventStyles: Record<string, { icon: string; color: string; bg: string }> = {
  thinking:   { icon: '🧠', color: 'text-ops-accent',  bg: 'bg-ops-accent/5'  },
  tool_call:  { icon: '🔧', color: 'text-ops-yellow',  bg: 'bg-ops-yellow/5'  },
  tool_result:{ icon: '📥', color: 'text-gray-400',    bg: 'bg-ops-border/20' },
  decision:   { icon: '⚡', color: 'text-ops-accent',  bg: 'bg-ops-accent/5'  },
  action:     { icon: '▶', color: 'text-ops-green',   bg: 'bg-ops-green/5'   },
  success:    { icon: '✓', color: 'text-ops-green',   bg: 'bg-ops-green/5'   },
  warning:    { icon: '⚠', color: 'text-ops-yellow',  bg: 'bg-ops-yellow/5'  },
  error:      { icon: '✗', color: 'text-ops-red',     bg: 'bg-ops-red/5'     },
  system:     { icon: '◈', color: 'text-ops-muted',   bg: 'bg-transparent'   },
  verify:     { icon: '✔', color: 'text-ops-green',   bg: 'bg-ops-green/5'   },
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function EventRow({ event }: { event: AgentEvent }) {
  const style = eventStyles[event.type] ?? eventStyles.system;
  return (
    <div className={`flex gap-3 px-4 py-2.5 border-b border-ops-border/30 ${style.bg} group`}>
      {/* Timeline connector */}
      <div className="flex flex-col items-center pt-0.5 shrink-0">
        <span className={`text-base leading-none ${style.color}`}>{style.icon}</span>
        <div className="w-px flex-1 bg-ops-border/30 mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className={`text-sm font-mono ${style.color} leading-snug`}>
            {event.tool && (
              <span className="text-xs bg-ops-border/40 text-gray-400 px-1.5 py-0.5 rounded mr-2 font-normal">
                {event.tool}
              </span>
            )}
            {event.message}
          </div>
          <span className="text-xs text-ops-muted font-mono shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
            {formatTime(event.timestamp)}
          </span>
        </div>
        {event.detail && (
          <div className="mt-1 text-xs text-ops-muted font-mono leading-relaxed opacity-80 whitespace-pre-wrap">
            {event.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function PulsingCursor() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-ops-border/30">
      <div className="flex gap-1 items-center shrink-0">
        <span className="w-2 h-2 rounded-full bg-ops-accent animate-pulse" />
        <span className="w-2 h-2 rounded-full bg-ops-accent animate-pulse delay-75" />
        <span className="w-2 h-2 rounded-full bg-ops-accent animate-pulse delay-150" />
      </div>
      <span className="text-xs font-mono text-ops-accent opacity-70">Agent working…</span>
    </div>
  );
}

export default function ActivityFeed({ events, isRunning }: ActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, isRunning]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-ops-bg">
      {events.length === 0 && !isRunning && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16">
          <div className="text-4xl mb-4 opacity-30">◈</div>
          <div className="text-ops-muted font-mono text-sm opacity-60">
            CodeOps is standing by.
          </div>
          <div className="text-ops-muted font-mono text-xs mt-2 opacity-40">
            Select a mode or type a command to begin.
          </div>
        </div>
      )}

      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}

      {isRunning && <PulsingCursor />}

      <div ref={bottomRef} />
    </div>
  );
}
