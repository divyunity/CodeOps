export type EventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'decision'
  | 'action'
  | 'success'
  | 'warning'
  | 'error'
  | 'system'
  | 'verify';

export interface AgentEvent {
  id: string;
  type: EventType;
  message: string;
  detail?: string;
  tool?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface IssueTriageResult {
  number: number;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  action: 'create_jira' | 'escalate' | 'monitor' | 'ignore' | 'auto_fixed';
  labels: string[];
  url: string;
  author: string;
  createdAt: string;
  jiraKey?: string;
  slackSent?: boolean;
  prUrl?: string;
  prNumber?: number;
}

export interface AgentReport {
  mode: string;
  summary: string;
  status: 'READY' | 'BLOCKED' | 'PARTIAL' | 'COMPLETE';
  findings: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  actions: {
    jiraCreated: number;
    slackSent: number;
    escalated: number;
    ignored: number;
    autoFixed: number;
  };
  issues: IssueTriageResult[];
  recommendation?: string;
  blockers?: string[];
  learnedRules?: string[];
  timestamp: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface SessionMemory {
  rules: string[];
  context: Record<string, string>;
}
