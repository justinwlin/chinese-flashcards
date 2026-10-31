export function applyTheme(theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme !== 'light' && prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('cf-theme', theme || 'system');
  } catch {
    /* Private mode can block localStorage. The in-memory theme still applies. */
  }
  const color = dark ? '#141210' : '#f4efe6';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', color);
  });
}
