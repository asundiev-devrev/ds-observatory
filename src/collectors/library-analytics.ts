import type { FigmaClient } from './figma-client.js';
import type {
  LibraryAnalyticsData,
  LibraryData,
  LibraryComponentUsage,
  FileBreakdownEntry,
} from '../types.js';

interface CollectOptions {
  dlsLibraryKey: string;
  arcadeLibraryKey: string;
  teamId: string;
}

interface FigmaUsageEntry {
  file_key: string;
  file_name: string;
  insertions: number;
  detachments: number;
}

interface FigmaComponentUsage {
  component: { key: string; name: string };
  usages: FigmaUsageEntry[];
}

interface FigmaAnalyticsResponse {
  component_usages: FigmaComponentUsage[];
  weekly_trends: Array<{ week: string; insertions: number; detachments: number }>;
}

function transformLibraryData(response: FigmaAnalyticsResponse): LibraryData {
  const components: LibraryComponentUsage[] = response.component_usages.map((cu) => {
    const insertions = cu.usages.reduce((sum, u) => sum + u.insertions, 0);
    const detachments = cu.usages.reduce((sum, u) => sum + u.detachments, 0);
    const files = cu.usages.map((u) => u.file_key);
    return { name: cu.component.name, id: cu.component.key, insertions, detachments, files };
  });

  return {
    totalInsertions: components.reduce((sum, c) => sum + c.insertions, 0),
    totalDetachments: components.reduce((sum, c) => sum + c.detachments, 0),
    components,
    weeklyTrend: response.weekly_trends.map((w) => ({
      week: w.week,
      insertions: w.insertions,
      detachments: w.detachments,
    })),
  };
}

function buildFileBreakdown(
  dlsResponse: FigmaAnalyticsResponse,
  arcadeResponse: FigmaAnalyticsResponse,
): FileBreakdownEntry[] {
  const fileMap = new Map<string, { fileName: string; dlsCount: number; arcadeCount: number }>();

  for (const cu of dlsResponse.component_usages) {
    for (const u of cu.usages) {
      const existing = fileMap.get(u.file_key) ?? { fileName: u.file_name, dlsCount: 0, arcadeCount: 0 };
      existing.dlsCount += u.insertions;
      fileMap.set(u.file_key, existing);
    }
  }

  for (const cu of arcadeResponse.component_usages) {
    for (const u of cu.usages) {
      const existing = fileMap.get(u.file_key) ?? { fileName: u.file_name, dlsCount: 0, arcadeCount: 0 };
      existing.arcadeCount += u.insertions;
      fileMap.set(u.file_key, existing);
    }
  }

  return Array.from(fileMap.entries()).map(([fileKey, data]) => {
    const total = data.dlsCount + data.arcadeCount;
    return {
      fileKey,
      fileName: data.fileName,
      dlsCount: data.dlsCount,
      arcadeCount: data.arcadeCount,
      arcadeRatio: total > 0 ? data.arcadeCount / total : 0,
    };
  });
}

export async function collectLibraryAnalytics(
  client: FigmaClient,
  options: CollectOptions,
): Promise<LibraryAnalyticsData> {
  try {
    const [dlsResponse, arcadeResponse] = await Promise.all([
      client.get<FigmaAnalyticsResponse>(`/v1/analytics/libraries/${options.dlsLibraryKey}/component/usages`),
      client.get<FigmaAnalyticsResponse>(`/v1/analytics/libraries/${options.arcadeLibraryKey}/component/usages`),
    ]);

    return {
      collectedAt: new Date().toISOString(),
      dls: transformLibraryData(dlsResponse),
      arcade: transformLibraryData(arcadeResponse),
      fileBreakdown: buildFileBreakdown(dlsResponse, arcadeResponse),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('403')) {
      console.warn('  Library Analytics API returned 403 (Enterprise-only endpoint).');
      console.warn('  Will synthesize library data from hot-file traversal instead.');
      return null as unknown as LibraryAnalyticsData;
    }
    throw error;
  }
}
