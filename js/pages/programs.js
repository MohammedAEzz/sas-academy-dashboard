import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, feedbackMetrics, fmt, monthlySeries,
} from '../metrics.js';
import { renderAnswerBand, renderSectionIntro, renderTableCard, renderCardEmpty } from '../components.js';
import { renderLineChart, renderBarChart, colorFor } from '../charts.js';
import { activityTypeLabel, statusBadge } from '../format.js';
import { escapeHtml } from '../core/escape.js';
import { navigate } from '../router.js';

let activeTab = 'courses';
let selectedCourseId = null;

export function selectedProgramCourseId() {
  return selectedCourseId;
}

export function programPortfolio(data) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const courseRows = data.courses.map((course) => {
    const courseSessions = sessions.filter((session) => session.course_id === course.course_id && session.status_clean === 'COMPLETED');
    const metrics = sessionMetrics(courseSessions);
    const groups = new Set(activities.filter((activity) => activity.course_id === course.course_id).map((activity) => activity.group_code));
    const instructors = new Set(courseSessions.map((session) => session.instructor_id).filter(Boolean));
    const learner = feedbackMetrics(feedback.filter((row) => row.course_id === course.course_id));
    return { course, metrics, groups: groups.size, instructors: instructors.size, learner, monthly: monthlySeries(courseSessions) };
  }).filter((row) => row.metrics.completedCount > 0).sort((a, b) => b.metrics.completedHours - a.metrics.completedHours);

  const externalActivities = activities.filter((activity) => activity.activity_type === 'EXTERNAL');
  const externalCodes = [...new Set(externalActivities.map((activity) => activity.group_code).filter(Boolean))].sort();
  const externalRows = externalCodes.map((code) => {
    const acts = externalActivities.filter((activity) => activity.group_code === code);
    const metrics = sessionMetrics(sessions.filter((session) => session.group_code === code));
    return { code, activity: acts[0], metrics };
  }).sort((a, b) => b.metrics.completedCount - a.metrics.completedCount);
  return { courseRows, externalRows };
}

export function programChartSpecs(portfolio, selectedId) {
  const { courseRows, externalRows } = portfolio;
  const selected = courseRows.find((row) => row.course.course_id === selectedId) || courseRows[0] || null;
  const topCourses = courseRows.slice(0, 8).reverse();
  const topClients = externalRows.slice(0, 10).reverse();
  return {
    selected,
    hours: topCourses.length ? {
      categories: topCourses.map((row) => row.course.course_name_clean),
      series: [{ name: 'Hours', data: topCourses.map((row) => Math.round(row.metrics.completedHours)), color: colorFor('DIPLOMA') }],
      horizontal: true,
    } : null,
    demand: selected?.monthly.length ? {
      categories: selected.monthly.map((item) => item.month),
      series: [{ name: 'Completed sessions', data: selected.monthly.map((item) => item.completed), color: colorFor('EXTERNAL'), area: true }],
      showLegend: false,
    } : null,
    clients: topClients.length ? {
      categories: topClients.map((row) => row.code),
      series: [{ name: 'Sessions', data: topClients.map((row) => row.metrics.completedCount), color: colorFor('EXTERNAL') }],
      horizontal: true,
    } : null,
  };
}

export function diplomaChartSpec(diplomas) {
  if (!diplomas.length) return null;
  return {
    categories: diplomas.map((row) => row.diploma_type),
    series: [{ name: 'Sessions', data: diplomas.map((row) => row.session_count), color: colorFor('DIPLOMA') }],
  };
}

export function eventChartSpec(events) {
  if (!events.length) return null;
  return {
    categories: events.map((row) => row.event_name),
    series: [{ name: 'Participants', data: events.map((row) => row.participant_count), color: colorFor('EVENT') }],
    horizontal: true,
  };
}

export function renderPrograms(app, { data, idx }) {
  const { courseRows, externalRows } = programPortfolio(data);
  if (!selectedCourseId && courseRows[0]) selectedCourseId = courseRows[0].course.course_id;

  app.innerHTML = `
    <div class="page-header"><h2>Programs</h2><p>One view at a time: course demand, external group codes, diplomas, or events.</p></div>
    <div class="tabs" role="tablist">
      <button class="tab-btn${activeTab === 'courses' ? ' active' : ''}" data-tab="courses">Courses</button>
      <button class="tab-btn${activeTab === 'clients' ? ' active' : ''}" data-tab="clients">Clients</button>
      <button class="tab-btn${activeTab === 'diplomas' ? ' active' : ''}" data-tab="diplomas">Diplomas</button>
      <button class="tab-btn${activeTab === 'events' ? ' active' : ''}" data-tab="events">Events</button>
    </div>
    <div id="tab-content"></div>
  `;

  const content = app.querySelector('#tab-content');
  const renderCourses = () => {
    const lead = courseRows[0];
    const selected = courseRows.find((row) => row.course.course_id === selectedCourseId) || lead;
    content.innerHTML = `
      ${renderAnswerBand({ eyebrow: 'Course portfolio', title: `${escapeHtml(lead?.course.course_name_clean || 'No course')} contributes the most teaching volume`, summary: `${fmt(lead?.metrics.completedHours, 'hours')} across ${fmt(lead?.metrics.completedCount, 'int')} completed sessions. Open any catalog row to change the demand drill-down.`, metrics: [{ label: 'Courses delivered', value: fmt(courseRows.length, 'int') }, { label: 'Lead course hours', value: fmt(lead?.metrics.completedHours, 'hours') }, { label: 'Lead course groups', value: fmt(lead?.groups, 'int') }, { label: 'Lead course instructors', value: fmt(lead?.instructors, 'int') }] })}
      ${renderSectionIntro('1 · Supporting evidence', 'Portfolio contribution', 'Completed hours only; aqua bars carry direct value labels.')}
      <div class="story-grid">
        <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Teaching hours by course</h3><p>Top eight delivered courses · long axis labels shorten; hover for the full name</p></div></div><div class="chart-container tall" id="program-course-hours"></div></section>
        <aside class="insight-panel story-support"><div class="panel-kicker">Selected course</div><h3>${escapeHtml(selected?.course.course_name_clean || '—')}</h3><p>${fmt(selected?.metrics.completedHours, 'hours')} from ${fmt(selected?.metrics.completedCount, 'int')} sessions across ${fmt(selected?.groups, 'int')} groups.</p><ul class="insight-list"><li><span>Instructors</span><strong>${fmt(selected?.instructors, 'int')}</strong></li><li><span>Feedback</span><strong>${fmt(selected?.learner.distinctCount, 'int')}</strong></li><li><span>Rating</span><strong>${selected?.learner.avgSatisfaction != null ? `${fmt(selected.learner.avgSatisfaction, 'rating')} (n=${selected.learner.satDenom})` : '—'}</strong></li></ul></aside>
        <section class="evidence-panel story-full"><div class="panel-header"><div><h3>Selected course demand over time</h3><p>${escapeHtml(selected?.course.course_name_clean || '—')} · completed sessions</p></div></div><div class="chart-container" id="program-course-demand"></div></section>
      </div>
      ${renderSectionIntro('2 · Detail', 'Course catalog', 'Select a row to update the drill-down above.')}
      ${renderTableCard({ tableHtml: `<table class="data-table table-mobile-compact"><thead><tr><th>Course</th><th class="num">Groups</th><th class="num">Sessions</th><th class="num">Hours</th><th class="num">Instructors</th><th class="num">Rating</th></tr></thead><tbody>${courseRows.map((row) => `<tr class="clickable${selectedCourseId === row.course.course_id ? ' selected' : ''}" data-course="${escapeHtml(row.course.course_id)}"><td>${escapeHtml(row.course.course_name_clean)}</td><td class="num">${fmt(row.groups, 'int')}</td><td class="num">${fmt(row.metrics.completedCount, 'int')}</td><td class="num">${fmt(row.metrics.completedHours, 'int')}</td><td class="num">${fmt(row.instructors, 'int')}</td><td class="num">${row.learner.avgSatisfaction != null ? `${fmt(row.learner.avgSatisfaction, 'rating')} <span class="table-sub">n=${fmt(row.learner.satDenom, 'int')}</span>` : '—'}</td></tr>`).join('')}</tbody></table>` })}
    `;
    const specs = programChartSpecs({ courseRows, externalRows }, selectedCourseId);
    if (specs.hours) renderBarChart(document.getElementById('program-course-hours'), specs.hours);
    else document.getElementById('program-course-hours').innerHTML = renderCardEmpty();
    if (specs.demand) renderLineChart(document.getElementById('program-course-demand'), specs.demand);
    else document.getElementById('program-course-demand').innerHTML = renderCardEmpty();
    content.querySelectorAll('[data-course]').forEach((row) => row.addEventListener('click', () => { selectedCourseId = row.dataset.course; renderCourses(); }));
  };

  const renderClients = () => {
    const totalSessions = externalRows.reduce((sum, row) => sum + row.metrics.completedCount, 0);
    const totalHours = externalRows.reduce((sum, row) => sum + row.metrics.completedHours, 0);
    content.innerHTML = `
      ${renderAnswerBand({ eyebrow: 'External delivery', title: `${fmt(externalRows.length, 'int')} external group codes account for ${fmt(totalSessions, 'int')} completed sessions`, summary: 'The source contains group codes only. It does not contain client or organisation names, so this tab is deliberately labelled as a code view.', metrics: [{ label: 'External codes', value: fmt(externalRows.length, 'int') }, { label: 'Sessions', value: fmt(totalSessions, 'int') }, { label: 'Hours', value: fmt(totalHours, 'hours') }, { label: 'Organisation names', value: 'N/A', sub: 'Not in source' }] })}
      <div class="note-box warning-box"><strong>Clients means external group codes here.</strong> No client/organisation field exists; codes are not reverse-labelled or guessed.</div>
      ${renderSectionIntro('1 · Supporting evidence', 'Largest external delivery codes', 'Completed sessions by code.')}
      <section class="evidence-panel" style="margin-bottom:32px"><div class="chart-container tall" id="program-clients"></div></section>
      ${renderSectionIntro('2 · Detail', 'External group-code register', 'Open a code for its group detail.')}
      ${renderTableCard({ tableHtml: `<table class="data-table table-mobile-compact"><thead><tr><th>External group code</th><th>Course</th><th class="num">Sessions</th><th class="num">Hours</th><th>Status</th></tr></thead><tbody>${externalRows.map((row) => `<tr class="clickable" data-group="${escapeHtml(row.code)}"><td><strong>${escapeHtml(row.code)}</strong></td><td>${fmt(row.activity?.course_name_clean)}</td><td class="num">${fmt(row.metrics.completedCount, 'int')}</td><td class="num">${fmt(row.metrics.completedHours, 'int')}</td><td>${statusBadge(row.activity?.status_clean)}</td></tr>`).join('')}</tbody></table>` })}
    `;
    const clientSpec = programChartSpecs({ courseRows, externalRows }, selectedCourseId).clients;
    if (clientSpec) renderBarChart(document.getElementById('program-clients'), clientSpec);
    else document.getElementById('program-clients').innerHTML = renderCardEmpty();
    content.querySelectorAll('[data-group]').forEach((row) => row.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(row.dataset.group)}`)));
  };

  const renderDiplomas = () => {
    const totalSessions = data.diplomas.reduce((sum, row) => sum + Number(row.session_count || 0), 0);
    const lead = [...data.diplomas].sort((a, b) => Number(b.session_count || 0) - Number(a.session_count || 0))[0];
    content.innerHTML = `
      ${renderAnswerBand({ eyebrow: 'Diploma portfolio', title: `${lead?.diploma_type || 'No diploma'} is the largest recorded diploma programme`, summary: `${fmt(data.diplomas.length, 'int')} diploma programmes contribute ${fmt(totalSessions, 'int')} sessions in the diploma summary source.`, metrics: [{ label: 'Programmes', value: fmt(data.diplomas.length, 'int') }, { label: 'Sessions', value: fmt(totalSessions, 'int') }, { label: 'Largest programme', value: fmt(lead?.session_count, 'int'), sub: 'Sessions' }, { label: 'Measure', value: 'Sessions' }] })}
      ${renderSectionIntro('1 · Supporting evidence', 'Sessions by diploma programme')}
      <section class="evidence-panel" style="margin-bottom:32px"><div class="chart-container" id="program-diplomas"></div></section>
      ${renderTableCard({ tableHtml: `<table class="data-table table-mobile-compact"><thead><tr><th>Programme</th><th class="num">Sessions</th><th>Date range</th></tr></thead><tbody>${data.diplomas.map((row) => `<tr><td>${fmt(row.diploma_type)}</td><td class="num">${fmt(row.session_count, 'int')}</td><td>${fmt(row.date_min, 'date')} – ${fmt(row.date_max, 'date')}</td></tr>`).join('')}</tbody></table>` })}
    `;
    const diplomaSpec = diplomaChartSpec(data.diplomas);
    if (diplomaSpec) renderBarChart(document.getElementById('program-diplomas'), diplomaSpec);
  };

  const renderEvents = () => {
    const participants = data.events.reduce((sum, row) => sum + Number(row.participant_count || 0), 0);
    const lead = [...data.events].sort((a, b) => Number(b.participant_count || 0) - Number(a.participant_count || 0))[0];
    content.innerHTML = `
      ${renderAnswerBand({ eyebrow: 'Event reach', title: `${fmt(data.events.length, 'int')} events reached ${fmt(participants, 'int')} recorded participants`, summary: `${escapeHtml(lead?.event_name || 'No event')} has the largest recorded participant count. Missing participant values stay missing rather than becoming zero.`, metrics: [{ label: 'Events', value: fmt(data.events.length, 'int') }, { label: 'Participants', value: fmt(participants, 'int') }, { label: 'Largest event', value: fmt(lead?.participant_count, 'int') }, { label: 'Entity colour', value: 'Event', sub: 'Fixed yellow slot with labels' }] })}
      ${renderSectionIntro('1 · Supporting evidence', 'Participants by event', 'Yellow marks retain direct labels for light-surface contrast.')}
      <section class="evidence-panel" style="margin-bottom:32px"><div class="chart-container tall" id="program-events"></div></section>
      ${renderTableCard({ tableHtml: `<table class="data-table table-mobile-compact"><thead><tr><th>Event</th><th>Type</th><th>Dates</th><th class="num">Participants</th></tr></thead><tbody>${data.events.map((row) => `<tr><td>${fmt(row.event_name)}</td><td>${activityTypeLabel(row.event_type)}</td><td>${fmt(row.event_date_start, 'date')} – ${fmt(row.event_date_end, 'date')}</td><td class="num">${row.participant_count != null ? fmt(row.participant_count, 'int') : '—'}</td></tr>`).join('')}</tbody></table>` })}
    `;
    const eventSpec = eventChartSpec(data.events);
    if (eventSpec) renderBarChart(document.getElementById('program-events'), eventSpec);
  };

  const renderers = { courses: renderCourses, clients: renderClients, diplomas: renderDiplomas, events: renderEvents };
  renderers[activeTab]();
  app.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { activeTab = button.dataset.tab; renderPrograms(app, { data, idx }); }));
}
