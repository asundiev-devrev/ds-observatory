export function buildDeepLink(fileKey: string, nodeId: string, version?: string): string {
  const base = `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;
  return version ? `${base}&version-id=${encodeURIComponent(version)}` : base;
}
