import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { GitHubTool } from '@/tools/github';
import { JiraTool } from '@/tools/jira';
import { SlackTool } from '@/tools/slack';
import { classifyIssue, buildJiraDescription, shouldActOnIssue } from '@/lib/decision-engine';
import { assessFixEligibility, generateFix } from '@/lib/auto-fix';
import { AgentEvent, AgentReport, IssueTriageResult } from '@/types/agent';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// SSE helpers
function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function makeEvent(
  type: AgentEvent['type'],
  message: string,
  opts?: { tool?: string; detail?: string; data?: Record<string, unknown> }
): AgentEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    message,
    timestamp: new Date().toISOString(),
    ...opts,
  };
}

// OpenAI tool definitions
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_recent_github_issues',
      description: 'Fetch GitHub issues created or updated in the last N hours.',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'How many hours back to look (default 24)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_all_open_issues',
      description: 'Fetch all open GitHub issues for full backlog analysis.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_open_prs',
      description: 'Fetch all open pull requests from GitHub.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stale_issues',
      description: 'Find GitHub issues with no activity for N days (potential blockers).',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Days since last update (default 3)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_jira_blockers',
      description: 'Fetch open P0/P1 Jira tickets that may block a release.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_jira_ticket',
      description: 'Create a Jira ticket for a critical/high GitHub issue.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Ticket title' },
          description: { type: 'string', description: 'Full ticket description' },
          priority: {
            type: 'string',
            enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
            description: 'Jira priority',
          },
          issue_type: {
            type: 'string',
            enum: ['Bug', 'Task', 'Story'],
            description: 'Jira issue type',
          },
          github_url: { type: 'string', description: 'GitHub issue URL for reference' },
        },
        required: ['summary', 'description', 'priority'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_slack_alert',
      description: 'Send an alert to the engineering Slack channel.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send' },
          severity: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'INFO'],
            description: 'Alert severity level',
          },
        },
        required: ['message', 'severity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'triage_and_act',
      description:
        'Classify a list of GitHub issues by severity and take appropriate action (create Jira, escalate, or auto-fix) based on the session rules. For MEDIUM/LOW issues, the agent will attempt an autonomous code fix and open a PR.',
      parameters: {
        type: 'object',
        properties: {
          issue_numbers: {
            type: 'array',
            items: { type: 'number' },
            description: 'GitHub issue numbers to triage',
          },
        },
        required: ['issue_numbers'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_final_report',
      description: 'Generate and send the final structured report to Slack after all actions are complete.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', description: 'Agent mode (urgent/release/sprint)' },
          summary: { type: 'string', description: 'Executive summary of what was done' },
          release_ready: { type: 'boolean', description: 'For release check: is it ready?' },
          blockers: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of blocking issues',
          },
          recommendation: { type: 'string', description: 'Recommended next action' },
        },
        required: ['mode', 'summary'],
      },
    },
  },
];

// Tool executor
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: {
    github: GitHubTool;
    jira: JiraTool;
    slack: SlackTool;
    sessionRules: string[];
    triageResults: IssueTriageResult[];
    issueCache: Map<number, import('@/tools/github').GitHubIssue>;
    emit: (event: AgentEvent) => void;
  }
): Promise<string> {
  const { github, jira, slack, sessionRules, triageResults, issueCache, emit } = ctx;

  switch (toolName) {
    case 'get_recent_github_issues': {
      const hours = (args.hours as number) ?? 24;
      emit(makeEvent('tool_call', `Fetching GitHub issues from the last ${hours}h...`, { tool: 'GitHub' }));
      const issues = await github.getRecentIssues(hours);
      issues.forEach((i) => issueCache.set(i.number, i));
      emit(makeEvent('tool_result', `Retrieved ${issues.length} recent issues.`, { tool: 'GitHub' }));
      return JSON.stringify(issues.map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), author: i.user.login, created: i.created_at, url: i.html_url })));
    }

    case 'get_all_open_issues': {
      emit(makeEvent('tool_call', 'Fetching all open GitHub issues...', { tool: 'GitHub' }));
      const issues = await github.getAllOpenIssues();
      issues.forEach((i) => issueCache.set(i.number, i));
      emit(makeEvent('tool_result', `Found ${issues.length} open issues in backlog.`, { tool: 'GitHub' }));
      return JSON.stringify(issues.map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), author: i.user.login, assignee: i.assignee?.login ?? null, updated: i.updated_at, url: i.html_url })));
    }

    case 'get_open_prs': {
      emit(makeEvent('tool_call', 'Fetching open pull requests...', { tool: 'GitHub' }));
      const prs = await github.getOpenPRs();
      emit(makeEvent('tool_result', `Found ${prs.length} open PRs.`, { tool: 'GitHub' }));
      return JSON.stringify(prs.map((p) => ({ number: p.number, title: p.title, author: p.user.login, draft: p.draft, labels: p.labels.map((l) => l.name), updated: p.updated_at, url: p.html_url })));
    }

    case 'get_stale_issues': {
      const days = (args.days as number) ?? 3;
      emit(makeEvent('tool_call', `Detecting issues stale for ${days}+ days...`, { tool: 'GitHub' }));
      const stale = await github.getStaleIssues(days);
      stale.forEach((i) => issueCache.set(i.number, i));
      emit(makeEvent(stale.length > 0 ? 'warning' : 'tool_result', `${stale.length} stale issues found.`, { tool: 'GitHub' }));
      return JSON.stringify(stale.map((i) => ({ number: i.number, title: i.title, daysStale: Math.round((Date.now() - new Date(i.updated_at).getTime()) / 86400000), assignee: i.assignee?.login ?? 'unassigned', url: i.html_url })));
    }

    case 'get_jira_blockers': {
      emit(makeEvent('tool_call', 'Querying Jira for P0/P1 open tickets...', { tool: 'Jira' }));
      const issues = await jira.getP0P1Issues();
      emit(makeEvent(issues.length > 0 ? 'warning' : 'tool_result', `${issues.length} high-priority Jira tickets found.`, { tool: 'Jira' }));
      return JSON.stringify(issues.map((i) => ({ key: i.key, summary: i.fields.summary, status: i.fields.status.name, priority: i.fields.priority.name, assignee: i.fields.assignee?.displayName ?? 'unassigned' })));
    }

    case 'create_jira_ticket': {
      emit(makeEvent('action', `Creating Jira ticket: "${args.summary}"`, { tool: 'Jira' }));
      const result = await jira.createIssue({
        summary: args.summary as string,
        description: args.description as string,
        priority: args.priority as 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest',
        issueType: (args.issue_type as 'Bug' | 'Task' | 'Story') ?? 'Bug',
        githubIssueUrl: args.github_url as string | undefined,
      });
      emit(makeEvent('success', `Jira ticket created: ${result.key}`, { tool: 'Jira', detail: result.url }));
      return JSON.stringify({ key: result.key, url: result.url, success: true });
    }

    case 'send_slack_alert': {
      emit(makeEvent('action', `Sending ${args.severity} alert to Slack...`, { tool: 'Slack' }));
      await slack.sendMessage({ text: `${args.severity === 'CRITICAL' ? '🚨' : args.severity === 'HIGH' ? '⚠️' : 'ℹ️'} ${args.message}` });
      emit(makeEvent('success', 'Slack notification sent.', { tool: 'Slack' }));
      return JSON.stringify({ success: true });
    }

    case 'triage_and_act': {
      const numbers = args.issue_numbers as number[];
      emit(makeEvent('thinking', `Triaging ${numbers.length} issues through decision engine...`));

      let critical = 0, high = 0, medium = 0, low = 0;
      let jiraCreated = 0, slackSent = 0, autoFixed = 0;

      for (const num of numbers) {
        let issue = issueCache.get(num);
        if (!issue) {
          try {
            issue = await github.getIssue(num);
            issueCache.set(num, issue);
          } catch {
            emit(makeEvent('error', `Could not fetch issue #${num}`));
            continue;
          }
        }

        const decision = classifyIssue(issue, sessionRules);
        const severityEmoji = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪' }[decision.severity];

        emit(makeEvent(
          decision.severity === 'CRITICAL' ? 'warning' : decision.severity === 'HIGH' ? 'warning' : 'thinking',
          `${severityEmoji} #${issue.number}: ${issue.title.slice(0, 60)} → ${decision.severity}`,
          { detail: decision.reason }
        ));

        const result: IssueTriageResult = {
          number: issue.number,
          title: issue.title,
          severity: decision.severity,
          reason: decision.reason,
          action: decision.action,
          labels: issue.labels.map((l) => l.name),
          url: issue.html_url,
          author: issue.user.login,
          createdAt: issue.created_at,
        };

        if (decision.severity === 'CRITICAL') critical++;
        else if (decision.severity === 'HIGH') high++;
        else if (decision.severity === 'MEDIUM') medium++;
        else low++;

        if (shouldActOnIssue(decision)) {
          try {
            const description = buildJiraDescription(issue, decision);
            const jiraResult = await jira.createIssue({
              summary: `[${decision.severity}] ${issue.title}`,
              description,
              priority: decision.jiraPriority,
              issueType: 'Bug',
              githubIssueUrl: issue.html_url,
            });
            result.jiraKey = jiraResult.key;
            jiraCreated++;
            emit(makeEvent('success', `Jira ${jiraResult.key} created for #${issue.number}`, { tool: 'Jira', detail: jiraResult.url }));

            if (decision.escalate) {
              await slack.sendCriticalAlert({
                issueTitle: issue.title,
                issueUrl: issue.html_url,
                jiraKey: jiraResult.key,
                jiraUrl: jiraResult.url,
                severity: decision.severity,
                reason: decision.reason,
              });
              result.slackSent = true;
              slackSent++;
              emit(makeEvent('success', `Slack escalation sent for #${issue.number}`, { tool: 'Slack' }));
            }
          } catch (err) {
            emit(makeEvent('error', `Failed to act on #${issue.number}: ${err instanceof Error ? err.message : 'Unknown'}`));
          }
        } else {
          // For MEDIUM/LOW issues — attempt autonomous fix
          const eligibility = assessFixEligibility(issue, decision.severity);

          if (eligibility.eligible) {
            emit(makeEvent('thinking', `🤖 #${issue.number}: Attempting autonomous fix (${eligibility.fixType})...`));
            try {
              const fix = await generateFix(issue, eligibility);

              if (fix) {
                emit(makeEvent('action', `🔧 Generated fix for ${fix.filePath}`, { detail: fix.explanation }));

                // Get default branch + SHA
                const defaultBranch = await github.getDefaultBranch();
                const baseSha = await github.getLatestCommitSha(defaultBranch);

                // Create fix branch
                const branchName = `codeops/fix-issue-${issue.number}-${Date.now().toString(36)}`;
                await github.createBranch(branchName, baseSha);
                emit(makeEvent('action', `Created branch: ${branchName}`, { tool: 'GitHub' }));

                // Get file and apply patch
                const file = await github.getFileContents(fix.filePath, defaultBranch);
                if (file && fix.oldCode && file.content.includes(fix.oldCode)) {
                  const patchedContent = file.content.replace(fix.oldCode, fix.newCode);
                  await github.updateFile({
                    filePath: fix.filePath,
                    content: patchedContent,
                    message: fix.commitMessage,
                    branch: branchName,
                    fileSha: file.sha,
                  });
                  emit(makeEvent('action', `Committed fix to ${fix.filePath}`, { tool: 'GitHub' }));

                  // Open PR
                  const pr = await github.createPR({
                    title: `fix: ${issue.title} (closes #${issue.number})`,
                    body: `## 🤖 Autonomous Fix by CodeOps\n\n**Issue:** #${issue.number} — ${issue.title}\n**Fix:** ${fix.explanation}\n\n**Severity:** ${decision.severity}\n**Fix type:** ${eligibility.fixType}\n\nThis PR was opened automatically by CodeOps. Please review before merging.\n\nCloses #${issue.number}`,
                    branch: branchName,
                    baseBranch: defaultBranch,
                  });

                  result.prUrl = pr.html_url;
                  result.prNumber = pr.number;
                  result.action = 'auto_fixed' as typeof result.action;
                  autoFixed++;
                  emit(makeEvent('success', `✅ PR #${pr.number} opened for auto-fix of #${issue.number}`, { tool: 'GitHub', detail: pr.html_url }));

                  // Post comment on issue
                  await github.closeIssueWithComment(
                    issue.number,
                    `🤖 **CodeOps Auto-Fix**\n\nI've analyzed this issue and applied an autonomous fix.\n\n**What changed:** ${fix.explanation}\n\nPR opened: ${pr.html_url}\n\nPlease review and merge if the fix looks correct.`
                  );
                } else {
                  emit(makeEvent('system', `#${issue.number}: File not found or code snippet mismatch — skipping patch.`));
                  result.action = 'monitor';
                }
              } else {
                emit(makeEvent('system', `#${issue.number}: AI could not produce a safe patch — marked for monitoring.`));
                result.action = 'monitor';
              }
            } catch (err) {
              emit(makeEvent('warning', `#${issue.number}: Auto-fix failed — ${err instanceof Error ? err.message : 'Unknown'}. Monitoring.`));
              result.action = 'monitor';
            }
          } else {
            emit(makeEvent('system', `#${issue.number} — ${eligibility.reason}`));
          }
        }

        triageResults.push(result);
      }

      return JSON.stringify({ critical, high, medium, low, jiraCreated, slackSent, autoFixed, triaged: numbers.length });
    }

    case 'generate_final_report': {
      const mode = args.mode as string;
      const ready = args.release_ready as boolean | undefined;
      const blockers = (args.blockers as string[] | undefined) ?? [];
      const recommendation = (args.recommendation as string | undefined) ?? '';

      emit(makeEvent('thinking', 'Generating final report...'));

      // Send to Slack based on mode
      if (mode.includes('release')) {
        await slack.sendReleaseAssessment({
          ready: ready ?? false,
          blockers,
          actions: triageResults
            .filter((r) => r.jiraKey)
            .map((r) => `Created ${r.jiraKey} for #${r.number}`),
          recommendation,
        });
      } else if (mode.includes('sprint')) {
        const sprintItems = triageResults
          .filter((r) => r.jiraKey)
          .map((r) => ({ key: r.jiraKey!, title: r.title, priority: r.severity }));
        await slack.sendSprintSummary({
          sprintName: 'Next Sprint',
          items: sprintItems,
          totalItems: triageResults.length,
        });
      } else {
        const critCount = triageResults.filter((r) => r.severity === 'CRITICAL').length;
        const highCount = triageResults.filter((r) => r.severity === 'HIGH').length;
        const jiraCount = triageResults.filter((r) => r.jiraKey).length;
        await slack.sendMessage({
          text: `🤖 CodeOps run complete: ${critCount} critical, ${highCount} high, ${jiraCount} Jira tickets created. ${recommendation}`,
        });
      }

      emit(makeEvent('success', 'Report sent to Slack. Run complete.', { tool: 'Slack' }));
      return JSON.stringify({ success: true, slackSent: true });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// Detect session memory rules from the command
function extractSessionRules(command: string, existingRules: string[]): string[] {
  const rules = [...existingRules];
  const rulePhrases = [
    /(?:don'?t|do not|never|skip|ignore)\s+(?:escalate|triage|create|notify)\s+[\w\s]+/gi,
    /our\s+\w+\s+(?:system|service|module)\s+is\s+(?:release[-\s]critical|critical|important)/gi,
    /remember\s+that\s+.+/gi,
  ];
  for (const pattern of rulePhrases) {
    const matches = command.match(pattern);
    if (matches) rules.push(...matches);
  }
  return Array.from(new Set(rules));
}

export async function POST(req: NextRequest) {
  const { command, sessionMemory = [] } = await req.json() as { command: string; sessionMemory: string[] };

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const emit = async (data: unknown) => {
    try {
      await writer.write(encoder.encode(sseEvent(data)));
    } catch {
      // client disconnected
    }
  };

  // Extract any new session rules from the command
  const sessionRules = extractSessionRules(command, sessionMemory);

  // Pass audit callback so Swytchcode execution events appear in the live feed
  const swytchcodeAudit = (e: import('@/lib/swytchcode').SwytchcodeAuditEvent) => {
    if (e.status === 'executing') {
      void emit({ type: 'event', event: makeEvent('tool_call', `[Swytchcode] Executing ${e.tool}`, { tool: 'Swytchcode', detail: `via ${e.layer} layer` }) });
    } else if (e.status === 'success') {
      void emit({ type: 'event', event: makeEvent('verify', `[Swytchcode] ${e.tool} completed in ${e.durationMs ?? 0}ms`, { tool: 'Swytchcode' }) });
    } else if (e.status === 'error') {
      void emit({ type: 'event', event: makeEvent('error', `[Swytchcode] ${e.tool} failed: ${e.error}`, { tool: 'Swytchcode' }) });
    } else if (e.status === 'fallback') {
      void emit({ type: 'event', event: makeEvent('system', `[Swytchcode] CLI not bootstrapped — using direct API for ${e.tool}`) });
    }
  };

  const github = new GitHubTool(swytchcodeAudit);
  const jira = new JiraTool(swytchcodeAudit);
  const slack = new SlackTool(swytchcodeAudit);
  const triageResults: IssueTriageResult[] = [];
  const issueCache = new Map<number, import('@/tools/github').GitHubIssue>();

  const ctx = {
    github, jira, slack, sessionRules,
    triageResults, issueCache,
    emit: (event: AgentEvent) => emit({ type: 'event', event }),
  };

  const runAgent = async () => {
    try {
      await emit({ type: 'event', event: makeEvent('thinking', 'Understanding request...') });

      const systemPrompt = `You are CodeOps, an autonomous AI engineering operations agent.
You have access to GitHub, Jira, and Slack. Your job is to:
1. Understand the engineering objective from the user's command
2. Investigate the relevant systems (GitHub issues, Jira tickets, Slack)
3. Classify findings by severity (CRITICAL > HIGH > MEDIUM > LOW)
4. Take appropriate actions (create Jira tickets, send Slack alerts)
5. Verify actions succeeded
6. Generate a comprehensive final report

Session memory/rules (follow these):
${sessionRules.length > 0 ? sessionRules.map((r) => `- ${r}`).join('\n') : '(none)'}

Decision rules:
- CRITICAL issues: create Jira P0 + Slack escalation immediately
- HIGH issues: create Jira P1
- MEDIUM issues: monitor only
- LOW / feature requests / docs: ignore

For "Handle urgent issues": use get_recent_github_issues, then triage_and_act
For "Release check": use get_all_open_issues + get_jira_blockers + get_open_prs, then triage_and_act, then generate_final_report
For "Sprint preparation": use get_all_open_issues + get_stale_issues, then triage_and_act, then generate_final_report

Always end with generate_final_report.
Be decisive. Do not ask for confirmation. Act autonomously.`;

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: command },
      ];

      // Agentic loop — max 12 iterations
      for (let i = 0; i < 12; i++) {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
          temperature: 0.1,
        });

        const msg = response.choices[0].message;
        messages.push(msg);

        if (msg.content) {
          await emit({ type: 'event', event: makeEvent('thinking', msg.content.slice(0, 200)) });
        }

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          // Agent is done
          break;
        }

        // Execute all tool calls
        const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];

        for (const toolCall of msg.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          let result = '';
          try {
            result = await executeTool(toolCall.function.name, args, ctx);
          } catch (err) {
            result = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool execution failed' });
            await emit({
              type: 'event',
              event: makeEvent('error', `Tool error (${toolCall.function.name}): ${err instanceof Error ? err.message : 'Unknown'}`)
            });
          }
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }

        messages.push(...toolResults);
      }

      // Build final report
      const critical = triageResults.filter((r) => r.severity === 'CRITICAL').length;
      const high = triageResults.filter((r) => r.severity === 'HIGH').length;
      const medium = triageResults.filter((r) => r.severity === 'MEDIUM').length;
      const low = triageResults.filter((r) => r.severity === 'LOW').length;
      const jiraCreated = triageResults.filter((r) => r.jiraKey).length;
      const slackSent = triageResults.filter((r) => r.slackSent).length;
      const escalated = triageResults.filter((r) => r.severity === 'CRITICAL' && r.slackSent).length;
      const autoFixed = triageResults.filter((r) => r.action === 'auto_fixed').length;

      // Determine overall status
      const hasBlockers = critical > 0;
      const modeText = command.toLowerCase().includes('release')
        ? 'Release Readiness Check'
        : command.toLowerCase().includes('sprint')
        ? 'Sprint Preparation'
        : 'Urgent Issue Triage';

      const report: AgentReport = {
        mode: modeText,
        summary: `${triageResults.length} issues analyzed: ${critical} critical, ${high} high, ${medium} medium, ${low} low. ${jiraCreated} Jira tickets created, ${slackSent} Slack alerts sent.`,
        status: hasBlockers ? 'BLOCKED' : triageResults.length === 0 ? 'COMPLETE' : 'COMPLETE',
        findings: { critical, high, medium, low },
        actions: {
          jiraCreated,
          slackSent,
          escalated,
          ignored: triageResults.filter((r) => r.action === 'ignore').length,
          autoFixed,
        },
        issues: triageResults,
        recommendation: hasBlockers
          ? `Resolve ${critical} critical issue(s) before proceeding.`
          : 'No critical blockers found. Proceed with confidence.',
        blockers: triageResults.filter((r) => r.severity === 'CRITICAL').map((r) => r.title),
        learnedRules: sessionRules.filter((r) => !sessionMemory.includes(r)),
        timestamp: new Date().toISOString(),
      };

      await emit({ type: 'report', report });
      await emit('data: [DONE]\n\n');
    } catch (err) {
      await emit({
        type: 'event',
        event: makeEvent('error', `Agent failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      });
    } finally {
      await writer.close();
    }
  };

  // Start agent in background
  runAgent();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
