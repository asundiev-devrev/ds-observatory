# DS Observatory — Active Review (Project A)

**Status:** Design / spec (revised after adversarial review, 2026-07-10)
**Date:** 2026-07-10
**Author:** Andrei Sundiev (with Claude Code)
**Scope:** Project A only. Project B (component identity system, per Daniel Nacamuli's Figma-frame-ID idea) is deferred to its own spec. A is designed to *adopt* B's IDs later without rework.

---

## 1. Problem & goal

DS Observatory today is a **read-only** pipeline: a CLI fetches Figma data, classifies component usage, and produces a dashboard + HTML report. The data may or may not be seen and acted on. Nothing pushes findings to where work happens.

**Goal:** make Observatory *act* on what it detects. When a designer marks a frame **"Ready for dev"** in Figma, Observatory reviews that specific frame for design-system health and reports the findings in two places:

1. **In Figma** — one summary comment pinned to the frame, listing issues with deep-links to each offending node.
2. **In Slack** — an actionable digest to `#ads-core-team`, @-mentioning the person who marked the frame ready, with a deep-link back to the frame.

The "Ready for dev" handoff is the trigger because it is the moment of highest leverage: a designer is declaring "build this," so catching design-system drift *then* prevents engineering from inheriting it. The trigger is fully automatic — no human has to remember to run anything, which is the entire point (see §3, "Why not a plugin").

### Non-goals (v1)

- Not a whole-file audit. One frame (or bounded section) per trigger.
- Not the component identity system (Project B). A references components by Figma node id and component name only.
- Not fixing issues automatically. Report only; humans act.
- Not replacing the existing `collect` / `serve` / `report` commands. This is additive.
- **Not old-generation detection or raw-value/token detection in v1** — both deferred to v2 with explicit prerequisites (§9).

---

## 2. Trigger: "Ready for dev" (verified against Figma OpenAPI spec)

Verified in `figma/rest-api-spec` `openapi/openapi.yaml` (fetched 2026-07-10; line numbers cited):

- **Webhook event `DEV_MODE_STATUS_UPDATE`** exists (`WebhookDevModeStatusUpdatePayload`, openapi 7423-7461). Payload fields:
  - `event_type` = `DEV_MODE_STATUS_UPDATE`
  - `file_key` — file that changed
  - `file_name`
  - `node_id` — the node whose Dev Mode status changed, e.g. `"43:2"`
  - `status` — one of `NONE`, `READY_FOR_DEV`, `COMPLETED`
  - `triggered_by` — the `User` (`{id, handle, img_url}` — **no email**)
  - `related_links` — array of `DevResource` links attached to the layer
- **`passcode`** is a required field on every webhook payload (`WebhookBasePayload`, openapi 7190-7207) — the receiver verifies it on every request.
- **`devStatus`** is a property on both `FrameTraits` (openapi 3807) **and `SectionNode`** (openapi 4066); enum `{NONE, READY_FOR_DEV, COMPLETED}` (3775-3778). **Consequence:** the marked node can be a *section* containing an entire page of frames, not just a single small frame. This is handled by a node-count ceiling (§4.1).

**v1 acts on `READY_FOR_DEV` to review, and on `COMPLETED`/`NONE` to *clear*** a previously-posted review (see §6.1, §7). This closes the "stale comment after a fix" gap.

---

## 3. Architecture

Cloudflare Workers, event-driven, single-purpose units.

```
Figma "Ready for dev" / "Completed" / status cleared
        │  DEV_MODE_STATUS_UPDATE webhook (HTTPS POST)
        ▼
┌────────────────────────┐
│ 1. Receiver (Worker)   │  verify passcode → ack 200 fast → enqueue
└──────────┬─────────────┘
           │ Cloudflare Queue   job = { fileKey, nodeId, status, triggeredBy, fileName, version }
           ▼
┌────────────────────────┐
│ 2. Reviewer (consumer) │  fetch node subtree → run checks → ReviewResult
└──────────┬─────────────┘
           ▼
    ┌──────┴───────┐
    ▼              ▼
┌─────────┐  ┌──────────┐
│3. Figma │  │4. Slack  │   upsert/clear frame comment   +   post digest
│ comment │  │ digest   │
└─────────┘  └──────────┘
           │
           ▼
┌────────────────────────┐
│ 5. Review store (D1)   │  dedup lock + comment-id record; enables atomic upsert
└────────────────────────┘
```

### Why this shape

- **Receiver stays thin.** Figma requires a fast `200` or it retries and eventually disables the webhook. The receiver only verifies the passcode and enqueues.
- **Queue absorbs the slow part.** The Reviewer may take seconds-to-minutes on Figma's slow API. The queue decouples this from the webhook ack and retries on transient failure. **Note:** Cloudflare Queues deliver *at least once* — the consumer must be idempotent (§4.4, §6.1).
- **Reviewer is a reusable pure core.** `review(fileKey, nodeId, version) → ReviewResult`. The same function backs a manual `review <url>` CLI command, so the entire detect→comment→Slack loop can be built and proven locally (via the CLI, or ngrok pointed at the receiver) before the production webhook is registered.
- **Emitters are dumb.** Each takes a `ReviewResult` and formats/sends. Swappable and independently testable.
- **Store gives atomic idempotency.** D1 (not KV) so a unique constraint on the dedup key enforces "exactly one consumer proceeds" (§4.4).

### Why not a plugin (decision, not oversight)

A Figma plugin has richer node access, but it **must be run by a human on a selected frame**. The core requirement here is that review happens *automatically* at the "ready for dev" moment with no one remembering to trigger it — a plugin cannot do that. Webhook + Workers is therefore the only option that meets the primary requirement. This is a deliberate rejection of the plugin path, not an unconsidered default.

### Repo layout (additive)

```
src/
├── review/
│   ├── reviewer.ts          # review(fileKey, nodeId, version) → ReviewResult (pure core)
│   ├── checks.ts            # v1: deprecated + detached
│   ├── deep-link.ts         # (fileKey, nodeId, version) → figma.com URL
│   └── types.ts             # Finding, ReviewResult
├── emitters/
│   ├── figma-comment.ts     # upsert/clear one summary comment on a frame
│   └── slack.ts             # post digest to #ads-core-team
├── store/
│   └── review-store.ts      # D1: dedup lock + comment-id record
├── collectors/              # REUSED — node-classifier extended, catalog fetch reused
└── cli/
    └── review.ts            # `ds-observatory review <figma-url|fileKey nodeId>`
worker/
├── receiver.ts              # webhook endpoint: verify + enqueue
└── consumer.ts              # queue consumer: calls reviewer + emitters
wrangler.jsonc               # Worker + Queue + D1 bindings
```

---

## 4. The reviewer (v1: two checks)

The Reviewer needs the **DS team component catalog** (`component key → { fileKey, displayName (set name), rawName }`), already built by `collect.ts::fetchTeamComponentCatalog`. In the Worker it is fetched once and cached in KV with a TTL (it changes rarely; ~5k components).

### 4.1 Fetch + size ceiling (fixes the "one frame isn't bounded" problem)

The marked node may be a section spanning a whole page. To keep a review bounded:

1. First fetch the node **shallow** (`GET /v1/files/{fileKey}/nodes?ids={nodeId}&depth=1&version={version}`) to read its immediate size.
2. Walk to count total descendants **as it fetches deeper** (existing client already degrades depth on large pages). If the node's total node count exceeds a **ceiling `MAX_REVIEW_NODES` (default 5,000)**, abort the per-node review and post a single comment: *"This section is too large to review automatically (N nodes). Break it into frames or review manually."* Log + Slack a one-line notice. No per-finding enumeration.
3. Otherwise fetch the full subtree and walk once.

For the two v1 checks, the needed node fields are `type`, `componentId`, and the response's `components` meta map — all present at the depths the existing `FigmaClient` already fetches. **No richer node shape is required for v1** (that requirement belongs to the deferred raw-value check, §9).

### 4.2 Check — Deprecated components

An INSTANCE whose **component-set display name** contains the deprecation marker (`DEPRECATED`, matched case-insensitively inside a bracketed prefix such as `[🔴DEPRECATED]`).

**Resolution (fixes the variant-vs-set-name gap):** an instance's `componentId` resolves to a `Component` meta whose `name` is the *variant* (e.g. `Type=Secondary`) and which has **no set name and no `file_key`** (openapi Component schema ~5904-5931). The deprecation marker lives on the **set** name. So Check A must resolve variant → set name via the cached team catalog, keyed by the component `key` (exactly the `containing_frame.containingComponentSet.name` join `collect.ts:76` already performs). Matching the instance's directly-resolved variant name would miss the marker and therefore miss most deprecated instances.

- Verified in real data: 45 distinct deprecated-marked components across 15 files; `[🔴DEPRECATED]Progressive Divider` alone has 1,106 instances.
- `detail` = the set display name, e.g. `"[🔴DEPRECATED]Button / Secondary"`.
- **Test:** unit test against a known deprecated *variant* instance to prove the set-name join catches it.

### 4.3 Check — Detachments

Reuses the existing `node-classifier` `detached` category (INSTANCE with no `componentId`, or with a `componentId` that resolves to no meta). Reported by count + deep-link to each (capped display, see §6).

- **Honest limitation:** detached node names are frequently blank (`" "`) and `originalComponent` is an internal node id, not a component name. So `detail` is often weak — we report location + count, not always "what it used to be." Known data limitation, not a v1 bug.

### 4.4 Idempotency

The consumer computes a **dedup key = `fileKey:nodeId:version`**. Before doing work it inserts that key into a D1 table with a UNIQUE constraint; if the insert fails (another delivery already claimed it), it exits. This makes at-least-once queue delivery and Figma's repeated webhook fires safe — exactly one review runs per (frame, version).

---

## 5. Data model

```ts
type FindingKind = 'deprecated' | 'detached';   // v1. v2 adds 'old-generation' | 'raw-value'

interface Finding {
  kind: FindingKind;
  nodeId: string;            // "43:2" — used to build the deep-link
  nodeName: string;
  detail: string;            // human-readable specifics (see each check)
}

interface ReviewResult {
  fileKey: string;
  version: string;           // pinned at review time (see §5.1)
  frameNodeId: string;
  frameName: string;
  reviewedAt: string;        // ISO; stamped by the caller (Worker/CLI), not the pure core
  triggeredBy?: string;      // Figma user handle from webhook; absent for manual CLI runs
  status: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE';
  findings: Finding[];
  counts: Record<FindingKind, number>;
  cleanScore: number | null; // % of component surface that is clean current DS; null if no component surface
  tooLarge?: { nodeCount: number };  // set instead of findings when over MAX_REVIEW_NODES
}
```

### 5.1 Deep-links, version & branch pinning

- **Deep-link:** `https://www.figma.com/file/{fileKey}?node-id={encodeURIComponent(nodeId)}&version-id={version}`. Pinning to the file `version` captured at review time prevents links rotting when the designer keeps editing after the flag flips (the queue budget is seconds-to-minutes).
- **v1 status:** deferred — the webhook payload carries no version and v1 does not fetch one, so deep-links are unversioned in v1; the plumbing (`result.version` → buildDeepLink) is in place for when a version source is added.
- **Branches:** `READY_FOR_DEV` can be set on a branch. v1 detects a branch file key and **either reviews it against the branch key or explicitly skips with a logged "branches not supported in v1" notice.** Decision recorded as open question Q4; default = skip + log, since branch review adds join complexity.

### 5.2 cleanScore (fixes divide-by-zero)

`cleanScore = componentSurface > 0 ? cleanCurrentDS / componentSurface * 100 : null`. When a frame has zero component instances (raw layout, image, text mockup), `cleanScore` is `null` and the emitters render "no DS components" rather than `NaN`. `componentSurface` follows the existing definition (`hot-file-traversal.ts:100-106`).

---

## 6. Emitters

### 6.1 Figma comment (`emitters/figma-comment.ts`)

- Posts **one summary comment** to the frame via `POST /v1/files/{fileKey}/comments`, pinned to the node using `client_meta` as a **`FrameOffset`** — which requires **both `node_id` and `node_offset` (a `Vector` with required `x`,`y`)** (openapi 6602-6614, 4701-4703). Pinning with a node id alone is not valid; the offset (e.g. `{x:0,y:0}`) must be supplied.
- **"Upsert" = delete-then-post, under real constraints (fixes the upsert-impossible finding):**
  - There is **no edit-comment endpoint** — only `getComments` / `postComment` / `deleteComment` (openapi 634-767).
  - `deleteComment` is restricted to **the comment's author** (openapi 739). Therefore **all comments must be posted by a single dedicated bot identity** (one PAT), documented as a hard requirement (§8). If a human deletes/resolves it, the store row is cleared on next run and a fresh comment is posted.
  - On each review: look up the stored comment id for `fileKey:frameNodeId` in D1. Under the §4.4 lock, delete the old comment (if present) and post the new one, then store the new id. The dedup lock guarantees only one consumer does this, so no duplicate/orphan pair is created.
  - Each upsert *does* re-notify file watchers (unavoidable given no edit API). This is acceptable because reviews are frame-scoped and infrequent per frame; it is called out so it isn't a surprise.
- **On `COMPLETED`/`NONE`:** delete the stored comment (the frame is done or no longer in dev) and clear the row — so fixed frames don't keep a stale "🔴 issues" comment.
- Comment body:
  ```
  🔭 DS Observatory review — {frameName}
  Clean DS: {cleanScore or "n/a — no DS components"}  ·  {total} issue(s)

  🔴 Deprecated ({n})
    • [🔴DEPRECATED]Button / Secondary → {deep-link}
  ⚪ Detached ({n})
    • {N} detached nodes → {deep-link to first}

  Reviewed {reviewedAt}.
  ```
  (No "reply to dismiss" — the design cannot honor it, since the next upsert deletes the comment and its replies. Dismissal is a v2 consideration.)
- If there are **no findings**, post a short "✅ clean" confirmation comment (confirms the review ran). Slack stays silent on clean (§6.2).

### 6.2 Slack digest (`emitters/slack.ts`)

- Posts to `#ads-core-team` via `chat.postMessage` (Block Kit).
- **@-mention requires a Figma→Slack identity map.** `triggered_by` is a Figma `User` with `handle` but **no email**, so it cannot be resolved to a Slack id directly. v1 adds a small **`figmaUserId → slackUserId` mapping** (config table, seeded for the DS team). If a user is unmapped, fall back to their plain-text Figma handle. This map is a listed dependency (§8).
- Headline: frame name (linked to the pinned, version-locked deep-link), `cleanScore`, total issues. Grouped counts with top offenders and a "view frame" link.
- **Silent on clean frames** (no findings) and on `COMPLETED`/`NONE` clears — Slack only fires when there is something to act on.
- **Debounce:** designers often bulk-flip many frames ready at once. The consumer batches Slack posts per `triggeredBy` within a short window (default 60s) into a single digest message listing all frames, instead of N separate pings.

---

## 7. Behavior summary (status → action)

| Webhook status | Reviewer | Figma | Slack |
|---|---|---|---|
| `READY_FOR_DEV` | run checks | upsert summary comment (or "too large", or "✅ clean") | digest if findings; silent if clean |
| `COMPLETED` | skip checks | delete stored comment, clear row | silent |
| `NONE` | skip checks | delete stored comment, clear row | silent |

---

## 8. Build order (de-risks the infra)

1. **Reviewer core + 2 checks** (`src/review/`), unit-tested against saved fixtures from `data/hot-file-audit.json` and a freshly-fetched deprecated-variant sample. No infra.
2. **`review` CLI command** — `ds-observatory review <figma-url>` prints the `ReviewResult`. Proves detection end-to-end locally.
3. **Emitters** — Figma comment (single bot PAT) + Slack (with identity map), driven from the CLI. Proves the full loop with a real token + real Slack, still no Worker.
4. **Worker receiver + queue + consumer** — register the webhook (ngrok during dev), deploy. The consumer calls the already-proven reviewer + emitters.
5. **Review store (D1)** — dedup lock + comment-id upsert + status-based clearing.

Each step is shippable and observable on its own.

---

## 9. Deferred to v2 (with prerequisites)

- **Old-generation detection.** **Blocked.** All three generations (DLS, Arcade 0.2, Arcade 0.3) now live in one consolidated library file (`a2uKnm88LxRXEWAL1kOqeQ`), so the current `file_key`-based classifier cannot distinguish them — and `collect.ts:236-244` actively biases shared names toward the *newest* generation, which would misclassify old-gen as current. **Prerequisite:** capture the DS team's actual name/prefix grammar for DLS vs Arcade 0.2 in the consolidated file as data (like `canonical-components.json`) and validate it against a labeled sample. Not buildable until that grammar exists.
- **Raw-value / token-adherence detection** (hardcoded colors & fonts vs variables/styles). Detectable in principle (`MinimalFillsTrait.styles`/`SolidPaint.boundVariables`/`TypeStyle.boundVariables` — openapi verified), but: (a) requires a **full-depth fetch** and a **richer node shape** than v1's `FigmaNode` (`types.ts:126-133` lacks `fills`/`boundVariables`), which fights the §4.1 size ceiling; (b) is the noisiest signal (intentional one-offs are legitimate) and needs a measured suppression threshold. **Prerequisite:** deep-fetch design within the ceiling + a noise-tuning pass. High value (Daniel's token pain), so first v2 candidate.

---

## 10. Dependencies & risks

| Item | Status | Note |
|---|---|---|
| **Single dedicated bot PAT with comment-write scope** | **To provision** | README says current token is read-only. Comment delete is author-locked → all comments must come from one bot identity (§6.1). |
| `SLACK_BOT_TOKEN` (`chat:write`, `#ads-core-team`) | **Not set** | Reported missing at session start. Blocker for Slack step. |
| Figma → Slack identity map | New (small) | `triggered_by` has no email; needed for @-mentions (§6.2). |
| Webhook passcode secret | New | Worker secret; verified on every request. |
| Cloudflare Workers + Queue + D1 | New infra | Zero-ops; needs a CF project. D1 (not KV) for the atomic dedup constraint. |
| `MAX_REVIEW_NODES` ceiling | New (config) | Bounds section-level triggers (§4.1). |
| Figma API slowness on large frames | Known | Mitigated by queue + retry + the size ceiling. |
| RTK shell hook currently failing | Environmental | `hook integrity check FAILED` blocks some Bash locally; affects build/test ergonomics until restored. Unrelated to design. |

## 11. Security

- Receiver **must** verify Figma's `passcode` (openapi 7190-7207) on every request before enqueuing; reject otherwise. Prevents forged review triggers.
- Bot PAT and Slack token stored as Worker secrets; never in code or repo.
- Comment + Slack outputs are **outward-facing writes** visible to everyone on the file and channel. v1 posts automatically on `READY_FOR_DEV`; if too noisy, a per-file opt-in allowlist is the first mitigation (v2 option).

## 12. Open questions (implementation, not blocking design)

1. **`MAX_REVIEW_NODES` value** — 5,000 is a starting guess; tune against real ready-for-dev sections.
2. **Clean-frame Figma comment** — post "✅ clean" or stay fully silent? Leaning: post it (confirms the review ran); Slack stays silent regardless.
3. **Debounce window** — 60s per triggerer is a guess; tune to designer bulk-flip behavior.
4. **Branch support** — default v1 = skip branch triggers with a logged notice; revisit if branch handoffs are common.

## 13. Relationship to Project B (deferred)

Project B assigns every DS component a **stable identity** (Daniel's Figma-frame-ID-as-attribute idea) so a specific instance is trackable across Figma ↔ code ↔ prototype. A works **without** B — it references nodes by Figma node id and components by name/set-name today. When B lands, the Reviewer's classification gains a bulletproof id-based path (replacing name/prefix heuristics — and directly unblocking the deferred old-generation check), and findings can link an instance to its canonical component across tools. A's `Finding`/`ReviewResult` contract is designed to carry such an id later without changing shape. B gets its own spec → plan → implementation cycle.
```
