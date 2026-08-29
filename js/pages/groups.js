import {
  filterSessions, filterActivities, filterFeedback,
  groupRowMetrics, fmt, ratingDistribution, satisfactionTrend,
} from '../metrics.js';
import {
  renderTable, paginate, renderKpiGrid, renderChartCard, renderComments,
  renderTableCard, renderCardEmpty,
} from '../components.js';
import { renderBarChart, renderLineChart, colorFor } from '../charts.js';
import { fmtAvg, statusBadge, activityTypeLabel } from '../format.js';
import { navigate } from '../router.js';
import { clearFilters } from '../filters.js';

let groupsState = { search: '', sortKey: 'groupCode', sortDir: 'asc', page: 1 };

export function renderGroups(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const codes = [...new Set(activities.map((a) => a.group_code).filter(Boolean))];

  let rows = codes.map((code) => groupRowMetrics(code, idx, sessions, activities, feedback));

  if (groupsState.search) {
    const q = groupsState.search.toLowerCase();
    rows = rows.filter((r) =>
      r.groupCode.toLowerCase().includes(q)
      || (r.course || '').toLowerCase().includes(q)
      || r.instructors.some((i) => i.toLowerCase().includes(q)),
    );
  }

  rows.sort((a, b) => {
    const k = groupsState.sortKey;
    let av = a[k]; let bv = b[k];
    if (k === 'sessions') { av = a.sessionMetrics.completedCount; bv = b.sessionMetrics.completedCount; }
    if (k === 'hours') { av = a.sessionMetrics.completedHours; bv = b.sessionMetrics.completedHours; }
    if (av == null) av = '';
    if (bv == null) bv = '';
    if (typeof av === 'number') return groupsState.sortDir === 'asc' ? av - bv : bv - av;
    return groupsState.sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const { rows: pageRows, pages, page, total } = paginate(rows, groupsState.page, 25);

  if (!codes.length && !groupsState.search) {
    app.innerHTML = `
      <div class="page-header"><h2>Groups</h2><p>Delivery groups and cohort detail</p></div>
      <div class="empty-state"><h3>No groups match these filters</h3><p>Adjust filters or clear them to browse all groups.</p>
        <button type="button" class="btn btn-primary" id="empty-clear">Clear all filters</button></div>`;
    app.querySelector('#empty-clear')?.addEventListener('click', clearFilters);
    return;
  }

  const columns = [
    { key: 'groupCode', label: 'Group', render: (r) => `<strong>${r.groupCode}</strong>` },
    { key: 'type', label: 'Type', render: (r) => activityTypeLabel(r.type) },
    { key: 'degree', label: 'Degree', render: (r) => fmt(r.degree) },
    { key: 'course', label: 'Course', render: (r) => fmt(r.course) },
    { key: 'instructors', label: 'Instructor(s)', render: (r) => fmt(r.instructors.join(', ')) },
    { key: 'start', label: 'Start', render: (r) => fmt(r.start, 'date') },
    { key: 'end', label: 'End', render: (r) => fmt(r.end, 'date') },
    { key: 'sessions', label: 'Sessions', num: true, render: (r) => fmt(r.sessionMetrics.completedCount, 'int') },
    { key: 'hours', label: 'Hours', num: true, render: (r) => fmt(r.sessionMetrics.completedHours, 'int') },
    { key: 'students', label: 'Students', num: true, render: (r) => (r.students != null ? fmt(r.students, 'int') : 'N/A') },
    { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
  ];

  app.innerHTML = `
    <div class="page-header"><h2>Groups</h2><p>${total.toLocaleString()} groups · select a row for detail</p></div>
    ${renderTableCard({
      toolbar: `<input type="search" class="search-input" id="group-search" placeholder="Search group, course, instructor…" value="${groupsState.search}">`,
      tableHtml: renderTable({ columns, rows: pageRows, sortKey: groupsState.sortKey, sortDir: groupsState.sortDir }),
      footer: `<span>Showing ${pageRows.length} of ${total.toLocaleString()}</span>
        <div class="pagination">Page ${page} of ${pages}
          <button class="btn btn-sm" id="gp-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button>
          <button class="btn btn-sm" id="gp-next" ${page >= pages ? 'disabled' : ''}>Next</button>
        </div>`,
    })}
  `;

  const wrap = app.querySelector('.table-wrap');
  wrap.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (groupsState.sortKey === key) groupsState.sortDir = groupsState.sortDir === 'asc' ? 'desc' : 'asc';
      else { groupsState.sortKey = key; groupsState.sortDir = 'asc'; }
      renderGroups(app, { data, idx });
    });
  });
  wrap.querySelectorAll('tbody tr.clickable, tbody tr[data-idx]').forEach((tr) => {
    if (tr.querySelector('.card-empty')) return;
    tr.classList.add('clickable');
    tr.addEventListener('click', () => {
      const i = Number(tr.dataset.idx);
      if (!Number.isNaN(i) && pageRows[i]) navigate(`#/groups/${encodeURIComponent(pageRows[i].groupCode)}`);
    });
  });

  app.querySelector('#group-search')?.addEventListener('input', (e) => {
    groupsState.search = e.target.value;
    groupsState.page = 1;
    renderGroups(app, { data, idx });
  });
  app.querySelector('#gp-prev')?.addEventListener('click', () => { groupsState.page--; renderGroups(app, { data, idx }); });
  app.querySelector('#gp-next')?.addEventListener('click', () => { groupsState.page++; renderGroups(app, { data, idx }); });
}

export function renderGroupDetail(app, { data, idx }, groupCode) {
  const code = decodeURIComponent(groupCode);
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const gm = groupRowMetrics(code, idx, sessions, activities, feedback);

  if (!gm.activities.length) {
    app.innerHTML = `<a class="back-link" href="#/groups">← Back to Groups</a><div class="empty-state"><h3>Group not found</h3><p>This group may not exist or may be excluded by active filters.</p></div>`;
    return;
  }

  const fbRows = feedback.filter((f) => f.group_match_status === 'MAPPED' && f.group_code_clean === code);
  const unmappedNote = idx.unmappedFeedback.length
    ? `<div class="note-box warning-box">${new Set(idx.unmappedFeedback.map((f) => f.feedback_id)).size} feedback responses could not be confidently mapped to a group and are excluded from group-level metrics.</div>`
    : '';

  const timeline = [...gm.sessions].sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  const comments = renderComments(fbRows);
  const satAvg = fmtAvg(
    gm.feedback.avgSatisfaction ? gm.feedback.avgSatisfaction * gm.feedback.satDenom : 0,
    gm.feedback.satDenom,
  );

  app.innerHTML = `
    <a class="back-link" href="#/groups">← Back to Groups</a>
    <div class="detail-header">
      <h2>${code}</h2>
      <p class="meta">${activityTypeLabel(gm.type)} · ${fmt(gm.degree)} · ${fmt(gm.course)}</p>
      <p class="meta">Instructors: ${fmt(gm.instructors.join(', '))}</p>
      <div class="badges">${statusBadge(gm.status)}</div>
    </div>
    ${unmappedNote}
    ${renderKpiGrid([
      { label: 'Completed Sessions', value: fmt(gm.sessionMetrics.completedCount, 'int') },
      { label: 'Planned Sessions', value: fmt(gm.sessionMetrics.plannedCount, 'int') },
      { label: 'Teaching Hours', value: fmt(gm.sessionMetrics.completedHours, 'hours') },
      { label: 'Students', value: gm.students != null ? fmt(gm.students, 'int') : 'N/A', sub: gm.studentCoverage ? `from ${gm.studentCoverage} activities` : '' },
      { label: 'Feedback Responses', value: fmt(gm.feedback.distinctCount, 'int') },
      { label: 'Avg Satisfaction', value: satAvg.value, sub: satAvg.sub },
      { label: 'NPS', value: gm.feedback.nps != null ? fmt(gm.feedback.nps, 'number') : '—' },
    ])}
    <div class="section">
      <h3>Session Timeline</h3>
      <div class="table-card">
        <div class="table-wrap"><table class="data-table"><thead><tr>
          <th>#</th><th>Date</th><th>Duration</th><th>Instructor</th><th>Status</th>
        </tr></thead><tbody>
          ${timeline.map((s) => `<tr><td class="num">${fmt(s.session_number)}</td><td>${fmt(s.session_date, 'date')}</td><td class="num">${fmt(s.duration_hours)}h</td><td>${fmt(s.instructor_name_clean)}</td><td>${statusBadge(s.status_clean)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>
    <div class="chart-grid">
      ${renderChartCard('gd-rating', 'Rating Distribution', '', 6)}
      ${renderChartCard('gd-sat', 'Satisfaction Trend', '', 6)}
    </div>
    <div class="section comments-panel">
      <h3>Student Comments</h3>
      <div class="table-card">${comments.html}</div>
    </div>
  `;

  const dist = ratingDistribution(fbRows);
  if (dist.length) {
    renderBarChart(document.getElementById('gd-rating'), {
      categories: dist.map((d) => String(d.rating)),
      series: [{ name: 'Responses', data: dist.map((d) => d.count), color: colorFor('EXTERNAL') }],
    });
  } else {
    document.getElementById('gd-rating').innerHTML = renderCardEmpty('No ratings for this group');
  }
  const sat = satisfactionTrend(fbRows);
  if (sat.length) {
    renderLineChart(document.getElementById('gd-sat'), {
      categories: sat.map((s) => s.month),
      series: [{ name: 'Avg', data: sat.map((s) => Number(s.avg.toFixed(2))), color: colorFor('DIPLOMA') }],
    });
  } else {
    document.getElementById('gd-sat').innerHTML = renderCardEmpty();
  }
}
