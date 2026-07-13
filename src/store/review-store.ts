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
