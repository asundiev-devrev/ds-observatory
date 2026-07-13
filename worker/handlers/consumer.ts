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
  EXCLUDE_LIBRARY_KEYS?: string;
  SLACK_BOT_TOKEN: string;
  SLACK_CHANNEL: string;
  FIGMA_SLACK_MAP: string;   // JSON string
  DLS_KEY: string;
  ARCADE_KEY: string;
  ARCADE3_KEY: string;
}

let catalogCache: Catalog | null = null;

export async function handleQueue(
  batch: { messages: { body: ReviewJob; ack(): void }[] },
  env: ConsumerEnv,
): Promise<void> {
  const client = new FigmaClient(env.FIGMA_BOT_TOKEN);
  const store = new ReviewStore(env.DB);

  // Fetch catalog with drift threading: pass exclude keys to keep Worker consistent with CLI
  if (!catalogCache) {
    const excludeKeys = env.EXCLUDE_LIBRARY_KEYS
      ? env.EXCLUDE_LIBRARY_KEYS.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    catalogCache = await fetchTeamComponentCatalog(client, env.FIGMA_DS_TEAM_ID, excludeKeys);
  }

  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      // Clear on COMPLETED / NONE — delete stale comment, drop the row.
      if (job.status !== 'READY_FOR_DEV') {
        const existing = await store.getCommentId(job.fileKey, job.nodeId);
        if (existing) {
          await deleteFrameComment(client, job.fileKey, existing).catch(() => {});
          await store.clear(job.fileKey, job.nodeId);
        }
        msg.ack();
        continue;
      }

      const dedupKey = `${job.fileKey}:${job.nodeId}:${job.version ?? 'live'}`;
      if (!(await store.claim(dedupKey))) {
        msg.ack();
        continue;
      }

      const result = await review(
        {
          client,
          catalog: catalogCache,
          libraryKeys: {
            dls: env.DLS_KEY,
            arcade: env.ARCADE_KEY,
            arcade3: env.ARCADE3_KEY
          },
          now: () => new Date().toISOString()
        },
        {
          fileKey: job.fileKey,
          nodeId: job.nodeId,
          version: job.version,
          frameName: job.frameName,
          triggeredBy: job.triggeredBy,
          status: 'READY_FOR_DEV'
        },
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
        await postDigest(
          env.SLACK_BOT_TOKEN,
          env.SLACK_CHANNEL,
          formatSlackBlocks(result, mention),
          `${result.frameName} review`
        );
      }
      msg.ack();
    } catch (err) {
      console.error('review failed', job, err);
      msg.ack();  // ack to avoid poison-loop; failures are logged.
    }
  }
}
