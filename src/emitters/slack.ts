// src/emitters/slack.ts
import { buildDeepLink } from '../review/deep-link.js';
import type { ReviewResult } from '../review/types.js';

export type FigmaSlackMap = Record<string, string>;

export function resolveMention(
  figmaUserId: string | undefined,
  handle: string | undefined,
  map: FigmaSlackMap,
): string {
  if (figmaUserId && map[figmaUserId]) return `<@${map[figmaUserId]}>`;
  if (handle) return handle;
  return 'a designer';
}

export function formatSlackBlocks(result: ReviewResult, mention: string): unknown[] {
  const link = buildDeepLink(result.fileKey, result.frameNodeId, result.version);

  if (result.tooLarge) {
    const count = result.tooLarge.nodeCount ? ` (${result.tooLarge.nodeCount} nodes)` : '';
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔭 *<${link}|${result.frameName}>* marked ready for dev by ${mention}\n⚠️ This frame/section is too large to review automatically${count}. Break it into frames or review manually.`,
        },
      },
    ];
  }

  const summary = `${result.counts.deprecated} deprecated, ${result.counts.detached} detached`;
  const score = result.cleanScore === null ? 'n/a' : `${result.cleanScore}%`;
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔭 *<${link}|${result.frameName}>* marked ready for dev by ${mention}\nOn current DS lib: ${score} · ${summary}`,
      },
    },
    ...result.findings.slice(0, 10).map((f) => ({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${f.kind === 'deprecated' ? '🔴' : '⚪'} ${f.detail} · <${buildDeepLink(result.fileKey, f.nodeId, result.version)}|jump>` }],
    })),
  ];
}

export async function postDigest(token: string, channel: string, blocks: unknown[], text: string): Promise<void> {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text, blocks }),
  });
  const data = (await resp.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error ?? 'unknown error'}`);
}
