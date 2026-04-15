import { loadConfig } from '../config.js';
import { FigmaClient } from '../collectors/figma-client.js';
import { collectLibraryAnalytics } from '../collectors/library-analytics.js';
import { discoverHotFiles } from '../collectors/hot-file-discovery.js';
import { traverseFileTree } from '../collectors/hot-file-traversal.js';
import { writeData, snapshotData } from '../store/index.js';
import path from 'node:path';
import type {
  FigmaFileResponse,
  FigmaComponentMeta,
  HotFileAuditData,
  HotFileEntry,
  LibraryAnalyticsData,
  LibraryComponentUsage,
  FileBreakdownEntry,
} from '../types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');

interface CollectOptions {
  token?: string;
  team?: string;
  hotFiles?: string;
  window?: string;
}

interface TeamComponentEntry {
  key: string;
  file_key: string;
  name: string;
  containing_frame?: {
    name?: string;
    containingComponentSet?: { name: string };
  };
}

interface TeamComponentsPage {
  meta: {
    components: TeamComponentEntry[];
    cursor?: { after?: number };
  };
}

interface ComponentInfo {
  fileKey: string;
  displayName: string;
}

/**
 * Paginate through team components API to build:
 * - key → file_key (for node classification)
 * - key → display name (resolved from component set name for variants)
 */
async function fetchTeamComponentCatalog(
  client: FigmaClient,
  teamId: string,
): Promise<{ keyToFileKey: Map<string, string>; keyToInfo: Map<string, ComponentInfo> }> {
  const keyToFileKey = new Map<string, string>();
  const keyToInfo = new Map<string, ComponentInfo>();
  let after: number | undefined;

  while (true) {
    const params: Record<string, string> = { page_size: '100' };
    if (after !== undefined) params.after = String(after);

    const page = await client.get<TeamComponentsPage>(
      `/v1/teams/${teamId}/components`,
      params,
    );

    for (const comp of page.meta.components) {
      keyToFileKey.set(comp.key, comp.file_key);

      // Resolve display name: use component set name for variants, own name for standalone
      const setName = comp.containing_frame?.containingComponentSet?.name;
      const displayName = setName ?? comp.name;

      keyToInfo.set(comp.key, { fileKey: comp.file_key, displayName });
    }

    if (page.meta.components.length < 100 || !page.meta.cursor?.after) break;
    after = page.meta.cursor.after;
  }

  return { keyToFileKey, keyToInfo };
}

/** Build library analytics from hot-file traversal data when the Enterprise API is unavailable. */
function synthesizeLibraryAnalytics(
  fileEntries: HotFileEntry[],
  fileResponses: Map<string, FigmaFileResponse>,
  libraryKeys: { dls: string; arcade: string },
  keyToFileKey: Map<string, string>,
  keyToInfo: Map<string, ComponentInfo>,
): LibraryAnalyticsData {
  const dlsComponents = new Map<string, LibraryComponentUsage>();
  const arcadeComponents = new Map<string, LibraryComponentUsage>();

  for (const entry of fileEntries) {
    const fileData = fileResponses.get(entry.fileKey);
    if (!fileData) continue;

    const instanceCounts = new Map<string, number>();
    countInstances(fileData.document, instanceCounts);

    for (const [compId, count] of instanceCounts) {
      const meta: FigmaComponentMeta | undefined = fileData.components[compId];
      if (!meta) continue;

      // Resolve file_key and display name via team component catalog
      const info = keyToInfo.get(meta.key);
      const fileKey = meta.file_key ?? info?.fileKey ?? keyToFileKey.get(meta.key);
      if (!fileKey) continue;

      const isArcade = fileKey === libraryKeys.arcade;
      const isDls = fileKey === libraryKeys.dls;
      if (!isArcade && !isDls) continue;

      const targetMap = isArcade ? arcadeComponents : dlsComponents;
      const displayName = info?.displayName ?? meta.name;

      const existing = targetMap.get(displayName);
      if (existing) {
        existing.insertions += count;
        if (!existing.files.includes(entry.fileKey)) existing.files.push(entry.fileKey);
      } else {
        targetMap.set(displayName, {
          name: displayName,
          id: compId,
          insertions: count,
          detachments: 0,
          files: [entry.fileKey],
        });
      }
    }
  }

  const dlsList = Array.from(dlsComponents.values()).sort((a, b) => b.insertions - a.insertions);
  const arcadeList = Array.from(arcadeComponents.values()).sort((a, b) => b.insertions - a.insertions);

  const fileBreakdown: FileBreakdownEntry[] = fileEntries.map((f) => {
    const total = f.breakdown.dsDls + f.breakdown.dsArcade;
    return {
      fileKey: f.fileKey,
      fileName: f.fileName,
      dlsCount: f.breakdown.dsDls,
      arcadeCount: f.breakdown.dsArcade,
      arcadeRatio: total > 0 ? f.breakdown.dsArcade / total : 0,
    };
  });

  return {
    collectedAt: new Date().toISOString(),
    dls: {
      totalInsertions: dlsList.reduce((s, c) => s + c.insertions, 0),
      totalDetachments: 0,
      components: dlsList,
      weeklyTrend: [],
    },
    arcade: {
      totalInsertions: arcadeList.reduce((s, c) => s + c.insertions, 0),
      totalDetachments: 0,
      components: arcadeList,
      weeklyTrend: [],
    },
    fileBreakdown,
  };
}

function countInstances(
  node: { type: string; componentId?: string; children?: any[] },
  counts: Map<string, number>,
): void {
  if (node.type === 'INSTANCE' && node.componentId) {
    counts.set(node.componentId, (counts.get(node.componentId) ?? 0) + 1);
  }
  if (node.children) {
    for (const child of node.children) {
      countInstances(child, counts);
    }
  }
}

export async function collectCommand(options: CollectOptions): Promise<void> {
  const config = loadConfig({
    figmaAccessToken: options.token,
    figmaTeamId: options.team,
    hotFileCount: options.hotFiles ? parseInt(options.hotFiles, 10) : undefined,
    hotFileWindowDays: options.window ? parseInt(options.window, 10) : undefined,
  });

  const client = new FigmaClient(config.figmaAccessToken);

  // Phase 0: Fetch team component catalog from DS team (key → file_key + display name)
  console.log(`Fetching component catalog from DS team...`);
  const { keyToFileKey, keyToInfo } = await fetchTeamComponentCatalog(client, config.figmaDsTeamId);
  console.log(`  ${keyToFileKey.size} published components indexed`);

  // Phase 1: Try Library Analytics (Enterprise-only, may 403)
  console.log('\nCollecting library analytics...');
  let analyticsData = await collectLibraryAnalytics(client, {
    dlsLibraryKey: config.dlsLibraryKey,
    arcadeLibraryKey: config.arcadeLibraryKey,
    teamId: config.figmaDsTeamId,
  });

  // Phase 2: Hot-File Traversal (from product team)
  console.log(`\nDiscovering top ${config.hotFileCount} active files (last ${config.hotFileWindowDays} days)...`);
  const hotFiles = await discoverHotFiles(client, {
    teamId: config.figmaTeamId,
    windowDays: config.hotFileWindowDays,
    maxFiles: config.hotFileCount,
  });
  console.log(`  Found ${hotFiles.length} active files`);

  const now = new Date();
  const windowStart = new Date(now.getTime() - config.hotFileWindowDays * 24 * 60 * 60 * 1000);

  // Build set of known DS component names for detached-frame detection
  // and name→fileKey map for fallback classification of remote components
  const dsComponentNames = new Set<string>();
  const componentNameToFileKey = new Map<string, string>();
  for (const info of keyToInfo.values()) {
    dsComponentNames.add(info.displayName);
    // Prefer Arcade over DLS when a name exists in both libraries
    const existing = componentNameToFileKey.get(info.displayName);
    if (!existing || info.fileKey === config.arcadeLibraryKey) {
      componentNameToFileKey.set(info.displayName, info.fileKey);
    }
  }
  console.log(`  ${dsComponentNames.size} unique component names for detachment detection`);

  const fileEntries: HotFileEntry[] = [];
  const fileResponses = new Map<string, FigmaFileResponse>();

  for (const file of hotFiles) {
    console.log(`  Scanning: ${file.fileName}...`);
    try {
      const fileData = await client.getFile(file.fileKey);
      fileResponses.set(file.fileKey, fileData);
      const result = traverseFileTree(fileData, {
        dls: config.dlsLibraryKey,
        arcade: config.arcadeLibraryKey,
      }, keyToFileKey, dsComponentNames, componentNameToFileKey);
      fileEntries.push({
        fileKey: file.fileKey,
        fileName: file.fileName,
        lastModified: file.lastModified,
        versionCount: file.versionCount,
        ...result,
      });
    } catch (err) {
      console.warn(`  Skipping "${file.fileName}" — ${err instanceof Error ? err.message : err}`);
    }
  }

  const auditData: HotFileAuditData = {
    collectedAt: now.toISOString(),
    window: { from: windowStart.toISOString().split('T')[0], to: now.toISOString().split('T')[0] },
    files: fileEntries,
  };

  await writeData(DATA_DIR, 'hot-file-audit.json', auditData);
  await snapshotData(DATA_DIR, 'hot-file-audit.json');

  // Synthesize library analytics from traversal if Enterprise API was unavailable
  if (!analyticsData) {
    console.log('\nSynthesizing library analytics from file traversal data...');
    analyticsData = synthesizeLibraryAnalytics(
      fileEntries, fileResponses,
      { dls: config.dlsLibraryKey, arcade: config.arcadeLibraryKey },
      keyToFileKey, keyToInfo,
    );
  }

  await writeData(DATA_DIR, 'library-analytics.json', analyticsData);
  await snapshotData(DATA_DIR, 'library-analytics.json');
  console.log(
    `  DLS: ${analyticsData.dls.totalInsertions} insertions, ${analyticsData.dls.components.length} components`,
  );
  console.log(
    `  Arcade: ${analyticsData.arcade.totalInsertions} insertions, ${analyticsData.arcade.components.length} components`,
  );

  // Summary
  const totalSurface = fileEntries.reduce((s, f) => s + f.componentSurface, 0);
  const totalDs = fileEntries.reduce(
    (s, f) => s + f.breakdown.dsArcade + f.breakdown.dsDls + f.breakdown.dsOther,
    0,
  );
  const totalArcade = fileEntries.reduce((s, f) => s + f.breakdown.dsArcade, 0);
  const totalDetached = fileEntries.reduce((s, f) => s + f.breakdown.detached, 0);

  console.log('\n--- Summary ---');
  console.log(`DS Coverage: ${totalSurface > 0 ? ((totalDs / totalSurface) * 100).toFixed(1) : 0}%`);
  console.log(`Arcade Adoption: ${totalDs > 0 ? ((totalArcade / totalDs) * 100).toFixed(1) : 0}%`);
  console.log(`Detachment Rate: ${(totalDetached + totalDs) > 0 ? ((totalDetached / (totalDetached + totalDs)) * 100).toFixed(1) : 0}%`);
  console.log('\nData written to ./data/');
}
