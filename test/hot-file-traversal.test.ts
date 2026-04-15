import { describe, it, expect } from 'vitest';
import { traverseFileTree } from '../src/collectors/hot-file-traversal.js';
import type { FigmaFileResponse } from '../src/types.js';
import fileTreeResponse from './fixtures/file-tree-response.json';

const DLS_KEY = 'rNeWrFnPT8J903T2jon2oG';
const ARCADE_KEY = 'loThitjZGdpisyETz5avvz';

describe('traverseFileTree', () => {
  it('counts all node categories correctly', () => {
    const result = traverseFileTree(
      fileTreeResponse as unknown as FigmaFileResponse,
      { dls: DLS_KEY, arcade: ARCADE_KEY },
    );
    expect(result.breakdown.dsDls).toBe(2);
    expect(result.breakdown.dsArcade).toBe(1);
    expect(result.breakdown.dsOther).toBe(1);
    expect(result.breakdown.detached).toBe(1);
    expect(result.breakdown.localComponent).toBe(1);
    // Raw: DOCUMENT(0:0) + CANVAS(1:0) + RECTANGLE(3:1) + FRAME(2:6) + TEXT(3:2) + GROUP(2:7) = 6
    expect(result.breakdown.raw).toBe(6);
  });

  it('computes componentSurface correctly (excludes raw)', () => {
    const result = traverseFileTree(
      fileTreeResponse as unknown as FigmaFileResponse,
      { dls: DLS_KEY, arcade: ARCADE_KEY },
    );
    // componentSurface = dsDls(2) + dsArcade(1) + dsOther(1) + detached(1) + localComponent(1) = 6
    expect(result.componentSurface).toBe(6);
  });

  it('computes totalNodes as sum of all categories', () => {
    const result = traverseFileTree(
      fileTreeResponse as unknown as FigmaFileResponse,
      { dls: DLS_KEY, arcade: ARCADE_KEY },
    );
    const b = result.breakdown;
    expect(result.totalNodes).toBe(
      b.dsDls + b.dsArcade + b.dsOther + b.detached + b.localComponent + b.raw,
    );
  });

  it('captures detached instances with original component name', () => {
    const result = traverseFileTree(
      fileTreeResponse as unknown as FigmaFileResponse,
      { dls: DLS_KEY, arcade: ARCADE_KEY },
    );
    expect(result.detachedInstances).toHaveLength(1);
    expect(result.detachedInstances[0].nodeId).toBe('2:4');
    expect(result.detachedInstances[0].name).toBe('Broken');
  });

  it('captures local components', () => {
    const result = traverseFileTree(
      fileTreeResponse as unknown as FigmaFileResponse,
      { dls: DLS_KEY, arcade: ARCADE_KEY },
    );
    expect(result.localComponents).toHaveLength(1);
    expect(result.localComponents[0].name).toBe('Custom Card');
  });
});
