import type { FigmaClient } from './figma-client.js';

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

export interface ComponentInfo {
  fileKey: string;
  displayName: string;
}

export interface Catalog {
  keyToFileKey: Map<string, string>;
  keyToInfo: Map<string, ComponentInfo>;
  excludedCount: number;
}

/**
 * Paginate through team components API to build:
 * - key → file_key (for node classification)
 * - key → display name (resolved from component set name for variants)
 */
export async function fetchTeamComponentCatalog(
  client: FigmaClient,
  teamId: string,
  excludeLibraryKeys: string[] = [],
): Promise<Catalog> {
  const keyToFileKey = new Map<string, string>();
  const keyToInfo = new Map<string, ComponentInfo>();
  const excludeSet = new Set(excludeLibraryKeys);
  let excludedCount = 0;
  let after: number | undefined;

  while (true) {
    const params: Record<string, string> = { page_size: '100' };
    if (after !== undefined) params.after = String(after);

    const page = await client.get<TeamComponentsPage>(
      `/v1/teams/${teamId}/components`,
      params,
    );

    for (const comp of page.meta.components) {
      // Drop staging/test libraries entirely so they never count as DS or feed
      // detachment detection downstream.
      if (excludeSet.has(comp.file_key)) {
        excludedCount++;
        continue;
      }

      keyToFileKey.set(comp.key, comp.file_key);

      // Resolve display name: use component set name for variants, own name for standalone
      const setName = comp.containing_frame?.containingComponentSet?.name;
      const displayName = setName ?? comp.name;

      keyToInfo.set(comp.key, { fileKey: comp.file_key, displayName });
    }

    if (page.meta.components.length < 100 || !page.meta.cursor?.after) break;
    after = page.meta.cursor.after;
  }

  return { keyToFileKey, keyToInfo, excludedCount };
}
