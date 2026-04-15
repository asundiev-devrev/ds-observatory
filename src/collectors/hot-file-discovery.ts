import type { FigmaClient } from './figma-client.js';
import type { FigmaProject, FigmaProjectFile, FigmaVersion } from '../types.js';

interface DiscoveryOptions {
  teamId: string;
  windowDays: number;
  maxFiles: number;
  referenceDate?: Date;
}

interface DiscoveredFile {
  fileKey: string;
  fileName: string;
  lastModified: string;
  versionCount: number;
}

export async function discoverHotFiles(
  client: FigmaClient,
  options: DiscoveryOptions,
): Promise<DiscoveredFile[]> {
  const referenceDate = options.referenceDate ?? new Date();
  const windowStart = new Date(referenceDate.getTime() - options.windowDays * 24 * 60 * 60 * 1000);

  const projectsResp = await client.get<{ projects: FigmaProject[] }>(
    `/v1/teams/${options.teamId}/projects`,
  );

  const allFiles: FigmaProjectFile[] = [];
  for (const project of projectsResp.projects) {
    const filesResp = await client.get<{ files: FigmaProjectFile[] }>(
      `/v1/projects/${project.id}/files`,
    );
    allFiles.push(...filesResp.files);
  }

  const recentFiles = allFiles.filter((f) => new Date(f.last_modified) >= windowStart);

  const results: DiscoveredFile[] = [];
  for (const file of recentFiles) {
    const versionsResp = await client.get<{ versions: FigmaVersion[] }>(
      `/v1/files/${file.key}/versions`,
    );
    const versionsInWindow = versionsResp.versions.filter(
      (v) => new Date(v.created_at) >= windowStart,
    );
    results.push({
      fileKey: file.key,
      fileName: file.name,
      lastModified: file.last_modified,
      versionCount: versionsInWindow.length,
    });
  }

  results.sort((a, b) => b.versionCount - a.versionCount);
  return results.slice(0, options.maxFiles);
}
