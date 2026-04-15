import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverHotFiles } from '../src/collectors/hot-file-discovery.js';
import type { FigmaClient } from '../src/collectors/figma-client.js';
import projectsResponse from './fixtures/projects-response.json';
import filesResponse from './fixtures/files-response.json';
import versionsResponse from './fixtures/versions-response.json';

describe('discoverHotFiles', () => {
  let mockClient: FigmaClient;

  beforeEach(() => {
    mockClient = { get: vi.fn() } as unknown as FigmaClient;
  });

  it('discovers and ranks files by version count within window', async () => {
    const get = mockClient.get as ReturnType<typeof vi.fn>;
    get.mockResolvedValueOnce(projectsResponse);
    get.mockResolvedValueOnce(filesResponse);
    get.mockResolvedValueOnce({ files: [] });
    get.mockResolvedValueOnce(versionsResponse);
    get.mockResolvedValueOnce({
      versions: [
        { id: 'v1', created_at: '2026-03-20T12:00:00Z', label: '', description: '' },
        { id: 'v2', created_at: '2025-01-01T12:00:00Z', label: '', description: '' },
      ],
    });

    const result = await discoverHotFiles(mockClient, {
      teamId: 'team-123',
      windowDays: 60,
      maxFiles: 5,
      referenceDate: new Date('2026-04-14T00:00:00Z'),
    });

    expect(result.length).toBeLessThanOrEqual(5);
    expect(result[0].fileKey).toBe('file-hot');
    expect(result[0].versionCount).toBeGreaterThan(result[1].versionCount);
  });

  it('excludes files with last_modified outside the window', async () => {
    const get = mockClient.get as ReturnType<typeof vi.fn>;
    get.mockResolvedValueOnce(projectsResponse);
    get.mockResolvedValueOnce(filesResponse);
    get.mockResolvedValueOnce({ files: [] });
    // Mock versions for file-hot (within window)
    get.mockResolvedValueOnce(versionsResponse);
    // Mock versions for file-warm (within window)
    get.mockResolvedValueOnce({
      versions: [
        { id: 'v1', created_at: '2026-03-20T12:00:00Z', label: '', description: '' },
      ],
    });

    const result = await discoverHotFiles(mockClient, {
      teamId: 'team-123',
      windowDays: 60,
      maxFiles: 5,
      referenceDate: new Date('2026-04-14T00:00:00Z'),
    });

    expect(result.find((f) => f.fileKey === 'file-cold')).toBeUndefined();
  });
});
