'use client';

import { AgentReport, IssueTriageResult } from '@/types/agent';

interface FinalReportProps {
  report: AgentReport;
}

const statusConfig = {
  READY:   { color: 'text-ops-green',  bg: 'bg-ops-green/10',  border: 'border-ops-green/40',  icon: '✅', label: 'READY TO RELEASE' },
  BLOCKED: { color: 'text-ops-red',    bg: 'bg-ops-red/10',    border: 'border-ops-red/40',    icon: '🚫', label: 'BLOCKED'         },
  PARTIAL: { color: 'text-ops-yellow', bg: 'bg-ops-yellow/10', border: 'border-ops-yellow/40', icon: '⚠️', label: 'PARTIAL'         },
  COMPLETE:{ color: 'text-ops-accent', bg: 'bg-ops-accent/10', border: 'border-ops-accent/40', icon: '✅', label: 'COMPLETE'        },
};

const severityColor = {
  CRITICAL: 'text-ops-red bg-ops-red/10 border-ops-red/30',
  HIGH:     'text-ops-yellow bg-ops-yellow/10 border-ops-yellow/30',
  MEDIUM:   'text-ops-accent bg-ops-accent/10 border-ops-accent/30',
  LOW:      'text-ops-muted bg-ops-border/20 border-ops-border',
};

function IssueCard({ issue }: { issue: IssueTriageResult }) {
  const sev = severityColor[issue.severity];
  return (
    <div className="border border-ops-border/50 rounded px-3 py-2.5 bg-ops-surface space-y-1">
      <div className="flex items-start justify-between gap-2">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-ops-accent hover:underline truncate"
        >
          #{issue.number} {issue.title}
        </a>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded border shrink-0 ${sev}`}>
          {issue.severity}
        </span>
      </div>
      <div className="text-xs text-ops-muted font-mono opacity-80">{issue.reason}</div>
      <div className="flex items-center gap-3 text-xs font-mono">
        {issue.jiraKey && (
          <span className="text-ops-green">🎫 {issue.jiraKey}</span>
        )}
        {issue.slackSent && (
          <span className="text-ops-yellow">📣 Slack notified</span>
        )}
        {issue.prUrl && issue.prNumber && (
          <a href={issue.prUrl} target="_blank" rel="noopener noreferrer"
             className="text-ops-accent hover:underline">
            🤖 PR #{issue.prNumber} opened
          </a>
        )}
        <span className={`ml-auto font-semibold ${
          issue.action === 'auto_fixed' ? 'text-ops-accent' :
          issue.action === 'ignore' ? 'text-ops-muted' : 'text-ops-green'
        }`}>
          {issue.action === 'auto_fixed' ? '🤖 auto-fixed' : issue.action.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}

export default function FinalReport({ report }: FinalReportProps) {
  const sc = statusConfig[report.status];

  return (
    <div className="border-t border-ops-border bg-ops-surface">
      {/* Collapsible header -- always visible */}
      <details open>
        <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-ops-bg/50 transition-colors">
          <span className="text-lg">{sc.icon}</span>
          <div className="flex-1">
            <div className={`text-sm font-mono font-bold ${sc.color}`}>
              AGENT RESULT · {sc.label}
            </div>
            <div className="text-xs text-ops-muted font-mono mt-0.5 opacity-80">
              {report.mode} · {new Date(report.timestamp).toLocaleTimeString()}
            </div>
          </div>
          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs font-mono">
            {report.findings.critical > 0 && (
              <span className="text-ops-red">🔴 {report.findings.critical} critical</span>
            )}
            {report.findings.high > 0 && (
              <span className="text-ops-yellow">🟡 {report.findings.high} high</span>
            )}
            <span className="text-ops-muted">↕</span>
          </div>
        </summary>

        <div className="px-4 pb-4 space-y-4 max-h-72 overflow-y-auto">
          {/* Summary */}
          <div className={`rounded border ${sc.border} ${sc.bg} px-3 py-2.5 text-sm font-mono ${sc.color}`}>
            {report.summary}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'Auto-Fixed', value: report.actions.autoFixed,   color: 'text-ops-accent' },
              { label: 'Jira',       value: report.actions.jiraCreated, color: 'text-ops-green' },
              { label: 'Slack',      value: report.actions.slackSent,   color: 'text-ops-yellow' },
              { label: 'Escalated',  value: report.actions.escalated,   color: 'text-ops-red' },
              { label: 'Ignored',    value: report.actions.ignored,     color: 'text-ops-muted' },
            ].map((s) => (
              <div key={s.label} className="bg-ops-bg border border-ops-border rounded px-2 py-2 text-center">
                <div className={`text-lg font-mono font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-ops-muted mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Blockers */}
          {report.blockers && report.blockers.length > 0 && (
            <div>
              <div className="text-xs font-mono text-ops-red uppercase tracking-widest mb-1.5">
                🚫 Blockers
              </div>
              {report.blockers.map((b, i) => (
                <div key={i} className="text-xs font-mono text-ops-red bg-ops-red/5 border border-ops-red/20 rounded px-2 py-1 mb-1">
                  {b}
                </div>
              ))}
            </div>
          )}

          {/* Recommendation */}
          {report.recommendation && (
            <div className="text-xs font-mono text-ops-muted bg-ops-bg border border-ops-border rounded px-3 py-2">
              <span className="text-ops-accent">→ Recommended: </span>
              {report.recommendation}
            </div>
          )}

          {/* Issue cards */}
          {report.issues.length > 0 && (
            <div>
              <div className="text-xs font-mono text-ops-muted uppercase tracking-widest mb-2">
                Issues Handled ({report.issues.length})
              </div>
              <div className="space-y-2">
                {report.issues.map((issue) => (
                  <IssueCard key={issue.number} issue={issue} />
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
