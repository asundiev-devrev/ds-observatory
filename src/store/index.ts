import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeData(dataDir: string, filename: string, data: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readData<T = unknown>(dataDir: string, filename: string): Promise<T | null> {
  const filePath = path.join(dataDir, filename);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function snapshotData(dataDir: string, filename: string): Promise<void> {
  const sourcePath = path.join(dataDir, filename);
  const snapshotDir = path.join(dataDir, 'snapshots');
  await fs.mkdir(snapshotDir, { recursive: true });

  const raw = await fs.readFile(sourcePath, 'utf-8');
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const baseName = path.basename(filename, '.json');
  const snapshotFilename = `${baseName}-${timestamp}.json`;
  await fs.writeFile(path.join(snapshotDir, snapshotFilename), raw, 'utf-8');
}
