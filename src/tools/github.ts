/**
 * GitHub Tool — execution routed through Swytchcode
 *
 * Every method calls swytchcodeExecute(swyToolId, input, fallback).
 * When the Swytchcode runtime is available it handles auth, retries,
 * idempotency and audit. When it is not (CLI not yet bootstrapped)
 * the fallback makes the direct GitHub API call so the app still works.
 */
import { swytchcodeExecute, SWY_TOOLS, SwytchcodeAuditEvent } from '@/lib/swytchcode';

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
  user: { login: string };
  assignee: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  comments: number;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  draft: boolean;
  labels: Array<{ name: string }>;
  review_comments: number;
}

export class GitHubTool {
  private token: string;
  private owner: string;
  private repo: string;
  private baseUrl = 'https://api.github.com';
  private onAudit?: (e: SwytchcodeAuditEvent) => void;

  constructor(onAudit?: (e: SwytchcodeAuditEvent) => void) {
    this.token = process.env.GITHUB_TOKEN ?? '';
    this.owner = process.env.GITHUB_OWNER ?? '';
    this.repo = process.env.GITHUB_REPO ?? '';
    this.onAudit = onAudit;
  }

  // ── Direct API fallback ──────────────────────────────────────────────────

  private async directRequest<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Public methods — each routes through Swytchcode ─────────────────────

  async getRecentIssues(hours = 24): Promise<GitHubIssue[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return swytchcodeExecute(
      SWY_TOOLS.GITHUB_LIST_ISSUES,
      { owner: this.owner, repo: this.repo, state: 'open', since, per_page: 50, sort: 'created', direction: 'desc' },
      async () => {
        const issues = await this.directRequest<GitHubIssue[]>(
          `/repos/${this.owner}/${this.repo}/issues?state=open&since=${since}&per_page=50&sort=created&direction=desc`
        );
        return issues.filter((i) => !('pull_request' in i));
      },
      this.onAudit
    );
  }

  async getAllOpenIssues(): Promise<GitHubIssue[]> {
    return swytchcodeExecute(
      SWY_TOOLS.GITHUB_LIST_ISSUES,
      { owner: this.owner, repo: this.repo, state: 'open', per_page: 100, sort: 'updated', direction: 'desc' },
      async () => {
        const issues = await this.directRequest<GitHubIssue[]>(
          `/repos/${this.owner}/${this.repo}/issues?state=open&per_page=100&sort=updated&direction=desc`
        );
        return issues.filter((i) => !('pull_request' in i));
      },
      this.onAudit
    );
  }

  async getOpenPRs(): Promise<GitHubPR[]> {
    return swytchcodeExecute(
      SWY_TOOLS.GITHUB_LIST_PRS,
      { owner: this.owner, repo: this.repo, state: 'open', per_page: 50, sort: 'updated', direction: 'desc' },
      () => this.directRequest<GitHubPR[]>(
        `/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`
      ),
      this.onAudit
    );
  }

  async getStaleIssues(days = 3): Promise<GitHubIssue[]> {
    const all = await this.getAllOpenIssues();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return all.filter((issue) => new Date(issue.updated_at) < cutoff);
  }

  async getIssue(number: number): Promise<GitHubIssue> {
    return swytchcodeExecute(
      SWY_TOOLS.GITHUB_GET_ISSUE,
      { owner: this.owner, repo: this.repo, issue_number: number },
      () => this.directRequest<GitHubIssue>(`/repos/${this.owner}/${this.repo}/issues/${number}`),
      this.onAudit
    );
  }

  async addLabelToIssue(number: number, labels: string[]): Promise<void> {
    return swytchcodeExecute(
      SWY_TOOLS.GITHUB_ADD_LABEL,
      { owner: this.owner, repo: this.repo, issue_number: number, labels },
      async () => {
        await this.directRequest(`/repos/${this.owner}/${this.repo}/issues/${number}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels }),
        });
      },
      this.onAudit
    );
  }

  // ── Auto-fix helpers (branch → commit → PR) ─────────────────────────────

  async getDefaultBranch(): Promise<string> {
    const repo = await this.directRequest<{ default_branch: string }>(
      `/repos/${this.owner}/${this.repo}`
    );
    return repo.default_branch;
  }

  async getLatestCommitSha(branch: string): Promise<string> {
    const ref = await this.directRequest<{ object: { sha: string } }>(
      `/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`
    );
    return ref.object.sha;
  }

  async createBranch(branchName: string, fromSha: string): Promise<void> {
    await this.directRequest(`/repos/${this.owner}/${this.repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
    });
  }

  async getFileContents(filePath: string, branch: string): Promise<{ content: string; sha: string } | null> {
    try {
      const result = await this.directRequest<{ content: string; sha: string }>(
        `/repos/${this.owner}/${this.repo}/contents/${filePath}?ref=${branch}`
      );
      return {
        content: Buffer.from(result.content.replace(/\n/g, ''), 'base64').toString('utf-8'),
        sha: result.sha,
      };
    } catch {
      return null;
    }
  }

  async updateFile(params: {
    filePath: string;
    content: string;
    message: string;
    branch: string;
    fileSha: string;
  }): Promise<void> {
    await this.directRequest(`/repos/${this.owner}/${this.repo}/contents/${params.filePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        content: Buffer.from(params.content, 'utf-8').toString('base64'),
        sha: params.fileSha,
        branch: params.branch,
      }),
    });
  }

  async createPR(params: {
    title: string;
    body: string;
    branch: string;
    baseBranch: string;
  }): Promise<{ number: number; html_url: string }> {
    return this.directRequest(`/repos/${this.owner}/${this.repo}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.branch,
        base: params.baseBranch,
      }),
    });
  }

  async closeIssueWithComment(issueNumber: number, comment: string): Promise<void> {
    await this.directRequest(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: comment }),
    });
    await this.directRequest(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
  }

  getRepoUrl(): string {
    return `https://github.com/${this.owner}/${this.repo}`;
  }
}
