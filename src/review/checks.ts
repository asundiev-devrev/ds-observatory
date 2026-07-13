// src/review/checks.ts
import { classifyNode } from '../collectors/node-classifier.js';
import { isDeprecatedName } from './deprecation.js';
import type { Finding } from './types.js';
import type { Catalog } from '../collectors/team-catalog.js';
import type { FigmaNode, FigmaComponentMeta } from '../types.js';

export interface CheckContext {
  components: Record<string, FigmaComponentMeta>;
  catalog: Catalog;
  libraryKeys: { dls: string; arcade: string; arcade3: string };
}

export interface CollectResult {
  findings: Finding[];
  nodeCount: number;
  componentSurface: number;
  cleanCurrentDS: number;
}

export function collectFindings(root: FigmaNode, ctx: CheckContext): CollectResult {
  const findings: Finding[] = [];
  let nodeCount = 0;
  let componentSurface = 0;
  let cleanCurrentDS = 0;

  function deprecatedSetName(node: FigmaNode): string | null {
    if (node.type !== 'INSTANCE' || !node.componentId) return null;
    const meta = ctx.components[node.componentId];
    if (!meta) return null;
    const info = ctx.catalog.keyToInfo.get(meta.key);
    // Only trust the catalog's SET display name. meta.name is the VARIANT name
    // (e.g. "Type=Secondary") and never carries the set's [DEPRECATED] marker, so
    // guessing on it would silently pass deprecated components as clean (spec §4.2).
    if (!info) return null;
    return isDeprecatedName(info.displayName) ? info.displayName : null;
  }

  function walk(node: FigmaNode): void {
    nodeCount++;

    const { category } = classifyNode(node, ctx.components, ctx.libraryKeys, ctx.catalog.keyToFileKey);
    if (category === 'dsArcade3' || category === 'dsArcade' || category === 'dsDls'
        || category === 'dsOther' || category === 'detached' || category === 'localComponent') {
      componentSurface++;
    }

    const depName = deprecatedSetName(node);
    if (depName) {
      findings.push({ kind: 'deprecated', nodeId: node.id, nodeName: node.name, detail: depName });
    } else if (category === 'detached') {
      findings.push({
        kind: 'detached',
        nodeId: node.id,
        nodeName: node.name,
        detail: `was ${node.componentId ?? 'unknown component'}`,
      });
    } else if (category === 'dsArcade3') {
      cleanCurrentDS++;
    }

    if (node.children) for (const child of node.children) walk(child);
  }

  walk(root);
  return { findings, nodeCount, componentSurface, cleanCurrentDS };
}
