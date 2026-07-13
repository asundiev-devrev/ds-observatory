const DEPRECATED_MARKER = /\[[^\]]*DEPRECATED[^\]]*\]/i;

/** True when a component set name carries a bracketed DEPRECATED marker. */
export function isDeprecatedName(name: string): boolean {
  return DEPRECATED_MARKER.test(name);
}
