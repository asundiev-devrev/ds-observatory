import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FigmaClient } from '../src/collectors/figma-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('FigmaClient', () => {
  let client: FigmaClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new FigmaClient('test-token-123');
  });

  it('sends auth header on every request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 'test' }),
    });

    await client.get('/v1/files/abc123');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.figma.com/v1/files/abc123',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Figma-Token': 'test-token-123',
        }),
      }),
    );
  });

  it('retries on 429 with exponential backoff', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Map([['retry-after', '1']]),
        json: async () => ({ error: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'success' }),
      });

    const result = await client.get('/v1/files/abc123');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: 'success' });
  });

  it('throws after max retries exhausted', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Map([['retry-after', '1']]),
      json: async () => ({ error: true }),
    });

    await expect(client.get('/v1/files/abc123')).rejects.toThrow('Rate limited');
  });

  it('throws on non-429 errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ err: 'not found' }),
    });

    await expect(client.get('/v1/files/abc123')).rejects.toThrow('Figma API error 404');
  });

  it('appends query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/v1/files/abc123', { depth: '1', branch_data: 'true' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('depth=1');
    expect(calledUrl).toContain('branch_data=true');
  });
});
