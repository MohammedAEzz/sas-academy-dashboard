import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, completedGroups, plannedGroups, feedbackMetrics,
  monthlySeries, activityTypeBreakdown, topCourses,
  instructorWorkload, satisfactionTrend, fmt, fmtAvg,
} from '../metrics.js';
import { renderKpiRow, renderChartCard, renderCardEmpty } from '../components.js';
import {
  renderLineChart, renderBarChart, renderDonut,
  colorFor, activityColor, completedStyle, plannedStyle,
} from '../charts.js';
import { activityTypeLabel } from '../format.js';

export function renderOverview(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const sm = sessionMetrics(sessions);
  const fm = feedbackMetrics(feedback);
  const activeInstructors = [...new Set(
    sessions.filter((s) => s.status_clean === 'COMPLETED').map((s) => s.instructor_id).filter(Boolean),
  )].length;
  const rosterActive = data.instructors.filter((i) => i.status === 'Active').length;

  const comp = completedStyle();
  const plan = plannedStyle();

  app.innerHTML = `
    <div class="page-header">
      <h2>Overview</h2>
      <p>Executive snapshot of delivery achievement and learner satisfaction</p>
    </div>
    ${renderKpiRow([
      { label: 'Completed Groups', value: fmt(completedGroups(activities), 'int') },
      { label: 'Sessions', value: fmt(sm.completedCount, 'int') },
      { label: 'Teaching Hours', value: fmt(sm.completedHours, 'hours') },
      { label: 'Active Instructors', value: fmt(activeInstructors, 'int'), sub: `${rosterActive} on roster` },
      { label: 'Avg Satisfaction', value: fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—', sub: fm.satDenom ? `n=${fmt(fm.satDenom, 'int')}` : 'N/A' },
      { label: 'NPS', value: fm.nps != null ? fmt(fm.nps, 'number') : '—', sub: fm.npsDenom ? `n=${fmt(fm.npsDenom, 'int')}` : 'N/A' },
    ])}
    ${renderKpiRow([
      { label: 'Planned Groups', value: fmt(plannedGroups(activities), 'int') },
      { label: 'Planned Sessions', value: fmt(sm.plannedCount, 'int') },
      { label: 'Planned Hours', value: fmt(sm.plannedHours, 'hours') },
    ], { secondary: true })}
    <div class="chart-grid">
      ${renderChartCard('chart-activity-time', 'Delivery Trend', 'Completed vs planned sessions by month', 8)}
      ${renderChartCard('chart-int-ext', 'Internal vs External', 'Completed sessions — labels show share', 4)}
      ${renderChartCard('chart-hours-trend', 'Teaching Hours', 'Historical series (HIGH confidence, from Mar 2024)', 6)}
      ${renderChartCard('chart-sat-trend', 'Satisfaction Trend', 'Monthly average from distinct feedback responses', 6)}
      ${renderChartCard('chart-course-mix', 'Top Courses', 'By completed teaching hours', 6)}
      ${renderChartCard('chart-workload', 'Instructor Workload', 'Top instructors by completed hours', 6)}
    </div>
  `;

  const monthly = monthlySeries(sessions);
  if (monthly.length) {
    renderLineChart(document.getElementById('chart-activity-time'), {
      categories: monthly.map((m) => m.month),
      series: [
        { name: 'Completed', data: monthly.map((m) => m.completed), color: comp.color },
        { name: 'Planned', data: monthly.map((m) => m.planned), color: plan.color, dashed: true },
      ],
    });
  } else {
    document.getElementById('chart-activity-time').innerHTML = renderCardEmpty();
  }

  const breakdown = activityTypeBreakdown(sessions);
  if (breakdown.length) {
    renderDonut(document.getElementById('chart-int-ext'), {
      data: breakdown.map((b) => ({
        name: activityTypeLabel(b.type),
        value: b.sessions,
        activityType: b.type,
      })),
    });
  } else {
    document.getElementById('chart-int-ext').innerHTML = renderCardEmpty();
  }

  if (monthly.length) {
    renderLineChart(document.getElementById('chart-hours-trend'), {
      categories: monthly.map((m) => m.month),
      series: [{ name: 'Hours', data: monthly.map((m) => Math.round(m.hours)), color: colorFor('INTERNAL'), area: true }],
      yName: 'Hours',
    });
  }

  const courses = topCourses(sessions, idx.courseMap, 8);
  if (courses.length) {
    renderBarChart(document.getElementById('chart-course-mix'), {
      categories: courses.map((c) => c.name.slice(0, 36)),
      series: [{ name: 'Hours', data: courses.map((c) => Math.round(c.hours)), color: colorFor('DIPLOMA') }],
      horizontal: true,
    });
  } else {
    document.getElementById('chart-course-mix').innerHTML = renderCardEmpty();
  }

  const workload = instructorWorkload(sessions, idx.instructorMap, 10);
  if (workload.length) {
    renderBarChart(document.getElementById('chart-workload'), {
      categories: workload.map((w) => w.name),
      series: [{ name: 'Hours', data: workload.map((w) => Math.round(w.hours)), color: colorFor('EXTERNAL') }],
      horizontal: true,
    });
  }

  const sat = satisfactionTrend(feedback);
  if (sat.length) {
    renderLineChart(document.getElementById('chart-sat-trend'), {
      categories: sat.map((s) => s.month),
      series: [{ name: 'Avg Satisfaction', data: sat.map((s) => Number(s.avg.toFixed(2))), color: colorFor('DIPLOMA') }],
    });
  } else {
    document.getElementById('chart-sat-trend').innerHTML = renderCardEmpty();
  }
}
