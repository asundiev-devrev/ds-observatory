// src/review/reviewer.ts
import { collectFindings } from './checks.js';
import type { CheckContext } from './checks.js';
import type { FigmaClient } from '../collectors/figma-client.js';
import type { Catalog } from '../collectors/team-catalog.js';
import type { FigmaNode, FigmaComponentMeta } from '../types.js';
import type { Finding, FindingKind, ReviewResult, ReviewTarget } from './types.js';

export const MAX_REVIEW_NODES = 5000;
export const MAX_IMMEDIATE_CHILDREN = 500;

export interface ReviewDeps {
  client: FigmaClient;
  catalog: Catalog;
  libraryKeys: { dls: string; arcade: string; arcade3: string };
  now: () => string;
}

interface NodesResponse {
  nodes: Record<string, { document: FigmaNode; components: Record<string, FigmaComponentMeta> }>;
}

function emptyCounts(): Record<FindingKind, number> {
  return { deprecated: 0, detached: 0 };
}

export async function review(deps: ReviewDeps, target: ReviewTarget): Promise<ReviewResult> {
  const path = `/v1/files/${target.fileKey}/nodes`;
  const versioned = (extra: Record<string, string>): Record<string, string> =>
    target.version ? { ids: target.nodeId, version: target.version, ...extra } : { ids: target.nodeId, ...extra };

  // Stage 1: shallow probe (depth=1) — small & reliable even for a page-sized section.
  const probe = await deps.client.get<NodesResponse>(path, versioned({ depth: '1' }));
  const probeNode = probe.nodes[target.nodeId];

  const base: Omit<ReviewResult, 'findings' | 'counts' | 'cleanScore' | 'tooLarge'> = {
    fileKey: target.fileKey,
    version: target.version,
    frameNodeId: target.nodeId,
    frameName: probeNode?.document.name ?? target.frameName ?? target.nodeId,
    reviewedAt: deps.now(),
    triggeredBy: target.triggeredBy,
    status: target.status ?? 'READY_FOR_DEV',
  };
  const empty = { findings: [] as Finding[], counts: emptyCounts(), cleanScore: null };

  if (!probeNode) return { ...base, ...empty };

  if ((probeNode.document.children?.length ?? 0) > MAX_IMMEDIATE_CHILDREN) {
    return { ...base, ...empty, tooLarge: { reason: 'immediate-breadth' } };
  }

  // Stage 2: deep fetch, guarded — a failure here must NOT throw (would become a silent
  // no-op in the consumer on exactly the giant sections the ceiling exists for).
  let deepNode: NodesResponse['nodes'][string] | undefined;
  try {
    const deep = await deps.client.get<NodesResponse>(path, versioned({}));
    deepNode = deep.nodes[target.nodeId];
  } catch {
    return { ...base, ...empty, tooLarge: { reason: 'fetch-failed' } };
  }
  if (!deepNode) return { ...base, ...empty };

  const ctx: CheckContext = {
    components: deepNode.components ?? {},
    catalog: deps.catalog,
    libraryKeys: deps.libraryKeys,
  };
  const collected = collectFindings(deepNode.document, ctx);

  // Stage 3: ceiling after walk (breadth probe already caught the worst cases).
  if (collected.nodeCount > MAX_REVIEW_NODES) {
    return { ...base, ...empty, tooLarge: { reason: 'ceiling', nodeCount: collected.nodeCount } };
  }

  const counts = emptyCounts();
  for (const f of collected.findings) counts[f.kind]++;

  const cleanScore = collected.componentSurface > 0
    ? Math.round((collected.cleanCurrentDS / collected.componentSurface) * 100)
    : null;

  return { ...base, findings: collected.findings, counts, cleanScore };
}
