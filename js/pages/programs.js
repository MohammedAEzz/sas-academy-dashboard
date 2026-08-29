import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, feedbackMetrics, fmt, fmtAvg, monthlySeries,
} from '../metrics.js';
import { renderKpiGrid, renderChartCard } from '../components.js';
import { renderLineChart, COLORS } from '../charts.js';
import { fmt as fmtDate, activityTypeLabel } from '../format.js';
import { navigate } from '../router.js';

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
    <div class="page-header"><h2>Programs</h2><p>Courses, external group codes, diplomas &amp; events</p></div>

    <div class="section">
      <h3>Courses</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Course</th><th>Groups</th><th>Sessions</th><th>Hours</th><th>Instructors</th><th>Avg Feedback</th>
      </tr></thead><tbody>
        ${courseRows.map((r) => `<tr class="clickable" data-cid="${r.course.course_id}">
          <td>${r.course.course_name_clean}</td>
          <td class="num">${fmt(r.groups, 'int')}</td>
          <td class="num">${fmt(r.sm.completedCount, 'int')}</td>
          <td class="num">${fmt(r.sm.completedHours, 'int')}</td>
          <td class="num">${fmt(r.instructors, 'int')}</td>
          <td class="num">${r.fm.avgSatisfaction != null ? `${fmt(r.fm.avgSatisfaction, 'rating')} (n=${fmt(r.fm.distinctCount, 'int')})` : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <div id="course-drill" class="section" style="display:none"></div>
    </div>

    <div class="section">
      <h3>External Group Codes</h3>
      <div class="note-box">These are external delivery group codes derived from schedules — not client organization names. No client company field exists in the source data.</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Group Code</th><th>Course</th><th>Sessions</th><th>Status</th></tr></thead><tbody>
        ${externalGroups.map((g) => {
    const acts = externalActs.filter((a) => a.group_code === g);
    const sess = sessions.filter((s) => s.group_code === g);
    const sm = sessionMetrics(sess);
    return `<tr class="clickable" data-g="${g}"><td>${g}</td><td>${fmt(acts[0]?.course_name_clean)}</td><td class="num">${fmt(sm.completedCount, 'int')}</td><td>${fmt(acts[0]?.status_clean)}</td></tr>`;
  }).join('')}
      </tbody></table></div>
    </div>

    <div class="section">
      <h3>Diplomas</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Program</th><th>Sessions</th><th>Date Range</th></tr></thead><tbody>
        ${data.diplomas.map((d) => `<tr><td>${d.diploma_type}</td><td class="num">${fmt(d.session_count, 'int')}</td><td>${fmt(d.date_min)} – ${fmt(d.date_max)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="section">
      <h3>Events</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Event</th><th>Type</th><th>Dates</th><th>Participants</th></tr></thead><tbody>
        ${data.events.map((e) => `<tr><td>${e.event_name}</td><td>${e.event_type}</td><td>${fmtDate(e.event_date_start, 'date')} – ${fmtDate(e.event_date_end, 'date')}</td><td class="num">${fmt(e.participant_count, 'int')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
  `;

  app.querySelectorAll('[data-g]').forEach((tr) => {
    tr.addEventListener('click', () => navigate(`#/groups/${encodeURIComponent(tr.dataset.g)}`));
  });

  app.querySelectorAll('[data-cid]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const cid = tr.dataset.cid;
      const row = courseRows.find((r) => r.course.course_id === cid);
      const drill = app.querySelector('#course-drill');
      drill.style.display = 'block';
      drill.innerHTML = `
        <h4>${row.course.course_name_clean} — demand over time</h4>
        ${renderChartCard('prog-course-chart', 'Sessions by Month')}
      `;
      renderLineChart(document.getElementById('prog-course-chart'), {
        categories: row.monthly.map((m) => m.month),
        series: [{ name: 'Completed Sessions', data: row.monthly.map((m) => m.completed), color: COLORS.primary }],
      });
    });
  });
}
