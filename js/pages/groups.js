import {
  filterSessions, filterActivities, filterFeedback,
  groupRowMetrics, fmt,
} from '../metrics.js';
import {
  renderTable, paginate, renderKpiGrid, renderChartCard, renderComments,
} from '../components.js';
import { renderBarChart, renderLineChart, COLORS } from '../charts.js';
import { fmtAvg, statusBadge, activityTypeLabel } from '../format.js';
import { navigate } from '../router.js';
import { ratingDistribution, satisfactionTrend } from '../metrics.js';

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

  app.innerHTML = `
    <div class="page-header"><h2>Groups</h2><p>${total} groups · click a row for detail</p></div>
    <div class="table-toolbar">
      <input type="search" id="group-search" placeholder="Search group, course, instructor…" value="${groupsState.search}">
    </div>
    <div class="table-wrap" id="groups-table-wrap"></div>
    <div class="pagination" id="groups-pagination"></div>
  `;

  const columns = [
    { key: 'groupCode', label: 'Group', render: (r) => r.groupCode },
    { key: 'type', label: 'Type', render: (r) => activityTypeLabel(r.type) },
    { key: 'degree', label: 'Degree', render: (r) => fmt(r.degree) },
    { key: 'course', label: 'Course', render: (r) => fmt(r.course) },
    { key: 'instructors', label: 'Instructor(s)', render: (r) => fmt(r.instructors.join(', ')) },
    { key: 'start', label: 'Start', render: (r) => fmt(r.start, 'date') },
    { key: 'end', label: 'End', render: (r) => fmt(r.end, 'date') },
    { key: 'sessions', label: 'Sessions', num: true, render: (r) => fmt(r.sessionMetrics.completedCount, 'int') },
    { key: 'hours', label: 'Hours', num: true, render: (r) => fmt(r.sessionMetrics.completedHours, 'int') },
    { key: 'students', label: 'Students', num: true, render: (r) => r.students != null ? fmt(r.students, 'int') : 'N/A' },
    { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
  ];

  const wrap = app.querySelector('#groups-table-wrap');
  wrap.innerHTML = renderTable({ columns, rows: pageRows, sortKey: groupsState.sortKey, sortDir: groupsState.sortDir });

  wrap.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (groupsState.sortKey === key) groupsState.sortDir = groupsState.sortDir === 'asc' ? 'desc' : 'asc';
      else { groupsState.sortKey = key; groupsState.sortDir = 'asc'; }
      renderGroups(app, { data, idx });
    });
  });

  wrap.querySelectorAll('tbody tr').forEach((tr, i) => {
    tr.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(pageRows[i].groupCode)}`));
  });

  app.querySelector('#group-search')?.addEventListener('input', (e) => {
    groupsState.search = e.target.value;
    groupsState.page = 1;
    renderGroups(app, { data, idx });
  });

  const pag = app.querySelector('#groups-pagination');
  pag.innerHTML = `Page ${page} of ${pages} (${total} groups)
    <button class="btn" id="gp-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button>
    <button class="btn" id="gp-next" ${page >= pages ? 'disabled' : ''}>Next</button>`;
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
    app.innerHTML = `<a class="back-link" href="#/groups">← Back to Groups</a><div class="empty-state">Group not found</div>`;
    return;
  }

  const fbRows = feedback.filter((f) => f.group_match_status === 'MAPPED' && f.group_code_clean === code);
  const unmappedNote = idx.unmappedFeedback.length
    ? `<div class="note-box warning-box">${new Set(idx.unmappedFeedback.map((f) => f.feedback_id)).size} feedback responses could not be mapped to a group and are excluded from group-level metrics.</div>`
    : '';

  const timeline = [...gm.sessions].sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  const comments = renderComments(fbRows);

  app.innerHTML = `
    <a class="back-link" href="#/groups">← Back to Groups</a>
    <div class="detail-header">
      <h2>${code}</h2>
      <p>${activityTypeLabel(gm.type)} · ${fmt(gm.degree)} · ${fmt(gm.course)}</p>
      <p>Instructors: ${fmt(gm.instructors.join(', '))}</p>
      ${statusBadge(gm.status)}
    </div>
    ${unmappedNote}
    ${renderKpiGrid([
      { label: 'Sessions', value: fmt(gm.sessionMetrics.total, 'int') },
      { label: 'Completed', value: fmt(gm.sessionMetrics.completedCount, 'int') },
      { label: 'Planned', value: fmt(gm.sessionMetrics.plannedCount, 'int') },
      { label: 'Hours', value: fmt(gm.sessionMetrics.completedHours, 'hours') },
      { label: 'Students', value: gm.students != null ? fmt(gm.students, 'int') : 'N/A', sub: gm.studentCoverage ? `from ${gm.studentCoverage} activities` : '' },
      { label: 'Instructors', value: fmt(gm.instructors.length, 'int') },
      { label: 'Feedback Responses', value: fmt(gm.feedback.distinctCount, 'int') },
      { label: 'Avg Satisfaction', value: fmtAvg(gm.feedback.avgSatisfaction ? gm.feedback.avgSatisfaction * gm.feedback.satDenom : 0, gm.feedback.satDenom).value, sub: fmtAvg(0, gm.feedback.satDenom).sub },
      { label: 'NPS', value: gm.feedback.nps != null ? fmt(gm.feedback.nps, 'number') : '—' },
    ])}
    <div class="section"><h3>Session Timeline</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>#</th><th>Date</th><th>Duration</th><th>Instructor</th><th>Status</th>
      </tr></thead><tbody>
        ${timeline.map((s) => `<tr><td>${fmt(s.session_number)}</td><td>${fmt(s.session_date, 'date')}</td><td>${fmt(s.duration_hours)}h</td><td>${fmt(s.instructor_name_clean)}</td><td>${statusBadge(s.status_clean)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="chart-grid">
      ${renderChartCard('gd-rating', 'Rating Distribution')}
      ${renderChartCard('gd-sat', 'Satisfaction Trend')}
    </div>
    <div class="section"><h3>Student Comments</h3>${comments.html}</div>
  `;

  const dist = ratingDistribution(fbRows);
  renderBarChart(document.getElementById('gd-rating'), {
    categories: dist.map((d) => String(d.rating)),
    series: [{ name: 'Responses', data: dist.map((d) => d.count), color: COLORS.primary }],
  });
  const sat = satisfactionTrend(fbRows);
  renderLineChart(document.getElementById('gd-sat'), {
    categories: sat.map((s) => s.month),
    series: [{ name: 'Avg', data: sat.map((s) => Number(s.avg.toFixed(2))), color: COLORS.completed }],
  });
}
