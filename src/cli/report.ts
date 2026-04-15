import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from '../store/index.js';
import type { LibraryAnalyticsData, HotFileAuditData } from '../types.js';

interface ReportOptions {
  output: string;
}

export async function reportCommand(options: ReportOptions): Promise<void> {
  const dataDir = path.resolve(process.cwd(), 'data');

  const analytics = await readData<LibraryAnalyticsData>(dataDir, 'library-analytics.json');
  const audit = await readData<HotFileAuditData>(dataDir, 'hot-file-audit.json');
  const canonical = await readData<Record<string, unknown>>(dataDir, 'canonical-components.json');

  if (!analytics || !audit) {
    console.error('No data found. Run `ds-observatory collect` first.');
    process.exit(1);
  }

  const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dashboard');
  const html = await fs.readFile(path.join(dashboardDir, 'index.html'), 'utf-8');
  const css = await fs.readFile(path.join(dashboardDir, 'styles.css'), 'utf-8');
  const js = await fs.readFile(path.join(dashboardDir, 'app.js'), 'utf-8');

  const report = html
    .replace(
      '<link rel="stylesheet" href="styles.css">',
      `<style>${css}</style>`,
    )
    .replace(
      '<script src="app.js"></script>',
      `<script>
window.__DS_OBSERVATORY_DATA__ = {
  analytics: ${JSON.stringify(analytics)},
  audit: ${JSON.stringify(audit)},
  canonical: ${JSON.stringify(canonical)}
};
</script>
<script>${js}</script>`,
    );

  await fs.writeFile(options.output, report, 'utf-8');
  console.log(`Report written to ${options.output}`);
}
