import {
  getFilters, setFilter, clearFilters, removeFilter, activeFilterChips, onFilterChange,
} from './filters.js';
import { activityTypeLabel } from './format.js';
import { createSearchableSelect } from './searchable-dropdown.js';
import { createDateRangePicker } from './date-range-picker.js';
import { activityColor } from './charts.js';
import { isSubstantiveComment } from './text-insights.js';

export function renderFilterBar(container, idx) {
  const f = getFilters();
  const groups = idx.groupCodes.map((g) => ({ value: g, label: g }));
  const courses = [...idx.courseMap.values()]
    .sort((a, b) => a.course_name_clean.localeCompare(b.course_name_clean))
    .map((c) => ({ value: c.course_id, label: c.course_name_clean }));
  const instructors = [...idx.instructorMap.values()]
    .sort((a, b) => a.instructor_name_clean.localeCompare(b.instructor_name_clean))
    .map((i) => ({ value: i.instructor_id, label: i.instructor_name_clean }));

  const toolbar = container.querySelector('#filter-toolbar') || container;
  toolbar.innerHTML = '';
  toolbar.className = 'filter-toolbar';

  toolbar.appendChild(createDateRangePicker());

  // Activity type
  const actField = document.createElement('div');
  actField.className = 'filter-field';
  actField.innerHTML = `
    <label for="f-activityType">Activity type</label>
    <select class="filter-input" id="f-activityType">
      <option value="">All types</option>
      ${idx.activityTypes.map((t) => `<option value="${t}" ${f.activityType === t ? 'selected' : ''}>${activityTypeLabel(t)}</option>`).join('')}
    </select>
  `;
  toolbar.appendChild(actField);

  // Searchable dropdowns
  toolbar.appendChild(createSearchableSelect({
    id: 'f-group', label: 'Group', options: groups, value: f.groupCode,
    placeholder: 'All groups', wide: true,
    onChange: (v) => setFilter('groupCode', v),
  }));
  const moreToggle = document.createElement('button');
  moreToggle.type = 'button';
  moreToggle.className = 'filter-more-toggle';
  moreToggle.id = 'toggle-more-filters';
  const activeCount = [f.dateFrom || f.dateTo, f.activityType, f.groupCode, f.instructorId, f.courseId, f.language, f.status].filter(Boolean).length;
  moreToggle.textContent = `Filters${activeCount ? ` (${activeCount})` : ''}`;
  toolbar.appendChild(moreToggle);

  const actions = document.createElement('div');
  actions.className = 'filter-actions';
  actions.innerHTML = `<button type="button" class="btn btn-ghost reset-filters" id="clear-filters" ${activeCount ? '' : 'disabled'}>Reset</button>`;
  toolbar.appendChild(actions);

  const more = document.createElement('div');
  more.className = 'filter-more';
  more.id = 'filter-more';
  more.appendChild(createSearchableSelect({
    id: 'f-instructor', label: 'Instructor', options: instructors, value: f.instructorId,
    placeholder: 'All instructors', wide: true,
    onChange: (v) => setFilter('instructorId', v),
  }));
  more.appendChild(createSearchableSelect({
    id: 'f-course', label: 'Course', options: courses, value: f.courseId,
    placeholder: 'All courses', wide: true,
    onChange: (v) => setFilter('courseId', v),
  }));
  more.insertAdjacentHTML('beforeend', `
    <div class="filter-field">
      <label for="f-language">Language</label>
      <select class="filter-input" id="f-language">
        <option value="">All languages</option>
        ${idx.languages.map((l) => `<option value="${l}" ${f.language === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="filter-field">
      <label for="f-status">Status</label>
      <select class="filter-input" id="f-status">
        <option value="">All statuses</option>
        <option value="COMPLETED" ${f.status === 'COMPLETED' ? 'selected' : ''}>Completed</option>
        <option value="PLANNED" ${f.status === 'PLANNED' ? 'selected' : ''}>Planned</option>
        <option value="UNKNOWN" ${f.status === 'UNKNOWN' ? 'selected' : ''}>Unknown</option>
      </select>
    </div>
  `);
  toolbar.appendChild(more);

  const chipsWrap = container.querySelector('#filter-chips') || document.createElement('div');
  chipsWrap.className = 'filter-chips';
  chipsWrap.id = 'filter-chips';
  if (!chipsWrap.parentElement) {
    container.querySelector('.filter-bar-inner')?.appendChild(chipsWrap);
  }

  // Bind events
  toolbar.querySelector('#f-activityType')?.addEventListener('change', (e) => setFilter('activityType', e.target.value));
  more.querySelector('#f-language')?.addEventListener('change', (e) => setFilter('language', e.target.value));
  more.querySelector('#f-status')?.addEventListener('change', (e) => setFilter('status', e.target.value));
  toolbar.querySelector('#clear-filters')?.addEventListener('click', clearFilters);
  toolbar.querySelector('#toggle-more-filters')?.addEventListener('click', () => {
    more.classList.toggle('open');
    moreToggle.classList.toggle('active', more.classList.contains('open'));
  });

  renderChips(chipsWrap, idx);
}

function renderChips(chipsEl, idx) {
  if (!chipsEl) return;
  const chips = activeFilterChips(idx);
  if (!chips.length) { chipsEl.innerHTML = ''; return; }
  chipsEl.innerHTML = chips.map((c) => {
    const swatch = c.color ? `<span class="chip-swatch" style="background:${c.color}"></span>` : '';
    return `<span class="chip">${swatch}${c.label}<button type="button" data-key="${c.key}" aria-label="Remove filter">✕</button></span>`;
  }).join('');
  chipsEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => removeFilter(btn.dataset.key));
  });
}

export function bindFilterUpdates(container, idx, rerender) {
  return onFilterChange(() => {
    renderFilterBar(container, idx);
    rerender();
  });
}

export function renderEmptyFilters(onClear) {
  return `<div class="empty-state">
    <h3>No results match these filters</h3>
    <p>Try adjusting your filter criteria or clearing all filters to see data.</p>
    <button type="button" class="btn btn-primary" id="empty-clear-filters">Clear all filters</button>
  </div>`;
}

export function bindEmptyClear(app, onClear) {
  app.querySelector('#empty-clear-filters')?.addEventListener('click', onClear);
}

export function renderKpiRow(items, { secondary = false } = {}) {
  if (secondary) {
    return `<div class="pipeline-strip" role="region" aria-label="Pipeline and upcoming">
      <span class="pipeline-label">Pipeline / Upcoming</span>
      <div class="pipeline-items">
        ${items.map((k) => `<div class="pipeline-item"><div class="label">${k.label}</div><div class="value">${k.value}</div></div>`).join('')}
      </div>
    </div>`;
  }
  return `<div class="kpi-row" role="region" aria-label="Key metrics">
    ${items.map((k) => `
      <div class="kpi-card">
        <div class="label">${k.label}</div>
        <div class="value">${k.value}</div>
        ${k.sub ? `<div class="sub">${k.sub}</div>` : ''}
      </div>
    `).join('')}
  </div>`;
}

export function renderKpiGrid(items) {
  return `<div class="kpi-grid">${items.map((k) => `
    <div class="kpi-card">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}</div>
      ${k.sub ? `<div class="sub">${k.sub}</div>` : ''}
    </div>
  `).join('')}</div>`;
}

export function renderAnswerBand({ eyebrow = 'Executive answer', title, summary = '', metrics = [] }) {
  return `<section class="answer-band" aria-label="Page answer">
    <div class="answer-copy">
      <div class="answer-eyebrow">${eyebrow}</div>
      <h2>${title}</h2>
      ${summary ? `<p>${summary}</p>` : ''}
    </div>
    ${metrics.length ? `<div class="answer-metrics">${metrics.map((m) => `<div class="answer-metric"><span>${m.label}</span><strong>${m.value}</strong>${m.sub ? `<small>${m.sub}</small>` : ''}</div>`).join('')}</div>` : ''}
  </section>`;
}

export function renderSectionIntro(kicker, title, note = '') {
  return `<div class="section-intro"><div><span>${kicker}</span><h3>${title}</h3></div>${note ? `<p>${note}</p>` : ''}</div>`;
}

export function renderPipelineStrip(items) {
  return renderKpiRow(items, { secondary: true });
}

export function renderChartCard(id, title, note = '', span = 6) {
  const spanClass = span === 12 ? 'full' : span === 4 ? 'span-4' : span === 8 ? 'span-8' : '';
  return `<div class="chart-card ${spanClass}">
    <h3>${title}</h3>${note ? `<div class="chart-note">${note}</div>` : ''}
    <div class="chart-container" id="${id}"></div>
  </div>`;
}

export function renderCardEmpty(message = 'No data available for the current filters') {
  return `<div class="card-empty">${message}</div>`;
}

export function paginate(rows, page, pageSize) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: p, pages, total };
}

export function renderTable({ columns, rows, sortKey, sortDir, rowClass, onRowClick, id = 'data-table' }) {
  const th = columns.map((c) => `
    <th class="${c.num ? 'num' : ''}" data-key="${c.key}">${c.label}${sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</th>
  `).join('');
  const tr = rows.map((r, i) => `
    <tr class="${rowClass ? rowClass(r) : ''}${onRowClick ? ' clickable' : ''}" data-idx="${i}">
      ${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : r[c.key]}</td>`).join('')}
    </tr>
  `).join('');
  return `<table class="data-table" id="${id}"><thead><tr>${th}</tr></thead><tbody>${tr || `<tr><td colspan="${columns.length}" class="card-empty">No results</td></tr>`}</tbody></table>`;
}

export function renderTableCard({ title, toolbar = '', tableHtml, footer = '' }) {
  return `<div class="table-card">
    ${title ? `<div class="table-toolbar"><h3 style="margin:0;font-size:14px;font-weight:600">${title}</h3>${toolbar}</div>` : toolbar ? `<div class="table-toolbar">${toolbar}</div>` : ''}
    <div class="table-wrap">${tableHtml}</div>
    ${footer ? `<div class="table-footer">${footer}</div>` : ''}
  </div>`;
}

export function renderComments(comments, page = 1, pageSize = 20, { keyword = '', substantiveOnly = true } = {}) {
  const seen = new Set();
  let withText = comments.filter((c) => {
    if (!c.student_comment || !String(c.student_comment).trim() || seen.has(c.feedback_id)) return false;
    seen.add(c.feedback_id);
    return true;
  });
  const totalAll = withText.length;
  const totalSubstantive = withText.filter((c) => isSubstantiveComment(c.student_comment)).length;

  if (substantiveOnly) {
    withText = withText.filter((c) => isSubstantiveComment(c.student_comment));
  }
  if (keyword) {
    const kw = keyword.toLowerCase();
    withText = withText.filter((c) => String(c.student_comment).toLowerCase().includes(kw));
  }
  const { rows, pages, total } = paginate(withText, page, pageSize);
  const toggleLabel = substantiveOnly
    ? `Showing ${totalSubstantive.toLocaleString()} substantive comments · <button type="button" class="btn btn-ghost btn-sm" id="comments-show-all">Show all ${totalAll.toLocaleString()}</button>`
    : `Showing all ${totalAll.toLocaleString()} comments · <button type="button" class="btn btn-ghost btn-sm" id="comments-show-substantive">Show ${totalSubstantive.toLocaleString()} substantive only</button>`;

  return {
    html: `<p class="comments-toggle">${toggleLabel}</p>
    <ul class="comments-list">${rows.map((c) => `
      <li>
        <div class="meta">
          <span>${c.feedback_date || '—'}</span>
          <span>${c.group_code_clean || '—'}</span>
          <span>${c.instructor_name_clean || '—'}</span>
        </div>
        ${escapeHtml(c.student_comment)}
      </li>
    `).join('') || '<li class="card-empty">No comments match</li>'}</ul>`,
    page, pages, total, totalAll, totalSubstantive, substantiveOnly,
  };
}

export function renderWordFrequencyPanel(freq, { activeKeyword = '', onKeyword } = {}) {
  const tags = (items, type) => items.map(({ word, count }) => `
    <button type="button" class="word-tag${activeKeyword === word ? ' active' : ''}" data-word="${escapeHtml(word)}" data-type="${type}">
      ${escapeHtml(word)} <span class="count">${count}</span>
    </button>
  `).join('');

  return `<div class="word-freq-panel">
    <h3>Most frequent words in comments</h3>
    <p class="disclaimer">Word frequency analysis only — not sentiment, not AI, not themes.
      ${freq.totalWithComment.toLocaleString()} distinct responses carry a comment;
      ${freq.afterJunkFilter.toLocaleString()} remain after filtering junk;
      ${freq.arabicPct}% contain Arabic script.</p>
    <p class="section-label" style="margin-top:16px">Top words</p>
    <div class="word-cloud" id="word-unigrams">${tags(freq.unigrams, 'uni') || '<span class="card-empty">No words</span>'}</div>
    <p class="section-label" style="margin-top:16px">Top phrases</p>
    <div class="word-cloud" id="word-bigrams">${tags(freq.bigrams, 'bi') || '<span class="card-empty">No phrases</span>'}</div>
  </div>`;
}

export function bindCommentsToggle(container, onToggle) {
  container?.querySelector('#comments-show-all')?.addEventListener('click', () => onToggle(true));
  container?.querySelector('#comments-show-substantive')?.addEventListener('click', () => onToggle(false));
}

export function bindWordFrequency(panel, callback) {
  panel?.querySelectorAll('.word-tag').forEach((btn) => {
    btn.addEventListener('click', () => {
      const word = btn.dataset.word;
      callback(word === panel.dataset.active ? '' : word);
    });
  });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDataQuality(overview, idx) {
  const unmappedDistinct = new Set(idx.unmappedFeedback.map((f) => f.feedback_id)).size;
  return `
    <span>Data as of ${overview.as_of_date}</span>
    <span>Historical series from ${overview.clean_series_first_month}</span>
    <span>${overview.total_feedback.toLocaleString()} distinct feedback responses</span>
    <span>${unmappedDistinct} unmapped feedback (not attached to groups)</span>
    <span>Student counts: ${overview.student_count_coverage?.activities_with_students}/${overview.student_count_coverage?.total_activities} activities</span>
  `;
}

export { activityColor };
