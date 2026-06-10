import { config as loadDotenv } from 'dotenv';
import type { Config } from './types.js';

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadDotenv();

  const figmaAccessToken = overrides.figmaAccessToken ?? process.env.FIGMA_ACCESS_TOKEN;
  const figmaTeamId = overrides.figmaTeamId ?? process.env.FIGMA_TEAM_ID;
  const figmaDsTeamId = overrides.figmaDsTeamId ?? process.env.FIGMA_DS_TEAM_ID ?? figmaTeamId;

  if (!figmaAccessToken) {
    throw new Error('FIGMA_ACCESS_TOKEN is required. Set it in .env or pass via CLI.');
  }
  if (!figmaTeamId) {
    throw new Error('FIGMA_TEAM_ID is required. Set it in .env or pass via CLI.');
  }

  return {
    figmaAccessToken,
    figmaTeamId,
    figmaDsTeamId: figmaDsTeamId!,
    // DLS Components — oldest legacy library
    dlsLibraryKey: overrides.dlsLibraryKey ?? process.env.DLS_LIBRARY_KEY ?? 'rNeWrFnPT8J903T2jon2oG',
    // Arcade 0.2 — current official library, being deprecated
    arcadeLibraryKey: overrides.arcadeLibraryKey ?? process.env.ARCADE_LIBRARY_KEY ?? 'loThitjZGdpisyETz5avvz',
    // Arcade 0.3 — new source of truth, actively finalising
    arcade3LibraryKey: overrides.arcade3LibraryKey ?? process.env.ARCADE3_LIBRARY_KEY ?? 'a2uKnm88LxRXEWAL1kOqeQ',
    // Files that aren't product surface — DS libraries, asset dumps, docs, a11y refs.
    // Matched case-insensitively as substrings of the Figma file name.
    excludeFilePatterns: overrides.excludeFilePatterns ?? (
      process.env.EXCLUDE_FILE_PATTERNS
        ? process.env.EXCLUDE_FILE_PATTERNS.split(',').map(s => s.trim()).filter(Boolean)
        : [
            'Marketplace Banner Images',
            'A11y for ADS',
            'Arcade UI Kit',
            'Documentation Website',
          ]
    ),
    hotFileCount: overrides.hotFileCount ?? parseInt(process.env.HOT_FILE_COUNT ?? '15', 10),
    hotFileWindowDays: overrides.hotFileWindowDays ?? parseInt(process.env.HOT_FILE_WINDOW_DAYS ?? '60', 10),
  };
}
