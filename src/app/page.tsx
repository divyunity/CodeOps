'use client';

import { useState, useRef, useEffect } from 'react';
import CommandPanel from '@/components/CommandPanel';
import ActivityFeed from '@/components/ActivityFeed';
import FinalReport from '@/components/FinalReport';
import AuditLog from '@/components/AuditLog';
import StatusBar from '@/components/StatusBar';
import { AgentEvent, AgentReport } from '@/types/agent';

const QUICK_COMMANDS = [
  {
    id: 'urgent',
    emoji: '🚨',
    label: 'Handle Urgent Issues',
    color: 'red' as const,
    command: 'Find anything critical in the last 24 hours and take appropriate action.',
  },
  {
    id: 'release',
    emoji: '🚀',
    label: 'Release Readiness',
    color: 'yellow' as const,
    command: 'Determine whether we are ready to release today. Check all blockers.',
  },
  {
    id: 'sprint',
    emoji: '📋',
    label: 'Sprint Preparation',
    color: 'green' as const,
    command: 'Analyze our current backlog and prepare a prioritized plan for the next sprint.',
  },
];

export default function Home() {
  const [command, setCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [auditLog, setAuditLog] = useState<AgentEvent[]>([]);
  const [sessionMemory, setSessionMemory] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'activity' | 'audit'>('activity');
  const abortRef = useRef<AbortController | null>(null);

  const addEvent = (event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
    setAuditLog((prev) => [...prev, event]);
  };

  const runAgent = async (cmd: string) => {
    if (!cmd.trim() || isRunning) return;

    setIsRunning(true);
    setEvents([]);
    setReport(null);
    setCommand('');

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, sessionMemory }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'event') {
              addEvent(parsed.event);
            } else if (parsed.type === 'report') {
              setReport(parsed.report);
              // Save any learned rules to session memory
              if (parsed.report.learnedRules) {
                setSessionMemory((prev) => [...prev, ...parsed.report.learnedRules]);
              }
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        addEvent({
          id: Date.now().toString(),
          type: 'error',
          message: `Agent error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      setIsRunning(false);
    }
  };

  const stopAgent = () => {
    abortRef.current?.abort();
    setIsRunning(false);
    addEvent({
      id: Date.now().toString(),
      type: 'system',
      message: 'Agent stopped by user.',
      timestamp: new Date().toISOString(),
    });
  };

  return (
    <div className="flex flex-col h-screen bg-ops-bg overflow-hidden">
      {/* Top bar */}
      <StatusBar isRunning={isRunning} sessionMemory={sessionMemory} />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Command center */}
        <div className="w-80 flex-shrink-0 flex flex-col border-r border-ops-border bg-ops-surface">
          <CommandPanel
            command={command}
            setCommand={setCommand}
            isRunning={isRunning}
            onRun={runAgent}
            onStop={stopAgent}
            quickCommands={QUICK_COMMANDS}
            sessionMemory={sessionMemory}
            onClearMemory={() => setSessionMemory([])}
          />
        </div>

        {/* Right panel — Activity + Result */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-ops-border bg-ops-surface">
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-5 py-3 text-xs font-mono uppercase tracking-wider transition-colors ${
                activeTab === 'activity'
                  ? 'text-ops-accent border-b-2 border-ops-accent bg-ops-bg'
                  : 'text-ops-muted hover:text-gray-300'
              }`}
            >
              ⚡ Live Activity
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-5 py-3 text-xs font-mono uppercase tracking-wider transition-colors ${
                activeTab === 'audit'
                  ? 'text-ops-accent border-b-2 border-ops-accent bg-ops-bg'
                  : 'text-ops-muted hover:text-gray-300'
              }`}
            >
              📋 Audit Log
              {auditLog.length > 0 && (
                <span className="ml-2 text-xs bg-ops-border px-1.5 py-0.5 rounded text-gray-400">
                  {auditLog.length}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeTab === 'activity' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <ActivityFeed events={events} isRunning={isRunning} />
                {report && <FinalReport report={report} />}
              </div>
            )}
            {activeTab === 'audit' && <AuditLog events={auditLog} />}
          </div>
        </div>
      </div>
    </div>
  );
}
