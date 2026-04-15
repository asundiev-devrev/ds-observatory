import type { FigmaFileResponse, FigmaNode, FigmaComponentMeta } from '../types.js';

const BASE_URL = 'https://api.figma.com';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface NodesResponse {
  nodes: Record<string, {
    document: FigmaNode;
    components: Record<string, FigmaComponentMeta>;
  }>;
}

export class FigmaClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  /**
   * Fetch a full Figma file. If the file is too large (400), falls back to
   * per-page fetching via the /nodes endpoint and merges the results.
   */
  async getFile(fileKey: string): Promise<FigmaFileResponse> {
    try {
      return await this.get<FigmaFileResponse>(`/v1/files/${fileKey}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('400')) throw err;

      console.warn(`    File too large for single request — fetching per-page...`);
      return this.getFileByPages(fileKey);
    }
  }

  private async getFileByPages(fileKey: string): Promise<FigmaFileResponse> {
    // Step 1: Get file structure at depth=1 (pages only)
    const shell = await this.get<FigmaFileResponse>(`/v1/files/${fileKey}`, { depth: '1' });
    const pages = shell.document.children ?? [];

    const allComponents: Record<string, FigmaComponentMeta> = { ...shell.components };
    const fullPages: FigmaNode[] = [];

    // Step 2: Fetch each page's subtree individually with depth limiting
    // depth=5 captures most component instances while keeping response sizes manageable
    for (const page of pages) {
      try {
        const resp = await this.get<NodesResponse>(
          `/v1/files/${fileKey}/nodes`,
          { ids: page.id, depth: '5' },
        );

        const nodeData = resp.nodes[page.id];
        if (nodeData) {
          fullPages.push(nodeData.document);
          Object.assign(allComponents, nodeData.components);
        } else {
          fullPages.push(page);
        }
      } catch (pageErr) {
        const pageMsg = pageErr instanceof Error ? pageErr.message : String(pageErr);
        console.warn(`    Page "${page.name}" skipped: ${pageMsg}`);
        fullPages.push(page);
      }
    }

    return {
      name: shell.name,
      lastModified: shell.lastModified,
      document: { ...shell.document, children: fullPages },
      components: allComponents,
    };
  }

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${BASE_URL}${path}`;
    if (params) {
      const query = new URLSearchParams(params).toString();
      url += `?${query}`;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'X-Figma-Token': this.token },
        });
      } catch (err) {
        // Network error on connect — retry
        if (attempt === MAX_RETRIES) {
          throw new Error(`Network error after ${MAX_RETRIES + 1} attempts: ${path} — ${err}`);
        }
        const delayMs = Math.pow(2, attempt + 1) * BASE_DELAY_MS;
        console.warn(`  Network error on ${path}, retrying in ${delayMs / 1000}s...`);
        await this.sleep(delayMs);
        continue;
      }

      if (response.ok) {
        try {
          return await response.json() as T;
        } catch (err) {
          // Socket dropped during body transfer — retry
          if (attempt === MAX_RETRIES) {
            throw new Error(`Body read error after ${MAX_RETRIES + 1} attempts: ${path} — ${err}`);
          }
          const delayMs = Math.pow(2, attempt + 1) * BASE_DELAY_MS;
          console.warn(`  Connection dropped reading ${path}, retrying in ${delayMs / 1000}s...`);
          await this.sleep(delayMs);
          continue;
        }
      }

      if (response.status === 429) {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Rate limited after ${MAX_RETRIES + 1} attempts: ${path}`);
        }
        const retryAfter = response.headers instanceof Map
          ? response.headers.get('retry-after')
          : response.headers?.get?.('retry-after');
        const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : Math.pow(2, attempt);
        const delayMs = delaySeconds * BASE_DELAY_MS;
        await this.sleep(delayMs);
        continue;
      }

      throw new Error(`Figma API error ${response.status}: ${response.statusText} — ${path}`);
    }

    throw new Error(`Unexpected: exhausted retries without returning — ${path}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
