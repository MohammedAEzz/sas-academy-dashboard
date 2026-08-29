import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, feedbackMetrics, fmt, monthlySeries,
} from '../metrics.js';
import { renderKpiGrid, renderChartCard, renderTableCard, renderCardEmpty } from '../components.js';
import { renderLineChart, renderBarChart, colorFor } from '../charts.js';
import { fmt as fmtDate, activityTypeLabel, statusBadge } from '../format.js';
import { navigate } from '../router.js';

let activeTab = 'courses';
let selectedCourseId = null;

export function renderPrograms(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);

  const courseRows = data.courses.map((c) => {
    const cs = sessions.filter((s) => s.course_id === c.course_id && s.status_clean === 'COMPLETED');
    const sm = sessionMetrics(cs);
    const groups = new Set(activities.filter((a) => a.course_id === c.course_id).map((a) => a.group_code));
    const instructors = new Set(cs.map((s) => s.instructor_id).filter(Boolean));
    const fb = feedback.filter((f) => f.course_id === c.course_id);
    const fm = feedbackMetrics(fb);
    const monthly = monthlySeries(cs);
    return { course: c, sm, groups: groups.size, instructors: instructors.size, fm, monthly };
  }).filter((r) => r.sm.completedCount > 0)
    .sort((a, b) => b.sm.completedHours - a.sm.completedHours);

  const externalActs = activities.filter((a) => a.activity_type === 'EXTERNAL');
  const externalGroups = [...new Set(externalActs.map((a) => a.group_code))].sort();

  app.innerHTML = `
    <div class="page-header">
      <h2>Programs</h2>
      <p>Courses, diplomas, events, and external delivery codes</p>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab-btn${activeTab === 'courses' ? ' active' : ''}" data-tab="courses">Courses</button>
      <button type="button" class="tab-btn${activeTab === 'diplomas' ? ' active' : ''}" data-tab="diplomas">Diplomas</button>
      <button type="button" class="tab-btn${activeTab === 'events' ? ' active' : ''}" data-tab="events">Events</button>
      <button type="button" class="tab-btn${activeTab === 'external' ? ' active' : ''}" data-tab="external">External Groups</button>
    </div>
    <div id="tab-content"></div>
  `;

  const content = app.querySelector('#tab-content');

  const renderCoursesTab = () => {
    const top5 = courseRows.slice(0, 5);
    content.innerHTML = `
      <div class="chart-grid">
        ${renderChartCard('prog-hours-chart', 'Teaching Hours by Course', 'Top 5 courses', 6)}
        ${renderChartCard('prog-demand-chart', 'Demand Over Time', selectedCourseId ? idx.courseName(selectedCourseId) : 'Select a course below', 6)}
      </div>
      ${renderTableCard({
        title: 'Course Catalog',
        tableHtml: `<table class="data-table"><thead><tr>
          <th>Course</th><th class="num">Groups</th><th class="num">Sessions</th><th class="num">Hours</th>
          <th class="num">Instructors</th><th class="num">Avg Feedback</th>
        </tr></thead><tbody>
          ${courseRows.map((r) => `<tr class="clickable${selectedCourseId === r.course.course_id ? ' selected' : ''}" data-cid="${r.course.course_id}">
            <td>${r.course.course_name_clean}</td>
            <td class="num">${fmt(r.groups, 'int')}</td>
            <td class="num">${fmt(r.sm.completedCount, 'int')}</td>
            <td class="num">${fmt(r.sm.completedHours, 'int')}</td>
            <td class="num">${fmt(r.instructors, 'int')}</td>
            <td class="num">${r.fm.avgSatisfaction != null ? `${fmt(r.fm.avgSatisfaction, 'rating')} (n=${fmt(r.fm.distinctCount, 'int')})` : '—'}</td>
          </tr>`).join('')}
        </tbody></table>`,
      })}
    `;

    if (top5.length) {
      renderBarChart(document.getElementById('prog-hours-chart'), {
        categories: top5.map((r) => r.course.course_name_clean.slice(0, 30)),
        series: [{ name: 'Hours', data: top5.map((r) => Math.round(r.sm.completedHours)), color: colorFor('DIPLOMA') }],
        horizontal: true,
      });
    }

    const drillRow = selectedCourseId ? courseRows.find((r) => r.course.course_id === selectedCourseId) : null;
    const demandEl = document.getElementById('prog-demand-chart');
    if (drillRow?.monthly?.length) {
      renderLineChart(demandEl, {
        categories: drillRow.monthly.map((m) => m.month),
        series: [{ name: 'Completed Sessions', data: drillRow.monthly.map((m) => m.completed), color: colorFor('INTERNAL') }],
      });
    } else {
      demandEl.innerHTML = renderCardEmpty('Click a course row to view demand over time');
    }

    content.querySelectorAll('[data-cid]').forEach((tr) => {
      tr.addEventListener('click', () => {
        selectedCourseId = tr.dataset.cid;
        renderCoursesTab();
      });
    });
  };

  const renderDiplomasTab = () => {
    const totalSessions = data.diplomas.reduce((s, d) => s + (d.session_count || 0), 0);
    content.innerHTML = `
      ${renderKpiGrid([
        { label: 'Diploma Programs', value: fmt(data.diplomas.length, 'int') },
        { label: 'Total Sessions', value: fmt(totalSessions, 'int') },
      ])}
      <div class="chart-grid">${renderChartCard('dip-chart', 'Sessions by Program', '', 12)}</div>
      ${renderTableCard({
        tableHtml: `<table class="data-table"><thead><tr><th>Program</th><th class="num">Sessions</th><th>Date Range</th></tr></thead><tbody>
          ${data.diplomas.map((d) => `<tr><td>${d.diploma_type}</td><td class="num">${fmt(d.session_count, 'int')}</td><td>${fmt(d.date_min)} – ${fmt(d.date_max)}</td></tr>`).join('')}
        </tbody></table>`,
      })}
    `;
    if (data.diplomas.length) {
      renderBarChart(document.getElementById('dip-chart'), {
        categories: data.diplomas.map((d) => d.diploma_type),
        series: [{ name: 'Sessions', data: data.diplomas.map((d) => d.session_count), color: colorFor('DIPLOMA') }],
      });
    }
  };

  const renderEventsTab = () => {
    const totalParticipants = data.events.reduce((s, e) => s + (e.participant_count || 0), 0);
    content.innerHTML = `
      ${renderKpiGrid([
        { label: 'Events', value: fmt(data.events.length, 'int') },
        { label: 'Total Participants', value: fmt(totalParticipants, 'int') },
      ])}
      <div class="chart-grid">${renderChartCard('evt-chart', 'Participants by Event', '', 12)}</div>
      ${renderTableCard({
        tableHtml: `<table class="data-table"><thead><tr><th>Event</th><th>Type</th><th>Dates</th><th class="num">Participants</th></tr></thead><tbody>
          ${data.events.map((e) => `<tr><td>${e.event_name}</td><td>${e.event_type}</td><td>${fmtDate(e.event_date_start, 'date')} – ${fmtDate(e.event_date_end, 'date')}</td><td class="num">${fmt(e.participant_count, 'int')}</td></tr>`).join('')}
        </tbody></table>`,
      })}
    `;
    if (data.events.length) {
      renderBarChart(document.getElementById('evt-chart'), {
        categories: data.events.map((e) => e.event_name.slice(0, 30)),
        series: [{ name: 'Participants', data: data.events.map((e) => e.participant_count || 0), color: colorFor('EVENT') }],
        horizontal: true,
      });
    }
  };

  const renderExternalTab = () => {
    content.innerHTML = `
      <div class="note-box">External group codes from schedules — not client organization names. No company field exists in source data.</div>
      <div class="chart-grid">${renderChartCard('ext-chart', 'Sessions by External Group', 'Top 15 by session count', 12)}</div>
      ${renderTableCard({
        tableHtml: `<table class="data-table"><thead><tr><th>Group Code</th><th>Course</th><th class="num">Sessions</th><th>Status</th></tr></thead><tbody>
          ${externalGroups.map((g) => {
    const acts = externalActs.filter((a) => a.group_code === g);
    const sess = sessions.filter((s) => s.group_code === g);
    const sm = sessionMetrics(sess);
    return `<tr class="clickable" data-g="${g}"><td>${g}</td><td>${fmt(acts[0]?.course_name_clean)}</td><td class="num">${fmt(sm.completedCount, 'int')}</td><td>${statusBadge(acts[0]?.status_clean)}</td></tr>`;
  }).join('')}
        </tbody></table>`,
      })}
    `;
    const topExt = externalGroups.slice(0, 15).map((g) => {
      const sm = sessionMetrics(sessions.filter((s) => s.group_code === g));
      return { g, count: sm.completedCount };
    }).sort((a, b) => b.count - a.count);
    if (topExt.length) {
      renderBarChart(document.getElementById('ext-chart'), {
        categories: topExt.map((x) => x.g),
        series: [{ name: 'Sessions', data: topExt.map((x) => x.count), color: colorFor('EXTERNAL') }],
        horizontal: true,
      });
    }
    content.querySelectorAll('[data-g]').forEach((tr) => {
      tr.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(tr.dataset.g)}`));
    });
  };

  const tabRenderers = { courses: renderCoursesTab, diplomas: renderDiplomasTab, events: renderEventsTab, external: renderExternalTab };
  tabRenderers[activeTab]();

  app.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      app.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
      tabRenderers[activeTab]();
    });
  });
}
