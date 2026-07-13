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
