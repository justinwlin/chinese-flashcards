export function formatVersionLabel({ version, sha, builtAt, locales, timeZone }) {
  const formatted = new Intl.DateTimeFormat(locales, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(builtAt));
  return `v${version} · ${sha} · built ${formatted}`;
}

export function versionLabel() {
  return formatVersionLabel({
    version: __APP_VERSION__,
    sha: __BUILD_SHA__,
    builtAt: __BUILD_TIME__,
  });
}
