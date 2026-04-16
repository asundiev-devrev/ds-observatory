import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ServeOptions {
  port: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
};

export async function serveCommand(options: ServeOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dashboard');
  const dataDir = path.resolve(process.cwd(), 'data');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    // List snapshot files
    if (url === '/data/snapshots/') {
      try {
        const snapshotDir = path.join(dataDir, 'snapshots');
        const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    if (url.startsWith('/data/')) {
      const filePath = path.join(dataDir, url.slice(6));
      return serveFile(filePath, res);
    }

    const filePath = url === '/' ? path.join(dashboardDir, 'index.html') : path.join(dashboardDir, url);
    serveFile(filePath, res);
  });

  server.listen(port, () => {
    console.log(`DS Observatory dashboard running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop');
  });
}

function serveFile(filePath: string, res: http.ServerResponse): void {
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}
