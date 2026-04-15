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
    dlsLibraryKey: overrides.dlsLibraryKey ?? process.env.DLS_LIBRARY_KEY ?? 'rNeWrFnPT8J903T2jon2oG',
    arcadeLibraryKey: overrides.arcadeLibraryKey ?? process.env.ARCADE_LIBRARY_KEY ?? 'loThitjZGdpisyETz5avvz',
    hotFileCount: overrides.hotFileCount ?? parseInt(process.env.HOT_FILE_COUNT ?? '15', 10),
    hotFileWindowDays: overrides.hotFileWindowDays ?? parseInt(process.env.HOT_FILE_WINDOW_DAYS ?? '60', 10),
  };
}
