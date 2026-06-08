import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from '../store/index.js';
import type { LibraryAnalyticsData, HotFileAuditData, HotFileEntry } from '../types.js';

interface ReportOptions {
  output: string;
}

interface SnapshotMetric {
  timestamp: string;
  dsCoverage: number;
  arcadeAdoption: number;   // Arcade 0.3 share of DS (new source of truth)
  arcade2Share: number;     // Arcade 0.2 share of DS (deprecating)
  offDls: number;           // % of DS that is NOT legacy DLS
  detachRate: number;
  totalDS: number;
  totalArcade: number;      // Arcade 0.3 instances
  totalDetached: number;
  totalComponentSurface: number;
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function computeSnapshotMetrics(audit: HotFileAuditData): SnapshotMetric | null {
  const files = audit?.files ?? [];
  if (!files.length) return null;

  let totalDS = 0, totalArcade3 = 0, totalArcade2 = 0, totalDls = 0, totalDetached = 0, totalComponentSurface = 0;

  files.forEach((f: HotFileEntry) => {
    const b = f.breakdown;
    // Older snapshots predate dsArcade3 — coalesce missing field to 0.
    const arcade3 = b.dsArcade3 ?? 0;
    // Tracked DS only: dsOther (icons/device frames/other-team libs), raw,
    // and suspected detachments are noise and excluded from every metric.
    const tracked = arcade3 + b.dsArcade + b.dsDls;
    totalDS += tracked;
    totalArcade3 += arcade3;
    totalArcade2 += b.dsArcade;
    totalDls += b.dsDls;
    totalDetached += b.detached;
    totalComponentSurface += tracked + b.detached + b.localComponent;
  });

  if (totalComponentSurface < 100) return null;

  return {
    timestamp: '',
    dsCoverage: pct(totalDS, totalComponentSurface),
    arcadeAdoption: pct(totalArcade3, totalDS || 1),
    arcade2Share: pct(totalArcade2, totalDS || 1),
    offDls: pct(totalDS - totalDls, totalDS || 1),
    detachRate: pct(totalDetached, totalComponentSurface || 1),
    totalDS,
    totalArcade: totalArcade3,
    totalDetached,
    totalComponentSurface,
  };
}

interface SlimSnapshot {
  timestamp: string;
  analytics: LibraryAnalyticsData;
  audit: { files: SlimFile[] };
}

interface SlimFile {
  fileKey: string;
  fileName: string;
  totalNodes: number;
  componentSurface: number;
  versionCount: number;
  lastModified: string;
  breakdown: HotFileEntry['breakdown'];
  suspectedDetachmentCount: number;
}

function slimAudit(audit: HotFileAuditData): { files: SlimFile[] } {
  return {
    files: (audit.files ?? []).map(f => ({
      fileKey: f.fileKey,
      fileName: f.fileName,
      totalNodes: f.totalNodes,
      componentSurface: f.componentSurface,
      versionCount: f.versionCount,
      lastModified: f.lastModified,
      breakdown: f.breakdown,
      suspectedDetachmentCount: (f.suspectedDetachments ?? []).length,
    })),
  };
}

function formatTimestamp(ts: string): string {
  return ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':').slice(0, 5);
}

async function buildSnapshots(dataDir: string): Promise<{ metrics: SnapshotMetric[]; snapshots: SlimSnapshot[] }> {
  const snapshotDir = path.join(dataDir, 'snapshots');
  let files: string[];
  try {
    files = await fs.readdir(snapshotDir);
  } catch {
    return { metrics: [], snapshots: [] };
  }

  const analyticsFiles: { ts: string; file: string }[] = [];
  const auditFiles: { ts: string; file: string }[] = [];
  for (const f of files) {
    const m = f.match(/^(library-analytics|hot-file-audit)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)/);
    if (!m) continue;
    if (m[1] === 'library-analytics') analyticsFiles.push({ ts: m[2], file: f });
    else auditFiles.push({ ts: m[2], file: f });
  }

  // analytics and audit are written sequentially by collect, so their filenames
  // may straddle a second boundary. Pair each analytics with the nearest audit
  // within a 60s window, consuming audits so each is used at most once.
  const PAIR_WINDOW_MS = 60_000;
  const tsToMs = (ts: string): number =>
    new Date(ts.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3')).getTime();

  const analyticsSorted = [...analyticsFiles].sort((a, b) => tsToMs(a.ts) - tsToMs(b.ts));
  const auditsRemaining = [...auditFiles];
  const pairs: { ts: string; analyticsFile: string; auditFile: string }[] = [];

  for (const a of analyticsSorted) {
    const aMs = tsToMs(a.ts);
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < auditsRemaining.length; i++) {
      const delta = Math.abs(tsToMs(auditsRemaining[i].ts) - aMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDelta <= PAIR_WINDOW_MS) {
      const [audit] = auditsRemaining.splice(bestIdx, 1);
      pairs.push({ ts: a.ts, analyticsFile: a.file, auditFile: audit.file });
    }
  }

  pairs.sort((a, b) => tsToMs(a.ts) - tsToMs(b.ts));

  const metrics: SnapshotMetric[] = [];
  const snapshots: SlimSnapshot[] = [];

  for (const p of pairs) {
    const analytics = await readData<LibraryAnalyticsData>(snapshotDir, p.analyticsFile);
    const audit = await readData<HotFileAuditData>(snapshotDir, p.auditFile);
    if (!analytics || !audit) continue;

    const m = computeSnapshotMetrics(audit);
    if (!m) continue;

    const label = formatTimestamp(p.ts);
    m.timestamp = label;
    metrics.push(m);

    snapshots.push({
      timestamp: label,
      analytics,
      audit: slimAudit(audit),
    });
  }

  return { metrics, snapshots };
}

interface CodeSnapshot {
  date: string;
  data: unknown;
}

async function loadCodeSnapshots(dataDir: string): Promise<CodeSnapshot[]> {
  const codeDir = path.join(dataDir, 'code-snapshots');
  let files: string[];
  try {
    files = await fs.readdir(codeDir);
  } catch {
    return [];
  }

  const matches = files
    .map(f => f.match(/^(\d{4}-\d{2}-\d{2})-observatory\.json$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => ({ date: m[1], file: m[0] }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const snapshots: CodeSnapshot[] = [];
  for (const { date, file } of matches) {
    try {
      const raw = await fs.readFile(path.join(codeDir, file), 'utf-8');
      snapshots.push({ date, data: JSON.parse(raw) });
    } catch {
      // skip unreadable snapshots
    }
  }
  return snapshots;
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

  const { metrics: snapshotMetrics, snapshots: slimSnapshots } = await buildSnapshots(dataDir);
  console.log(`Found ${snapshotMetrics.length} snapshot(s) for trend chart`);

  const codeSnapshots = await loadCodeSnapshots(dataDir);
  console.log(`Found ${codeSnapshots.length} code snapshot(s)`);

  const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dashboard');
  const html = await fs.readFile(path.join(dashboardDir, 'index.html'), 'utf-8');
  let css = await fs.readFile(path.join(dashboardDir, 'styles.css'), 'utf-8');
  const js = await fs.readFile(path.join(dashboardDir, 'app.js'), 'utf-8');

  // Embed font files as base64 data URLs for self-contained report
  const fontFiles = [
    { name: 'Chip_Text_Variable-Regular.ttf', format: 'truetype' },
    { name: 'Chip_Display_Variable-Regular.ttf', format: 'truetype' },
    { name: 'Chip_Mono-Regular.ttf', format: 'truetype' },
  ];
  for (const font of fontFiles) {
    try {
      const fontData = await fs.readFile(path.join(dashboardDir, font.name));
      const b64 = fontData.toString('base64');
      css = css.replace(
        `url('${font.name}') format('${font.format}')`,
        `url('data:font/ttf;base64,${b64}') format('${font.format}')`,
      );
    } catch {
      console.warn(`Font file ${font.name} not found, skipping embedding`);
    }
  }

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
  canonical: ${JSON.stringify(canonical)},
  snapshotMetrics: ${JSON.stringify(snapshotMetrics)},
  snapshots: ${JSON.stringify(slimSnapshots)},
  codeSnapshots: ${JSON.stringify(codeSnapshots)}
};
</script>
<script>${js}</script>`,
    );

  await fs.writeFile(options.output, report, 'utf-8');
  console.log(`Report written to ${options.output}`);
}
