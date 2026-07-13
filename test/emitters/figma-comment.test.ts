// test/emitters/figma-comment.test.ts
import { describe, it, expect, vi } from 'vitest';
import { formatCommentBody, postFrameComment } from '../../src/emitters/figma-comment.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';
import type { ReviewResult } from '../../src/review/types.js';

const result: ReviewResult = {
  fileKey: 'F', version: '99', frameNodeId: '43:2', frameName: 'Checkout',
  reviewedAt: '2026-07-10T00:00:00.000Z', status: 'READY_FOR_DEV',
  findings: [
    { kind: 'deprecated', nodeId: '43:3', nodeName: 'btn', detail: '[🔴DEPRECATED]Button / Secondary' },
    { kind: 'detached', nodeId: '43:4', nodeName: ' ', detail: 'was 12:8' },
  ],
  counts: { deprecated: 1, detached: 1 },
  cleanScore: 40,
};

describe('formatCommentBody', () => {
  it('includes the header, score, grouped counts, and deep-links', () => {
    const body = formatCommentBody(result);
    expect(body).toContain('DS Observatory review — Checkout');
    expect(body).toContain('On current DS lib: 40%');
    expect(body).toContain('Deprecated (1)');
    expect(body).toContain('[🔴DEPRECATED]Button / Secondary');
    expect(body).toContain('node-id=43%3A3');
    expect(body).toContain('version-id=99');
  });
  it('renders "n/a" when cleanScore is null', () => {
    const body = formatCommentBody({ ...result, cleanScore: null });
    expect(body).toContain('no DS components');
  });
  it('renders a too-large notice with the node count when present (ceiling)', () => {
    const body = formatCommentBody({ ...result, tooLarge: { reason: 'ceiling', nodeCount: 9000 }, findings: [], counts: { deprecated: 0, detached: 0 } });
    expect(body).toContain('too large');
    expect(body).toContain('9000');
  });
  it('renders a too-large notice without a count when the fetch failed', () => {
    const body = formatCommentBody({ ...result, tooLarge: { reason: 'fetch-failed' }, findings: [], counts: { deprecated: 0, detached: 0 } });
    expect(body).toContain('too large');
    expect(body).not.toContain('undefined');
  });
});

describe('postFrameComment', () => {
  it('POSTs a node-pinned comment and returns its id', async () => {
    const client = new FigmaClient('t');
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ id: 'comment-1' } as any);
    const id = await postFrameComment(client, result);
    expect(id).toBe('comment-1');
    const [, body] = postSpy.mock.calls[0];
    expect(body).toMatchObject({ client_meta: { node_id: '43:2', node_offset: { x: 0, y: 0 } } });
    expect(typeof (body as any).message).toBe('string');
  });
});
