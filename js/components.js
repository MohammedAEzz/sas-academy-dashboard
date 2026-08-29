import {
  getFilters, setFilter, clearFilters, removeFilter, activeFilterChips, onFilterChange,
} from './filters.js';
import { activityTypeLabel } from './format.js';

export function renderFilterBar(container, idx) {
  const f = getFilters();
  const groups = idx.groupCodes;
  const courses = [...idx.courseMap.values()].sort((a, b) => a.course_name_clean.localeCompare(b.course_name_clean));
  const instructors = [...idx.instructorMap.values()].sort((a, b) => a.instructor_name_clean.localeCompare(b.instructor_name_clean));

  container.innerHTML = `
    <div class="filter-row">
      <div class="filter-group"><label>Date from</label><input type="date" id="f-dateFrom" value="${f.dateFrom}"></div>
      <div class="filter-group"><label>Date to</label><input type="date" id="f-dateTo" value="${f.dateTo}"></div>
      <div class="filter-group"><label>Activity type</label>
        <select id="f-activityType">
          <option value="">All</option>
          ${idx.activityTypes.map((t) => `<option value="${t}" ${f.activityType === t ? 'selected' : ''}>${activityTypeLabel(t)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group"><label>Group</label>
        <select id="f-groupCode"><option value="">All</option>
          ${groups.map((g) => `<option value="${g}" ${f.groupCode === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-link" id="toggle-more-filters">More filters ▾</button>
      <div class="filter-actions">
        <button class="btn" id="clear-filters">Clear filters</button>
      </div>
    </div>
    <div class="filter-more" id="filter-more">
      <div class="filter-group"><label>Course</label>
        <select id="f-courseId"><option value="">All</option>
          ${courses.map((c) => `<option value="${c.course_id}" ${f.courseId === c.course_id ? 'selected' : ''}>${c.course_name_clean}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group"><label>Instructor</label>
        <select id="f-instructorId"><option value="">All</option>
          ${instructors.map((i) => `<option value="${i.instructor_id}" ${f.instructorId === i.instructor_id ? 'selected' : ''}>${i.instructor_name_clean}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group"><label>Language</label>
        <select id="f-language"><option value="">All</option>
          ${idx.languages.map((l) => `<option value="${l}" ${f.language === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group"><label>Status</label>
        <select id="f-status">
          <option value="">All</option>
          <option value="COMPLETED" ${f.status === 'COMPLETED' ? 'selected' : ''}>Completed</option>
          <option value="PLANNED" ${f.status === 'PLANNED' ? 'selected' : ''}>Planned</option>
          <option value="UNKNOWN" ${f.status === 'UNKNOWN' ? 'selected' : ''}>Unknown</option>
        </select>
      </div>
    </div>
    <div class="filter-chips" id="filter-chips"></div>
  `;

  const bind = (id, key) => {
    const el = container.querySelector(id);
    el?.addEventListener('change', () => setFilter(key, el.value));
  };
  bind('#f-dateFrom', 'dateFrom');
  bind('#f-dateTo', 'dateTo');
  bind('#f-activityType', 'activityType');
  bind('#f-groupCode', 'groupCode');
  bind('#f-courseId', 'courseId');
  bind('#f-instructorId', 'instructorId');
  bind('#f-language', 'language');
  bind('#f-status', 'status');

  container.querySelector('#clear-filters')?.addEventListener('click', clearFilters);
  container.querySelector('#toggle-more-filters')?.addEventListener('click', () => {
    container.querySelector('#filter-more')?.classList.toggle('open');
  });

  renderChips(container, idx);
}

function renderChips(container, idx) {
  const chipsEl = container.querySelector('#filter-chips');
  if (!chipsEl) return;
  const chips = activeFilterChips(idx);
  chipsEl.innerHTML = chips.map((c) => `
    <span class="chip">${c.label}<button type="button" data-key="${c.key}" aria-label="Remove filter">×</button></span>
  `).join('');
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

export function renderKpiGrid(items) {
  return `<div class="kpi-grid">${items.map((k) => `
    <div class="kpi-card">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}</div>
      ${k.sub ? `<div class="sub">${k.sub}</div>` : ''}
    </div>
  `).join('')}</div>`;
}

export function renderPipelineStrip(items) {
  return `<div class="pipeline-strip"><h3>Pipeline / Upcoming</h3><div class="pipeline-grid">
    ${items.map((k) => `<div class="pipeline-item"><div class="label">${k.label}</div><div class="value">${k.value}</div></div>`).join('')}
  </div></div>`;
}

export function renderChartCard(id, title, note = '', full = false) {
  return `<div class="chart-card${full ? ' full' : ''}">
    <h3>${title}</h3>${note ? `<div class="chart-note">${note}</div>` : ''}
    <div class="chart-container" id="${id}"></div>
  </div>`;
}

export function paginate(rows, page, pageSize) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: p, pages, total };
}

export function renderTable({ columns, rows, sortKey, sortDir, onSort, rowClass, onRowClick, id = 'data-table' }) {
  const th = columns.map((c) => `
    <th class="${c.num ? 'num' : ''}" data-key="${c.key}">${c.label}${sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
  `).join('');
  const tr = rows.map((r, i) => `
    <tr class="${rowClass ? rowClass(r) : ''}${onRowClick ? ' clickable' : ''}" data-idx="${i}">
      ${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : r[c.key]}</td>`).join('')}
    </tr>
  `).join('');
  return `<table class="data-table" id="${id}"><thead><tr>${th}</tr></thead><tbody>${tr || '<tr><td colspan="' + columns.length + '">No results</td></tr>'}</tbody></table>`;
}

export function renderComments(comments, page = 1, pageSize = 20) {
  const withText = comments.filter((c) => c.student_comment && String(c.student_comment).trim());
  const { rows, pages, total } = paginate(withText, page, pageSize);
  return {
    html: `<ul class="comments-list">${rows.map((c) => `
      <li><div class="meta">${c.feedback_date || ''} · ${c.group_code_clean || ''} · ${c.instructor_name_clean || ''}</div>${escapeHtml(c.student_comment)}</li>
    `).join('') || '<li>No comments</li>'}</ul>`,
    page, pages, total,
  };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDataQuality(overview, idx) {
  const unmapped = idx.unmappedFeedback.length;
  const unmappedDistinct = new Set(idx.unmappedFeedback.map((f) => f.feedback_id)).size;
  return `
    <span>Data as of ${overview.as_of_date}</span>
    <span>Historical series from ${overview.clean_series_first_month}</span>
    <span>${overview.total_feedback.toLocaleString()} distinct feedback responses</span>
    <span>${unmappedDistinct} unmapped feedback (not attached to groups)</span>
    <span>Student counts: ${overview.student_count_coverage?.activities_with_students}/${overview.student_count_coverage?.total_activities} activities</span>
  `;
}
