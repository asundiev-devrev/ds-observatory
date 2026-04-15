import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectLibraryAnalytics } from '../src/collectors/library-analytics.js';
import type { FigmaClient } from '../src/collectors/figma-client.js';
import dlsResponse from './fixtures/library-analytics-response.json';
import teamComponentsResponse from './fixtures/team-components-response.json';

describe('collectLibraryAnalytics', () => {
  let mockClient: FigmaClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
    } as unknown as FigmaClient;
  });

  it('collects and transforms DLS and Arcade usage data', async () => {
    (mockClient.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(dlsResponse)
      .mockResolvedValueOnce({ component_usages: [], weekly_trends: [] })
      .mockResolvedValueOnce(teamComponentsResponse);

    const result = await collectLibraryAnalytics(mockClient, {
      dlsLibraryKey: 'dls-key',
      arcadeLibraryKey: 'arcade-key',
      teamId: 'team-123',
    });

    expect(result.dls.totalInsertions).toBe(100);
    expect(result.dls.totalDetachments).toBe(4);
    expect(result.dls.components).toHaveLength(2);
    expect(result.dls.components[0].name).toBe('Button');
    expect(result.dls.components[0].insertions).toBe(70);
    expect(result.dls.weeklyTrend).toHaveLength(2);
    expect(result.arcade.totalInsertions).toBe(0);
    expect(result.fileBreakdown).toHaveLength(2);
    expect(result.collectedAt).toBeDefined();
  });

  it('computes file breakdown with arcade ratio', async () => {
    const arcadeResponse = {
      component_usages: [
        {
          component: { key: 'arc-btn', name: 'Button' },
          usages: [{ file_key: 'file-a', file_name: 'App Designs', insertions: 25, detachments: 0 }],
        },
      ],
      weekly_trends: [],
    };

    (mockClient.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(dlsResponse)
      .mockResolvedValueOnce(arcadeResponse)
      .mockResolvedValueOnce(teamComponentsResponse);

    const result = await collectLibraryAnalytics(mockClient, {
      dlsLibraryKey: 'dls-key',
      arcadeLibraryKey: 'arcade-key',
      teamId: 'team-123',
    });

    const fileA = result.fileBreakdown.find((f) => f.fileKey === 'file-a')!;
    expect(fileA.dlsCount).toBe(80);
    expect(fileA.arcadeCount).toBe(25);
    expect(fileA.arcadeRatio).toBeCloseTo(25 / 105, 2);
  });
});
