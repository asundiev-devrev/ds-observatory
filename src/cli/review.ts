// src/cli/review.ts
import { loadConfig } from '../config.js';
import { FigmaClient } from '../collectors/figma-client.js';
import { fetchTeamComponentCatalog } from '../collectors/team-catalog.js';
import { review } from '../review/reviewer.js';
import type { Finding } from '../review/types.js';

export function parseFigmaTarget(input: string): { fileKey: string; nodeId: string } {
  const trimmed = input.trim();

  const urlMatch = trimmed.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    const nodeMatch = trimmed.match(/[?&]node-id=([0-9]+(?:-[0-9]+)+)/);
    if (!nodeMatch) throw new Error('Figma URL is missing a node-id query parameter.');
    return { fileKey: urlMatch[1], nodeId: nodeMatch[1].replace(/-/g, ':') };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { fileKey: parts[0], nodeId: parts[1] };
  }

  throw new Error('Expected a Figma URL with node-id, or "<fileKey> <nodeId>".');
}

const EMOJI: Record<Finding['kind'], string> = { deprecated: '🔴', detached: '⚪' };

export async function reviewCommand(input: string, options: { token?: string }): Promise<void> {
  const config = loadConfig({ figmaAccessToken: options.token });
  const client = new FigmaClient(config.figmaAccessToken);
  const { fileKey, nodeId } = parseFigmaTarget(input);

  console.log(`Fetching component catalog...`);
  const catalog = await fetchTeamComponentCatalog(client, config.figmaDsTeamId, config.excludeLibraryKeys);

  console.log(`Reviewing ${fileKey} node ${nodeId}...`);
  const result = await review(
    {
      client,
      catalog,
      libraryKeys: { dls: config.dlsLibraryKey, arcade: config.arcadeLibraryKey, arcade3: config.arcade3LibraryKey },
      now: () => new Date().toISOString(),
    },
    { fileKey, nodeId },
  );

  console.log(`\n🔭 ${result.frameName} — on current DS lib: ${result.cleanScore ?? 'n/a'}%`);
  if (result.tooLarge) {
    const detail = result.tooLarge.nodeCount ? ` (${result.tooLarge.nodeCount} nodes)` : '';
    console.log(`  ⚠️  Too large to review — ${result.tooLarge.reason}${detail}.`);
    return;
  }
  if (result.findings.length === 0) {
    console.log('  ✅ No issues found.');
    return;
  }
  console.log(`  ${result.counts.deprecated} deprecated, ${result.counts.detached} detached\n`);
  for (const f of result.findings) {
    console.log(`  ${EMOJI[f.kind]} ${f.kind}: ${f.detail} (${f.nodeId})`);
  }
}
