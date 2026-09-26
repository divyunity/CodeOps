import { GitHubIssue } from '@/tools/github';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Action = 'create_jira' | 'escalate' | 'monitor' | 'ignore';

export interface TriageDecision {
  severity: Severity;
  action: Action;
  jiraPriority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  reason: string;
  escalate: boolean;
}

// Keywords that signal severity levels
const CRITICAL_KEYWORDS = [
  'critical', 'crash', 'data loss', 'security', 'vulnerability', 'exploit',
  'payment', 'billing', 'authentication', 'auth', 'production down', 'outage',
  'severity: critical', 'p0', '[critical]', 'regression', 'broken prod',
  'infinite loop', 'memory leak', 'sql injection', 'xss', 'rce', 'remote code',
];

const HIGH_KEYWORDS = [
  'high', 'urgent', 'important', 'performance', 'slow', 'timeout',
  'failure', 'broken', 'not working', 'cant login', "can't login", 'blocker',
  'blocks', 'blocking', 'database', 'api down', 'error 500', '500 error',
  'p1', '[high]', 'serious',
];

const LOW_SIGNAL_KEYWORDS = [
  'documentation', 'docs', 'typo', 'spelling', 'cosmetic', 'style',
  'minor', 'nice to have', 'enhancement', 'chore', 'refactor', 'cleanup',
  'rename', 'comment', 'whitespace', 'formatting',
];

const FEATURE_KEYWORDS = [
  'feature request', 'feature:', 'feat:', 'suggestion', 'proposal',
  'idea', 'would be great', 'enhancement', 'new feature', 'add support for',
];

export function classifyIssue(
  issue: GitHubIssue,
  sessionRules: string[] = []
): TriageDecision {
  const text = `${issue.title} ${issue.body ?? ''}`.toLowerCase();
  const labelNames = issue.labels.map((l) => l.name.toLowerCase());

  // Check session memory rules first
  for (const rule of sessionRules) {
    const ruleLower = rule.toLowerCase();
    if (ruleLower.includes('don\'t escalate') || ruleLower.includes('do not escalate')) {
      // Extract what not to escalate
      const match = rule.match(/(?:don'?t escalate|do not escalate)\s+(\w+)/i);
      if (match && text.includes(match[1].toLowerCase())) {
        return {
          severity: 'LOW',
          action: 'ignore',
          jiraPriority: 'Lowest',
          reason: `Skipped per session rule: "${rule}"`,
          escalate: false,
        };
      }
    }
  }

  // Check label-based severity overrides
  if (labelNames.some((l) => l.includes('critical') || l.includes('p0'))) {
    return {
      severity: 'CRITICAL',
      action: 'create_jira',
      jiraPriority: 'Highest',
      reason: 'Issue labelled as critical/P0.',
      escalate: true,
    };
  }

  if (labelNames.some((l) => l.includes('security') || l.includes('vulnerability'))) {
    return {
      severity: 'CRITICAL',
      action: 'create_jira',
      jiraPriority: 'Highest',
      reason: 'Security vulnerability label detected.',
      escalate: true,
    };
  }

  // Low-signal / feature checks first to avoid false positives
  const isLowSignal = LOW_SIGNAL_KEYWORDS.some((kw) => text.includes(kw));
  const isFeature = FEATURE_KEYWORDS.some((kw) => text.includes(kw)) ||
    labelNames.some((l) => l.includes('feature') || l.includes('enhancement'));

  if (isFeature) {
    return {
      severity: 'LOW',
      action: 'ignore',
      jiraPriority: 'Lowest',
      reason: 'Feature request — no immediate action needed.',
      escalate: false,
    };
  }

  if (isLowSignal && !labelNames.some((l) => l.includes('bug'))) {
    return {
      severity: 'LOW',
      action: 'ignore',
      jiraPriority: 'Lowest',
      reason: 'Documentation or cosmetic issue — low priority.',
      escalate: false,
    };
  }

  // Severity scoring
  let critScore = CRITICAL_KEYWORDS.filter((kw) => text.includes(kw)).length;
  let highScore = HIGH_KEYWORDS.filter((kw) => text.includes(kw)).length;

  // Boost score for unassigned issues with comments
  if (!issue.assignee && issue.comments > 3) highScore += 1;

  // Stale detection boost
  const updatedDaysAgo = (Date.now() - new Date(issue.updated_at).getTime()) / 86400000;
  if (updatedDaysAgo > 3) highScore += 1;
  if (updatedDaysAgo > 7) critScore += 1;

  if (critScore >= 1) {
    return {
      severity: 'CRITICAL',
      action: 'create_jira',
      jiraPriority: 'Highest',
      reason: `Critical signals detected: ${CRITICAL_KEYWORDS.filter((kw) => text.includes(kw)).join(', ')}.`,
      escalate: true,
    };
  }

  if (highScore >= 2) {
    return {
      severity: 'HIGH',
      action: 'create_jira',
      jiraPriority: 'High',
      reason: `High-priority signals: ${HIGH_KEYWORDS.filter((kw) => text.includes(kw)).slice(0, 3).join(', ')}.`,
      escalate: false,
    };
  }

  if (highScore === 1 || labelNames.some((l) => l.includes('bug'))) {
    return {
      severity: 'MEDIUM',
      action: 'monitor',
      jiraPriority: 'Medium',
      reason: 'Bug reported — monitoring; no immediate escalation required.',
      escalate: false,
    };
  }

  return {
    severity: 'LOW',
    action: 'ignore',
    jiraPriority: 'Low',
    reason: 'Normal priority issue — no action needed.',
    escalate: false,
  };
}

export function buildJiraDescription(issue: GitHubIssue, decision: TriageDecision): string {
  const age = Math.round((Date.now() - new Date(issue.created_at).getTime()) / 3600000);
  return [
    `[Auto-triaged by CodeOps Agent]`,
    ``,
    `Severity: ${decision.severity}`,
    `Triage Reason: ${decision.reason}`,
    ``,
    `GitHub Issue: ${issue.html_url}`,
    `Reported by: @${issue.user.login}`,
    `Age: ${age} hours`,
    `Comments: ${issue.comments}`,
    ``,
    `--- Original Description ---`,
    issue.body?.slice(0, 2000) ?? '(no description)',
  ].join('\n');
}

export function shouldActOnIssue(decision: TriageDecision): boolean {
  return decision.action === 'create_jira' || decision.action === 'escalate';
}
