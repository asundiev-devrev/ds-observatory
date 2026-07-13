// src/emitters/figma-comment.ts
import { buildDeepLink } from '../review/deep-link.js';
import type { FigmaClient } from '../collectors/figma-client.js';
import type { ReviewResult, Finding } from '../review/types.js';

const LABEL: Record<Finding['kind'], string> = { deprecated: '🔴 Deprecated', detached: '⚪ Detached' };

export function formatCommentBody(result: ReviewResult): string {
  const link = (nodeId: string) => buildDeepLink(result.fileKey, nodeId, result.version);
  const lines: string[] = [`🔭 DS Observatory review — ${result.frameName}`];

  if (result.tooLarge) {
    const count = result.tooLarge.nodeCount ? ` (${result.tooLarge.nodeCount} nodes)` : '';
    lines.push(`This section is too large to review automatically${count}. Break it into frames or review manually.`);
    return lines.join('\n');
  }

  const score = result.cleanScore === null ? 'n/a — no DS components' : `${result.cleanScore}%`;
  const total = result.findings.length;
  // "On current DS lib" not "Clean DS": v1 cannot tell DLS/0.2/0.3 apart inside the
  // consolidated library (spec §9), so this is "% from the current library, non-deprecated",
  // NOT "% on the newest generation". Do not relabel as clean/current-SoT.
  lines.push(`On current DS lib: ${score}  ·  ${total} issue(s)`, '');

  if (total === 0) {
    lines.push('✅ No deprecated or detached components found.');
    return lines.join('\n');
  }

  for (const kind of ['deprecated', 'detached'] as Finding['kind'][]) {
    const group = result.findings.filter((f) => f.kind === kind);
    if (group.length === 0) continue;
    lines.push(`${LABEL[kind]} (${group.length})`);
    for (const f of group.slice(0, 10)) lines.push(`  • ${f.detail} → ${link(f.nodeId)}`);
    if (group.length > 10) lines.push(`  • …and ${group.length - 10} more`);
  }

  lines.push('', `Reviewed ${result.reviewedAt}.`);
  return lines.join('\n');
}

export async function postFrameComment(client: FigmaClient, result: ReviewResult): Promise<string> {
  const resp = await client.post<{ id: string }>(`/v1/files/${result.fileKey}/comments`, {
    message: formatCommentBody(result),
    client_meta: { node_id: result.frameNodeId, node_offset: { x: 0, y: 0 } },
  });
  return resp.id;
}

export async function deleteFrameComment(client: FigmaClient, fileKey: string, commentId: string): Promise<void> {
  await client.delete(`/v1/files/${fileKey}/comments/${commentId}`);
}
