import {
  filterSessions, filterActivities, filterFeedback,
  instructorRowMetrics, fmt, fmtAvg, monthlySeries, activityTypeBreakdown,
  satisfactionTrend, ratingDistribution, topCourses,
} from '../metrics.js';
import {
  renderTable, paginate, renderKpiGrid, renderChartCard, renderComments,
  renderTableCard, renderCardEmpty, bindCommentsToggle,
} from '../components.js';
import {
  renderBarChart, renderLineChart, renderDonut, renderHistogram, colorFor,
} from '../charts.js';
import { statusBadge, activityTypeLabel, isPlannedSession } from '../format.js';
import { navigate } from '../router.js';

let instState = { search: '', sortKey: 'name', sortDir: 'asc', page: 1, minFeedback: 10, topN: 10 };
let profileShowAllComments = false;

function workloadDistribution(rows) {
  const hours = rows.map((r) => r.sessionMetrics.completedHours).filter((h) => h > 0);
  if (!hours.length) return [];
  const binSize = 150;
  const max = Math.max(...hours);
  const top = Math.ceil(max / binSize) * binSize;
  const bins = [];
  for (let lower = 0; lower < top; lower += binSize) {
    const upper = lower + binSize;
    const count = hours.filter((h) => h >= lower && (h < upper || upper === top)).length;
    bins.push({ label: `${lower}–${upper}h`, count, lower });
  }
  return bins.sort((a, b) => a.lower - b.lower);
}

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

  const rankable = rows.filter((r) => r.feedback.distinctCount >= instState.minFeedback);
  const topByHours = [...rows].sort((a, b) => b.sessionMetrics.completedHours - a.sessionMetrics.completedHours).slice(0, instState.topN);
  const topByGroups = [...rows].sort((a, b) => b.completedGroups - a.completedGroups).slice(0, instState.topN);
  const topBySessions = [...rows].sort((a, b) => b.sessionMetrics.completedCount - a.sessionMetrics.completedCount).slice(0, instState.topN);
  const topByRating = [...rankable].sort((a, b) => (b.feedback.avgSatisfaction || 0) - (a.feedback.avgSatisfaction || 0)).slice(0, instState.topN);
  const workloadBins = workloadDistribution(rows);

  const { rows: pageRows, pages, page, total } = paginate(rows, instState.page, 20);

  app.innerHTML = `
    <div class="page-header"><h2>Instructors</h2><p>Performance rankings, workload distribution, and roster</p></div>
    <div class="rank-controls">
      <label>Top N <select id="top-n">${[5, 10, 15].map((n) => `<option value="${n}" ${instState.topN === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Min responses for rating <input type="number" id="min-fb" value="${instState.minFeedback}" min="1" max="100" style="width:56px"></label>
    </div>
    <div class="chart-grid">
      ${renderChartCard('rank-hours', 'Top by Teaching Hours', '', 6)}
      ${renderChartCard('rank-groups', 'Top by Completed Groups', '', 6)}
      ${renderChartCard('rank-sessions', 'Top by Sessions', '', 6)}
      ${renderChartCard('rank-rating', `Rating Leaderboard (min ${instState.minFeedback} responses)`, 'Rating shown with n', 6)}
      ${renderChartCard('workload-dist', 'Workload Distribution', 'Instructors by completed hours band', 12)}
    </div>
    ${renderTableCard({
      title: 'Instructor Roster',
      toolbar: `<input type="search" class="search-input" id="inst-search" placeholder="Search instructor…" value="${instState.search}">`,
      tableHtml: renderTable({
        columns: [
          { key: 'name', label: 'Instructor', render: (r) => r.name },
          { key: 'status', label: 'Status', render: (r) => (r.status === 'Active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>') },
          { key: 'groups', label: 'Groups', num: true, render: (r) => fmt(r.groups, 'int') },
          { key: 'completed', label: 'Completed', num: true, render: (r) => fmt(r.completedGroups, 'int') },
          { key: 'sessions', label: 'Sessions', num: true, render: (r) => fmt(r.sessionMetrics.completedCount, 'int') },
          { key: 'hours', label: 'Hours', num: true, render: (r) => fmt(r.sessionMetrics.completedHours, 'int') },
          { key: 'courses', label: 'Courses', num: true, render: (r) => fmt(r.courses, 'int') },
          { key: 'rating', label: 'Avg Rating', num: true, render: (r) => (r.feedback.avgSatisfaction != null ? `${fmt(r.feedback.avgSatisfaction, 'rating')} (n=${fmt(r.feedback.distinctCount, 'int')})` : '—') },
          { key: 'feedback', label: 'Feedback', num: true, render: (r) => fmt(r.feedback.distinctCount, 'int') },
        ],
        rows: pageRows,
        sortKey: instState.sortKey,
        sortDir: instState.sortDir,
      }),
      footer: `<span>${total} instructors</span><div class="pagination">Page ${page} of ${pages}
        <button class="btn btn-sm" id="ip-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button>
        <button class="btn btn-sm" id="ip-next" ${page >= pages ? 'disabled' : ''}>Next</button></div>`,
    })}
  `;

  const renderRank = (id, items, valueFn, labelFn) => {
    const el = document.getElementById(id);
    if (!items.length) { el.innerHTML = renderCardEmpty(); return; }
    renderBarChart(el, {
      categories: items.map((r) => r.name).reverse(),
      series: [{ name: labelFn, data: items.map(valueFn).reverse(), color: colorFor('INTERNAL') }],
      horizontal: true,
    });
  };

  renderRank('rank-hours', topByHours, (r) => Math.round(r.sessionMetrics.completedHours), 'Hours');
  renderRank('rank-groups', topByGroups, (r) => r.completedGroups, 'Groups');
  renderRank('rank-sessions', topBySessions, (r) => r.sessionMetrics.completedCount, 'Sessions');

  const ratingEl = document.getElementById('rank-rating');
  if (topByRating.length) {
    renderBarChart(ratingEl, {
      categories: topByRating.map((r) => `${r.name} (n=${r.feedback.distinctCount})`).reverse(),
      series: [{ name: 'Rating', data: topByRating.map((r) => Number(r.feedback.avgSatisfaction.toFixed(2))).reverse(), color: colorFor('DIPLOMA') }],
      horizontal: true,
    });
  } else {
    ratingEl.innerHTML = renderCardEmpty(`No instructors with ≥${instState.minFeedback} responses`);
  }

  if (workloadBins.length) {
    renderHistogram(document.getElementById('workload-dist'), { bins: workloadBins });
  }

  const wrap = app.querySelector('.table-wrap');
  wrap.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (instState.sortKey === key) instState.sortDir = instState.sortDir === 'asc' ? 'desc' : 'asc';
      else { instState.sortKey = key; instState.sortDir = 'asc'; }
      renderInstructors(app, { data, idx });
    });
  });
  wrap.querySelectorAll('tbody tr').forEach((tr, i) => {
    if (tr.querySelector('.card-empty')) return;
    tr.classList.add('clickable');
    tr.addEventListener('click', () => navigate(`#/instructors/${pageRows[i].instructorId}`));
  });

  app.querySelector('#inst-search')?.addEventListener('input', (e) => { instState.search = e.target.value; instState.page = 1; renderInstructors(app, { data, idx }); });
  app.querySelector('#top-n')?.addEventListener('change', (e) => { instState.topN = Number(e.target.value); renderInstructors(app, { data, idx }); });
  app.querySelector('#min-fb')?.addEventListener('change', (e) => { instState.minFeedback = Number(e.target.value) || 10; renderInstructors(app, { data, idx }); });
  app.querySelector('#ip-prev')?.addEventListener('click', () => { instState.page--; renderInstructors(app, { data, idx }); });
  app.querySelector('#ip-next')?.addEventListener('click', () => { instState.page++; renderInstructors(app, { data, idx }); });
}

export function renderInstructorProfile(app, { data, idx }, instructorId) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const m = instructorRowMetrics(instructorId, idx, sessions, activities, feedback);

  if (!m.instructor) {
    app.innerHTML = `<a class="back-link" href="#/instructors">← Back</a><div class="empty-state"><h3>Instructor not found</h3></div>`;
    return;
  }

  const fbRows = feedback.filter((f) => f.instructor_id === instructorId);
  const upcoming = m.sessions.filter(isPlannedSession).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  const comments = renderComments(fbRows, 1, 20, { substantiveOnly: !profileShowAllComments });
  const monthly = monthlySeries(m.sessions);
  const breakdown = activityTypeBreakdown(m.sessions);
  const courses = topCourses(m.sessions, idx.courseMap, 20);
  const badgeCls = m.instructor.status === 'Active' ? 'badge-active' : 'badge-inactive';
  const satAvg = fmtAvg(m.feedback.avgSatisfaction ? m.feedback.avgSatisfaction * m.feedback.satDenom : 0, m.feedback.satDenom);

  app.innerHTML = `
    <a class="back-link" href="#/instructors">← Back to Instructors</a>
    <div class="detail-header">
      <h2>${m.instructor.instructor_name_clean}</h2>
      <div class="badges"><span class="badge ${badgeCls}">${m.instructor.status}</span></div>
      ${m.instructor.title ? `<p class="meta">${m.instructor.title}</p>` : ''}
    </div>
    ${renderKpiGrid([
      { label: 'Completed Groups', value: fmt(m.completedGroups, 'int'), sub: `${fmt(m.plannedGroups, 'int')} planned` },
      { label: 'Sessions', value: fmt(m.sessionMetrics.completedCount, 'int') },
      { label: 'Teaching Hours', value: fmt(m.sessionMetrics.completedHours, 'hours') },
      { label: 'Courses', value: fmt(m.courses, 'int') },
      { label: 'Students', value: m.students != null ? fmt(m.students, 'int') : 'N/A', sub: m.studentActivities ? `from ${m.studentActivities} activities` : '' },
      { label: 'Avg Satisfaction', value: satAvg.value, sub: satAvg.sub },
      { label: 'Feedback', value: fmt(m.feedback.distinctCount, 'int') },
      { label: 'NPS', value: m.feedback.nps != null ? fmt(m.feedback.nps, 'number') : '—' },
    ])}
    <div class="chart-grid">
      ${renderChartCard('ip-activity', 'Activity Over Time', '', 8)}
      ${renderChartCard('ip-breakdown', 'Group Type Breakdown', '', 4)}
      ${renderChartCard('ip-workload', 'Monthly Teaching Hours', '', 6)}
      ${renderChartCard('ip-rating', 'Rating Distribution', '', 6)}
      ${renderChartCard('ip-sat', 'Feedback Trend', '', 12)}
    </div>
    <div class="two-col">
      <div class="section"><h3>Group History</h3>
        <div class="table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Group</th><th>Course</th><th>Type</th><th>Status</th></tr></thead><tbody>
          ${m.activities.map((a) => `<tr class="clickable" data-g="${a.group_code}"><td>${a.group_code}</td><td>${fmt(a.course_name_clean)}</td><td>${activityTypeLabel(a.activity_type)}</td><td>${statusBadge(a.status_clean)}</td></tr>`).join('')}
        </tbody></table></div></div>
      </div>
      <div class="section"><h3>Courses Taught</h3>
        <div class="table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Course</th><th class="num">Sessions</th><th class="num">Hours</th></tr></thead><tbody>
          ${courses.map((c) => `<tr><td>${c.name}</td><td class="num">${fmt(c.sessions, 'int')}</td><td class="num">${fmt(c.hours, 'int')}</td></tr>`).join('')}
        </tbody></table></div></div>
      </div>
    </div>
    ${upcoming.length ? `<div class="section"><h3>Upcoming Work</h3>
      <div class="table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Group</th><th>Course</th><th class="num">Hours</th></tr></thead><tbody>
        ${upcoming.map((s) => `<tr><td>${fmt(s.session_date, 'date')}</td><td>${s.group_code}</td><td>${fmt(s.course_name_clean)}</td><td class="num">${fmt(s.duration_hours)}h</td></tr>`).join('')}
      </tbody></table></div></div></div>` : ''}
    <div class="section comments-panel"><h3>Student Comments</h3>
      <div class="table-card">${comments.html}</div>
    </div>
  `;

  app.querySelectorAll('[data-g]').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(tr.dataset.g)}`));
  });

  bindCommentsToggle(app, (all) => {
    profileShowAllComments = all;
    renderInstructorProfile(app, { data, idx }, instructorId);
  });

  renderLineChart(document.getElementById('ip-activity'), {
    categories: monthly.map((x) => x.month),
    series: [
      { name: 'Completed', data: monthly.map((x) => x.completed), color: colorFor('EXTERNAL') },
      { name: 'Planned', data: monthly.map((x) => x.planned), color: colorFor('EXTERNAL'), dashed: true },
    ],
  });
  renderDonut(document.getElementById('ip-breakdown'), {
    data: breakdown.map((b) => ({ name: activityTypeLabel(b.type), value: b.sessions, activityType: b.type })),
  });
  renderBarChart(document.getElementById('ip-workload'), {
    categories: monthly.map((x) => x.month),
    series: [{ name: 'Hours', data: monthly.map((x) => Math.round(x.hours)), color: colorFor('INTERNAL') }],
  });
  const dist = ratingDistribution(fbRows);
  renderBarChart(document.getElementById('ip-rating'), {
    categories: dist.map((d) => String(d.rating)),
    series: [{ name: 'Count', data: dist.map((d) => d.count), color: colorFor('DIPLOMA') }],
  });
  const sat = satisfactionTrend(fbRows);
  if (sat.length) {
    renderLineChart(document.getElementById('ip-sat'), {
      categories: sat.map((s) => s.month),
      series: [{ name: 'Avg Satisfaction', data: sat.map((s) => Number(s.avg.toFixed(2))), color: colorFor('DIPLOMA') }],
    });
  }
}
