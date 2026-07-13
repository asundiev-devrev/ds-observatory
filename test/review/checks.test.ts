// test/review/checks.test.ts
import { describe, it, expect } from 'vitest';
import { collectFindings } from '../../src/review/checks.js';
import type { FigmaNode, FigmaComponentMeta } from '../../src/types.js';
import type { Catalog } from '../../src/collectors/team-catalog.js';

const ARCADE3 = 'a2uKnm88LxRXEWAL1kOqeQ';
const libraryKeys = { dls: 'DLSKEY', arcade: 'A2KEY', arcade3: ARCADE3 };

const components: Record<string, FigmaComponentMeta> = {
  cDep:   { key: 'kDep',   name: 'Type=Secondary', description: '', file_key: ARCADE3 },
  cClean: { key: 'kClean', name: 'Button',         description: '', file_key: ARCADE3 },
};

const catalog: Catalog = {
  keyToFileKey: new Map([['kDep', ARCADE3], ['kClean', ARCADE3]]),
  keyToInfo: new Map([
    ['kDep',   { fileKey: ARCADE3, displayName: '[🔴DEPRECATED]Button / Secondary' }],
    ['kClean', { fileKey: ARCADE3, displayName: 'Button' }],
  ]),
  excludedCount: 0,
};

const ctx = { components, catalog, libraryKeys };

it('flags a deprecated instance by its set name (variant → set resolution)', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '1:1', name: 'btn', type: 'INSTANCE', componentId: 'cDep' }],
  };
  const r = collectFindings(root, ctx);
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0].kind).toBe('deprecated');
  expect(r.findings[0].detail).toBe('[🔴DEPRECATED]Button / Secondary');
  expect(r.findings[0].nodeId).toBe('1:1');
});

it('flags a detached instance (unresolvable componentId)', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '2:2', name: ' ', type: 'INSTANCE', componentId: 'missing' }],
  };
  const r = collectFindings(root, ctx);
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0].kind).toBe('detached');
});

it('emits nothing for a clean current-SoT instance and counts it clean', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '3:3', name: 'btn', type: 'INSTANCE', componentId: 'cClean' }],
  };
  const r = collectFindings(root, ctx);
  expect(r.findings).toHaveLength(0);
  expect(r.cleanCurrentDS).toBe(1);
  expect(r.componentSurface).toBe(1);
});

it('does NOT flag deprecated by guessing on the variant name when the key is absent from the catalog', () => {
  // meta.name literally contains the marker, but the component key is NOT in the catalog.
  // We must not treat the variant name as authoritative (it would be a false positive here,
  // and symmetrically a false negative for a real deprecated set whose variant name is clean).
  const localComponents: Record<string, FigmaComponentMeta> = {
    cUnknown: { key: 'kUnknown', name: '[🔴DEPRECATED]RawVariantName', description: '', file_key: ARCADE3 },
  };
  const localCtx = { components: localComponents, catalog, libraryKeys }; // catalog has no 'kUnknown'
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '9:9', name: 'x', type: 'INSTANCE', componentId: 'cUnknown' }],
  };
  const r = collectFindings(root, localCtx);
  expect(r.findings.some((f) => f.kind === 'deprecated')).toBe(false);
});

it('counts total nodes across the tree', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [
      { id: 'a', name: 'x', type: 'RECTANGLE' },
      { id: 'b', name: 'y', type: 'FRAME', children: [{ id: 'c', name: 'z', type: 'TEXT' }] },
    ],
  };
  const r = collectFindings(root, ctx);
  expect(r.nodeCount).toBe(4); // root + a + b + c
});
