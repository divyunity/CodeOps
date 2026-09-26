/**
 * Swytchcode Execution Layer
 *
 * This module is the single gateway between the CodeOps agent and all external APIs.
 * Instead of calling GitHub/Jira/Slack directly, every tool call goes through
 * SwytchcodeRuntime which handles:
 *   - Authentication (OAuth, API tokens, managed credentials)
 *   - Schema validation against live provider schemas
 *   - Automatic retries with exponential backoff
 *   - Idempotency keys on mutating requests
 *   - Policy enforcement (prevent destructive ops)
 *   - Full audit trail of every execution
 *
 * Architecture:
 *   OpenAI (reasons + decides) -> SwytchcodeExecutor (executes) -> GitHub/Jira/Slack
 */

// SwytchcodeRuntime is loaded lazily so the app still starts if the CLI hasn't
// been bootstrapped yet — we fall back to direct API calls in that case.
let swx: SwytchcodeClient | null = null;
let runtimeAvailable = false;

interface SwytchcodeClient {
  tools: {
    execute(canonical_id: string, args?: Record<string, unknown>): Promise<unknown>;
  };
}

async function getRuntime(): Promise<SwytchcodeClient | null> {
  if (runtimeAvailable) return swx;
  try {
    const { Swytchcode } = await import('@swytchcode/runtime');
    swx = new Swytchcode() as unknown as SwytchcodeClient;
    runtimeAvailable = true;
    console.log('[Swytchcode] Runtime loaded — tool calls routed through Swytchcode execution layer');
    return swx;
  } catch {
    console.warn('[Swytchcode] Runtime not available — falling back to direct API calls.');
    runtimeAvailable = false;
    return null;
  }
}

/**
 * Execute a tool through Swytchcode's execution pipeline.
 * Falls back to the provided fallbackFn if runtime is not available OR if auth fails.
 */
export async function swytchcodeExecute<T>(
  toolId: string,
  input: Record<string, unknown>,
  fallbackFn: () => Promise<T>,
  onAudit?: (event: SwytchcodeAuditEvent) => void
): Promise<T> {
  const rt = await getRuntime();

  if (rt) {
    try {
      const startMs = Date.now();

      onAudit?.({
        tool: toolId,
        input,
        status: 'executing',
        timestamp: new Date().toISOString(),
        layer: 'swytchcode',
      });

      const result = await rt.tools.execute(toolId, input);

      onAudit?.({
        tool: toolId,
        input,
        status: 'success',
        durationMs: Date.now() - startMs,
        timestamp: new Date().toISOString(),
        layer: 'swytchcode',
      });

      return result as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthError = msg.includes('missing credentials') || msg.includes('auth connect') || msg.includes('SWY-ERR');

      if (isAuthError) {
        // Silently fall through to direct API — Swytchcode OAuth not connected yet
        onAudit?.({
          tool: toolId,
          input,
          status: 'fallback',
          timestamp: new Date().toISOString(),
          layer: 'direct',
        });
      } else {
        onAudit?.({
          tool: toolId,
          input,
          status: 'error',
          error: msg,
          timestamp: new Date().toISOString(),
          layer: 'swytchcode',
        });
        throw err;
      }
    }
  } else {
    onAudit?.({
      tool: toolId,
      input,
      status: 'fallback',
      timestamp: new Date().toISOString(),
      layer: 'direct',
    });
  }

  return fallbackFn();
}

export interface SwytchcodeAuditEvent {
  tool: string;
  input: Record<string, unknown>;
  status: 'executing' | 'success' | 'error' | 'fallback';
  durationMs?: number;
  error?: string;
  timestamp: string;
  layer: 'swytchcode' | 'direct';
}

/**
 * Canonical Swytchcode tool IDs for the integrations CodeOps uses.
 * Verified against `swy list methods` after `swy get github/jira/slack`.
 *
 * github.issue.get1  = List repository issues (GET /repos/{owner}/{repo}/issues)
 * github.issue.get2  = Get a single issue    (GET /repos/{owner}/{repo}/issues/{number})
 * github.issue.create = Create an issue
 * github.issue.labels.create = Add labels to issue
 * github.pull.get   = Get a pull request / list PRs
 * jira.api.issue.create = Create Jira issue
 * jira.api.issue.get    = Get Jira issue
 * jira.api.search.list  = JQL search (GET /rest/api/3/search)
 * slack.chat.postmessage.create = Post a Slack message
 */
export const SWY_TOOLS = {
  // GitHub
  GITHUB_LIST_ISSUES:   'github.issue.get1',       // List repo issues
  GITHUB_GET_ISSUE:     'github.issue.get2',        // Get single issue
  GITHUB_CREATE_ISSUE:  'github.issue.create',      // Create issue
  GITHUB_ADD_LABEL:     'github.issue.labels.create',
  GITHUB_LIST_PRS:      'github.pull.get',          // List / get PRs

  // Jira
  JIRA_CREATE_ISSUE:    'jira.api.issue.create',
  JIRA_GET_ISSUE:       'jira.api.issue.get',
  JIRA_SEARCH_ISSUES:   'jira.api.search.list',     // JQL search

  // Slack
  SLACK_POST_MESSAGE:   'slack.chat.postmessage.create',
} as const;

export type SwyToolId = typeof SWY_TOOLS[keyof typeof SWY_TOOLS];
