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
  arcade3LibraryKey: string;
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
  arcade3Response: FigmaAnalyticsResponse,
): FileBreakdownEntry[] {
  type Row = { fileName: string; dlsCount: number; arcadeCount: number; arcade3Count: number };
  const fileMap = new Map<string, Row>();
  const blank = (fileName: string): Row => ({ fileName, dlsCount: 0, arcadeCount: 0, arcade3Count: 0 });

  for (const cu of dlsResponse.component_usages)
    for (const u of cu.usages) {
      const r = fileMap.get(u.file_key) ?? blank(u.file_name);
      r.dlsCount += u.insertions; fileMap.set(u.file_key, r);
    }
  for (const cu of arcadeResponse.component_usages)
    for (const u of cu.usages) {
      const r = fileMap.get(u.file_key) ?? blank(u.file_name);
      r.arcadeCount += u.insertions; fileMap.set(u.file_key, r);
    }
  for (const cu of arcade3Response.component_usages)
    for (const u of cu.usages) {
      const r = fileMap.get(u.file_key) ?? blank(u.file_name);
      r.arcade3Count += u.insertions; fileMap.set(u.file_key, r);
    }

  return Array.from(fileMap.entries()).map(([fileKey, data]) => {
    const total = data.dlsCount + data.arcadeCount + data.arcade3Count;
    return {
      fileKey,
      fileName: data.fileName,
      dlsCount: data.dlsCount,
      arcadeCount: data.arcadeCount,
      arcade3Count: data.arcade3Count,
      arcadeRatio: total > 0 ? data.arcade3Count / total : 0,
    };
  });
}

export async function collectLibraryAnalytics(
  client: FigmaClient,
  options: CollectOptions,
): Promise<LibraryAnalyticsData> {
  try {
    const [dlsResponse, arcadeResponse, arcade3Response] = await Promise.all([
      client.get<FigmaAnalyticsResponse>(`/v1/analytics/libraries/${options.dlsLibraryKey}/component/usages`),
      client.get<FigmaAnalyticsResponse>(`/v1/analytics/libraries/${options.arcadeLibraryKey}/component/usages`),
      client.get<FigmaAnalyticsResponse>(`/v1/analytics/libraries/${options.arcade3LibraryKey}/component/usages`),
    ]);

    return {
      collectedAt: new Date().toISOString(),
      dls: transformLibraryData(dlsResponse),
      arcade: transformLibraryData(arcadeResponse),
      arcade3: transformLibraryData(arcade3Response),
      fileBreakdown: buildFileBreakdown(dlsResponse, arcadeResponse, arcade3Response),
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
