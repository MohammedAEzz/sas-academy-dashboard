import {
  filterSessions, filterActivities, filterFeedback,
  groupRowMetrics, fmt, satisfactionTrend,
} from '../metrics.js';
import {
  renderTable, paginate, renderComments, renderTableCard, renderCardEmpty,
  renderAnswerBand, renderSectionIntro, bindCommentsToggle,
} from '../components.js';
import { renderBarChart, renderLineChart, colorFor, completedStyle, plannedStyle } from '../charts.js';
import { statusBadge, activityTypeLabel, isHistoricalSession, isPlannedSession, monthKey } from '../format.js';
import { navigate } from '../router.js';
import { clearFilters } from '../filters.js';
import { escapeHtml } from '../core/escape.js';

let groupsState = { search: '', sortKey: 'start', sortDir: 'desc', page: 1 };
let detailTimelineExpanded = false;
let detailShowAllComments = false;

export function groupStatusSummary(codes, activities) {
  const statusFor = (code) => activities.find((a) => a.group_code === code)?.status_clean || 'UNKNOWN';
  const typeFor = (code) => activities.find((a) => a.group_code === code)?.activity_type || 'UNKNOWN';
  return {
    completed: codes.filter((code) => statusFor(code) === 'COMPLETED').length,
    planned: codes.filter((code) => statusFor(code) === 'PLANNED').length,
    unknown: codes.filter((code) => statusFor(code) === 'UNKNOWN').length,
    internal: codes.filter((code) => typeFor(code) === 'INTERNAL').length,
    external: codes.filter((code) => typeFor(code) === 'EXTERNAL').length,
  };
}

export function monthlyGroups(sessions) {
  const map = new Map();
  const ensure = (month) => {
    if (!map.has(month)) map.set(month, { completed: new Set(), planned: new Set() });
    return map.get(month);
  };
  for (const session of sessions) {
    const month = monthKey(session.session_date);
    if (!month || !session.group_code) continue;
    if (isHistoricalSession(session) && session.status_clean === 'COMPLETED') ensure(month).completed.add(session.group_code);
    if (isPlannedSession(session)) ensure(month).planned.add(session.group_code);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, value]) => ({ month, completed: value.completed.size, planned: value.planned.size }));
}

export function groupsMonthlySpec(sessions) {
  const monthly = monthlyGroups(sessions);
  if (!monthly.length) return null;
  return {
    categories: monthly.map((item) => item.month),
    series: [
      { name: 'Completed', data: monthly.map((item) => item.completed), color: completedStyle().color },
      { name: 'Planned', data: monthly.map((item) => item.planned), color: plannedStyle().color, dashed: true },
    ],
  };
}

export function renderGroups(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const codes = [...new Set(activities.map((a) => a.group_code).filter(Boolean))];
  const summary = groupStatusSummary(codes, activities);
  let rows = codes.map((code) => groupRowMetrics(code, idx, sessions, activities, feedback));

  if (groupsState.search) {
    const q = groupsState.search.toLowerCase();
    rows = rows.filter((row) => row.groupCode.toLowerCase().includes(q)
      || (row.course || '').toLowerCase().includes(q)
      || row.instructors.some((instructor) => instructor.toLowerCase().includes(q)));
  }

  rows.sort((a, b) => {
    const key = groupsState.sortKey;
    let av = a[key]; let bv = b[key];
    if (key === 'sessions') { av = a.sessionMetrics.completedCount; bv = b.sessionMetrics.completedCount; }
    if (key === 'hours') { av = a.sessionMetrics.completedHours; bv = b.sessionMetrics.completedHours; }
    if (av == null) av = ''; if (bv == null) bv = '';
    const direction = groupsState.sortDir === 'asc' ? 1 : -1;
    return typeof av === 'number' ? (av - bv) * direction : String(av).localeCompare(String(bv)) * direction;
  });

  const { rows: pageRows, pages, page, total } = paginate(rows, groupsState.page, 20);
  if (!codes.length && !groupsState.search) {
    app.innerHTML = `<div class="page-header"><h2>Groups</h2><p>What did we deliver, and what state is it in?</p></div><div class="empty-state"><h3>No groups match these filters</h3><p>Adjust filters or reset them to browse all groups.</p><button class="btn btn-primary" id="empty-clear">Reset filters</button></div>`;
    app.querySelector('#empty-clear')?.addEventListener('click', clearFilters);
    return;
  }

  const columns = [
    { key: 'groupCode', label: 'Group', render: (row) => `<strong>${escapeHtml(row.groupCode)}</strong><div class="table-sub">${activityTypeLabel(row.type)}</div>` },
    { key: 'course', label: 'Course', render: (row) => fmt(row.course) },
    { key: 'instructors', label: 'Lead instructor(s)', render: (row) => fmt(row.instructors.slice(0, 2).join(', ')) },
    { key: 'start', label: 'Delivery window', render: (row) => `${fmt(row.start, 'date')}<div class="table-sub">to ${fmt(row.end, 'date')}</div>` },
    { key: 'sessions', label: 'Sessions', num: true, render: (row) => fmt(row.sessionMetrics.completedCount, 'int') },
    { key: 'hours', label: 'Hours', num: true, render: (row) => fmt(row.sessionMetrics.completedHours, 'int') },
    { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
  ];

  app.innerHTML = `
    ${renderAnswerBand({
      eyebrow: 'Group delivery',
      title: `${fmt(summary.completed, 'int')} groups are completed; ${fmt(summary.planned, 'int')} are upcoming`,
      summary: `${fmt(codes.length, 'int')} group codes are in scope. Status remains explicit: ${fmt(summary.unknown, 'int')} cannot be confidently classified from the source.`,
      metrics: [
        { label: 'Completed', value: fmt(summary.completed, 'int') },
        { label: 'Upcoming', value: fmt(summary.planned, 'int'), sub: 'Planned status' },
        { label: 'Internal', value: fmt(summary.internal, 'int') },
        { label: 'External', value: fmt(summary.external, 'int') },
      ],
    })}
    ${renderSectionIntro('1 · Supporting evidence', 'When groups were active', 'Monthly unique groups from HIGH-confidence completed sessions; planned groups are dashed.')}
    <div class="story-grid">
      <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Groups by month and status</h3><p>A group can appear in more than one month when delivery spans months.</p></div></div><div class="chart-container" id="groups-monthly"></div></section>
      <aside class="insight-panel story-support"><div class="panel-kicker">Status quality</div><h3>${fmt(summary.unknown, 'int')} group codes have unknown status</h3><p>They stay visible as their own bucket and are never silently treated as delivered or upcoming.</p><ul class="insight-list"><li><span>All groups</span><strong>${fmt(codes.length, 'int')}</strong></li><li><span>Completed share</span><strong>${codes.length ? Math.round(summary.completed / codes.length * 100) : 0}%</strong></li><li><span>Rows after search</span><strong>${fmt(total, 'int')}</strong></li></ul></aside>
    </div>
    ${renderSectionIntro('2 · Detail', 'Group register', 'Search, sort, then open a row for the designed group story.')}
    ${renderTableCard({
      toolbar: `<input type="search" class="search-input" id="group-search" placeholder="Search group, course, instructor…" value="${escapeHtml(groupsState.search)}">`,
      tableHtml: renderTable({ columns, rows: pageRows, sortKey: groupsState.sortKey, sortDir: groupsState.sortDir, id: 'groups-table' }).replace('class="data-table"', 'class="data-table table-mobile-compact"'),
      footer: `<span>Showing ${pageRows.length} of ${fmt(total, 'int')}</span><div class="pagination">Page ${page} of ${pages}<button class="btn btn-sm" id="gp-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn btn-sm" id="gp-next" ${page >= pages ? 'disabled' : ''}>Next</button></div>`,
    })}
  `;

  const monthlySpec = groupsMonthlySpec(sessions);
  if (monthlySpec) renderBarChart(document.getElementById('groups-monthly'), monthlySpec);
  else document.getElementById('groups-monthly').innerHTML = renderCardEmpty();

  const wrap = app.querySelector('.table-wrap');
  wrap?.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (groupsState.sortKey === key) groupsState.sortDir = groupsState.sortDir === 'asc' ? 'desc' : 'asc';
    else { groupsState.sortKey = key; groupsState.sortDir = 'asc'; }
    renderGroups(app, { data, idx });
  }));
  wrap?.querySelectorAll('tbody tr').forEach((tr, index) => {
    if (!pageRows[index]) return;
    tr.classList.add('clickable');
    tr.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(pageRows[index].groupCode)}`));
  });
  app.querySelector('#group-search')?.addEventListener('input', (event) => { groupsState.search = event.target.value; groupsState.page = 1; renderGroups(app, { data, idx }); });
  app.querySelector('#gp-prev')?.addEventListener('click', () => { groupsState.page -= 1; renderGroups(app, { data, idx }); });
  app.querySelector('#gp-next')?.addEventListener('click', () => { groupsState.page += 1; renderGroups(app, { data, idx }); });
}

export function renderGroupDetail(app, { data, idx }, groupCode) {
  const code = decodeURIComponent(groupCode);
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const gm = groupRowMetrics(code, idx, sessions, activities, feedback);
  if (!gm.activities.length) {
    app.innerHTML = `<a class="back-link" href="#/groups">← Back to Groups</a><div class="empty-state"><h3>Group not found</h3><p>This group may be excluded by active filters.</p></div>`;
    return;
  }

  const fbRows = feedback.filter((row) => row.group_match_status === 'MAPPED' && row.group_code_clean === code);
  const timeline = [...gm.sessions].sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  const visibleTimeline = detailTimelineExpanded ? timeline : timeline.slice(0, 12);
  const comments = renderComments(fbRows, 1, 8, { substantiveOnly: !detailShowAllComments });
  const courses = [...new Set(gm.activities.map((activity) => activity.course_name_clean).filter(Boolean))];
  const sat = satisfactionTrend(fbRows);
  const mappedGap = new Set(idx.unmappedFeedback.map((row) => row.feedback_id)).size;

  app.innerHTML = `
    <a class="back-link" href="#/groups">← Back to Groups</a>
    <header class="profile-header">
      <div><div class="answer-eyebrow" style="color:var(--cat-1)">Group profile</div><h2>${escapeHtml(code)}</h2><p>${activityTypeLabel(gm.type)} · ${fmt(gm.degree)} · ${courses.map(fmt).join(' · ') || '—'}</p><div class="badges" style="margin-top:12px">${statusBadge(gm.status)}</div></div>
      <div class="profile-header-aside"><strong>${fmt(gm.sessionMetrics.completedHours, 'hours')}</strong><span>completed teaching across ${fmt(gm.sessionMetrics.completedCount, 'int')} sessions</span></div>
    </header>
    <div class="metric-strip">
      <div class="metric-strip-item"><span>Sessions</span><strong>${fmt(gm.sessionMetrics.completedCount, 'int')}</strong><small>${fmt(gm.sessionMetrics.plannedCount, 'int')} planned</small></div>
      <div class="metric-strip-item"><span>Instructors</span><strong>${fmt(gm.instructors.length, 'int')}</strong><small>${escapeHtml(gm.instructors.slice(0, 2).join(', ') || '—')}</small></div>
      <div class="metric-strip-item"><span>Satisfaction</span><strong>${gm.feedback.avgSatisfaction != null ? fmt(gm.feedback.avgSatisfaction, 'rating') : '—'}</strong><small>${gm.feedback.satDenom ? `n=${fmt(gm.feedback.satDenom, 'int')}` : 'N/A'}</small></div>
      <div class="metric-strip-item"><span>Students</span><strong>${gm.students != null ? fmt(gm.students, 'int') : 'N/A'}</strong><small>Source coverage is 17% overall</small></div>
    </div>
    <div class="note-box warning-box">${fmt(mappedGap, 'int')} distinct feedback responses cannot be confidently mapped to a group and are excluded from every group-level feedback metric.</div>

    <section class="profile-section">
      <div class="profile-section-label">DELIVERY TIMELINE</div>
      <div class="detail-panel">
        <div class="table-wrap"><table class="data-table table-mobile-compact"><thead><tr><th>#</th><th>Date</th><th>Instructor</th><th class="num">Hours</th><th>Status</th></tr></thead><tbody>${visibleTimeline.map((session) => `<tr><td class="num">${fmt(session.session_number)}</td><td>${fmt(session.session_date, 'date')}</td><td>${fmt(session.instructor_name_clean)}</td><td class="num">${fmt(session.duration_hours, 'number')}</td><td>${statusBadge(session.status_clean)}</td></tr>`).join('') || '<tr><td colspan="5" class="card-empty">No sessions</td></tr>'}</tbody></table></div>
        ${timeline.length > 12 ? `<div class="table-footer"><span>Showing ${visibleTimeline.length} of ${timeline.length}</span><button class="btn btn-sm" id="timeline-toggle">${detailTimelineExpanded ? 'Show first 12' : 'Show all sessions'}</button></div>` : ''}
      </div>
    </section>

    <section class="profile-section">
      <div class="profile-section-label">LEARNER FEEDBACK</div>
      <div class="story-grid">
        <aside class="insight-panel story-support"><div class="panel-kicker">Experience</div><h3>${gm.feedback.avgSatisfaction != null ? `${fmt(gm.feedback.avgSatisfaction, 'rating')} average` : 'No mapped rating'}</h3><p>${fmt(gm.feedback.distinctCount, 'int')} distinct mapped response${gm.feedback.distinctCount === 1 ? '' : 's'}. ${gm.feedback.distinctCount < 5 ? 'Treat this as directional because the sample is small.' : 'The sample is shown alongside every rating.'}</p><ul class="insight-list"><li><span>NPS</span><strong>${gm.feedback.nps != null ? fmt(gm.feedback.nps, 'number') : '—'}</strong></li><li><span>Responses</span><strong>${fmt(gm.feedback.distinctCount, 'int')}</strong></li></ul></aside>
        <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Satisfaction trend</h3><p>Monthly average from distinct mapped feedback</p></div></div><div class="chart-container" id="group-satisfaction"></div></section>
      </div>
      <div class="detail-panel comments-panel"><div class="panel-header" style="padding:20px 20px 0"><div><h3>Student comments</h3><p>Substantive comments first</p></div></div>${comments.html}</div>
    </section>
  `;

  app.querySelector('#timeline-toggle')?.addEventListener('click', () => { detailTimelineExpanded = !detailTimelineExpanded; renderGroupDetail(app, { data, idx }, groupCode); });
  bindCommentsToggle(app, (showAll) => { detailShowAllComments = showAll; renderGroupDetail(app, { data, idx }, groupCode); });
  const satEl = document.getElementById('group-satisfaction');
  if (sat.length) renderLineChart(satEl, { categories: sat.map((item) => item.month), series: [{ name: 'Satisfaction', data: sat.map((item) => Number(item.avg.toFixed(2))), color: colorFor('DIPLOMA') }], showLegend: false });
  else satEl.innerHTML = renderCardEmpty('No monthly rating trend for this group');
}
