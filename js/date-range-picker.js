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
  const today = new Date();
  const months = [];
  for (let year = 2024, month = 2; year < today.getFullYear() || (year === today.getFullYear() && month <= today.getMonth()); month += 1) {
    if (month > 11) { year += 1; month = 0; }
    if (year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth())) break;
    const value = `${year}-${String(month + 1).padStart(2, '0')}`;
    months.push({ value, label: `${MONTHS[month]} ${year}` });
  }
  const monthOptions = (selected, emptyLabel) => `<option value="">${emptyLabel}</option>${months.map((m) => `<option value="${m.value}" ${String(selected || '').startsWith(m.value) ? 'selected' : ''}>${m.label}</option>`).join('')}`;

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
              <select class="filter-input" id="f-dateFrom">${monthOptions(f.dateFrom, 'First month')}</select>
            </div>
            <div class="date-range-field">
              <label for="f-dateTo">To</label>
              <select class="filter-input" id="f-dateTo">${monthOptions(f.dateTo, 'Latest month')}</select>
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
    wrapper.querySelector('#f-dateFrom').value = cur.dateFrom ? cur.dateFrom.slice(0, 7) : '';
    wrapper.querySelector('#f-dateTo').value = cur.dateTo ? cur.dateTo.slice(0, 7) : '';
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
    setDateRange(e.target.value ? `${e.target.value}-01` : '', cur.dateTo);
    syncLabel();
  });
  wrapper.querySelector('#f-dateTo')?.addEventListener('change', (e) => {
    const cur = getFilters();
    const [year, month] = e.target.value.split('-').map(Number);
    const lastDay = year && month ? new Date(year, month, 0).getDate() : null;
    setDateRange(cur.dateFrom, lastDay ? `${e.target.value}-${String(lastDay).padStart(2, '0')}` : '');
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
