import { classifyNode } from './node-classifier.js';
import type {
  FigmaNode,
  FigmaFileResponse,
  NodeBreakdown,
  DetachedInstance,
  SuspectedDetachment,
  OtherLibraryUsage,
  LocalComponent,
} from '../types.js';

interface LibraryKeys {
  dls: string;
  arcade: string;
}

interface TraversalResult {
  totalNodes: number;
  componentSurface: number;
  breakdown: NodeBreakdown;
  detachedInstances: DetachedInstance[];
  suspectedDetachments: SuspectedDetachment[];
  otherLibraries: OtherLibraryUsage[];
  localComponents: LocalComponent[];
}

export function traverseFileTree(
  file: FigmaFileResponse,
  libraryKeys: LibraryKeys,
  componentKeyToFileKey?: Map<string, string>,
  dsComponentNames?: Set<string>,
  componentNameToFileKey?: Map<string, string>,
): TraversalResult {
  const breakdown: NodeBreakdown = {
    dsArcade: 0,
    dsDls: 0,
    dsOther: 0,
    detached: 0,
    localComponent: 0,
    raw: 0,
  };

  const detachedInstances: DetachedInstance[] = [];
  const suspectedDetachments: SuspectedDetachment[] = [];
  const otherFileKeyCounts = new Map<string, number>();
  const localComponents: LocalComponent[] = [];

  function walk(node: FigmaNode): void {
    const result = classifyNode(node, file.components, libraryKeys, componentKeyToFileKey, componentNameToFileKey);
    breakdown[result.category]++;

    if (result.category === 'detached') {
      detachedInstances.push({
        nodeId: node.id,
        name: node.name,
        originalComponent: node.componentId ?? 'unknown',
      });
    }

    if (result.category === 'dsOther' && result.sourceFileKey) {
      otherFileKeyCounts.set(
        result.sourceFileKey,
        (otherFileKeyCounts.get(result.sourceFileKey) ?? 0) + 1,
      );
    }

    if (result.category === 'localComponent') {
      const instanceCount = countLocalInstances(file.document, node.id);
      localComponents.push({
        nodeId: node.id,
        name: node.name,
        instanceCount,
      });
    }

    // Detect suspected detachments: FRAME/GROUP nodes whose name matches a DS component
    if (dsComponentNames && (node.type === 'FRAME' || node.type === 'GROUP')) {
      const name = node.name;
      if (dsComponentNames.has(name)) {
        suspectedDetachments.push({
          nodeId: node.id,
          name: node.name,
          matchedComponentName: name,
        });
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(file.document);

  const totalNodes = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const componentSurface =
    breakdown.dsArcade +
    breakdown.dsDls +
    breakdown.dsOther +
    breakdown.detached +
    breakdown.localComponent;

  const otherLibraries: OtherLibraryUsage[] = Array.from(otherFileKeyCounts.entries())
    .map(([fileKey, instanceCount]) => ({ fileKey, instanceCount }))
    .sort((a, b) => b.instanceCount - a.instanceCount);

  return {
    totalNodes, componentSurface, breakdown,
    detachedInstances, suspectedDetachments, otherLibraries, localComponents,
  };
}

function countLocalInstances(root: FigmaNode, componentNodeId: string): number {
  let count = 0;
  function walk(node: FigmaNode): void {
    if (node.type === 'INSTANCE' && node.componentId === componentNodeId) {
      count++;
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(root);
  return count;
}
