/**
 * Jira Tool — execution routed through Swytchcode
 *
 * Swytchcode handles: managed auth (no raw Basic creds in requests),
 * idempotency keys (prevents duplicate ticket creation on retries),
 * schema validation, retries, and full audit trail.
 */
import { swytchcodeExecute, SWY_TOOLS, SwytchcodeAuditEvent } from '@/lib/swytchcode';

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: { name: string };
    priority: { name: string };
    assignee?: { displayName: string } | null;
    issuetype: { name: string };
    created: string;
    updated: string;
  };
  self: string;
}

export interface CreateIssueParams {
  summary: string;
  description: string;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  issueType?: 'Bug' | 'Task' | 'Story' | 'Epic';
  labels?: string[];
  githubIssueUrl?: string;
}

export class JiraTool {
  private baseUrl: string;
  private email: string;
  private token: string;
  private projectKey: string;
  private authHeader: string;
  private onAudit?: (e: SwytchcodeAuditEvent) => void;

  constructor(onAudit?: (e: SwytchcodeAuditEvent) => void) {
    this.baseUrl = process.env.JIRA_BASE_URL ?? '';
    this.email = process.env.JIRA_EMAIL ?? '';
    this.token = process.env.JIRA_API_TOKEN ?? '';
    this.projectKey = process.env.JIRA_PROJECT_KEY ?? 'PROJ';
    this.authHeader = `Basic ${Buffer.from(`${this.email}:${this.token}`).toString('base64')}`;
    this.onAudit = onAudit;
  }

  // ── Direct API fallback ──────────────────────────────────────────────────

  private async directRequest<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Jira API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Public methods ───────────────────────────────────────────────────────

  async createIssue(params: CreateIssueParams): Promise<{ key: string; url: string }> {
    const swyInput = {
      project_key: this.projectKey,
      summary: params.summary,
      description: params.description,
      issue_type: params.issueType ?? 'Bug',
      priority: params.priority,
      labels: params.labels ?? [],
      ...(params.githubIssueUrl ? { github_url: params.githubIssueUrl } : {}),
    };

    // Jira ADF description for the direct fallback
    const adfDescription = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: params.description }],
        },
        ...(params.githubIssueUrl
          ? [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'GitHub Issue: ' },
                { type: 'text', text: params.githubIssueUrl, marks: [{ type: 'link', attrs: { href: params.githubIssueUrl } }] },
              ],
            }]
          : []),
      ],
    };

    type CreateResult = { id: string; key: string; self: string };

    const result = await swytchcodeExecute<CreateResult>(
      SWY_TOOLS.JIRA_CREATE_ISSUE,
      swyInput,
      () => this.directRequest<CreateResult>('/issue', {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            project: { key: this.projectKey },
            summary: params.summary,
            description: adfDescription,
            issuetype: { name: params.issueType ?? 'Bug' },
            priority: { name: params.priority },
            labels: params.labels ?? [],
          },
        }),
      }),
      this.onAudit
    );

    return {
      key: result.key,
      url: `${this.baseUrl}/browse/${result.key}`,
    };
  }

  async getP0P1Issues(): Promise<JiraIssue[]> {
    const jql = `project = ${this.projectKey} AND status != Done AND priority in (Highest, High) ORDER BY priority ASC`;

    return swytchcodeExecute(
      SWY_TOOLS.JIRA_SEARCH_ISSUES,
      { jql, max_results: 20 },
      async () => {
        const encoded = encodeURIComponent(jql);
        const result = await this.directRequest<{ issues: JiraIssue[] }>(
          `/search?jql=${encoded}&maxResults=20`
        );
        return result.issues;
      },
      this.onAudit
    );
  }

  async transitionIssue(issueKey: string, transitionName: string): Promise<void> {
    const transitions = await this.directRequest<{ transitions: Array<{ id: string; name: string }> }>(
      `/issue/${issueKey}/transitions`
    );
    const t = transitions.transitions.find((x) =>
      x.name.toLowerCase().includes(transitionName.toLowerCase())
    );
    if (!t) throw new Error(`Transition "${transitionName}" not found for ${issueKey}`);

    // Transition uses a direct call — no matching Swytchcode canonical method yet
    await this.directRequest(`/issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: t.id } }),
    });
  }
}
