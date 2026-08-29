import {
  filterSessions, filterActivities, filterFeedback,
  instructorRowMetrics, fmt, fmtAvg, monthlySeries, activityTypeBreakdown,
  satisfactionTrend, ratingDistribution, topCourses,
} from '../metrics.js';
import {
  renderTable, paginate, renderKpiGrid, renderChartCard, renderComments,
} from '../components.js';
import { renderBarChart, renderLineChart, renderDonut, COLORS } from '../charts.js';
import { statusBadge, activityTypeLabel, isPlannedSession } from '../format.js';
import { navigate } from '../router.js';

let instState = { search: '', sortKey: 'name', sortDir: 'asc', page: 1, minFeedback: 10, topN: 5 };

export function renderInstructors(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);

  let rows = data.instructors.map((ins) => {
    const m = instructorRowMetrics(ins.instructor_id, idx, sessions, activities, feedback);
    return { ...m, name: ins.instructor_name_clean, status: ins.status };
  });

  if (instState.search) {
    const q = instState.search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }

  rows.sort((a, b) => {
    const k = instState.sortKey;
    let av; let bv;
    if (k === 'name') { av = a.name; bv = b.name; }
    else if (k === 'groups') { av = a.groups; bv = b.groups; }
    else if (k === 'completed') { av = a.completedGroups; bv = b.completedGroups; }
    else if (k === 'planned') { av = a.plannedGroups; bv = b.plannedGroups; }
    else if (k === 'sessions') { av = a.sessionMetrics.completedCount; bv = b.sessionMetrics.completedCount; }
    else if (k === 'hours') { av = a.sessionMetrics.completedHours; bv = b.sessionMetrics.completedHours; }
    else if (k === 'courses') { av = a.courses; bv = b.courses; }
    else if (k === 'rating') { av = a.feedback.avgSatisfaction || 0; bv = b.feedback.avgSatisfaction || 0; }
    else if (k === 'feedback') { av = a.feedback.distinctCount; bv = b.feedback.distinctCount; }
    else { av = a[k]; bv = b[k]; }
    if (typeof av === 'number') return instState.sortDir === 'asc' ? av - bv : bv - av;
    return instState.sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const totalHours = rows.reduce((s, r) => s + r.sessionMetrics.completedHours, 0);
  const active = rows.filter((r) => r.status === 'Active').length;
  const rated = rows.filter((r) => r.feedback.avgSatisfaction != null);
  const avgRating = rated.length ? rated.reduce((s, r) => s + r.feedback.avgSatisfaction, 0) / rated.length : null;

  const rankable = rows.filter((r) => r.feedback.distinctCount >= instState.minFeedback);
  const topByHours = [...rows].sort((a, b) => b.sessionMetrics.completedHours - a.sessionMetrics.completedHours).slice(0, instState.topN);
  const topByGroups = [...rows].sort((a, b) => b.completedGroups - a.completedGroups).slice(0, instState.topN);
  const topBySessions = [...rows].sort((a, b) => b.sessionMetrics.completedCount - a.sessionMetrics.completedCount).slice(0, instState.topN);
  const topByRating = [...rankable].sort((a, b) => (b.feedback.avgSatisfaction || 0) - (a.feedback.avgSatisfaction || 0)).slice(0, instState.topN);

  const { rows: pageRows, pages, page, total } = paginate(rows, instState.page, 20);

  app.innerHTML = `
    <div class="page-header"><h2>Instructors</h2><p>Delivery performance and feedback</p></div>
    ${renderKpiGrid([
      { label: 'Total Instructors', value: fmt(rows.length, 'int') },
      { label: 'Active', value: fmt(active, 'int') },
      { label: 'Total Hours', value: fmt(totalHours, 'hours') },
      { label: 'Avg Groups/Instructor', value: fmt(rows.length ? rows.reduce((s, r) => s + r.groups, 0) / rows.length : 0, 'number') },
      { label: 'Avg Rating', value: avgRating != null ? fmt(avgRating, 'rating') : '—' },
    ])}
    <div class="section">
      <h3>Top Rankings</h3>
      <div class="rank-controls">
        <label>Top N: <select id="top-n"><option ${instState.topN === 5 ? 'selected' : ''}>5</option><option ${instState.topN === 10 ? 'selected' : ''}>10</option></select></label>
        <label>Min feedback for rating rank: <input type="number" id="min-fb" value="${instState.minFeedback}" min="1" max="100" style="width:60px"></label>
      </div>
      <div class="two-col">
        <div><h4>By Teaching Hours</h4><ul>${topByHours.map((r) => `<li>${r.name}: ${fmt(r.sessionMetrics.completedHours, 'hours')}</li>`).join('')}</ul></div>
        <div><h4>By Completed Groups</h4><ul>${topByGroups.map((r) => `<li>${r.name}: ${fmt(r.completedGroups, 'int')}</li>`).join('')}</ul></div>
        <div><h4>By Sessions</h4><ul>${topBySessions.map((r) => `<li>${r.name}: ${fmt(r.sessionMetrics.completedCount, 'int')}</li>`).join('')}</ul></div>
        <div><h4>By Avg Rating (min ${instState.minFeedback} responses)</h4><ul>${topByRating.map((r) => `<li>${r.name}: ${fmt(r.feedback.avgSatisfaction, 'rating')} (n=${fmt(r.feedback.distinctCount, 'int')})</li>`).join('') || '<li>—</li>'}</ul></div>
      </div>
    </div>
    <div class="table-toolbar"><input type="search" id="inst-search" placeholder="Search instructor…" value="${instState.search}"></div>
    <div class="table-wrap" id="inst-table-wrap"></div>
    <div class="pagination" id="inst-pagination"></div>
  `;

  const columns = [
    { key: 'name', label: 'Instructor', render: (r) => r.name },
    { key: 'groups', label: 'Groups', num: true, render: (r) => fmt(r.groups, 'int') },
    { key: 'completed', label: 'Completed', num: true, render: (r) => fmt(r.completedGroups, 'int') },
    { key: 'planned', label: 'Planned', num: true, render: (r) => fmt(r.plannedGroups, 'int') },
    { key: 'sessions', label: 'Sessions', num: true, render: (r) => fmt(r.sessionMetrics.completedCount, 'int') },
    { key: 'hours', label: 'Hours', num: true, render: (r) => fmt(r.sessionMetrics.completedHours, 'int') },
    { key: 'courses', label: 'Courses', num: true, render: (r) => fmt(r.courses, 'int') },
    { key: 'students', label: 'Students', num: true, render: (r) => r.students != null ? fmt(r.students, 'int') : 'N/A' },
    { key: 'rating', label: 'Avg Rating', num: true, render: (r) => r.feedback.avgSatisfaction != null ? `${fmt(r.feedback.avgSatisfaction, 'rating')} (${fmt(r.feedback.distinctCount, 'int')})` : '—' },
    { key: 'feedback', label: 'Feedback', num: true, render: (r) => fmt(r.feedback.distinctCount, 'int') },
  ];

  const wrap = app.querySelector('#inst-table-wrap');
  wrap.innerHTML = renderTable({ columns, rows: pageRows, sortKey: instState.sortKey, sortDir: instState.sortDir });
  wrap.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (instState.sortKey === key) instState.sortDir = instState.sortDir === 'asc' ? 'desc' : 'asc';
      else { instState.sortKey = key; instState.sortDir = 'asc'; }
      renderInstructors(app, { data, idx });
    });
  });
  wrap.querySelectorAll('tbody tr').forEach((tr, i) => {
    tr.addEventListener('click', () => navigate(`#/instructors/${pageRows[i].instructorId}`));
  });

  app.querySelector('#inst-search')?.addEventListener('input', (e) => { instState.search = e.target.value; instState.page = 1; renderInstructors(app, { data, idx }); });
  app.querySelector('#top-n')?.addEventListener('change', (e) => { instState.topN = Number(e.target.value); renderInstructors(app, { data, idx }); });
  app.querySelector('#min-fb')?.addEventListener('change', (e) => { instState.minFeedback = Number(e.target.value) || 10; renderInstructors(app, { data, idx }); });

  const pag = app.querySelector('#inst-pagination');
  pag.innerHTML = `Page ${page} of ${pages} <button class="btn" id="ip-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn" id="ip-next" ${page >= pages ? 'disabled' : ''}>Next</button>`;
  app.querySelector('#ip-prev')?.addEventListener('click', () => { instState.page--; renderInstructors(app, { data, idx }); });
  app.querySelector('#ip-next')?.addEventListener('click', () => { instState.page++; renderInstructors(app, { data, idx }); });
}

export function renderInstructorProfile(app, { data, idx }, instructorId) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const m = instructorRowMetrics(instructorId, idx, sessions, activities, feedback);

  if (!m.instructor) {
    app.innerHTML = `<a class="back-link" href="#/instructors">← Back</a><div class="empty-state">Instructor not found</div>`;
    return;
  }

  const fbRows = feedback.filter((f) => f.instructor_id === instructorId);
  const upcoming = m.sessions.filter(isPlannedSession).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  const comments = renderComments(fbRows);
  const monthly = monthlySeries(m.sessions);
  const breakdown = activityTypeBreakdown(m.sessions);
  const courses = topCourses(m.sessions, idx.courseMap, 20);

  const badgeCls = m.instructor.status === 'Active' ? 'badge-active' : 'badge-inactive';

  app.innerHTML = `
    <a class="back-link" href="#/instructors">← Back to Instructors</a>
    <div class="detail-header">
      <h2>${m.instructor.instructor_name_clean}</h2>
      <span class="badge ${badgeCls}">${m.instructor.status}</span>
      ${m.instructor.title ? `<p>${m.instructor.title}</p>` : ''}
    </div>
    ${renderKpiGrid([
      { label: 'Total Groups', value: fmt(m.groups, 'int') },
      { label: 'Completed Groups', value: fmt(m.completedGroups, 'int') },
      { label: 'Planned Groups', value: fmt(m.plannedGroups, 'int') },
      { label: 'Sessions', value: fmt(m.sessionMetrics.completedCount, 'int'), sub: `${fmt(m.sessionMetrics.plannedCount, 'int')} planned` },
      { label: 'Hours', value: fmt(m.sessionMetrics.completedHours, 'hours') },
      { label: 'Courses', value: fmt(m.courses, 'int') },
      { label: 'Students', value: m.students != null ? fmt(m.students, 'int') : 'N/A', sub: m.studentActivities ? `from ${m.studentActivities} activities` : '' },
      { label: 'Avg Satisfaction', value: fmtAvg(m.feedback.avgSatisfaction ? m.feedback.avgSatisfaction * m.feedback.satDenom : 0, m.feedback.satDenom).value, sub: fmtAvg(0, m.feedback.satDenom).sub },
      { label: 'Feedback', value: fmt(m.feedback.distinctCount, 'int') },
      { label: 'NPS', value: m.feedback.nps != null ? fmt(m.feedback.nps, 'number') : '—' },
    ])}
    <div class="chart-grid">
      ${renderChartCard('ip-activity', 'Activity Over Time')}
      ${renderChartCard('ip-breakdown', 'By Activity Type')}
      ${renderChartCard('ip-workload', 'Monthly Workload (hours)')}
      ${renderChartCard('ip-rating', 'Rating Distribution')}
      ${renderChartCard('ip-sat', 'Satisfaction Trend')}
    </div>
    <div class="section"><h3>Groups</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Group</th><th>Course</th><th>Type</th><th>Status</th></tr></thead><tbody>
        ${m.activities.map((a) => `<tr class="clickable" data-g="${a.group_code}"><td>${a.group_code}</td><td>${fmt(a.course_name_clean)}</td><td>${activityTypeLabel(a.activity_type)}</td><td>${statusBadge(a.status_clean)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="section"><h3>Courses Delivered</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Course</th><th>Sessions</th><th>Hours</th></tr></thead><tbody>
        ${courses.map((c) => `<tr><td>${c.name}</td><td class="num">${fmt(c.sessions, 'int')}</td><td class="num">${fmt(c.hours, 'int')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    ${upcoming.length ? `<div class="section"><h3>Upcoming Work</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Group</th><th>Course</th><th>Hours</th></tr></thead><tbody>
      ${upcoming.map((s) => `<tr><td>${fmt(s.session_date, 'date')}</td><td>${s.group_code}</td><td>${fmt(s.course_name_clean)}</td><td>${fmt(s.duration_hours)}h</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    <div class="section"><h3>Student Comments</h3>${comments.html}</div>
  `;

  app.querySelectorAll('[data-g]').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(tr.dataset.g)}`));
  });

  renderLineChart(document.getElementById('ip-activity'), {
    categories: monthly.map((x) => x.month),
    series: [
      { name: 'Completed', data: monthly.map((x) => x.completed), color: COLORS.completed },
      { name: 'Planned', data: monthly.map((x) => x.planned), color: COLORS.planned },
    ],
  });
  renderDonut(document.getElementById('ip-breakdown'), {
    data: breakdown.map((b) => ({ name: activityTypeLabel(b.type), value: b.sessions })),
  });
  renderBarChart(document.getElementById('ip-workload'), {
    categories: monthly.map((x) => x.month),
    series: [{ name: 'Hours', data: monthly.map((x) => Math.round(x.hours)), color: COLORS.primary }],
  });
  const dist = ratingDistribution(fbRows);
  renderBarChart(document.getElementById('ip-rating'), {
    categories: dist.map((d) => String(d.rating)),
    series: [{ name: 'Count', data: dist.map((d) => d.count), color: COLORS.secondary }],
  });
  const sat = satisfactionTrend(fbRows);
  renderLineChart(document.getElementById('ip-sat'), {
    categories: sat.map((s) => s.month),
    series: [{ name: 'Avg', data: sat.map((s) => Number(s.avg.toFixed(2))), color: COLORS.completed }],
  });
}
