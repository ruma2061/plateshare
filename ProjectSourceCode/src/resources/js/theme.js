(() => {
  const key = 'plateshare-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const validTheme = value => value === 'light' || value === 'dark';
  let preference = null;
  try {
    const saved = window.localStorage.getItem(key);
    if (validTheme(saved)) preference = saved;
  } catch { /* Theme switching still works when storage is unavailable. */ }

  function applyTheme() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    root.setAttribute('data-bs-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.querySelector('[data-theme-label]').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
      button.hidden = false;
    });
  }

  // Run in the head before styles load, so a saved dark theme never flashes light.
  applyTheme();
  document.addEventListener('DOMContentLoaded', applyTheme);
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    preference = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
    applyTheme();
  });
  system.addEventListener('change', () => { if (!preference) applyTheme(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = validTheme(event.newValue) ? event.newValue : null;
    applyTheme();
  });
})();
