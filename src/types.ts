// ---- Config ----

export interface Config {
  figmaAccessToken: string;
  figmaTeamId: string;
  figmaDsTeamId: string;
  dlsLibraryKey: string;
  arcadeLibraryKey: string;
  arcade3LibraryKey: string;
  /** File-name substrings to skip in hot-file discovery — DS libraries, internal/non-product files that skew stats */
  excludeFilePatterns: string[];
  /** Library file keys to drop from the DS team catalog — staging/test libraries that must not count as DS or pollute detachment detection */
  excludeLibraryKeys: string[];
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
  arcadeCount: number;    // Arcade 0.2
  arcade3Count: number;   // Arcade 0.3 (new source of truth)
  /** Arcade 0.3 share of (DLS + 0.2 + 0.3) — migration progress toward the SoT */
  arcadeRatio: number;
}

export interface LibraryAnalyticsData {
  collectedAt: string;
  dls: LibraryData;
  arcade: LibraryData;    // Arcade 0.2
  arcade3: LibraryData;   // Arcade 0.3
  fileBreakdown: FileBreakdownEntry[];
}

// ---- Hot-File Traversal ----

export type NodeCategory =
  | 'dsArcade3'
  | 'dsArcade'
  | 'dsDls'
  | 'dsOther'
  | 'detached'
  | 'localComponent'
  | 'raw';

export interface NodeBreakdown {
  /** Arcade 0.3 — new source of truth (a2uKnm88...) */
  dsArcade3: number;
  /** Arcade 0.2 — current official, deprecating (loThitjZ...) */
  dsArcade: number;
  /** DLS Components — oldest legacy (rNeWrFnP...) */
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
