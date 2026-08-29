const routes = new Map();
let currentCleanup = null;

export function registerRoute(pattern, handler) {
  routes.set(pattern, handler);
}

export function parseRoute(hash) {
  const path = (hash || '#/overview').replace(/^#/, '') || '/overview';
  const parts = path.split('/').filter(Boolean);
  return parts;
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function startRouter(renderFn) {
  const handle = () => {
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    const parts = parseRoute(window.location.hash);
    const page = parts[0] || 'overview';
    document.querySelectorAll('.main-nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === page || (page.startsWith('groups') && a.dataset.route === 'groups') || (page.startsWith('instructors') && a.dataset.route === 'instructors'));
    });
    const cleanup = renderFn(parts);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  };
  window.addEventListener('hashchange', handle);
  if (!window.location.hash) window.location.hash = '#/overview';
  handle();
  return () => window.removeEventListener('hashchange', handle);
}
