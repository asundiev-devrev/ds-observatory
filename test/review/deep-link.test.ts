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
