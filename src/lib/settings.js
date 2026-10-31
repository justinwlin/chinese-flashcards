export const DEFAULT_SETTINGS = {
  theme: 'system',
  newPerDay: 10,
  directions: 'both',
  speakOnReveal: true,
  syncOnOpen: true,
  owner: 'justinwlin',
  repo: 'chinese-flashcards',
  branch: 'main',
};

export function normalizeSettings(value) {
  const settings = { ...DEFAULT_SETTINGS, ...(value || {}) };
  const perDay = Number(settings.newPerDay);
  settings.newPerDay = Number.isFinite(perDay) ? Math.min(200, Math.max(0, Math.round(perDay))) : DEFAULT_SETTINGS.newPerDay;
  if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system';
  if (!['both', 'read', 'write'].includes(settings.directions)) settings.directions = 'both';
  settings.speakOnReveal = settings.speakOnReveal !== false;
  settings.syncOnOpen = settings.syncOnOpen !== false;
  settings.owner = String(settings.owner || DEFAULT_SETTINGS.owner).trim();
  settings.repo = String(settings.repo || DEFAULT_SETTINGS.repo).trim();
  settings.branch = String(settings.branch || 'main').trim() || 'main';
  return settings;
}
