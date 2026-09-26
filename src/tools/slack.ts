/**
 * Slack Tool — execution routed through Swytchcode
 *
 * Swytchcode handles auth token management, retries on rate-limits,
 * and logs every message in the audit trail.
 */
import { swytchcodeExecute, SWY_TOOLS, SwytchcodeAuditEvent } from '@/lib/swytchcode';

export interface SlackMessageOptions {
  channel?: string;
  text: string;
  blocks?: SlackBlock[];
  username?: string;
  iconEmoji?: string;
}

export type SlackBlock =
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' }
  | { type: 'header'; text: { type: 'plain_text'; text: string } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> };

export class SlackTool {
  private token: string;
  private defaultChannel: string;
  private onAudit?: (e: SwytchcodeAuditEvent) => void;

  constructor(onAudit?: (e: SwytchcodeAuditEvent) => void) {
    this.token = process.env.SLACK_BOT_TOKEN ?? '';
    this.defaultChannel = process.env.SLACK_CHANNEL_ID ?? '';
    this.onAudit = onAudit;
  }

  // ── Direct API fallback ──────────────────────────────────────────────────

  private async directRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://slack.com/api/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Slack API HTTP error: ${res.status}`);
    const data = await res.json() as { ok: boolean; error?: string; ts?: string };
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data as T;
  }

  // ── Public methods ───────────────────────────────────────────────────────

  async sendMessage(options: SlackMessageOptions): Promise<{ ts: string }> {
    const channel = options.channel ?? this.defaultChannel;
    const payload = {
      channel,
      text: options.text,
      ...(options.blocks ? { blocks: options.blocks } : {}),
      username: options.username ?? 'CodeOps Agent',
      icon_emoji: options.iconEmoji ?? ':robot_face:',
    };

    return swytchcodeExecute<{ ts: string }>(
      SWY_TOOLS.SLACK_POST_MESSAGE,
      payload,
      () => this.directRequest<{ ts: string }>('chat.postMessage', payload),
      this.onAudit
    );
  }

  async sendCriticalAlert(params: {
    issueTitle: string;
    issueUrl: string;
    jiraKey: string;
    jiraUrl: string;
    severity: string;
    reason: string;
  }): Promise<void> {
    const emoji = params.severity === 'CRITICAL' ? '🚨' : '⚠️';

    await this.sendMessage({
      text: `${emoji} ${params.severity} issue detected: ${params.issueTitle}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${emoji} ${params.severity} Issue Detected` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*<${params.issueUrl}|${params.issueTitle}>*\n${params.reason}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `🎫 Jira ticket created: *<${params.jiraUrl}|${params.jiraKey}>*` },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Triaged by CodeOps Agent • ${new Date().toLocaleString()}` }],
        },
      ],
    });
  }

  async sendReleaseAssessment(params: {
    ready: boolean;
    blockers: string[];
    actions: string[];
    recommendation: string;
  }): Promise<void> {
    const status = params.ready ? '✅ READY TO RELEASE' : '❌ RELEASE BLOCKED';

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${params.ready ? '✅' : '❌'} Release Assessment` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Status: ${status}*` },
      },
    ];

    if (params.blockers.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Blockers:*\n${params.blockers.map((b) => `• ${b}`).join('\n')}` },
      });
    }

    if (params.actions.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Actions taken:*\n${params.actions.map((a) => `✓ ${a}`).join('\n')}` },
      });
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommendation:* ${params.recommendation}` },
    });

    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `CodeOps Release Check • ${new Date().toLocaleString()}` }],
    });

    await this.sendMessage({ text: `Release Assessment: ${status}`, blocks });
  }

  async sendSprintSummary(params: {
    sprintName: string;
    items: Array<{ key: string; title: string; priority: string }>;
    totalItems: number;
  }): Promise<void> {
    const topItems = params.items.slice(0, 5);

    await this.sendMessage({
      text: `📋 Sprint prepared: ${params.totalItems} items prioritized`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📋 Sprint Preparation Complete' },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${params.totalItems} items* prioritized for the next sprint` },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Top priorities:*\n${topItems.map((i) => `• \`${i.key}\` ${i.title} _(${i.priority})_`).join('\n')}`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `CodeOps Sprint Assistant • ${new Date().toLocaleString()}` }],
        },
      ],
    });
  }
}
