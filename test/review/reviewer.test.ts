// test/review/reviewer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { review, MAX_REVIEW_NODES, MAX_IMMEDIATE_CHILDREN } from '../../src/review/reviewer.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';
import type { Catalog } from '../../src/collectors/team-catalog.js';

const ARCADE3 = 'a2uKnm88LxRXEWAL1kOqeQ';
const libraryKeys = { dls: 'DLS', arcade: 'A2', arcade3: ARCADE3 };
const catalog: Catalog = {
  keyToFileKey: new Map([['kDep', ARCADE3]]),
  keyToInfo: new Map([['kDep', { fileKey: ARCADE3, displayName: '[🔴DEPRECATED]Divider' }]]),
  excludedCount: 0,
};
const now = () => '2026-07-10T00:00:00.000Z';

// The reviewer calls client.get twice: a depth=1 probe, then a deep fetch (no depth).
// `probe` is returned when params.depth === '1'; `deep` (a value, or a thrown error) otherwise.
function deps(probe: any, deep?: any | (() => never)) {
  const client = new FigmaClient('t');
  vi.spyOn(client, 'get').mockImplementation(async (_path: string, params?: Record<string, string>) => {
    if (params?.depth === '1') return probe;
    if (typeof deep === 'function') return (deep as () => never)();
    return deep;
  });
  return { client, catalog, libraryKeys, now };
}

function node(children: any[], type = 'FRAME', name = 'Checkout') {
  return { nodes: { '43:2': { components: { cDep: { key: 'kDep', name: 'X', description: '', file_key: ARCADE3 } }, document: { id: '43:2', name, type, children } } } };
}

it('returns a deprecated finding and a cleanScore', async () => {
  const child = { id: '43:3', name: 'div', type: 'INSTANCE', componentId: 'cDep' };
  const result = await review(deps(node([child]), node([child])), { fileKey: 'F', nodeId: '43:2' });
  expect(result.frameName).toBe('Checkout');
  expect(result.counts.deprecated).toBe(1);
  expect(result.findings[0].kind).toBe('deprecated');
  expect(result.cleanScore).toBe(0);       // 0 clean of 1 surface
  expect(result.reviewedAt).toBe('2026-07-10T00:00:00.000Z');
  expect(result.status).toBe('READY_FOR_DEV');
});

it('bails as immediate-breadth when the probe shows too many direct children', async () => {
  const many = Array.from({ length: MAX_IMMEDIATE_CHILDREN + 1 }, (_, i) => ({ id: `c${i}`, name: 'x', type: 'FRAME' }));
  // deep fetch must NOT be called — pass a throwing deep to prove the probe short-circuits.
  const result = await review(deps(node(many, 'SECTION', 'Big'), () => { throw new Error('deep fetch should not run'); }), { fileKey: 'F', nodeId: '43:2' });
  expect(result.tooLarge?.reason).toBe('immediate-breadth');
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});

it('flags tooLarge=ceiling when the deep subtree exceeds MAX_REVIEW_NODES', async () => {
  const deep = node(Array.from({ length: MAX_REVIEW_NODES + 1 }, (_, i) => ({ id: `c${i}`, name: 'x', type: 'RECTANGLE' })), 'FRAME', 'Big');
  const result = await review(deps(node([{ id: 'c0', name: 'x', type: 'RECTANGLE' }]), deep), { fileKey: 'F', nodeId: '43:2' });
  expect(result.tooLarge?.reason).toBe('ceiling');
  expect(result.tooLarge?.nodeCount).toBeGreaterThan(MAX_REVIEW_NODES);
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});

it('degrades to tooLarge=fetch-failed when the deep fetch throws (never rethrows)', async () => {
  const result = await review(deps(node([{ id: 'c0', name: 'x', type: 'FRAME' }]), () => { throw new Error('terminated'); }), { fileKey: 'F', nodeId: '43:2' });
  expect(result.tooLarge?.reason).toBe('fetch-failed');
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});

it('returns an empty result when the node is missing from the probe', async () => {
  const result = await review(deps({ nodes: {} }), { fileKey: 'F', nodeId: 'gone', frameName: 'Gone' });
  expect(result.frameName).toBe('Gone');
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});
