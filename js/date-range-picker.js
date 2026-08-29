import { getFilters, applyDatePreset, setDateRange } from './filters.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthYear(iso) {
  if (!iso) return '';
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m) return iso;
  return `${MONTHS[m - 1]} ${y}`;
}

export function dateRangeLabel(f) {
  if (f.datePreset === 'all' || (!f.dateFrom && !f.dateTo)) return 'All time';
  if (f.datePreset === 'last6') return 'Last 6 months';
  if (f.datePreset === 'thisyear') return 'This year';
  const from = formatMonthYear(f.dateFrom);
  const to = formatMonthYear(f.dateTo);
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'All time';
}

export function createDateRangePicker() {
  const f = getFilters();
  const wrapper = document.createElement('div');
  wrapper.className = 'filter-field date-range-picker';
  wrapper.innerHTML = `
    <label id="date-range-label">Date range</label>
    <div class="date-range-select">
      <button type="button" class="searchable-select-trigger date-range-trigger" id="date-range-trigger"
              aria-haspopup="dialog" aria-expanded="false" aria-labelledby="date-range-label">
        <span>${dateRangeLabel(f)}</span>
        <span class="chevron">▾</span>
      </button>
      <div class="date-range-popover" id="date-range-popover" role="dialog" aria-label="Date range">
        <div class="date-range-popover-inner">
          <div class="filter-presets date-range-presets">
            <button type="button" class="preset-btn${f.datePreset === 'last6' ? ' active' : ''}" data-preset="last6">Last 6 months</button>
            <button type="button" class="preset-btn${f.datePreset === 'thisyear' ? ' active' : ''}" data-preset="thisyear">This year</button>
            <button type="button" class="preset-btn${f.datePreset === 'all' ? ' active' : ''}" data-preset="all">All time</button>
          </div>
          <div class="date-range-fields">
            <div class="date-range-field">
              <label for="f-dateFrom">From</label>
              <input type="date" class="filter-input" id="f-dateFrom" value="${f.dateFrom}">
            </div>
            <div class="date-range-field">
              <label for="f-dateTo">To</label>
              <input type="date" class="filter-input" id="f-dateTo" value="${f.dateTo}">
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const root = wrapper.querySelector('.date-range-select');
  const trigger = wrapper.querySelector('#date-range-trigger');
  const popover = wrapper.querySelector('#date-range-popover');
  const labelSpan = trigger.querySelector('span');

  const syncLabel = () => {
    labelSpan.textContent = dateRangeLabel(getFilters());
    const cur = getFilters();
    wrapper.querySelector('#f-dateFrom').value = cur.dateFrom;
    wrapper.querySelector('#f-dateTo').value = cur.dateTo;
    wrapper.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === cur.datePreset);
    });
  };

  const open = () => {
    popover.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    popover.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', () => {
    if (popover.classList.contains('open')) close();
    else open();
  });

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    if (e.key === 'Escape') close();
  });

  wrapper.querySelector('#f-dateFrom')?.addEventListener('change', (e) => {
    const cur = getFilters();
    setDateRange(e.target.value, cur.dateTo);
    syncLabel();
  });
  wrapper.querySelector('#f-dateTo')?.addEventListener('change', (e) => {
    const cur = getFilters();
    setDateRange(cur.dateFrom, e.target.value);
    syncLabel();
  });

  wrapper.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyDatePreset(btn.dataset.preset);
      syncLabel();
      close();
    });
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });

  wrapper.syncLabel = syncLabel;
  return wrapper;
}
