'use client';

interface StatusBarProps {
  isRunning: boolean;
  sessionMemory: string[];
}

export default function StatusBar({ isRunning, sessionMemory }: StatusBarProps) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-b border-ops-border bg-ops-surface"
      style={{ minHeight: 44 }}
    >
      {/* Left: logo */}
      <div className="flex items-center gap-3">
        <span className="text-ops-accent font-mono font-bold text-sm tracking-widest uppercase">
          ◈ CODEOPS
        </span>
        <span className="text-ops-muted text-xs font-mono hidden sm:block">
          Autonomous Engineering Command Center
        </span>
      </div>

      {/* Center: status */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <span className="flex items-center gap-2 text-xs font-mono text-ops-accent">
            <span className="inline-block w-2 h-2 rounded-full bg-ops-accent animate-pulse" />
            AGENT RUNNING
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs font-mono text-ops-green">
            <span className="inline-block w-2 h-2 rounded-full bg-ops-green" />
            AGENT ONLINE
          </span>
        )}
      </div>

      {/* Right: memory indicator */}
      <div className="flex items-center gap-3 text-xs font-mono text-ops-muted">
        {sessionMemory.length > 0 && (
          <span className="flex items-center gap-1 text-ops-yellow">
            <span>🧠</span>
            <span>{sessionMemory.length} rule{sessionMemory.length !== 1 ? 's' : ''} in memory</span>
          </span>
        )}
        <span className="hidden sm:block text-ops-muted opacity-50">
          {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </span>
      </div>
    </div>
  );
}
