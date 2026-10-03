import {
  filterSessions, filterActivities, filterFeedback,
  instructorRowMetrics, fmt, monthlySeries, activityTypeBreakdown,
  satisfactionTrend, topCourses, sessionMetrics,
} from '../metrics.js';
import {
  renderTable, paginate, renderComments, renderTableCard, renderCardEmpty,
  renderAnswerBand, renderSectionIntro, bindCommentsToggle,
} from '../components.js';
import { renderBarChart, renderLineChart, colorFor, activityColor } from '../charts.js';
import { statusBadge, activityTypeLabel, isPlannedSession } from '../format.js';
import { escapeHtml } from '../core/escape.js';
import { navigate } from '../router.js';

let instState = { search: '', sortKey: 'hours', sortDir: 'desc', page: 1, minFeedback: 10, topN: 5 };
let profileShowAllComments = false;

function buildRows(data, idx, sessions, activities, feedback) {
  return data.instructors.map((instructor) => {
    const metrics = instructorRowMetrics(instructor.instructor_id, idx, sessions, activities, feedback);
    return { ...metrics, name: instructor.instructor_name_clean, status: instructor.status };
  });
}

function rowSortValue(row, key) {
  const values = {
    name: row.name,
    status: row.status,
    groups: row.groups,
    completed: row.completedGroups,
    planned: row.plannedGroups,
    sessions: row.sessionMetrics.completedCount,
    hours: row.sessionMetrics.completedHours,
    courses: row.courses,
    rating: row.feedback.avgSatisfaction ?? -1,
    feedback: row.feedback.distinctCount,
  };
  return values[key] ?? row[key];
}

function sortRows(rows, key, direction) {
  return rows.sort((a, b) => {
    const av = rowSortValue(a, key); const bv = rowSortValue(b, key);
    const multiplier = direction === 'asc' ? 1 : -1;
    return typeof av === 'number' ? (av - bv) * multiplier : String(av).localeCompare(String(bv)) * multiplier;
  });
}

export function renderInstructors(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  let rows = buildRows(data, idx, sessions, activities, feedback);
  if (instState.search) rows = rows.filter((row) => row.name.toLowerCase().includes(instState.search.toLowerCase()));
  sortRows(rows, instState.sortKey, instState.sortDir);

  const byHours = [...rows].sort((a, b) => b.sessionMetrics.completedHours - a.sessionMetrics.completedHours);
  const rankable = rows.filter((row) => row.feedback.distinctCount >= instState.minFeedback);
  const byRating = [...rankable].sort((a, b) => (b.feedback.avgSatisfaction ?? 0) - (a.feedback.avgSatisfaction ?? 0)).slice(0, instState.topN);
  const byBreadth = [...rows].sort((a, b) => b.courses - a.courses || b.sessionMetrics.completedHours - a.sessionMetrics.completedHours).slice(0, instState.topN);
  const byUpcoming = [...rows].filter((row) => row.sessionMetrics.plannedCount > 0).sort((a, b) => b.sessionMetrics.plannedHours - a.sessionMetrics.plannedHours).slice(0, instState.topN);
  const totalHours = sessionMetrics(sessions).completedHours;
  const topFiveShare = totalHours ? (byHours.slice(0, 5).reduce((sum, row) => sum + row.sessionMetrics.completedHours, 0) / totalHours * 100).toFixed(1) : '0.0';
  const activeCount = rows.filter((row) => row.status === 'Active').length;
  const { rows: pageRows, pages, page, total } = paginate(rows, instState.page, 20);

  app.innerHTML = `
    ${renderAnswerBand({
      eyebrow: 'Instructor contribution',
      title: `${escapeHtml(byHours[0]?.name || 'No instructor')} leads delivery with ${fmt(byHours[0]?.sessionMetrics.completedHours, 'hours')}`,
      summary: `${fmt(activeCount, 'int')} of ${fmt(rows.length, 'int')} instructors are active on the roster. The top five account for ${topFiveShare}% of completed teaching hours, a workload concentration signal rather than observed capacity.`,
      metrics: [
        { label: 'Instructors', value: fmt(rows.length, 'int') },
        { label: 'Active roster', value: fmt(activeCount, 'int') },
        { label: 'Top-five share', value: `${topFiveShare}%` },
        { label: 'Rating threshold', value: `n≥${instState.minFeedback}`, sub: 'Applied to every rating rank' },
      ],
    })}

    ${renderSectionIntro('1 · Supporting evidence', 'Who carries delivery?', 'Rankings remain charts; use the same Top 5/10 control across the page.')}
    <div class="rank-controls">
      <div class="segmented-control" id="instructor-topn">${[5, 10].map((n) => `<button class="segment-btn${instState.topN === n ? ' active' : ''}" data-top="${n}">Top ${n}</button>`).join('')}</div>
      <label>Minimum responses for rating <input type="number" id="min-fb" value="${instState.minFeedback}" min="1" max="100"></label>
    </div>
    <div class="story-grid">
      <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Completed teaching hours</h3><p>Volume leaders under the current filters</p></div></div><div class="chart-container tall" id="rank-hours"></div></section>
      <aside class="insight-panel story-support"><div class="panel-kicker">Workload signal</div><h3>${topFiveShare}% of hours sit with five instructors</h3><p>High contribution does not prove overload because contracted hours and availability are absent.</p><ul class="insight-list">${byHours.slice(0, 5).map((row) => `<li><span>${escapeHtml(row.name)}</span><strong>${fmt(row.sessionMetrics.completedHours, 'hours')}</strong></li>`).join('')}</ul></aside>
    </div>

    ${renderSectionIntro('2 · Range and quality', 'Breadth, learner rating, and forward work', 'Ratings always carry n; planned work never enters achievement.')}
    <div class="story-grid">
      <section class="evidence-panel story-half"><div class="panel-header"><div><h3>Widest course range</h3><p>Distinct courses with completed delivery</p></div></div><div class="chart-container" id="rank-breadth"></div></section>
      <section class="evidence-panel story-half"><div class="panel-header"><div><h3>Highest learner rating</h3><p>Minimum ${instState.minFeedback} distinct responses; label shows n</p></div></div><div class="chart-container" id="rank-rating"></div></section>
      <section class="evidence-panel story-half"><div class="panel-header"><div><h3>Upcoming workload</h3><p>Planned teaching hours only</p></div></div><div class="chart-container" id="rank-upcoming"></div></section>
      <aside class="insight-panel story-half"><div class="panel-kicker">Interpretation</div><h3>Volume, breadth, and rating answer different questions</h3><p>They are deliberately separated. A scatter was not shipped because uneven response counts would make visual proximity look more comparable than the evidence supports.</p><ul class="insight-list"><li><span>Rating-eligible instructors</span><strong>${fmt(rankable.length, 'int')}</strong></li><li><span>With planned work</span><strong>${fmt(rows.filter((row) => row.sessionMetrics.plannedCount > 0).length, 'int')}</strong></li></ul></aside>
    </div>

    ${renderSectionIntro('3 · Detail', 'Instructor roster', 'Sort a metric or open a person profile for delivery, expertise, and experience.')}
    ${renderTableCard({
      title: 'Instructor roster',
      toolbar: `<input type="search" class="search-input" id="inst-search" placeholder="Search instructor…" value="${escapeHtml(instState.search)}">`,
      tableHtml: renderTable({
        columns: [
          { key: 'name', label: 'Instructor', render: (row) => `<strong>${escapeHtml(row.name)}</strong>` },
          { key: 'status', label: 'Status', render: (row) => `<span class="badge ${row.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${row.status}</span>` },
          { key: 'completed', label: 'Groups', num: true, render: (row) => fmt(row.completedGroups, 'int') },
          { key: 'hours', label: 'Hours', num: true, render: (row) => fmt(row.sessionMetrics.completedHours, 'int') },
          { key: 'courses', label: 'Courses', num: true, render: (row) => fmt(row.courses, 'int') },
          { key: 'rating', label: 'Rating', num: true, render: (row) => row.feedback.avgSatisfaction != null ? `${fmt(row.feedback.avgSatisfaction, 'rating')} <span class="table-sub">n=${fmt(row.feedback.distinctCount, 'int')}</span>` : '—' },
          { key: 'planned', label: 'Upcoming', num: true, render: (row) => fmt(row.sessionMetrics.plannedCount, 'int') },
        ],
        rows: pageRows, sortKey: instState.sortKey, sortDir: instState.sortDir, id: 'instructors-table',
      }).replace('class="data-table"', 'class="data-table table-mobile-compact"'),
      footer: `<span>${fmt(total, 'int')} instructors</span><div class="pagination">Page ${page} of ${pages}<button class="btn btn-sm" id="ip-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn btn-sm" id="ip-next" ${page >= pages ? 'disabled' : ''}>Next</button></div>`,
    })}
  `;

  const renderRanking = (id, items, value, label, color) => {
    const target = document.getElementById(id);
    if (!items.length) { target.innerHTML = renderCardEmpty(); return; }
    renderBarChart(target, { categories: items.map((row) => row.name).reverse(), series: [{ name: label, data: items.map(value).reverse(), color }], horizontal: true });
  };
  renderRanking('rank-hours', byHours.slice(0, instState.topN), (row) => Math.round(row.sessionMetrics.completedHours), 'Hours', colorFor('EXTERNAL'));
  renderRanking('rank-breadth', byBreadth, (row) => row.courses, 'Courses', colorFor('INTERNAL'));
  const ratingTarget = document.getElementById('rank-rating');
  if (byRating.length) renderBarChart(ratingTarget, { categories: byRating.map((row) => `${row.name} (n=${row.feedback.distinctCount})`).reverse(), series: [{ name: 'Rating', data: byRating.map((row) => Number(row.feedback.avgSatisfaction.toFixed(2))).reverse(), color: colorFor('DIPLOMA') }], horizontal: true });
  else ratingTarget.innerHTML = renderCardEmpty(`No instructors meet n≥${instState.minFeedback}`);
  renderRanking('rank-upcoming', byUpcoming, (row) => Math.round(row.sessionMetrics.plannedHours), 'Planned hours', colorFor('EXTERNAL'));

  app.querySelectorAll('#instructor-topn [data-top]').forEach((button) => button.addEventListener('click', () => { instState.topN = Number(button.dataset.top); renderInstructors(app, { data, idx }); }));
  app.querySelector('#min-fb')?.addEventListener('change', (event) => { instState.minFeedback = Number(event.target.value) || 10; renderInstructors(app, { data, idx }); });
  app.querySelector('#inst-search')?.addEventListener('input', (event) => { instState.search = event.target.value; instState.page = 1; renderInstructors(app, { data, idx }); });
  app.querySelector('#ip-prev')?.addEventListener('click', () => { instState.page -= 1; renderInstructors(app, { data, idx }); });
  app.querySelector('#ip-next')?.addEventListener('click', () => { instState.page += 1; renderInstructors(app, { data, idx }); });
  const table = app.querySelector('#instructors-table');
  table?.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => { const key = th.dataset.key; if (instState.sortKey === key) instState.sortDir = instState.sortDir === 'asc' ? 'desc' : 'asc'; else { instState.sortKey = key; instState.sortDir = 'asc'; } renderInstructors(app, { data, idx }); }));
  table?.querySelectorAll('tbody tr').forEach((tr, index) => { if (pageRows[index]) { tr.classList.add('clickable'); tr.addEventListener('click', () => navigate(`#/instructors/${pageRows[index].instructorId}`)); } });
}

export function renderInstructorProfile(app, { data, idx }, instructorId) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const metrics = instructorRowMetrics(instructorId, idx, sessions, activities, feedback);
  if (!metrics.instructor) { app.innerHTML = `<a class="back-link" href="#/instructors">← Back</a><div class="empty-state"><h3>Instructor not found</h3></div>`; return; }

  const fbRows = feedback.filter((row) => row.instructor_id === instructorId);
  const upcoming = metrics.sessions.filter(isPlannedSession).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  const monthly = monthlySeries(metrics.sessions);
  const breakdown = activityTypeBreakdown(metrics.sessions);
  const mixTotal = breakdown.reduce((sum, item) => sum + item.sessions, 0);
  const courses = topCourses(metrics.sessions, idx.courseMap, 12);
  const sat = satisfactionTrend(fbRows);
  const comments = renderComments(fbRows, 1, 8, { substantiveOnly: !profileShowAllComments });
  const unknownGroups = new Set(metrics.activities.filter((activity) => activity.status_clean === 'UNKNOWN').map((activity) => activity.group_code)).size;
  const badgeClass = metrics.instructor.status === 'Active' ? 'badge-active' : 'badge-inactive';

  app.innerHTML = `
    <a class="back-link" href="#/instructors">← Back to Instructors</a>
    <header class="profile-header">
      <div><div class="answer-eyebrow" style="color:var(--cat-1)">Instructor profile</div><h2>${escapeHtml(metrics.instructor.instructor_name_clean)}</h2><p>Contributed ${fmt(metrics.sessionMetrics.completedHours, 'hours')} across ${fmt(metrics.completedGroups, 'int')} completed groups and ${fmt(metrics.courses, 'int')} courses.</p><div class="badges" style="margin-top:12px"><span class="badge ${badgeClass}">${escapeHtml(metrics.instructor.status)}</span></div></div>
      <div class="profile-header-aside"><strong>${metrics.feedback.avgSatisfaction != null ? fmt(metrics.feedback.avgSatisfaction, 'rating') : '—'}</strong><span>learner rating · n=${fmt(metrics.feedback.distinctCount, 'int')}</span></div>
    </header>
    <div class="metric-strip">
      <div class="metric-strip-item"><span>Completed groups</span><strong>${fmt(metrics.completedGroups, 'int')}</strong><small>${fmt(metrics.plannedGroups, 'int')} planned</small></div>
      <div class="metric-strip-item"><span>Sessions</span><strong>${fmt(metrics.sessionMetrics.completedCount, 'int')}</strong><small>${fmt(metrics.sessionMetrics.completedHours, 'hours')}</small></div>
      <div class="metric-strip-item"><span>Course coverage</span><strong>${fmt(metrics.courses, 'int')}</strong><small>Distinct completed courses</small></div>
      <div class="metric-strip-item"><span>Students</span><strong>${metrics.students != null ? fmt(metrics.students, 'int') : 'N/A'}</strong><small>Student data covers 17% overall</small></div>
    </div>

    <section class="profile-section">
      <div class="profile-section-label">DELIVERY</div>
      <div class="story-grid">
        <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Activity timeline</h3><p>Completed sessions and planned assignments</p></div></div><div class="chart-container" id="profile-activity"></div></section>
        <aside class="insight-panel story-support"><div class="panel-kicker">Contribution</div><h3>${fmt(metrics.sessionMetrics.completedHours, 'hours')} delivered</h3><p>${fmt(metrics.completedGroups, 'int')} completed groups, ${fmt(metrics.plannedGroups, 'int')} planned, and ${fmt(unknownGroups, 'int')} with unknown status.</p><ul class="insight-list"><li><span>Completed sessions</span><strong>${fmt(metrics.sessionMetrics.completedCount, 'int')}</strong></li><li><span>Planned sessions</span><strong>${fmt(metrics.sessionMetrics.plannedCount, 'int')}</strong></li></ul></aside>
        <section class="evidence-panel story-half"><div class="panel-header"><div><h3>Monthly teaching hours</h3><p>Completed hours only</p></div></div><div class="chart-container" id="profile-hours"></div></section>
        <section class="detail-panel story-half upcoming-panel"><div class="panel-header" style="padding:20px 20px 0"><div><h3>Upcoming assignments</h3><p>Visually separated from historical contribution</p></div></div><div class="table-wrap"><table class="data-table table-mobile-compact"><thead><tr><th>Date</th><th>Group</th><th>Course</th><th class="num">Hours</th></tr></thead><tbody>${upcoming.slice(0, 10).map((session) => `<tr><td>${fmt(session.session_date, 'date')}</td><td>${fmt(session.group_code)}</td><td>${fmt(session.course_name_clean)}</td><td class="num">${fmt(session.duration_hours, 'number')}</td></tr>`).join('') || '<tr><td colspan="4" class="card-empty">No upcoming assignments</td></tr>'}</tbody></table></div></section>
      </div>
      <details class="detail-panel method-details"><summary style="padding:16px">Open group history (${fmt(metrics.activities.length, 'int')} activity records)</summary><div class="table-wrap"><table class="data-table table-mobile-compact"><thead><tr><th>Group</th><th>Course</th><th>Type</th><th>Status</th></tr></thead><tbody>${metrics.activities.map((activity) => `<tr class="clickable" data-group="${escapeHtml(activity.group_code)}"><td>${escapeHtml(activity.group_code)}</td><td>${fmt(activity.course_name_clean)}</td><td>${activityTypeLabel(activity.activity_type)}</td><td>${statusBadge(activity.status_clean)}</td></tr>`).join('')}</tbody></table></div></details>
    </section>

    <section class="profile-section">
      <div class="profile-section-label">EXPERTISE</div>
      <div class="story-grid">
        <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Courses taught</h3><p>Completed teaching hours by course · long axis labels shorten; hover for the full name</p></div></div><div class="chart-container" id="profile-courses"></div></section>
        <aside class="insight-panel story-support"><div class="panel-kicker">Program mix</div><h3>${fmt(courses.length, 'int')} courses in the completed record</h3><p>Internal and external delivery retain their fixed entity colours.</p><div class="mix-list">${breakdown.map((item) => { const pct = mixTotal ? Math.round(item.sessions / mixTotal * 100) : 0; return `<div class="mix-row"><span>${activityTypeLabel(item.type)}</span><div class="track"><div class="fill" style="width:${pct}%;background:${activityColor(item.type)}"></div></div><strong>${pct}%</strong></div>`; }).join('') || '<div class="card-empty">No completed mix</div>'}</div></aside>
      </div>
    </section>

    <section class="profile-section">
      <div class="profile-section-label">EXPERIENCE</div>
      <div class="story-grid">
        <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Rating trend</h3><p>Monthly satisfaction from distinct responses</p></div></div><div class="chart-container" id="profile-satisfaction"></div></section>
        <aside class="insight-panel story-support"><div class="panel-kicker">Learner evidence</div><h3>${metrics.feedback.avgSatisfaction != null ? fmt(metrics.feedback.avgSatisfaction, 'rating') : '—'} average rating</h3><p>Always read with the ${fmt(metrics.feedback.distinctCount, 'int')}-response sample. NPS is ${metrics.feedback.nps != null ? fmt(metrics.feedback.nps, 'number') : '—'}.</p><ul class="insight-list"><li><span>Feedback responses</span><strong>${fmt(metrics.feedback.distinctCount, 'int')}</strong></li><li><span>NPS sample</span><strong>${fmt(metrics.feedback.npsDenom, 'int')}</strong></li></ul></aside>
      </div>
      <div class="detail-panel comments-panel"><div class="panel-header" style="padding:20px 20px 0"><div><h3>Student comments</h3><p>Substantive comments first</p></div></div>${comments.html}</div>
    </section>
  `;

  app.querySelectorAll('[data-group]').forEach((row) => row.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(row.dataset.group)}`)));
  bindCommentsToggle(app, (showAll) => { profileShowAllComments = showAll; renderInstructorProfile(app, { data, idx }, instructorId); });
  if (monthly.length) {
    renderLineChart(document.getElementById('profile-activity'), { categories: monthly.map((item) => item.month), series: [{ name: 'Completed', data: monthly.map((item) => item.completed), color: colorFor('EXTERNAL') }, { name: 'Planned', data: monthly.map((item) => item.planned), color: colorFor('EXTERNAL'), dashed: true }] });
    renderBarChart(document.getElementById('profile-hours'), { categories: monthly.map((item) => item.month), series: [{ name: 'Hours', data: monthly.map((item) => Math.round(item.hours)), color: colorFor('INTERNAL') }] });
  } else {
    document.getElementById('profile-activity').innerHTML = renderCardEmpty();
    document.getElementById('profile-hours').innerHTML = renderCardEmpty();
  }
  if (courses.length) renderBarChart(document.getElementById('profile-courses'), { categories: courses.map((course) => course.name), series: [{ name: 'Hours', data: courses.map((course) => Math.round(course.hours)), color: colorFor('DIPLOMA') }], horizontal: true });
  else document.getElementById('profile-courses').innerHTML = renderCardEmpty();
  if (sat.length) renderLineChart(document.getElementById('profile-satisfaction'), { categories: sat.map((item) => item.month), series: [{ name: 'Satisfaction', data: sat.map((item) => Number(item.avg.toFixed(2))), color: colorFor('DIPLOMA') }], showLegend: false });
  else document.getElementById('profile-satisfaction').innerHTML = renderCardEmpty('No rating trend for this instructor');
}
