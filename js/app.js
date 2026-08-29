import { data, ready } from './data.js';
import { buildIndexes } from './indexes.js';
import { renderFilterBar, bindFilterUpdates, renderDataQuality } from './components.js';
import { startRouter } from './router.js';
import { disposeAllCharts, resizeCharts } from './charts.js';
import { renderOverview } from './pages/overview.js';
import { renderGroups, renderGroupDetail } from './pages/groups.js';
import { renderInstructors, renderInstructorProfile } from './pages/instructors.js';
import { renderFeedback } from './pages/feedback.js';
import { renderPrograms } from './pages/programs.js';
import { renderForecast } from './pages/forecast.js';

let idx = null;

function getContext() {
  return { data, idx };
}

function renderPage(parts) {
  disposeAllCharts();
  const app = document.getElementById('app');
  const page = parts[0] || 'overview';

  switch (page) {
    case 'overview':
      renderOverview(app, getContext());
      break;
    case 'groups':
      if (parts[1]) renderGroupDetail(app, getContext(), parts[1]);
      else renderGroups(app, getContext());
      break;
    case 'instructors':
      if (parts[1]) renderInstructorProfile(app, getContext(), parts[1]);
      else renderInstructors(app, getContext());
      break;
    case 'feedback':
      renderFeedback(app, getContext());
      break;
    case 'programs':
      renderPrograms(app, getContext());
      break;
    case 'forecast':
      renderForecast(app, getContext());
      break;
    default:
      app.innerHTML = '<div class="empty-state">Page not found</div>';
  }

  requestAnimationFrame(() => resizeCharts());
  return () => disposeAllCharts();
}

async function init() {
  try {
    // Theme
    const savedTheme = localStorage.getItem('sas-theme') || 'light';
    document.documentElement.dataset.theme = savedTheme;
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('sas-theme', next);
      const parts = (window.location.hash || '#/overview').replace(/^#/, '').split('/').filter(Boolean);
      renderPage(parts);
    });

    // Mobile filter toggle
    document.getElementById('filter-toggle-mobile')?.addEventListener('click', () => {
      document.getElementById('filter-toolbar')?.classList.toggle('open');
    });

    await ready;
    idx = buildIndexes(data);
    const filterBar = document.getElementById('filter-bar');
    const dq = document.getElementById('data-quality');
    dq.innerHTML = renderDataQuality(data.overview, idx);

    const rerender = () => {
      const parts = (window.location.hash || '#/overview').replace(/^#/, '').split('/').filter(Boolean);
      renderPage(parts);
    };

    renderFilterBar(filterBar, idx);
    bindFilterUpdates(filterBar, idx, rerender);
    startRouter(renderPage);
    window.addEventListener('resize', resizeCharts);
  } catch (err) {
    document.getElementById('app').innerHTML = `<div class="empty-state">Failed to load data: ${err.message}</div>`;
    console.error(err);
  } finally {
    document.getElementById('loading-state')?.remove();
  }
}

init();
