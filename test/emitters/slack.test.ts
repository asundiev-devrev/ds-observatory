// test/emitters/slack.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveMention, formatSlackBlocks, postDigest } from '../../src/emitters/slack.js';
import type { ReviewResult } from '../../src/review/types.js';

const result: ReviewResult = {
  fileKey: 'F', version: '99', frameNodeId: '43:2', frameName: 'Checkout',
  reviewedAt: '2026-07-10T00:00:00.000Z', status: 'READY_FOR_DEV', triggeredBy: 'figU',
  findings: [{ kind: 'deprecated', nodeId: '43:3', nodeName: 'btn', detail: '[🔴DEPRECATED]Button' }],
  counts: { deprecated: 1, detached: 0 }, cleanScore: 40,
};

describe('resolveMention', () => {
  it('maps a known figma user to a slack mention', () => {
    expect(resolveMention('figU', 'Jane', { figU: 'U123' })).toBe('<@U123>');
  });
  it('falls back to the figma handle when unmapped', () => {
    expect(resolveMention('figU', 'Jane', {})).toBe('Jane');
  });
  it('falls back to a generic label when nothing is known', () => {
    expect(resolveMention(undefined, undefined, {})).toBe('a designer');
  });
});

describe('formatSlackBlocks', () => {
  it('includes the frame name, deep-link, and mention', () => {
    const blocks = formatSlackBlocks(result, '<@U123>');
    const json = JSON.stringify(blocks);
    expect(json).toContain('Checkout');
    expect(json).toContain('node-id=43%3A2');
    expect(json).toContain('<@U123>');
    expect(json).toContain('1 deprecated');
  });
});

describe('postDigest', () => {
  it('throws when Slack returns ok:false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'channel_not_found' }) });
    vi.stubGlobal('fetch', mockFetch);
    await expect(postDigest('tok', '#ads-core-team', [], 'x')).rejects.toThrow('channel_not_found');
  });
});
