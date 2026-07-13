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
