'use client';

import { useRef, useEffect } from 'react';

interface QuickCommand {
  id: string;
  emoji: string;
  label: string;
  color: 'red' | 'yellow' | 'green';
  command: string;
}

interface CommandPanelProps {
  command: string;
  setCommand: (v: string) => void;
  isRunning: boolean;
  onRun: (cmd: string) => void;
  onStop: () => void;
  quickCommands: QuickCommand[];
  sessionMemory: string[];
  onClearMemory: () => void;
}

const colorMap = {
  red: {
    border: 'border-ops-red/40 hover:border-ops-red',
    text: 'text-ops-red',
    bg: 'hover:bg-ops-red/10',
  },
  yellow: {
    border: 'border-ops-yellow/40 hover:border-ops-yellow',
    text: 'text-ops-yellow',
    bg: 'hover:bg-ops-yellow/10',
  },
  green: {
    border: 'border-ops-green/40 hover:border-ops-green',
    text: 'text-ops-green',
    bg: 'hover:bg-ops-green/10',
  },
};

export default function CommandPanel({
  command,
  setCommand,
  isRunning,
  onRun,
  onStop,
  quickCommands,
  sessionMemory,
  onClearMemory,
}: CommandPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isRunning) textareaRef.current?.focus();
  }, [isRunning]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isRunning && command.trim()) onRun(command);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-ops-border">
        <div className="text-xs font-mono text-ops-muted uppercase tracking-widest mb-1">
          Command Center
        </div>
        <div className="text-xs text-ops-muted opacity-60">
          Type a command or select a mode below
        </div>
      </div>

      {/* Quick mode buttons */}
      <div className="px-4 py-3 border-b border-ops-border space-y-2">
        <div className="text-xs font-mono text-ops-muted uppercase tracking-widest mb-2">
          Quick Modes
        </div>
        {quickCommands.map((qc) => {
          const c = colorMap[qc.color];
          return (
            <button
              key={qc.id}
              disabled={isRunning}
              onClick={() => onRun(qc.command)}
              className={`w-full text-left px-3 py-2.5 rounded border ${c.border} ${c.bg} transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <div className={`flex items-center gap-2 text-sm font-mono font-medium ${c.text}`}>
                <span>{qc.emoji}</span>
                <span>{qc.label}</span>
              </div>
              <div className="text-xs text-ops-muted mt-0.5 pl-6 leading-relaxed opacity-80">
                {qc.command.slice(0, 60)}…
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom command input */}
      <div className="px-4 py-3 flex-1 flex flex-col">
        <div className="text-xs font-mono text-ops-muted uppercase tracking-widest mb-2">
          Custom Command
        </div>
        <textarea
          ref={textareaRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder={'Ask CodeOps anything...\n\nExamples:\n• "What needs attention today?"\n• "Find stale PRs"\n• "Are we ready to ship?"'}
          rows={5}
          className="flex-1 bg-ops-bg border border-ops-border rounded px-3 py-2 text-sm font-mono text-gray-300 placeholder-ops-muted resize-none focus:outline-none focus:border-ops-accent transition-colors disabled:opacity-50"
        />
        <div className="mt-2 flex items-center gap-2">
          {isRunning ? (
            <button
              onClick={onStop}
              className="flex-1 py-2 bg-ops-red/20 border border-ops-red/50 hover:bg-ops-red/30 text-ops-red font-mono text-sm rounded transition-colors"
            >
              ⏹ Stop Agent
            </button>
          ) : (
            <button
              onClick={() => command.trim() && onRun(command)}
              disabled={!command.trim()}
              className="flex-1 py-2 bg-ops-accent/10 border border-ops-accent/50 hover:bg-ops-accent/20 text-ops-accent font-mono text-sm rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ▶ Run Agent
            </button>
          )}
        </div>
        <div className="mt-1 text-xs text-ops-muted opacity-50 text-right font-mono">
          Enter to run · Shift+Enter for newline
        </div>
      </div>

      {/* Session memory */}
      {sessionMemory.length > 0 && (
        <div className="px-4 py-3 border-t border-ops-border">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-mono text-ops-yellow uppercase tracking-widest">
              🧠 Session Memory ({sessionMemory.length})
            </div>
            <button
              onClick={onClearMemory}
              className="text-xs text-ops-muted hover:text-ops-red transition-colors font-mono"
            >
              clear
            </button>
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {sessionMemory.map((rule, i) => (
              <div
                key={i}
                className="text-xs text-ops-muted bg-ops-bg rounded px-2 py-1 leading-relaxed border border-ops-border/50"
              >
                {rule}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
