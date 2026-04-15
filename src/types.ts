// ---- Config ----

export interface Config {
  figmaAccessToken: string;
  figmaTeamId: string;
  figmaDsTeamId: string;
  dlsLibraryKey: string;
  arcadeLibraryKey: string;
  hotFileCount: number;
  hotFileWindowDays: number;
}

// ---- Library Analytics ----

export interface LibraryComponentUsage {
  name: string;
  id: string;
  insertions: number;
  detachments: number;
  files: string[];
}

export interface WeeklyTrend {
  week: string;
  insertions: number;
  detachments: number;
}

export interface LibraryData {
  totalInsertions: number;
  totalDetachments: number;
  components: LibraryComponentUsage[];
  weeklyTrend: WeeklyTrend[];
}

export interface FileBreakdownEntry {
  fileKey: string;
  fileName: string;
  dlsCount: number;
  arcadeCount: number;
  arcadeRatio: number;
}

export interface LibraryAnalyticsData {
  collectedAt: string;
  dls: LibraryData;
  arcade: LibraryData;
  fileBreakdown: FileBreakdownEntry[];
}

// ---- Hot-File Traversal ----

export type NodeCategory =
  | 'dsArcade'
  | 'dsDls'
  | 'dsOther'
  | 'detached'
  | 'localComponent'
  | 'raw';

export interface NodeBreakdown {
  dsArcade: number;
  dsDls: number;
  dsOther: number;
  detached: number;
  localComponent: number;
  raw: number;
}

export interface DetachedInstance {
  nodeId: string;
  name: string;
  originalComponent: string;
}

export interface SuspectedDetachment {
  nodeId: string;
  name: string;
  matchedComponentName: string;
}

export interface OtherLibraryUsage {
  fileKey: string;
  instanceCount: number;
}

export interface LocalComponent {
  nodeId: string;
  name: string;
  instanceCount: number;
}

export interface HotFileEntry {
  fileKey: string;
  fileName: string;
  lastModified: string;
  versionCount: number;
  totalNodes: number;
  componentSurface: number;
  breakdown: NodeBreakdown;
  detachedInstances: DetachedInstance[];
  suspectedDetachments: SuspectedDetachment[];
  otherLibraries: OtherLibraryUsage[];
  localComponents: LocalComponent[];
}

export interface HotFileAuditData {
  collectedAt: string;
  window: { from: string; to: string };
  files: HotFileEntry[];
}

// ---- Figma API response shapes (subset we use) ----

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  componentId?: string;
  componentProperties?: Record<string, unknown>;
}

export interface FigmaComponentMeta {
  key: string;
  name: string;
  description: string;
  remote?: boolean;
  documentationLinks?: unknown[];
  containing_frame?: { name: string };
  /** Only present in team components response, NOT in file response */
  file_key?: string;
}

export interface FigmaFileResponse {
  name: string;
  lastModified: string;
  document: FigmaNode;
  components: Record<string, FigmaComponentMeta>;
}

export interface FigmaVersion {
  id: string;
  created_at: string;
  label: string;
  description: string;
}

export interface FigmaProjectFile {
  key: string;
  name: string;
  last_modified: string;
}

export interface FigmaProject {
  id: number;
  name: string;
}
