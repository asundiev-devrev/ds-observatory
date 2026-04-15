import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeData, readData, snapshotData } from '../src/store/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('store', () => {
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-obs-test-'));
  });

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  it('writes and reads JSON data', async () => {
    const data = { collectedAt: '2026-04-14', items: [1, 2, 3] };
    await writeData(testDataDir, 'test-data.json', data);
    const result = await readData(testDataDir, 'test-data.json');
    expect(result).toEqual(data);
  });

  it('returns null for non-existent file', async () => {
    const result = await readData(testDataDir, 'missing.json');
    expect(result).toBeNull();
  });

  it('creates a timestamped snapshot copy', async () => {
    const data = { collectedAt: '2026-04-14T10:00:00Z', value: 42 };
    await writeData(testDataDir, 'metrics.json', data);
    await snapshotData(testDataDir, 'metrics.json');

    const snapshotDir = path.join(testDataDir, 'snapshots');
    const files = fs.readdirSync(snapshotDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^metrics-\d{4}-\d{2}-\d{2}T.*\.json$/);

    const snapshotContent = JSON.parse(fs.readFileSync(path.join(snapshotDir, files[0]), 'utf-8'));
    expect(snapshotContent).toEqual(data);
  });
});
