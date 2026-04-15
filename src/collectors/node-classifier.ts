import type { FigmaNode, FigmaComponentMeta, NodeCategory } from '../types.js';

interface LibraryKeys {
  dls: string;
  arcade: string;
}

export interface ClassificationResult {
  category: NodeCategory;
  sourceFileKey?: string;
}

/**
 * Classify a Figma node into a design system category.
 *
 * @param componentKeyToFileKey - Map from component `key` (hash) to the `file_key`
 *   of the library file it was published from. Built from the team components API.
 *   When empty/missing, remote components are classified as 'dsOther' if marked remote,
 *   or 'detached' if no metadata exists.
 */
export function classifyNode(
  node: FigmaNode,
  components: Record<string, FigmaComponentMeta>,
  libraryKeys: LibraryKeys,
  componentKeyToFileKey?: Map<string, string>,
  componentNameToFileKey?: Map<string, string>,
): ClassificationResult {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return { category: 'localComponent' };
  }

  if (node.type === 'INSTANCE') {
    const componentId = node.componentId;
    if (!componentId) return { category: 'detached' };

    const meta = components[componentId];
    if (!meta) return { category: 'detached' };

    // Resolve file_key: prefer team components lookup, fall back to meta.file_key
    let fileKey = meta.file_key;
    if (!fileKey && componentKeyToFileKey && meta.key) {
      fileKey = componentKeyToFileKey.get(meta.key);
    }

    // Name-based fallback: match component name against known DS catalog
    // Try containing_frame name first (component set name for variants), then raw name
    if (!fileKey && meta.remote && componentNameToFileKey) {
      const frameName = meta.containing_frame?.name;
      if (frameName) fileKey = componentNameToFileKey.get(frameName);
      if (!fileKey) fileKey = componentNameToFileKey.get(meta.name);
    }

    if (fileKey) {
      if (fileKey === libraryKeys.dls) return { category: 'dsDls', sourceFileKey: fileKey };
      if (fileKey === libraryKeys.arcade) return { category: 'dsArcade', sourceFileKey: fileKey };
      return { category: 'dsOther', sourceFileKey: fileKey };
    }

    // No file_key resolved — if marked remote it's from some library
    if (meta.remote) return { category: 'dsOther' };

    return { category: 'detached' };
  }

  return { category: 'raw' };
}
