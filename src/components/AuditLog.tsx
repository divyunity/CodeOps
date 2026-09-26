'use client';

import { AgentEvent } from '@/types/agent';

interface AuditLogProps {
  events: AgentEvent[];
}

const typeLabel: Record<string, string> = {
  thinking:    'THINK',
  tool_call:   'TOOL',
  tool_result: 'RESULT',
  decision:    'DECIDE',
  action:      'ACTION',
  success:     'OK',
  warning:     'WARN',
  error:       'ERR',
  system:      'SYS',
  verify:      'VERIFY',
};

const typeColor: Record<string, string> = {
  thinking:    'text-ops-accent bg-ops-accent/10',
  tool_call:   'text-ops-yellow bg-ops-yellow/10',
  tool_result: 'text-gray-400 bg-ops-border/20',
  decision:    'text-ops-accent bg-ops-accent/10',
  action:      'text-ops-green bg-ops-green/10',
  success:     'text-ops-green bg-ops-green/10',
  warning:     'text-ops-yellow bg-ops-yellow/10',
  error:       'text-ops-red bg-ops-red/10',
  system:      'text-ops-muted bg-ops-border/20',
  verify:      'text-ops-green bg-ops-green/10',
};

export default function AuditLog({ events }: AuditLogProps) {
  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center py-16">
        <div>
          <div className="text-3xl mb-3 opacity-30">📋</div>
          <div className="text-ops-muted font-mono text-sm opacity-60">
            No audit entries yet.
          </div>
          <div className="text-ops-muted font-mono text-xs mt-1 opacity-40">
            Run the agent to see all decisions and actions recorded here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-ops-bg font-mono">
      {/* Table header */}
      <div className="sticky top-0 flex items-center gap-0 px-0 py-1.5 bg-ops-surface border-b border-ops-border text-xs text-ops-muted uppercase tracking-widest z-10">
        <div className="w-28 px-4">Time</div>
        <div className="w-20 px-2">Type</div>
        <div className="flex-1 px-2">Message</div>
        <div className="w-24 px-2 hidden md:block">Tool</div>
      </div>

      {/* Rows */}
      {events.map((event, i) => (
        <div
          key={event.id}
          className={`flex items-start gap-0 border-b border-ops-border/20 text-xs hover:bg-ops-surface/60 transition-colors ${
            i % 2 === 0 ? 'bg-transparent' : 'bg-ops-surface/20'
          }`}
        >
          {/* Timestamp */}
          <div className="w-28 px-4 py-2.5 text-ops-muted shrink-0 opacity-70">
            {new Date(event.timestamp).toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </div>

          {/* Type badge */}
          <div className="w-20 px-2 py-2.5 shrink-0">
            <span
              className={`inline-block text-xs px-1.5 py-0.5 rounded ${
                typeColor[event.type] ?? typeColor.system
              }`}
            >
              {typeLabel[event.type] ?? event.type.toUpperCase()}
            </span>
          </div>

          {/* Message */}
          <div className="flex-1 px-2 py-2.5 text-gray-300 leading-snug">
            {event.message}
            {event.detail && (
              <div className="mt-0.5 text-ops-muted opacity-70 whitespace-pre-wrap">
                {event.detail}
              </div>
            )}
          </div>

          {/* Tool */}
          <div className="w-24 px-2 py-2.5 text-ops-yellow hidden md:block opacity-80">
            {event.tool ?? '—'}
          </div>
        </div>
      ))}

      {/* Export hint */}
      <div className="px-4 py-3 text-xs text-ops-muted opacity-40 border-t border-ops-border">
        {events.length} entries · complete audit trail
      </div>
    </div>
  );
}
