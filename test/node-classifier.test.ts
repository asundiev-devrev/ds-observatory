import { describe, it, expect } from 'vitest';
import { classifyNode } from '../src/collectors/node-classifier.js';
import type { FigmaNode, FigmaComponentMeta } from '../src/types.js';

const DLS_KEY = 'rNeWrFnPT8J903T2jon2oG';
const ARCADE_KEY = 'loThitjZGdpisyETz5avvz';
const OTHER_KEY = 'some-other-library-key';

const components: Record<string, FigmaComponentMeta> = {
  'comp-1': { key: 'k1', name: 'Button', description: '', file_key: DLS_KEY },
  'comp-2': { key: 'k2', name: 'Badge', description: '', file_key: ARCADE_KEY },
  'comp-3': { key: 'k3', name: 'ThirdParty', description: '', file_key: OTHER_KEY },
};

const libraryKeys = { dls: DLS_KEY, arcade: ARCADE_KEY };

describe('classifyNode', () => {
  it('classifies INSTANCE with DLS component as dsDls', () => {
    const node: FigmaNode = { id: '1', name: 'Button', type: 'INSTANCE', componentId: 'comp-1' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('dsDls');
  });

  it('classifies INSTANCE with Arcade component as dsArcade', () => {
    const node: FigmaNode = { id: '2', name: 'Badge', type: 'INSTANCE', componentId: 'comp-2' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('dsArcade');
  });

  it('classifies INSTANCE with other library component as dsOther', () => {
    const node: FigmaNode = { id: '3', name: 'ThirdParty', type: 'INSTANCE', componentId: 'comp-3' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('dsOther');
  });

  it('classifies INSTANCE with unresolvable componentId as detached', () => {
    const node: FigmaNode = { id: '4', name: 'Broken Button', type: 'INSTANCE', componentId: 'missing-comp' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('detached');
  });

  it('classifies COMPONENT node as localComponent', () => {
    const node: FigmaNode = { id: '5', name: 'Custom Card', type: 'COMPONENT' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('localComponent');
  });

  it('classifies COMPONENT_SET node as localComponent', () => {
    const node: FigmaNode = { id: '6', name: 'Custom Card Set', type: 'COMPONENT_SET' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('localComponent');
  });

  it('classifies FRAME with no component lineage as raw', () => {
    const node: FigmaNode = { id: '7', name: 'Container', type: 'FRAME' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('raw');
  });

  it('classifies GROUP as raw', () => {
    const node: FigmaNode = { id: '8', name: 'Group 1', type: 'GROUP' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('raw');
  });

  it('classifies RECTANGLE as raw', () => {
    const node: FigmaNode = { id: '9', name: 'bg', type: 'RECTANGLE' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('raw');
  });

  it('classifies INSTANCE with no componentId as detached', () => {
    const node: FigmaNode = { id: '10', name: 'Orphan', type: 'INSTANCE' };
    expect(classifyNode(node, components, libraryKeys).category).toBe('detached');
  });
});
