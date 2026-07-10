# DS Observatory — Active Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a designer marks a Figma frame "Ready for dev", automatically review it for design-system drift (deprecated + detached components) and post a summary comment in Figma plus a digest to `#ads-core-team` in Slack.

**Architecture:** A pure reviewer core (`review(client, catalog, target) → ReviewResult`) is exercised three ways in increasing infra: (1) a local `ds-observatory review <url>` CLI, (2) the same core driving Figma-comment + Slack emitters, (3) a Cloudflare Worker webhook receiver → Queue → consumer that calls the core + emitters, with a D1 store for idempotency and comment upsert. Build order goes core → CLI → emitters → Worker so every phase is independently provable.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥18, vitest, `tsx`, commander, Cloudflare Workers + Queues + D1 (`wrangler`), Figma REST API, Slack Web API.

## Global Constraints

- **Language/module:** TypeScript, `"type": "module"`. All relative imports use the `.js` extension (e.g. `import { x } from './deep-link.js'`), matching the existing codebase.
- **Testing:** vitest. `npm test` runs `vitest run`. Test files live in `test/` mirroring `src/` paths, named `*.test.ts`. Use `describe/it/expect`; mock `fetch` via `vi.stubGlobal('fetch', mockFetch)` as in `test/figma-client.test.ts`.
- **The reviewer core and its dependencies (`src/review/**`, `src/collectors/team-catalog.ts`) MUST NOT import `node:fs`, `node:path`, `node:http`, or any Node-only API** — they run in the Cloudflare Worker runtime. `fetch`, `setTimeout`, `console` are allowed (available in Workers). Node-only code (CLI, local store reads) stays in `src/cli/**` and `src/store/index.ts`.
- **v1 checks are exactly two:** `deprecated` and `detached`. Do NOT implement old-generation or raw-value detection (deferred to v2 per spec §9).
- **Deprecation marker:** case-insensitive substring `DEPRECATED` appearing inside a bracketed prefix in the component **set** display name (e.g. `[🔴DEPRECATED]Button / Secondary`). Matched via `/\[[^\]]*DEPRECATED[^\]]*\]/i`.
- **Consolidated library key:** `a2uKnm88LxRXEWAL1kOqeQ` (Arcade 0.3 / current SoT). Legacy DLS `rNeWrFnPT8J903T2jon2oG`, Arcade 0.2 `loThitjZGdpisyETz5avvz` — these are used only for the existing `classifyNode` detached path, NOT for generation detection.
- **Node-count ceiling:** `MAX_REVIEW_NODES = 5000`. A review whose subtree exceeds this is reported as "too large", not enumerated.
- **Deep-link format:** `https://www.figma.com/file/{fileKey}?node-id={encodeURIComponent(nodeId)}` with `&version-id={version}` appended only when a version is provided.
- **Idempotency:** dedup key is exactly `` `${fileKey}:${nodeId}:${version}` ``.
- **Spec reference:** `docs/superpowers/specs/2026-07-10-active-review-design.md`. This plan implements v1 (§1–§8); §9 items are out of scope.

---

## File Structure

**Created:**
- `src/review/types.ts` — `FindingKind`, `Finding`, `ReviewResult`, `ReviewTarget`
- `src/review/deep-link.ts` — `buildDeepLink(fileKey, nodeId, version?)`
- `src/review/deprecation.ts` — `isDeprecatedName(name)`
- `src/review/checks.ts` — `collectFindings(root, ctx)` (walks subtree, emits findings)
- `src/review/reviewer.ts` — `review(client, catalog, target)` (fetch + ceiling + findings + cleanScore)
- `src/collectors/team-catalog.ts` — extracted `fetchTeamComponentCatalog` + `Catalog` type (shared by collect + reviewer)
- `src/emitters/figma-comment.ts` — `formatCommentBody(result)`, `upsertFrameComment(...)`, `clearFrameComment(...)`
- `src/emitters/slack.ts` — `formatSlackBlocks(result, mention)`, `resolveMention(user, map)`, `postDigest(...)`
- `src/store/review-store.ts` — D1-backed `ReviewStore` (`claim`, `getCommentId`, `setCommentId`, `clear`)
- `src/cli/review.ts` — `reviewCommand(urlOrKey, options)` + `parseFigmaTarget(input)`
- `worker/handlers/receiver.ts` — webhook handler logic (verify passcode → enqueue)
- `worker/handlers/consumer.ts` — queue handler logic (claim → review → emit → store)
- `worker/index.ts` — the single Worker entry: one `export default` exposing both `fetch` and `queue`
- `tsconfig.worker.json` — type-checks `worker/` + its `src/` imports (the base tsconfig only covers `src/`)
- `wrangler.jsonc` — Worker + Queue + D1 + KV bindings
- Test files mirroring each of the above under `test/`

**Modified:**
- `src/cli/collect.ts` — replace inline `fetchTeamComponentCatalog` with import from `team-catalog.ts`
- `src/cli/index.ts` — register the `review` command
- `README.md` — document the `review` command + Worker (final task)

---

## Phase A — Pure reviewer core (Node + Worker portable)

### Task 1: Review types + deep-link builder

**Files:**
- Create: `src/review/types.ts`
- Create: `src/review/deep-link.ts`
- Test: `test/review/deep-link.test.ts`

**Interfaces:**
- Produces: the type contract every later task consumes, and `buildDeepLink`.

```ts
// src/review/types.ts
export type FindingKind = 'deprecated' | 'detached';

export interface Finding {
  kind: FindingKind;
  nodeId: string;
  nodeName: string;
  detail: string;
}

export interface ReviewTarget {
  fileKey: string;
  nodeId: string;
  version?: string;
  frameName?: string;      // filled from webhook file_name/node name if known
  triggeredBy?: string;    // Figma user id
  status?: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE';
}

export interface ReviewResult {
  fileKey: string;
  version?: string;
  frameNodeId: string;
  frameName: string;
  reviewedAt: string;
  triggeredBy?: string;
  status: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE';
  findings: Finding[];
  counts: Record<FindingKind, number>;
  cleanScore: number | null;
  tooLarge?: { reason: 'immediate-breadth' | 'ceiling' | 'fetch-failed'; nodeCount?: number };
}
```

- [ ] **Step 1: Write the failing test**

```ts
// test/review/deep-link.test.ts
import { describe, it, expect } from 'vitest';
import { buildDeepLink } from '../../src/review/deep-link.js';

describe('buildDeepLink', () => {
  it('builds a link with an encoded node id', () => {
    expect(buildDeepLink('FILEKEY', '43:2')).toBe(
      'https://www.figma.com/file/FILEKEY?node-id=43%3A2',
    );
  });

  it('appends version-id when a version is given', () => {
    expect(buildDeepLink('FILEKEY', '43:2', '9981')).toBe(
      'https://www.figma.com/file/FILEKEY?node-id=43%3A2&version-id=9981',
    );
  });

  it('omits version-id when version is undefined', () => {
    expect(buildDeepLink('FILEKEY', '43:2', undefined)).not.toContain('version-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/review/deep-link.test.ts`
Expected: FAIL — cannot find module `../../src/review/deep-link.js`.

- [ ] **Step 3: Write the types file and the implementation**

Create `src/review/types.ts` with the exact content from the Interfaces block above.

```ts
// src/review/deep-link.ts
export function buildDeepLink(fileKey: string, nodeId: string, version?: string): string {
  const base = `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;
  return version ? `${base}&version-id=${encodeURIComponent(version)}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/review/deep-link.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/review/types.ts src/review/deep-link.ts test/review/deep-link.test.ts
git commit -m "feat(review): review types + deep-link builder"
```

---

### Task 2: Deprecation-marker detection

**Files:**
- Create: `src/review/deprecation.ts`
- Test: `test/review/deprecation.test.ts`

**Interfaces:**
- Produces: `isDeprecatedName(name: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// test/review/deprecation.test.ts
import { describe, it, expect } from 'vitest';
import { isDeprecatedName } from '../../src/review/deprecation.js';

describe('isDeprecatedName', () => {
  it('matches the emoji deprecation prefix', () => {
    expect(isDeprecatedName('[🔴DEPRECATED]Button / Secondary')).toBe(true);
  });
  it('matches a plain bracketed DEPRECATED prefix', () => {
    expect(isDeprecatedName('[DEPRECATED] Menu/Label')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isDeprecatedName('[deprecated]Old Thing')).toBe(true);
  });
  it('does not match a clean component name', () => {
    expect(isDeprecatedName('Button')).toBe(false);
  });
  it('does not match the word deprecated outside brackets', () => {
    expect(isDeprecatedName('Deprecated Patterns Doc')).toBe(false);
  });
  it('handles empty / whitespace names', () => {
    expect(isDeprecatedName('')).toBe(false);
    expect(isDeprecatedName('   ')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/review/deprecation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/review/deprecation.ts
const DEPRECATED_MARKER = /\[[^\]]*DEPRECATED[^\]]*\]/i;

/** True when a component set name carries a bracketed DEPRECATED marker. */
export function isDeprecatedName(name: string): boolean {
  return DEPRECATED_MARKER.test(name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/review/deprecation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/review/deprecation.ts test/review/deprecation.test.ts
git commit -m "feat(review): deprecation-marker detection"
```

---

### Task 3: Extract shared team-component catalog

Reuses the existing (currently private) `fetchTeamComponentCatalog` from `collect.ts` so both `collect` and the reviewer share one implementation. The catalog maps a component `key` → its **set display name** (needed to detect the deprecation marker, which lives on the set, not the variant).

**Files:**
- Create: `src/collectors/team-catalog.ts`
- Modify: `src/cli/collect.ts` (remove inline copy, import instead)
- Test: `test/collectors/team-catalog.test.ts`

**Interfaces:**
- Consumes: `FigmaClient` (existing).
- Produces:
  ```ts
  export interface ComponentInfo { fileKey: string; displayName: string; }
  export interface Catalog {
    keyToFileKey: Map<string, string>;
    keyToInfo: Map<string, ComponentInfo>;
  }
  export function fetchTeamComponentCatalog(client: FigmaClient, teamId: string): Promise<Catalog>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/collectors/team-catalog.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchTeamComponentCatalog } from '../../src/collectors/team-catalog.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';

describe('fetchTeamComponentCatalog', () => {
  it('resolves variant set name via containingComponentSet and paginates', async () => {
    const client = new FigmaClient('t');
    const getSpy = vi.spyOn(client, 'get')
      .mockResolvedValueOnce({
        meta: {
          components: [
            {
              key: 'k1', file_key: 'F1', name: 'Type=Secondary',
              containing_frame: { containingComponentSet: { name: '[🔴DEPRECATED]Button / Secondary' } },
            },
          ],
          cursor: { after: 100 },
        },
      } as any)
      .mockResolvedValueOnce({
        meta: { components: [{ key: 'k2', file_key: 'F2', name: 'Avatar' }] },
      } as any);

    const catalog = await fetchTeamComponentCatalog(client, 'TEAM');

    expect(catalog.keyToInfo.get('k1')?.displayName).toBe('[🔴DEPRECATED]Button / Secondary');
    expect(catalog.keyToInfo.get('k2')?.displayName).toBe('Avatar');
    expect(catalog.keyToFileKey.get('k1')).toBe('F1');
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/collectors/team-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/collectors/team-catalog.ts`**

Move the logic verbatim from `collect.ts` (the `TeamComponentEntry`, `TeamComponentsPage`, `ComponentInfo` interfaces and the `fetchTeamComponentCatalog` function), exporting the types and function. Do not change behavior.

```ts
// src/collectors/team-catalog.ts
import type { FigmaClient } from './figma-client.js';

interface TeamComponentEntry {
  key: string;
  file_key: string;
  name: string;
  containing_frame?: {
    name?: string;
    containingComponentSet?: { name: string };
  };
}

interface TeamComponentsPage {
  meta: {
    components: TeamComponentEntry[];
    cursor?: { after?: number };
  };
}

export interface ComponentInfo {
  fileKey: string;
  displayName: string;
}

export interface Catalog {
  keyToFileKey: Map<string, string>;
  keyToInfo: Map<string, ComponentInfo>;
}

export async function fetchTeamComponentCatalog(client: FigmaClient, teamId: string): Promise<Catalog> {
  const keyToFileKey = new Map<string, string>();
  const keyToInfo = new Map<string, ComponentInfo>();
  let after: number | undefined;

  while (true) {
    const params: Record<string, string> = { page_size: '100' };
    if (after !== undefined) params.after = String(after);

    const page = await client.get<TeamComponentsPage>(`/v1/teams/${teamId}/components`, params);

    for (const comp of page.meta.components) {
      keyToFileKey.set(comp.key, comp.file_key);
      const setName = comp.containing_frame?.containingComponentSet?.name;
      const displayName = setName ?? comp.name;
      keyToInfo.set(comp.key, { fileKey: comp.file_key, displayName });
    }

    if (page.meta.components.length < 100 || !page.meta.cursor?.after) break;
    after = page.meta.cursor.after;
  }

  return { keyToFileKey, keyToInfo };
}
```

- [ ] **Step 4: Update `collect.ts` to import from the shared module**

In `src/cli/collect.ts`: delete the local `TeamComponentEntry`, `TeamComponentsPage`, `ComponentInfo` interfaces and the local `fetchTeamComponentCatalog` function (lines ~28–87). Add near the top imports:

```ts
import { fetchTeamComponentCatalog } from '../collectors/team-catalog.js';
import type { ComponentInfo } from '../collectors/team-catalog.js';
```

Leave the call site (`const { keyToFileKey, keyToInfo } = await fetchTeamComponentCatalog(...)`) unchanged.

- [ ] **Step 5: Run the full suite to verify nothing regressed**

Run: `npm test`
Expected: PASS — the new catalog test plus all existing tests (collect has no dedicated test, but the type extraction must not break compilation).

- [ ] **Step 6: Verify the project still type-checks**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/collectors/team-catalog.ts src/cli/collect.ts test/collectors/team-catalog.test.ts
git commit -m "refactor(collectors): extract shared team-component catalog"
```

---

### Task 4: Findings collection over a node subtree

Walks a fetched subtree once and emits `deprecated` + `detached` findings, plus the counts needed for `cleanScore`.

**Files:**
- Create: `src/review/checks.ts`
- Test: `test/review/checks.test.ts`

**Interfaces:**
- Consumes: `Finding` (Task 1), `isDeprecatedName` (Task 2), `Catalog` (Task 3), existing `classifyNode` (`src/collectors/node-classifier.ts`), `FigmaNode`/`FigmaComponentMeta` (`src/types.ts`).
- Produces:
  ```ts
  export interface CheckContext {
    components: Record<string, FigmaComponentMeta>;  // from the file/nodes response
    catalog: Catalog;
    libraryKeys: { dls: string; arcade: string; arcade3: string };
  }
  export interface CollectResult {
    findings: Finding[];
    nodeCount: number;
    componentSurface: number;   // ds + detached + local (excludes raw/dsOther)
    cleanCurrentDS: number;     // dsArcade3 instances that are NOT deprecated
  }
  export function collectFindings(root: FigmaNode, ctx: CheckContext): CollectResult;
  ```

**Detail for each finding kind:**
- `deprecated`: an INSTANCE whose component `key` **resolves in `ctx.catalog.keyToInfo`** to a `displayName` that `isDeprecatedName(...)`. **Do NOT fall back to the raw `meta.name` when the key is absent from the catalog** — `meta.name` is the *variant* name (e.g. `Type=Secondary`), which never carries the set's `[DEPRECATED]` marker, so guessing on it silently passes deprecated components as clean (spec §4.2 miss mode). If the key isn't in the catalog, skip the deprecated check for that node (it may still be flagged `detached`). `detail` = the resolved set displayName.
- `detached`: `classifyNode(node, ctx.components, ctx.libraryKeys, ctx.catalog.keyToFileKey).category === 'detached'`. `detail` = `` `was ${node.componentId ?? 'unknown component'}` `` (names are often blank — see spec §4.3).
- A node counts once: check deprecated first; if not deprecated but detached, emit detached. A clean current-SoT instance emits nothing but increments `cleanCurrentDS`.

- [ ] **Step 1: Write the failing test**

```ts
// test/review/checks.test.ts
import { describe, it, expect } from 'vitest';
import { collectFindings } from '../../src/review/checks.js';
import type { FigmaNode, FigmaComponentMeta } from '../../src/types.js';
import type { Catalog } from '../../src/collectors/team-catalog.js';

const ARCADE3 = 'a2uKnm88LxRXEWAL1kOqeQ';
const libraryKeys = { dls: 'DLSKEY', arcade: 'A2KEY', arcade3: ARCADE3 };

const components: Record<string, FigmaComponentMeta> = {
  cDep:   { key: 'kDep',   name: 'Type=Secondary', description: '', file_key: ARCADE3 },
  cClean: { key: 'kClean', name: 'Button',         description: '', file_key: ARCADE3 },
};

const catalog: Catalog = {
  keyToFileKey: new Map([['kDep', ARCADE3], ['kClean', ARCADE3]]),
  keyToInfo: new Map([
    ['kDep',   { fileKey: ARCADE3, displayName: '[🔴DEPRECATED]Button / Secondary' }],
    ['kClean', { fileKey: ARCADE3, displayName: 'Button' }],
  ]),
};

const ctx = { components, catalog, libraryKeys };

it('flags a deprecated instance by its set name (variant → set resolution)', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '1:1', name: 'btn', type: 'INSTANCE', componentId: 'cDep' }],
  };
  const r = collectFindings(root, ctx);
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0].kind).toBe('deprecated');
  expect(r.findings[0].detail).toBe('[🔴DEPRECATED]Button / Secondary');
  expect(r.findings[0].nodeId).toBe('1:1');
});

it('flags a detached instance (unresolvable componentId)', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '2:2', name: ' ', type: 'INSTANCE', componentId: 'missing' }],
  };
  const r = collectFindings(root, ctx);
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0].kind).toBe('detached');
});

it('emits nothing for a clean current-SoT instance and counts it clean', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '3:3', name: 'btn', type: 'INSTANCE', componentId: 'cClean' }],
  };
  const r = collectFindings(root, ctx);
  expect(r.findings).toHaveLength(0);
  expect(r.cleanCurrentDS).toBe(1);
  expect(r.componentSurface).toBe(1);
});

it('does NOT flag deprecated by guessing on the variant name when the key is absent from the catalog', () => {
  // meta.name literally contains the marker, but the component key is NOT in the catalog.
  // We must not treat the variant name as authoritative (it would be a false positive here,
  // and symmetrically a false negative for a real deprecated set whose variant name is clean).
  const localComponents: Record<string, FigmaComponentMeta> = {
    cUnknown: { key: 'kUnknown', name: '[🔴DEPRECATED]RawVariantName', description: '', file_key: ARCADE3 },
  };
  const localCtx = { components: localComponents, catalog, libraryKeys }; // catalog has no 'kUnknown'
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [{ id: '9:9', name: 'x', type: 'INSTANCE', componentId: 'cUnknown' }],
  };
  const r = collectFindings(root, localCtx);
  expect(r.findings.some((f) => f.kind === 'deprecated')).toBe(false);
});

it('counts total nodes across the tree', () => {
  const root: FigmaNode = {
    id: 'root', name: 'Frame', type: 'FRAME',
    children: [
      { id: 'a', name: 'x', type: 'RECTANGLE' },
      { id: 'b', name: 'y', type: 'FRAME', children: [{ id: 'c', name: 'z', type: 'TEXT' }] },
    ],
  };
  const r = collectFindings(root, ctx);
  expect(r.nodeCount).toBe(4); // root + a + b + c
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/review/checks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/review/checks.ts
import { classifyNode } from '../collectors/node-classifier.js';
import { isDeprecatedName } from './deprecation.js';
import type { Finding } from './types.js';
import type { Catalog } from '../collectors/team-catalog.js';
import type { FigmaNode, FigmaComponentMeta } from '../types.js';

export interface CheckContext {
  components: Record<string, FigmaComponentMeta>;
  catalog: Catalog;
  libraryKeys: { dls: string; arcade: string; arcade3: string };
}

export interface CollectResult {
  findings: Finding[];
  nodeCount: number;
  componentSurface: number;
  cleanCurrentDS: number;
}

export function collectFindings(root: FigmaNode, ctx: CheckContext): CollectResult {
  const findings: Finding[] = [];
  let nodeCount = 0;
  let componentSurface = 0;
  let cleanCurrentDS = 0;

  function deprecatedSetName(node: FigmaNode): string | null {
    if (node.type !== 'INSTANCE' || !node.componentId) return null;
    const meta = ctx.components[node.componentId];
    if (!meta) return null;
    const info = ctx.catalog.keyToInfo.get(meta.key);
    // Only trust the catalog's SET display name. meta.name is the VARIANT name
    // (e.g. "Type=Secondary") and never carries the set's [DEPRECATED] marker, so
    // guessing on it would silently pass deprecated components as clean (spec §4.2).
    if (!info) return null;
    return isDeprecatedName(info.displayName) ? info.displayName : null;
  }

  function walk(node: FigmaNode): void {
    nodeCount++;

    const { category } = classifyNode(node, ctx.components, ctx.libraryKeys, ctx.catalog.keyToFileKey);
    if (category === 'dsArcade3' || category === 'dsArcade' || category === 'dsDls'
        || category === 'dsOther' || category === 'detached' || category === 'localComponent') {
      componentSurface++;
    }

    const depName = deprecatedSetName(node);
    if (depName) {
      findings.push({ kind: 'deprecated', nodeId: node.id, nodeName: node.name, detail: depName });
    } else if (category === 'detached') {
      findings.push({
        kind: 'detached',
        nodeId: node.id,
        nodeName: node.name,
        detail: `was ${node.componentId ?? 'unknown component'}`,
      });
    } else if (category === 'dsArcade3') {
      cleanCurrentDS++;
    }

    if (node.children) for (const child of node.children) walk(child);
  }

  walk(root);
  return { findings, nodeCount, componentSurface, cleanCurrentDS };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/review/checks.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/review/checks.ts test/review/checks.test.ts
git commit -m "feat(review): findings collection (deprecated + detached)"
```

---

### Task 5: Reviewer orchestration (fetch → ceiling → result)

Ties fetch, the size ceiling, findings, and `cleanScore` into one pure entry point.

**Files:**
- Create: `src/review/reviewer.ts`
- Test: `test/review/reviewer.test.ts`

**Interfaces:**
- Consumes: `FigmaClient` (existing `getFile`/`get`), `Catalog` (Task 3), `collectFindings` (Task 4), `ReviewResult`/`ReviewTarget`/`Finding` (Task 1).
- Produces:
  ```ts
  export const MAX_REVIEW_NODES = 5000;
  export interface ReviewDeps {
    client: FigmaClient;
    catalog: Catalog;
    libraryKeys: { dls: string; arcade: string; arcade3: string };
    now: () => string;   // injectable clock → ISO string
  }
  export function review(deps: ReviewDeps, target: ReviewTarget): Promise<ReviewResult>;
  ```
- **Two-stage fetch (fixes the "ceiling protects nothing" bug).** The ceiling must be enforced *before* the expensive deep fetch, and a failed deep fetch must degrade to a `tooLarge` result — never throw (a throw becomes a silent no-op in the consumer, exactly on the giant sections the ceiling exists for). Order:
  1. **Probe shallow:** `GET /v1/files/{fileKey}/nodes?ids={nodeId}&depth=1` (+`version`). This returns the node plus only its immediate children — small and reliable even for a page-sized section. Read `frameName` from `document.name`. If the node is missing, return an empty result with `frameName = target.frameName ?? nodeId`. If its immediate `children.length > MAX_IMMEDIATE_CHILDREN` (500), bail immediately with `tooLarge: { reason: 'immediate-breadth' }` (a node with hundreds of direct children is a page/section, not a reviewable frame).
  2. **Deep fetch, guarded:** wrap the full-subtree fetch (`GET .../nodes?ids={nodeId}`, no depth) in try/catch. On any error (oversize 400, dropped socket, timeout), return `tooLarge: { reason: 'fetch-failed' }` — do NOT rethrow.
  3. **Ceiling after walk:** run `collectFindings`; if `nodeCount > MAX_REVIEW_NODES`, discard findings, set `tooLarge: { reason: 'ceiling', nodeCount }`.
- In all `tooLarge` cases: `findings: []`, `counts: emptyCounts()`, `cleanScore: null`.
- **cleanScore:** `componentSurface > 0 ? Math.round(cleanCurrentDS / componentSurface * 100) : null`.
- **status:** default `'READY_FOR_DEV'` when `target.status` is absent.
- Consts: `export const MAX_REVIEW_NODES = 5000;` and `export const MAX_IMMEDIATE_CHILDREN = 500;`

- [ ] **Step 1: Write the failing test**

```ts
// test/review/reviewer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { review, MAX_REVIEW_NODES, MAX_IMMEDIATE_CHILDREN } from '../../src/review/reviewer.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';
import type { Catalog } from '../../src/collectors/team-catalog.js';

const ARCADE3 = 'a2uKnm88LxRXEWAL1kOqeQ';
const libraryKeys = { dls: 'DLS', arcade: 'A2', arcade3: ARCADE3 };
const catalog: Catalog = {
  keyToFileKey: new Map([['kDep', ARCADE3]]),
  keyToInfo: new Map([['kDep', { fileKey: ARCADE3, displayName: '[🔴DEPRECATED]Divider' }]]),
};
const now = () => '2026-07-10T00:00:00.000Z';

// The reviewer calls client.get twice: a depth=1 probe, then a deep fetch (no depth).
// `probe` is returned when params.depth === '1'; `deep` (a value, or a thrown error) otherwise.
function deps(probe: any, deep?: any | (() => never)) {
  const client = new FigmaClient('t');
  vi.spyOn(client, 'get').mockImplementation(async (_path: string, params?: Record<string, string>) => {
    if (params?.depth === '1') return probe;
    if (typeof deep === 'function') return (deep as () => never)();
    return deep;
  });
  return { client, catalog, libraryKeys, now };
}

function node(children: any[], type = 'FRAME', name = 'Checkout') {
  return { nodes: { '43:2': { components: { cDep: { key: 'kDep', name: 'X', description: '', file_key: ARCADE3 } }, document: { id: '43:2', name, type, children } } } };
}

it('returns a deprecated finding and a cleanScore', async () => {
  const child = { id: '43:3', name: 'div', type: 'INSTANCE', componentId: 'cDep' };
  const result = await review(deps(node([child]), node([child])), { fileKey: 'F', nodeId: '43:2' });
  expect(result.frameName).toBe('Checkout');
  expect(result.counts.deprecated).toBe(1);
  expect(result.findings[0].kind).toBe('deprecated');
  expect(result.cleanScore).toBe(0);       // 0 clean of 1 surface
  expect(result.reviewedAt).toBe('2026-07-10T00:00:00.000Z');
  expect(result.status).toBe('READY_FOR_DEV');
});

it('bails as immediate-breadth when the probe shows too many direct children', async () => {
  const many = Array.from({ length: MAX_IMMEDIATE_CHILDREN + 1 }, (_, i) => ({ id: `c${i}`, name: 'x', type: 'FRAME' }));
  // deep fetch must NOT be called — pass a throwing deep to prove the probe short-circuits.
  const result = await review(deps(node(many, 'SECTION', 'Big'), () => { throw new Error('deep fetch should not run'); }), { fileKey: 'F', nodeId: '43:2' });
  expect(result.tooLarge?.reason).toBe('immediate-breadth');
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});

it('flags tooLarge=ceiling when the deep subtree exceeds MAX_REVIEW_NODES', async () => {
  const deep = node(Array.from({ length: MAX_REVIEW_NODES + 1 }, (_, i) => ({ id: `c${i}`, name: 'x', type: 'RECTANGLE' })), 'FRAME', 'Big');
  const result = await review(deps(node([{ id: 'c0', name: 'x', type: 'RECTANGLE' }]), deep), { fileKey: 'F', nodeId: '43:2' });
  expect(result.tooLarge?.reason).toBe('ceiling');
  expect(result.tooLarge?.nodeCount).toBeGreaterThan(MAX_REVIEW_NODES);
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});

it('degrades to tooLarge=fetch-failed when the deep fetch throws (never rethrows)', async () => {
  const result = await review(deps(node([{ id: 'c0', name: 'x', type: 'FRAME' }]), () => { throw new Error('terminated'); }), { fileKey: 'F', nodeId: '43:2' });
  expect(result.tooLarge?.reason).toBe('fetch-failed');
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});

it('returns an empty result when the node is missing from the probe', async () => {
  const result = await review(deps({ nodes: {} }), { fileKey: 'F', nodeId: 'gone', frameName: 'Gone' });
  expect(result.frameName).toBe('Gone');
  expect(result.findings).toHaveLength(0);
  expect(result.cleanScore).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/review/reviewer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/review/reviewer.ts
import { collectFindings } from './checks.js';
import type { CheckContext } from './checks.js';
import type { FigmaClient } from '../collectors/figma-client.js';
import type { Catalog } from '../collectors/team-catalog.js';
import type { FigmaNode, FigmaComponentMeta } from '../types.js';
import type { Finding, FindingKind, ReviewResult, ReviewTarget } from './types.js';

export const MAX_REVIEW_NODES = 5000;
export const MAX_IMMEDIATE_CHILDREN = 500;

export interface ReviewDeps {
  client: FigmaClient;
  catalog: Catalog;
  libraryKeys: { dls: string; arcade: string; arcade3: string };
  now: () => string;
}

interface NodesResponse {
  nodes: Record<string, { document: FigmaNode; components: Record<string, FigmaComponentMeta> }>;
}

function emptyCounts(): Record<FindingKind, number> {
  return { deprecated: 0, detached: 0 };
}

export async function review(deps: ReviewDeps, target: ReviewTarget): Promise<ReviewResult> {
  const path = `/v1/files/${target.fileKey}/nodes`;
  const versioned = (extra: Record<string, string>): Record<string, string> =>
    target.version ? { ids: target.nodeId, version: target.version, ...extra } : { ids: target.nodeId, ...extra };

  // Stage 1: shallow probe (depth=1) — small & reliable even for a page-sized section.
  const probe = await deps.client.get<NodesResponse>(path, versioned({ depth: '1' }));
  const probeNode = probe.nodes[target.nodeId];

  const base: Omit<ReviewResult, 'findings' | 'counts' | 'cleanScore' | 'tooLarge'> = {
    fileKey: target.fileKey,
    version: target.version,
    frameNodeId: target.nodeId,
    frameName: probeNode?.document.name ?? target.frameName ?? target.nodeId,
    reviewedAt: deps.now(),
    triggeredBy: target.triggeredBy,
    status: target.status ?? 'READY_FOR_DEV',
  };
  const empty = { findings: [] as Finding[], counts: emptyCounts(), cleanScore: null };

  if (!probeNode) return { ...base, ...empty };

  if ((probeNode.document.children?.length ?? 0) > MAX_IMMEDIATE_CHILDREN) {
    return { ...base, ...empty, tooLarge: { reason: 'immediate-breadth' } };
  }

  // Stage 2: deep fetch, guarded — a failure here must NOT throw (would become a silent
  // no-op in the consumer on exactly the giant sections the ceiling exists for).
  let deepNode: NodesResponse['nodes'][string] | undefined;
  try {
    const deep = await deps.client.get<NodesResponse>(path, versioned({}));
    deepNode = deep.nodes[target.nodeId];
  } catch {
    return { ...base, ...empty, tooLarge: { reason: 'fetch-failed' } };
  }
  if (!deepNode) return { ...base, ...empty };

  const ctx: CheckContext = {
    components: deepNode.components ?? {},
    catalog: deps.catalog,
    libraryKeys: deps.libraryKeys,
  };
  const collected = collectFindings(deepNode.document, ctx);

  // Stage 3: ceiling after walk (breadth probe already caught the worst cases).
  if (collected.nodeCount > MAX_REVIEW_NODES) {
    return { ...base, ...empty, tooLarge: { reason: 'ceiling', nodeCount: collected.nodeCount } };
  }

  const counts = emptyCounts();
  for (const f of collected.findings) counts[f.kind]++;

  const cleanScore = collected.componentSurface > 0
    ? Math.round((collected.cleanCurrentDS / collected.componentSurface) * 100)
    : null;

  return { ...base, findings: collected.findings, counts, cleanScore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/review/reviewer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite + build**

Run: `npm test && npm run build`
Expected: all green, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/review/reviewer.ts test/review/reviewer.test.ts
git commit -m "feat(review): reviewer orchestration with size ceiling + cleanScore"
```

---

## Phase B — Local CLI (proves detection end-to-end)

### Task 6: `ds-observatory review <url>` command

**Files:**
- Create: `src/cli/review.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli/review-parse.test.ts`

**Interfaces:**
- Consumes: `review`/`ReviewDeps` (Task 5), `fetchTeamComponentCatalog` (Task 3), `loadConfig` (existing), `FigmaClient` (existing).
- Produces: `parseFigmaTarget(input: string): { fileKey: string; nodeId: string }` and `reviewCommand(input: string, options: { token?: string }): Promise<void>`.
- **`parseFigmaTarget`** accepts either a Figma URL (`https://www.figma.com/(file|design)/{key}/...?node-id=43-2` — note Figma URLs use `43-2`, convert to `43:2`) or a raw `"{fileKey} {nodeId}"` pair. Throws a clear error if neither.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/review-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseFigmaTarget } from '../../src/cli/review.js';

describe('parseFigmaTarget', () => {
  it('parses a design URL and normalizes node-id dashes to colons', () => {
    const t = parseFigmaTarget('https://www.figma.com/design/ABC123/My-File?node-id=209-10074&t=x');
    expect(t).toEqual({ fileKey: 'ABC123', nodeId: '209:10074' });
  });
  it('parses a /file/ URL', () => {
    const t = parseFigmaTarget('https://www.figma.com/file/KEY9/Name?node-id=43-2');
    expect(t).toEqual({ fileKey: 'KEY9', nodeId: '43:2' });
  });
  it('parses a raw "fileKey nodeId" pair', () => {
    expect(parseFigmaTarget('KEY9 43:2')).toEqual({ fileKey: 'KEY9', nodeId: '43:2' });
  });
  it('throws on input with no node id', () => {
    expect(() => parseFigmaTarget('https://www.figma.com/design/ABC123/My-File')).toThrow(/node-id/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/review-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/cli/review.ts`**

```ts
// src/cli/review.ts
import { loadConfig } from '../config.js';
import { FigmaClient } from '../collectors/figma-client.js';
import { fetchTeamComponentCatalog } from '../collectors/team-catalog.js';
import { review } from '../review/reviewer.js';
import type { Finding } from '../review/types.js';

export function parseFigmaTarget(input: string): { fileKey: string; nodeId: string } {
  const trimmed = input.trim();

  const urlMatch = trimmed.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    const nodeMatch = trimmed.match(/[?&]node-id=([0-9]+-[0-9]+)/);
    if (!nodeMatch) throw new Error('Figma URL is missing a node-id query parameter.');
    return { fileKey: urlMatch[1], nodeId: nodeMatch[1].replace('-', ':') };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { fileKey: parts[0], nodeId: parts[1] };
  }

  throw new Error('Expected a Figma URL with node-id, or "<fileKey> <nodeId>".');
}

const EMOJI: Record<Finding['kind'], string> = { deprecated: '🔴', detached: '⚪' };

export async function reviewCommand(input: string, options: { token?: string }): Promise<void> {
  const config = loadConfig({ figmaAccessToken: options.token });
  const client = new FigmaClient(config.figmaAccessToken);
  const { fileKey, nodeId } = parseFigmaTarget(input);

  console.log(`Fetching component catalog...`);
  const catalog = await fetchTeamComponentCatalog(client, config.figmaDsTeamId);

  console.log(`Reviewing ${fileKey} node ${nodeId}...`);
  const result = await review(
    {
      client,
      catalog,
      libraryKeys: { dls: config.dlsLibraryKey, arcade: config.arcadeLibraryKey, arcade3: config.arcade3LibraryKey },
      now: () => new Date().toISOString(),
    },
    { fileKey, nodeId },
  );

  console.log(`\n🔭 ${result.frameName} — on current DS lib: ${result.cleanScore ?? 'n/a'}%`);
  if (result.tooLarge) {
    const detail = result.tooLarge.nodeCount ? ` (${result.tooLarge.nodeCount} nodes)` : '';
    console.log(`  ⚠️  Too large to review — ${result.tooLarge.reason}${detail}.`);
    return;
  }
  if (result.findings.length === 0) {
    console.log('  ✅ No issues found.');
    return;
  }
  console.log(`  ${result.counts.deprecated} deprecated, ${result.counts.detached} detached\n`);
  for (const f of result.findings) {
    console.log(`  ${EMOJI[f.kind]} ${f.kind}: ${f.detail} (${f.nodeId})`);
  }
}
```

- [ ] **Step 4: Register the command in `src/cli/index.ts`**

Add the import alongside the others:

```ts
import { reviewCommand } from './review.js';
```

Add the command registration before `program.parse();`:

```ts
program
  .command('review')
  .description('Review a single frame for DS drift (deprecated + detached)')
  .argument('<target>', 'Figma frame URL, or "<fileKey> <nodeId>"')
  .option('--token <token>', 'Figma access token (overrides FIGMA_ACCESS_TOKEN)')
  .action((target, options) => reviewCommand(target, options));
```

- [ ] **Step 5: Run the parse test to verify it passes**

Run: `npx vitest run test/cli/review-parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Manual smoke test against a real frame**

Run (requires `FIGMA_ACCESS_TOKEN` in `.env`):
`npm run dev -- review "https://www.figma.com/design/JztJjqt3i6uFwB6r4dfewz/Navigation--where-to-next?node-id=209-10074"`
Expected: prints the frame name, a clean-DS %, and a list of deprecated/detached findings (or "no issues"). This is the "wild mixture" file Andrei referenced, so expect findings.

- [ ] **Step 7: Commit**

```bash
git add src/cli/review.ts src/cli/index.ts test/cli/review-parse.test.ts
git commit -m "feat(cli): ds-observatory review command"
```

---

## Phase C — Emitters (proves the full detect → report loop)

### Task 7: Figma comment emitter (format + post + delete)

**Files:**
- Create: `src/emitters/figma-comment.ts`
- Test: `test/emitters/figma-comment.test.ts`

**Interfaces:**
- Consumes: `ReviewResult`/`Finding` (Task 1), `buildDeepLink` (Task 1), `FigmaClient` (existing — add a generic `post`/`delete`, see step 3).
- Produces:
  ```ts
  export function formatCommentBody(result: ReviewResult): string;
  export function postFrameComment(client: FigmaClient, result: ReviewResult): Promise<string>;  // returns new comment id
  export function deleteFrameComment(client: FigmaClient, fileKey: string, commentId: string): Promise<void>;
  ```
- **Pinning:** `POST /v1/files/{fileKey}/comments` with body `{ message, client_meta: { node_id: result.frameNodeId, node_offset: { x: 0, y: 0 } } }` (FrameOffset requires node_id + node_offset with x,y — spec §6.1).
- **Delete:** `DELETE /v1/files/{fileKey}/comments/{commentId}`.

- [ ] **Step 1: Write the failing test**

```ts
// test/emitters/figma-comment.test.ts
import { describe, it, expect, vi } from 'vitest';
import { formatCommentBody, postFrameComment } from '../../src/emitters/figma-comment.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';
import type { ReviewResult } from '../../src/review/types.js';

const result: ReviewResult = {
  fileKey: 'F', version: '99', frameNodeId: '43:2', frameName: 'Checkout',
  reviewedAt: '2026-07-10T00:00:00.000Z', status: 'READY_FOR_DEV',
  findings: [
    { kind: 'deprecated', nodeId: '43:3', nodeName: 'btn', detail: '[🔴DEPRECATED]Button / Secondary' },
    { kind: 'detached', nodeId: '43:4', nodeName: ' ', detail: 'was 12:8' },
  ],
  counts: { deprecated: 1, detached: 1 },
  cleanScore: 40,
};

describe('formatCommentBody', () => {
  it('includes the header, score, grouped counts, and deep-links', () => {
    const body = formatCommentBody(result);
    expect(body).toContain('DS Observatory review — Checkout');
    expect(body).toContain('On current DS lib: 40%');
    expect(body).toContain('Deprecated (1)');
    expect(body).toContain('[🔴DEPRECATED]Button / Secondary');
    expect(body).toContain('node-id=43%3A3');
    expect(body).toContain('version-id=99');
  });
  it('renders "n/a" when cleanScore is null', () => {
    const body = formatCommentBody({ ...result, cleanScore: null });
    expect(body).toContain('no DS components');
  });
  it('renders a too-large notice with the node count when present (ceiling)', () => {
    const body = formatCommentBody({ ...result, tooLarge: { reason: 'ceiling', nodeCount: 9000 }, findings: [], counts: { deprecated: 0, detached: 0 } });
    expect(body).toContain('too large');
    expect(body).toContain('9000');
  });
  it('renders a too-large notice without a count when the fetch failed', () => {
    const body = formatCommentBody({ ...result, tooLarge: { reason: 'fetch-failed' }, findings: [], counts: { deprecated: 0, detached: 0 } });
    expect(body).toContain('too large');
    expect(body).not.toContain('undefined');
  });
});

describe('postFrameComment', () => {
  it('POSTs a node-pinned comment and returns its id', async () => {
    const client = new FigmaClient('t');
    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({ id: 'comment-1' } as any);
    const id = await postFrameComment(client, result);
    expect(id).toBe('comment-1');
    const [, body] = postSpy.mock.calls[0];
    expect(body).toMatchObject({ client_meta: { node_id: '43:2', node_offset: { x: 0, y: 0 } } });
    expect(typeof (body as any).message).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/emitters/figma-comment.test.ts`
Expected: FAIL — `client.post` is not a function AND module not found.

- [ ] **Step 3: Add `post`/`delete` to `FigmaClient`, then write the emitter**

In `src/collectors/figma-client.ts`, add two methods to the class (mirroring the existing `get` retry/error handling but for write verbs):

```ts
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.send<T>('DELETE', path);
  }

  private async send<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `${BASE_URL}${path}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            'X-Figma-Token': this.token,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        if (attempt === MAX_RETRIES) throw new Error(`Network error after retries: ${method} ${path} — ${err}`);
        await this.sleep(Math.pow(2, attempt + 1) * BASE_DELAY_MS);
        continue;
      }
      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await this.sleep(Math.pow(2, attempt) * BASE_DELAY_MS);
        continue;
      }
      throw new Error(`Figma API error ${response.status}: ${response.statusText} — ${method} ${path}`);
    }
    throw new Error(`Unexpected: exhausted retries — ${method} ${path}`);
  }
```

```ts
// src/emitters/figma-comment.ts
import { buildDeepLink } from '../review/deep-link.js';
import type { FigmaClient } from '../collectors/figma-client.js';
import type { ReviewResult, Finding } from '../review/types.js';

const LABEL: Record<Finding['kind'], string> = { deprecated: '🔴 Deprecated', detached: '⚪ Detached' };

export function formatCommentBody(result: ReviewResult): string {
  const link = (nodeId: string) => buildDeepLink(result.fileKey, nodeId, result.version);
  const lines: string[] = [`🔭 DS Observatory review — ${result.frameName}`];

  if (result.tooLarge) {
    const count = result.tooLarge.nodeCount ? ` (${result.tooLarge.nodeCount} nodes)` : '';
    lines.push(`This section is too large to review automatically${count}. Break it into frames or review manually.`);
    return lines.join('\n');
  }

  const score = result.cleanScore === null ? 'n/a — no DS components' : `${result.cleanScore}%`;
  const total = result.findings.length;
  // "On current DS lib" not "Clean DS": v1 cannot tell DLS/0.2/0.3 apart inside the
  // consolidated library (spec §9), so this is "% from the current library, non-deprecated",
  // NOT "% on the newest generation". Do not relabel as clean/current-SoT.
  lines.push(`On current DS lib: ${score}  ·  ${total} issue(s)`, '');

  if (total === 0) {
    lines.push('✅ No deprecated or detached components found.');
    return lines.join('\n');
  }

  for (const kind of ['deprecated', 'detached'] as Finding['kind'][]) {
    const group = result.findings.filter((f) => f.kind === kind);
    if (group.length === 0) continue;
    lines.push(`${LABEL[kind]} (${group.length})`);
    for (const f of group.slice(0, 10)) lines.push(`  • ${f.detail} → ${link(f.nodeId)}`);
    if (group.length > 10) lines.push(`  • …and ${group.length - 10} more`);
  }

  lines.push('', `Reviewed ${result.reviewedAt}.`);
  return lines.join('\n');
}

export async function postFrameComment(client: FigmaClient, result: ReviewResult): Promise<string> {
  const resp = await client.post<{ id: string }>(`/v1/files/${result.fileKey}/comments`, {
    message: formatCommentBody(result),
    client_meta: { node_id: result.frameNodeId, node_offset: { x: 0, y: 0 } },
  });
  return resp.id;
}

export async function deleteFrameComment(client: FigmaClient, fileKey: string, commentId: string): Promise<void> {
  await client.delete(`/v1/files/${fileKey}/comments/${commentId}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/emitters/figma-comment.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite + build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/emitters/figma-comment.ts src/collectors/figma-client.ts test/emitters/figma-comment.test.ts
git commit -m "feat(emitters): figma comment (format + post + delete)"
```

---

### Task 8: Slack digest emitter + identity map

**Files:**
- Create: `src/emitters/slack.ts`
- Test: `test/emitters/slack.test.ts`

**Interfaces:**
- Consumes: `ReviewResult` (Task 1), `buildDeepLink` (Task 1).
- Produces:
  ```ts
  export type FigmaSlackMap = Record<string, string>;  // figmaUserId → slackUserId
  export function resolveMention(figmaUserId: string | undefined, handle: string | undefined, map: FigmaSlackMap): string;
  export function formatSlackBlocks(result: ReviewResult, mention: string): unknown[];
  export function postDigest(token: string, channel: string, blocks: unknown[], text: string): Promise<void>;
  ```
- **`resolveMention`:** if `figmaUserId` is in the map → `<@slackId>`; else fall back to the plain Figma `handle` (or `"a designer"` if both missing).
- **`postDigest`:** `POST https://slack.com/api/chat.postMessage` with bearer token; throws if the JSON response has `ok: false`.

- [ ] **Step 1: Write the failing test**

```ts
// test/emitters/slack.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveMention, formatSlackBlocks, postDigest } from '../../src/emitters/slack.js';
import type { ReviewResult } from '../../src/review/types.js';

const result: ReviewResult = {
  fileKey: 'F', version: '99', frameNodeId: '43:2', frameName: 'Checkout',
  reviewedAt: '2026-07-10T00:00:00.000Z', status: 'READY_FOR_DEV', triggeredBy: 'figU',
  findings: [{ kind: 'deprecated', nodeId: '43:3', nodeName: 'btn', detail: '[🔴DEPRECATED]Button' }],
  counts: { deprecated: 1, detached: 0 }, cleanScore: 40,
};

describe('resolveMention', () => {
  it('maps a known figma user to a slack mention', () => {
    expect(resolveMention('figU', 'Jane', { figU: 'U123' })).toBe('<@U123>');
  });
  it('falls back to the figma handle when unmapped', () => {
    expect(resolveMention('figU', 'Jane', {})).toBe('Jane');
  });
  it('falls back to a generic label when nothing is known', () => {
    expect(resolveMention(undefined, undefined, {})).toBe('a designer');
  });
});

describe('formatSlackBlocks', () => {
  it('includes the frame name, deep-link, and mention', () => {
    const blocks = formatSlackBlocks(result, '<@U123>');
    const json = JSON.stringify(blocks);
    expect(json).toContain('Checkout');
    expect(json).toContain('node-id=43%3A2');
    expect(json).toContain('<@U123>');
    expect(json).toContain('1 deprecated');
  });
});

describe('postDigest', () => {
  it('throws when Slack returns ok:false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'channel_not_found' }) });
    vi.stubGlobal('fetch', mockFetch);
    await expect(postDigest('tok', '#ads-core-team', [], 'x')).rejects.toThrow('channel_not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/emitters/slack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/emitters/slack.ts
import { buildDeepLink } from '../review/deep-link.js';
import type { ReviewResult } from '../review/types.js';

export type FigmaSlackMap = Record<string, string>;

export function resolveMention(
  figmaUserId: string | undefined,
  handle: string | undefined,
  map: FigmaSlackMap,
): string {
  if (figmaUserId && map[figmaUserId]) return `<@${map[figmaUserId]}>`;
  if (handle) return handle;
  return 'a designer';
}

export function formatSlackBlocks(result: ReviewResult, mention: string): unknown[] {
  const link = buildDeepLink(result.fileKey, result.frameNodeId, result.version);
  const summary = `${result.counts.deprecated} deprecated, ${result.counts.detached} detached`;
  const score = result.cleanScore === null ? 'n/a' : `${result.cleanScore}%`;
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔭 *<${link}|${result.frameName}>* marked ready for dev by ${mention}\nOn current DS lib: ${score} · ${summary}`,
      },
    },
    ...result.findings.slice(0, 10).map((f) => ({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${f.kind === 'deprecated' ? '🔴' : '⚪'} ${f.detail} · <${buildDeepLink(result.fileKey, f.nodeId, result.version)}|jump>` }],
    })),
  ];
}

export async function postDigest(token: string, channel: string, blocks: unknown[], text: string): Promise<void> {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text, blocks }),
  });
  const data = (await resp.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error ?? 'unknown error'}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/emitters/slack.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire both emitters into the CLI (optional flags), then commit**

In `src/cli/review.ts`, extend `reviewCommand` options with `--comment` (post to Figma) and `--slack` (post digest). After computing `result`:

```ts
  if (options.comment) {
    const { postFrameComment } = await import('../emitters/figma-comment.js');
    const id = await postFrameComment(client, result);
    console.log(`  Posted Figma comment ${id}`);
  }
  if (options.slack && process.env.SLACK_BOT_TOKEN) {
    const { formatSlackBlocks, resolveMention, postDigest } = await import('../emitters/slack.js');
    const mention = resolveMention(result.triggeredBy, undefined, {});
    const blocks = formatSlackBlocks(result, mention);
    await postDigest(process.env.SLACK_BOT_TOKEN, '#ads-core-team', blocks, `${result.frameName} review`);
    console.log('  Posted Slack digest');
  }
```

Add the option declarations to the `review` command in `src/cli/index.ts`:

```ts
  .option('--comment', 'Post the summary as a Figma comment on the frame')
  .option('--slack', 'Post a digest to #ads-core-team (needs SLACK_BOT_TOKEN)')
```

Run: `npm test && npm run build`
Expected: green.

```bash
git add src/emitters/slack.ts src/cli/review.ts src/cli/index.ts test/emitters/slack.test.ts
git commit -m "feat(emitters): slack digest + wire emitters into review CLI"
```

---

## Phase D — Cloudflare Worker (auto-trigger)

> **Before starting Phase D:** read the `cloudflare` and `wrangler` skills for current Worker/Queue/D1 syntax. Provision a Cloudflare project, a Queue (`ds-review`), and a D1 database (`ds-review-store`). The bot Figma PAT (comment-write) and `SLACK_BOT_TOKEN` must exist as Worker secrets. These are the spec §10 dependencies.

### Task 9: Webhook passcode verification + job shape

The pure, testable heart of the receiver — no Worker runtime needed to test it.

**Files:**
- Create: `worker/verify.ts`
- Test: `test/worker/verify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReviewJob { fileKey: string; nodeId: string; version?: string; frameName?: string; triggeredBy?: string; status: string; }
  export interface WebhookPayload { event_type?: string; passcode?: string; file_key?: string; file_name?: string; node_id?: string; status?: string; triggered_by?: { id?: string }; }
  export function verifyAndBuildJob(payload: WebhookPayload, expectedPasscode: string): { ok: true; job: ReviewJob | null } | { ok: false; reason: string };
  ```
- **Rules:** wrong/missing passcode → `{ ok: false }`. Correct passcode but `event_type !== 'DEV_MODE_STATUS_UPDATE'` or missing `node_id`/`file_key` → `{ ok: true, job: null }` (ack, nothing to do). Valid dev-mode event → `{ ok: true, job }` with `status` carried through (the consumer decides review vs clear).

- [ ] **Step 1: Write the failing test**

```ts
// test/worker/verify.test.ts
import { describe, it, expect } from 'vitest';
import { verifyAndBuildJob } from '../../worker/verify.js';

const good = {
  event_type: 'DEV_MODE_STATUS_UPDATE', passcode: 'SECRET',
  file_key: 'F', file_name: 'Nav', node_id: '43:2', status: 'READY_FOR_DEV', triggered_by: { id: 'u1' },
};

describe('verifyAndBuildJob', () => {
  it('rejects a bad passcode', () => {
    const r = verifyAndBuildJob({ ...good, passcode: 'WRONG' }, 'SECRET');
    expect(r.ok).toBe(false);
  });
  it('acks non-dev-mode events with no job', () => {
    const r = verifyAndBuildJob({ event_type: 'FILE_UPDATE', passcode: 'SECRET' }, 'SECRET');
    expect(r).toEqual({ ok: true, job: null });
  });
  it('builds a job for a valid dev-mode event', () => {
    const r = verifyAndBuildJob(good, 'SECRET');
    expect(r).toEqual({ ok: true, job: { fileKey: 'F', nodeId: '43:2', frameName: 'Nav', triggeredBy: 'u1', status: 'READY_FOR_DEV', version: undefined } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker/verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `worker/verify.ts`**

```ts
// worker/verify.ts
export interface ReviewJob {
  fileKey: string;
  nodeId: string;
  version?: string;
  frameName?: string;
  triggeredBy?: string;
  status: string;
}

export interface WebhookPayload {
  event_type?: string;
  passcode?: string;
  file_key?: string;
  file_name?: string;
  node_id?: string;
  status?: string;
  triggered_by?: { id?: string };
}

export function verifyAndBuildJob(
  payload: WebhookPayload,
  expectedPasscode: string,
): { ok: true; job: ReviewJob | null } | { ok: false; reason: string } {
  if (!payload.passcode || payload.passcode !== expectedPasscode) {
    return { ok: false, reason: 'bad passcode' };
  }
  if (payload.event_type !== 'DEV_MODE_STATUS_UPDATE' || !payload.node_id || !payload.file_key) {
    return { ok: true, job: null };
  }
  return {
    ok: true,
    job: {
      fileKey: payload.file_key,
      nodeId: payload.node_id,
      version: undefined,
      frameName: payload.file_name,
      triggeredBy: payload.triggered_by?.id,
      status: payload.status ?? 'READY_FOR_DEV',
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/worker/verify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/verify.ts test/worker/verify.test.ts
git commit -m "feat(worker): webhook passcode verification + job builder"
```

---

### Task 10: D1 review store (dedup lock + comment id)

**Files:**
- Create: `src/store/review-store.ts`
- Create: `worker/schema.sql`
- Test: `test/store/review-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface D1Like {
    prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<{ success: boolean; meta?: { changes?: number } }>; first<T>(): Promise<T | null> } };
  }
  export class ReviewStore {
    constructor(db: D1Like);
    claim(dedupKey: string): Promise<boolean>;          // true if this caller won the insert
    getCommentId(fileKey: string, nodeId: string): Promise<string | null>;
    setCommentId(fileKey: string, nodeId: string, commentId: string): Promise<void>;
    clear(fileKey: string, nodeId: string): Promise<void>;
  }
  ```
- **`claim`** does `INSERT ... ON CONFLICT DO NOTHING` into a `claims(dedup_key PRIMARY KEY)` table and returns whether a row was actually inserted (`meta.changes === 1`). This is the at-least-once guard.
- Comment ids stored in `comments(frame_key PRIMARY KEY, comment_id)` where `frame_key = ${fileKey}:${nodeId}`.

`worker/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS claims (dedup_key TEXT PRIMARY KEY, claimed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (frame_key TEXT PRIMARY KEY, comment_id TEXT NOT NULL);
```

- [ ] **Step 1: Write the failing test (with an in-memory fake D1)**

```ts
// test/store/review-store.test.ts
import { describe, it, expect } from 'vitest';
import { ReviewStore } from '../../src/store/review-store.js';

// Minimal fake honoring INSERT OR IGNORE / ON CONFLICT semantics on a Map.
function fakeD1() {
  const claims = new Set<string>();
  const comments = new Map<string, string>();
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes('INTO claims')) {
                const key = String(args[0]);
                if (claims.has(key)) return { success: true, meta: { changes: 0 } };
                claims.add(key); return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('INTO comments')) { comments.set(String(args[0]), String(args[1])); return { success: true }; }
              if (sql.startsWith('DELETE FROM comments')) { comments.delete(String(args[0])); return { success: true }; }
              return { success: true };
            },
            async first<T>() {
              if (sql.startsWith('SELECT comment_id')) {
                const v = comments.get(String(args[0]));
                return (v ? { comment_id: v } : null) as T | null;
              }
              return null as T | null;
            },
          };
        },
      };
    },
  };
}

describe('ReviewStore', () => {
  it('claim returns true once, false on repeat', async () => {
    const store = new ReviewStore(fakeD1());
    expect(await store.claim('F:43:2:v1')).toBe(true);
    expect(await store.claim('F:43:2:v1')).toBe(false);
  });
  it('round-trips a comment id and clears it', async () => {
    const store = new ReviewStore(fakeD1());
    expect(await store.getCommentId('F', '43:2')).toBeNull();
    await store.setCommentId('F', '43:2', 'c1');
    expect(await store.getCommentId('F', '43:2')).toBe('c1');
    await store.clear('F', '43:2');
    expect(await store.getCommentId('F', '43:2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store/review-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/store/review-store.ts` and `worker/schema.sql`**

```ts
// src/store/review-store.ts
export interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
    };
  };
}

const frameKey = (fileKey: string, nodeId: string) => `${fileKey}:${nodeId}`;

export class ReviewStore {
  constructor(private db: D1Like) {}

  async claim(dedupKey: string): Promise<boolean> {
    const res = await this.db
      .prepare('INSERT INTO claims (dedup_key, claimed_at) VALUES (?, ?) ON CONFLICT(dedup_key) DO NOTHING')
      .bind(dedupKey, new Date().toISOString())
      .run();
    return (res.meta?.changes ?? 0) === 1;
  }

  async getCommentId(fileKey: string, nodeId: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT comment_id FROM comments WHERE frame_key = ?')
      .bind(frameKey(fileKey, nodeId))
      .first<{ comment_id: string }>();
    return row?.comment_id ?? null;
  }

  async setCommentId(fileKey: string, nodeId: string, commentId: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO comments (frame_key, comment_id) VALUES (?, ?) ON CONFLICT(frame_key) DO UPDATE SET comment_id = excluded.comment_id')
      .bind(frameKey(fileKey, nodeId), commentId)
      .run();
  }

  async clear(fileKey: string, nodeId: string): Promise<void> {
    await this.db.prepare('DELETE FROM comments WHERE frame_key = ?').bind(frameKey(fileKey, nodeId)).run();
  }
}
```

Create `worker/schema.sql` with the two `CREATE TABLE` statements shown above.

> Note: `new Date().toISOString()` here is fine — this file runs in the Worker/consumer path, not the pure reviewer core.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store/review-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/review-store.ts worker/schema.sql test/store/review-store.test.ts
git commit -m "feat(store): D1 review store (dedup claim + comment id)"
```

---

### Task 11: Worker receiver + consumer + wrangler config

Assembles the deployable Worker from already-tested parts. The receiver and consumer are thin glue; the logic they call is all unit-tested. Verification here is a live smoke test, since Worker wiring is integration-level.

**Files:**
- Create: `worker/handlers/receiver.ts` (the `fetch` handler logic)
- Create: `worker/handlers/consumer.ts` (the `queue` handler logic)
- Create: `worker/index.ts` (**the single Worker entry** — one `export default` with BOTH `fetch` and `queue`)
- Create: `tsconfig.worker.json`
- Create: `wrangler.jsonc`
- Modify: `package.json` (add a `build:worker` script), `README.md`

**Interfaces:**
- Consumes: `verifyAndBuildJob`/`ReviewJob` (Task 9), `review`/`ReviewDeps` (Task 5), `fetchTeamComponentCatalog` (Task 3), emitters (Tasks 7–8), `ReviewStore` (Task 10), `FigmaClient` (existing).
- The catalog is fetched once per isolate and cached in a module-level variable (cold-start rebuild is acceptable; a KV cache is a v2 optimization noted in the spec).

> **Why one entry file (fixes the "consumer never loads" critical):** a Cloudflare Worker loads exactly ONE module — the file named by `main`. Cloudflare invokes `fetch` for HTTP and `queue` for queue messages, but **both must be properties of that one module's single `default` export.** Two files each with their own `export default` means only `main`'s export loads; the queue handler is never registered and every queued job dead-letters. So the handler *logic* lives in two files for clarity, but `worker/index.ts` is the only entry and composes both. `main` points at `worker/index.ts`.

- [ ] **Step 1: Write the receiver handler**

```ts
// worker/handlers/receiver.ts
import { verifyAndBuildJob } from '../verify.js';
import type { ReviewJob } from '../verify.js';

export interface ReceiverEnv {
  REVIEW_QUEUE: { send(body: ReviewJob): Promise<void> };
  WEBHOOK_PASSCODE: string;
}

export async function handleWebhook(request: Request, env: ReceiverEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response('ok', { status: 200 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const result = verifyAndBuildJob(payload as any, env.WEBHOOK_PASSCODE);
  if (!result.ok) return new Response('forbidden', { status: 403 });
  if (result.job) await env.REVIEW_QUEUE.send(result.job);
  return new Response('ok', { status: 200 });  // fast ack — always
}
```

- [ ] **Step 2: Write the consumer handler**

```ts
// worker/handlers/consumer.ts
import { review } from '../../src/review/reviewer.js';
import { fetchTeamComponentCatalog } from '../../src/collectors/team-catalog.js';
import { FigmaClient } from '../../src/collectors/figma-client.js';
import { ReviewStore } from '../../src/store/review-store.js';
import type { D1Like } from '../../src/store/review-store.js';
import { postFrameComment, deleteFrameComment } from '../../src/emitters/figma-comment.js';
import { formatSlackBlocks, resolveMention, postDigest } from '../../src/emitters/slack.js';
import type { Catalog } from '../../src/collectors/team-catalog.js';
import type { ReviewJob } from '../verify.js';

export interface ConsumerEnv {
  DB: D1Like;
  FIGMA_BOT_TOKEN: string;
  FIGMA_DS_TEAM_ID: string;
  SLACK_BOT_TOKEN: string;
  SLACK_CHANNEL: string;
  FIGMA_SLACK_MAP: string;   // JSON string
  DLS_KEY: string; ARCADE_KEY: string; ARCADE3_KEY: string;
}

let catalogCache: Catalog | null = null;

export async function handleQueue(
  batch: { messages: { body: ReviewJob; ack(): void }[] },
  env: ConsumerEnv,
): Promise<void> {
  const client = new FigmaClient(env.FIGMA_BOT_TOKEN);
  const store = new ReviewStore(env.DB);
  if (!catalogCache) catalogCache = await fetchTeamComponentCatalog(client, env.FIGMA_DS_TEAM_ID);

  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      // Clear on COMPLETED / NONE — delete stale comment, drop the row.
      if (job.status !== 'READY_FOR_DEV') {
        const existing = await store.getCommentId(job.fileKey, job.nodeId);
        if (existing) { await deleteFrameComment(client, job.fileKey, existing).catch(() => {}); await store.clear(job.fileKey, job.nodeId); }
        msg.ack();
        continue;
      }

      const dedupKey = `${job.fileKey}:${job.nodeId}:${job.version ?? 'live'}`;
      if (!(await store.claim(dedupKey))) { msg.ack(); continue; }

      const result = await review(
        { client, catalog: catalogCache, libraryKeys: { dls: env.DLS_KEY, arcade: env.ARCADE_KEY, arcade3: env.ARCADE3_KEY }, now: () => new Date().toISOString() },
        { fileKey: job.fileKey, nodeId: job.nodeId, version: job.version, frameName: job.frameName, triggeredBy: job.triggeredBy, status: 'READY_FOR_DEV' },
      );

      // Upsert comment: delete old (same bot author) then post new.
      const prev = await store.getCommentId(job.fileKey, job.nodeId);
      if (prev) await deleteFrameComment(client, job.fileKey, prev).catch(() => {});
      const newId = await postFrameComment(client, result);
      await store.setCommentId(job.fileKey, job.nodeId, newId);

      // Slack only when there is something to act on.
      if (result.findings.length > 0 || result.tooLarge) {
        const map = JSON.parse(env.FIGMA_SLACK_MAP || '{}');
        const mention = resolveMention(result.triggeredBy, undefined, map);
        await postDigest(env.SLACK_BOT_TOKEN, env.SLACK_CHANNEL, formatSlackBlocks(result, mention), `${result.frameName} review`);
      }
      msg.ack();
    } catch (err) {
      console.error('review failed', job, err);
      msg.ack();  // ack to avoid poison-loop; failures are logged. (Retry policy is a v2 tuning item.)
    }
  }
}
```

- [ ] **Step 3: Write the single Worker entry that composes both handlers**

```ts
// worker/index.ts
import { handleWebhook } from './handlers/receiver.js';
import type { ReceiverEnv } from './handlers/receiver.js';
import { handleQueue } from './handlers/consumer.js';
import type { ConsumerEnv } from './handlers/consumer.js';

export type Env = ReceiverEnv & ConsumerEnv;

// ONE default export with BOTH handlers — this is the entire Worker.
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleWebhook(request, env);
  },
  queue(batch: { messages: { body: any; ack(): void }[] }, env: Env): Promise<void> {
    return handleQueue(batch, env);
  },
};
```

- [ ] **Step 4: Write `wrangler.jsonc` (main → the single entry)**

```jsonc
{
  "name": "ds-observatory-review",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "queues": {
    "producers": [{ "queue": "ds-review", "binding": "REVIEW_QUEUE" }],
    "consumers": [{ "queue": "ds-review", "max_batch_size": 5 }]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "ds-review-store", "database_id": "<fill after wrangler d1 create>" }],
  "vars": { "SLACK_CHANNEL": "#ads-core-team", "FIGMA_DS_TEAM_ID": "<ds team id>", "DLS_KEY": "rNeWrFnPT8J903T2jon2oG", "ARCADE_KEY": "loThitjZGdpisyETz5avvz", "ARCADE3_KEY": "a2uKnm88LxRXEWAL1kOqeQ" }
}
```

> Secrets set via `wrangler secret put`: `WEBHOOK_PASSCODE`, `FIGMA_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `FIGMA_SLACK_MAP`. `main` is the single entry `worker/index.ts`; the `consumers` array only tells Cloudflare which queue this same Worker consumes — the actual handler is the `queue` method on the entry's default export. Consult the `wrangler` skill to confirm current queue-binding syntax for your account.

- [ ] **Step 5: Add a Worker type-check config + build script (fixes "npm build never checks worker/")**

The repo's `tsconfig.json` has `rootDir: "src"` / `include: ["src"]`, so `npm run build` (`tsc`) **never type-checks `worker/`** — its build gates are meaningless for half the feature. Add a dedicated Worker config that type-checks `worker/` and its cross-imports into `src/` without emitting (wrangler bundles the actual deploy via esbuild).

Create `tsconfig.worker.json`:
```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["worker", "src"]
}
```

Install the Worker types: `npm i -D @cloudflare/workers-types wrangler`.

Add to `package.json` scripts:
```json
    "build:worker": "tsc -p tsconfig.worker.json",
```

- [ ] **Step 6: Type-check both the library and the Worker**

Run: `npm run build && npm run build:worker`
Expected: `build` compiles `src/` (emits `dist/`) with no errors; `build:worker` type-checks `worker/` + its `src/` imports with no errors and no emit. Both must pass — this is the real gate for the Worker code.

- [ ] **Step 7: Create the D1 database and apply the schema**

Run (per wrangler skill): `npx wrangler d1 create ds-review-store` then `npx wrangler d1 execute ds-review-store --file worker/schema.sql`. Paste the returned `database_id` into `wrangler.jsonc`.

- [ ] **Step 8: Live smoke test with a manual webhook payload**

Deploy to a dev environment (`npx wrangler dev`), then POST a hand-built `DEV_MODE_STATUS_UPDATE` payload (correct passcode, a real `file_key`/`node_id` from the Navigation file) to the entry Worker's URL. Verify: 200 returned immediately; within a minute a summary comment appears on the frame in Figma and a digest lands in `#ads-core-team`. Then POST a large SECTION's `node_id` and confirm a single "too large" comment (not a crash / silent no-op). Finally flip the original node's status to `COMPLETED` and confirm the comment is removed.

- [ ] **Step 9: Register the real Figma webhook**

Per spec §2, create a `DEV_MODE_STATUS_UPDATE` webhook (Figma webhooks API) for the product team's file(s), pointing at the deployed Worker URL, with the `WEBHOOK_PASSCODE`. Confirm a real "ready for dev" flip triggers the loop.

- [ ] **Step 10: Update the README**

Add a "Active Review" section documenting: the `review` CLI command (with `--comment`/`--slack`), the Worker architecture (single entry with `fetch` + `queue`), required secrets, and the two v2-deferred checks. Keep it consistent with the existing README voice.

- [ ] **Step 11: Commit**

```bash
git add worker/handlers/receiver.ts worker/handlers/consumer.ts worker/index.ts tsconfig.worker.json wrangler.jsonc package.json README.md
git commit -m "feat(worker): single-entry webhook receiver + queue consumer + wrangler config"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §2 trigger (DEV_MODE_STATUS_UPDATE, passcode, READY_FOR_DEV/COMPLETED/NONE) → Tasks 9, 11.
- §3 architecture (receiver → queue → consumer → emitters → store; why-not-plugin) → Tasks 9–11.
- §4.1 size ceiling → Task 5 (`depth=1` probe + `MAX_IMMEDIATE_CHILDREN` + `MAX_REVIEW_NODES`, guarded deep fetch, `tooLarge.reason`).
- §4.2 deprecated + variant→set-name resolution → Tasks 2, 4 (test asserts set-name catch).
- §4.3 detached (weak detail acknowledged) → Task 4.
- §4.4 idempotency (dedup key + D1 claim) → Tasks 10, 11.
- §5 data model, deep-link + version pinning, cleanScore null-guard → Tasks 1, 5, 7.
- §6.1 comment upsert (delete-then-post, single bot author, node_offset pinning, clear on COMPLETED/NONE, no "reply to dismiss") → Tasks 7, 11.
- §6.2 Slack digest, identity map, silent-on-clean → Tasks 8, 11.
- §7 status→action table → Task 11 consumer branches.
- §8 build order → phase ordering A→B→C→D.
- §9 deferrals (old-gen, raw-value) → explicitly excluded (Global Constraints); §10 dependencies surfaced in Phase D preamble.
- Debounce (§6.2) is intentionally **not** implemented in v1 tasks — flagged as a known simplification (see note below), since correct per-triggerer batching needs Worker-side timers/Durable Objects and would balloon Task 11.

**Known simplification (surfaced, not hidden):** the spec's §6.2 Slack debounce (batch bulk-flips per designer within 60s) is deferred — v1 posts one Slack message per frame. Bulk "ready for dev" flips will produce multiple messages. Revisit with a Durable Object timer if noise is real.

**Adversarial-review fixes applied (second pass):**
- **C1 — size ceiling was checked after the full fetch** (huge sections would crash → silent no-op). Task 5 now does a `depth=1` probe → `MAX_IMMEDIATE_CHILDREN` breadth bail → guarded deep fetch that degrades to `tooLarge:{reason:'fetch-failed'}` instead of throwing → `MAX_REVIEW_NODES` ceiling last. `tooLarge` gained a `reason`; emitter/CLI handle the countless case.
- **C2 — two `export default` files meant the queue handler never loaded.** Task 11 now has a single entry (`worker/index.ts`) exposing both `fetch` and `queue`; handler logic split into `worker/handlers/*`; `main` → `worker/index.ts`.
- **M1 — `npm run build` never type-checked `worker/`.** Task 11 adds `tsconfig.worker.json` + a `build:worker` script; the build gate now runs both.
- **M2 — `cleanScore` labeled "Clean DS" overclaimed** (can't distinguish generations in the consolidated library). Relabeled everywhere to "On current DS lib" with an in-code caveat; math unchanged.
- **M3 — deprecated check fell back to the variant name when the key was absent from the catalog** (false negatives). Task 4 now returns null when `info` is missing; a new test asserts no guessing on `meta.name`.

**Placeholder scan:** no TBD/TODO; every code step has complete code. `<fill after wrangler d1 create>` and `<ds team id>` in `wrangler.jsonc` are genuine deploy-time secrets/ids, not code placeholders.

**Type consistency:** `Finding`/`ReviewResult`/`ReviewTarget` (Task 1, `tooLarge.reason` added) used consistently in Tasks 4, 5, 6, 7, 8, 11. `Catalog`/`ComponentInfo` (Task 3) used in Tasks 4, 5, 11. `ReviewJob` (Task 9) used in Task 11. `D1Like` (Task 10) used in Task 11. `review(deps, target)` and the `MAX_REVIEW_NODES`/`MAX_IMMEDIATE_CHILDREN` consts consistent across Tasks 5, 6, 11. `buildDeepLink` signature consistent across Tasks 1, 7, 8.
