import { describe, it, expect, vi } from 'vitest';
import { fetchTeamComponentCatalog } from '../../src/collectors/team-catalog.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';

describe('fetchTeamComponentCatalog', () => {
  it('resolves variant set name via containingComponentSet and paginates', async () => {
    const client = new FigmaClient('test-token');

    // Build 100 dummy components for first page to trigger pagination
    const page1Components = Array.from({ length: 100 }, (_, i) => ({
      key: `dummy${i}`,
      file_key: 'DUMMY',
      name: `Dummy${i}`,
    }));
    page1Components[0] = {
      key: 'k1',
      file_key: 'F1',
      name: 'Type=Secondary',
      containing_frame: {
        containingComponentSet: { name: '[🔴DEPRECATED]Button / Secondary' },
      },
    };

    const getSpy = vi.spyOn(client, 'get')
      .mockResolvedValueOnce({
        meta: {
          components: page1Components,
          cursor: { after: 100 },
        },
      } as any)
      .mockResolvedValueOnce({
        meta: {
          components: [{ key: 'k2', file_key: 'F2', name: 'Avatar' }],
        },
      } as any);

    const catalog = await fetchTeamComponentCatalog(client, 'TEAM');

    expect(catalog.keyToInfo.get('k1')?.displayName).toBe('[🔴DEPRECATED]Button / Secondary');
    expect(catalog.keyToInfo.get('k2')?.displayName).toBe('Avatar');
    expect(catalog.keyToFileKey.get('k1')).toBe('F1');
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('excludes components by file_key and reports excludedCount', async () => {
    const client = new FigmaClient('test-token');
    vi.spyOn(client, 'get').mockResolvedValueOnce({
      meta: {
        components: [
          { key: 'k1', file_key: 'TEST_LIB', name: 'TestComponent' },
          { key: 'k2', file_key: 'PROD_LIB', name: 'ProdComponent' },
          { key: 'k3', file_key: 'TEST_LIB', name: 'AnotherTest' },
        ],
      },
    } as any);

    const catalog = await fetchTeamComponentCatalog(client, 'TEAM', ['TEST_LIB']);

    expect(catalog.keyToFileKey.size).toBe(1);
    expect(catalog.keyToInfo.size).toBe(1);
    expect(catalog.keyToFileKey.get('k2')).toBe('PROD_LIB');
    expect(catalog.keyToInfo.get('k2')?.displayName).toBe('ProdComponent');
    expect(catalog.excludedCount).toBe(2);
  });
});
