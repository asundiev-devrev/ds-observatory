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
