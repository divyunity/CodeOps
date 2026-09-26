/**
 * Auto-Fix Engine
 *
 * Decides whether an issue is autonomously fixable and, if so,
 * uses OpenAI to generate the code fix, creates a branch, commits it,
 * and opens a PR — all without human intervention.
 *
 * Fix eligibility rules:
 *   CRITICAL  → Never auto-fix. Always escalate to humans.
 *   HIGH      → Never auto-fix. Requires human review before merging.
 *   MEDIUM    → Auto-fix if the issue has a clear, contained code fix.
 *   LOW       → Auto-fix always (typos, docs, minor config).
 */

import OpenAI from 'openai';
import { GitHubIssue } from '@/tools/github';
import { Severity } from '@/lib/decision-engine';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type FixEligibility =
  | { eligible: false; reason: string }
  | { eligible: true; confidence: 'high' | 'medium'; fixType: FixType; reason: string };

export type FixType =
  | 'typo_or_copy'
  | 'config_value'
  | 'missing_guard'
  | 'missing_cleanup'
  | 'logic_bug'
  | 'documentation';

export interface AutoFixResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  commitMessage?: string;
  filesChanged?: string[];
  explanation?: string;
  error?: string;
}

export interface GeneratedFix {
  filePath: string;
  oldCode: string;
  newCode: string;
  explanation: string;
  commitMessage: string;
}

const UNSAFE_PATTERNS = [
  'payment', 'billing', 'stripe', 'charge', 'transaction',
  'auth', 'authentication', 'password', 'token', 'secret', 'credential',
  'security', 'vulnerability', 'exploit', 'injection', 'xss',
  'database migration', 'drop table', 'production deploy',
];

const SAFE_FIX_PATTERNS: Array<{ pattern: RegExp; type: FixType }> = [
  { pattern: /typo|spelling|misspell|wording/i,                        type: 'typo_or_copy'    },
  { pattern: /off.by.one|wrong.*count|wrong.*limit|pool\.max|pool\.min/i, type: 'config_value' },
  { pattern: /null.*check|undefined.*check|missing.*check/i,           type: 'missing_guard'   },
  { pattern: /never.*removed|leak.*listener|event.*listener/i,         type: 'missing_cleanup' },
  { pattern: /wrong.*condition|inverted|backward.*check/i,             type: 'logic_bug'       },
  { pattern: /documentation|readme|comment\s/i,                        type: 'documentation'   },
];

export function assessFixEligibility(issue: GitHubIssue, severity: Severity): FixEligibility {
  if (severity === 'CRITICAL' || severity === 'HIGH') {
    return { eligible: false, reason: `${severity} severity requires human review — auto-fix disabled.` };
  }

  const text = `${issue.title} ${issue.body ?? ''}`.toLowerCase();
  const unsafe = UNSAFE_PATTERNS.find((p) => text.includes(p));
  if (unsafe) {
    return { eligible: false, reason: `Touches sensitive area (${unsafe}) — auto-fix disabled for safety.` };
  }

  for (const { pattern, type } of SAFE_FIX_PATTERNS) {
    if (pattern.test(text)) {
      return {
        eligible: true,
        confidence: severity === 'LOW' ? 'high' : 'medium',
        fixType: type,
        reason: `Identified as ${type.replace(/_/g, ' ')} — safe to auto-fix.`,
      };
    }
  }

  return {
    eligible: true,
    confidence: severity === 'LOW' ? 'high' : 'medium',
    fixType: 'logic_bug',
    reason: `${severity} bug with clear description — attempting autonomous fix with PR for review.`,
  };
}

export async function generateFix(
  issue: GitHubIssue,
  eligibility: Extract<FixEligibility, { eligible: true }>
): Promise<GeneratedFix | null> {
  const prompt = `You are an autonomous code repair agent. Analyze this GitHub issue and produce a minimal, safe code fix.

ISSUE #${issue.number}: ${issue.title}
BODY:
${issue.body?.slice(0, 3000) ?? '(no description)'}

FIX TYPE: ${eligibility.fixType}

Rules:
- Fix ONLY what is explicitly described. Do not refactor anything else.
- If the fix is ambiguous or requires full codebase context, respond: CANNOT_FIX
- Keep the patch minimal — one logical change.
- Commit message format: "fix: <description> (closes #${issue.number})"

Respond ONLY in this exact JSON (no markdown wrapping):
{
  "filePath": "relative/path/to/file.ts",
  "oldCode": "exact code snippet to replace",
  "newCode": "exact replacement code",
  "explanation": "one sentence: what was wrong and what changed",
  "commitMessage": "fix: description (closes #${issue.number})"
}

If you cannot produce a safe specific fix, respond with exactly: CANNOT_FIX`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const content = response.choices[0].message.content?.trim() ?? '';
    if (content.includes('CANNOT_FIX')) return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const fix = JSON.parse(jsonMatch[0]) as GeneratedFix;
    if (!fix.filePath || !fix.oldCode || !fix.newCode || !fix.commitMessage) return null;

    return fix;
  } catch {
    return null;
  }
}
