import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, completedGroups, plannedGroups, feedbackMetrics,
  studentMetrics, monthlySeries, activityTypeBreakdown, topCourses,
  instructorWorkload, satisfactionTrend, fmt, fmtAvg,
} from '../metrics.js';
import { renderKpiGrid, renderPipelineStrip, renderChartCard } from '../components.js';
import { renderLineChart, renderBarChart, renderDonut, COLORS } from '../charts.js';
import { fmtStudents, activityTypeLabel } from '../format.js';

export function renderOverview(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const sm = sessionMetrics(sessions);
  const fm = feedbackMetrics(feedback);
  const students = studentMetrics(activities, data.overview);
  const activeInstructors = [...new Set(
    sessions.filter((s) => s.status_clean === 'COMPLETED').map((s) => s.instructor_id).filter(Boolean),
  )].length;

  app.innerHTML = `
    <div class="page-header"><h2>Overview</h2><p>Delivery achievement and pipeline snapshot</p></div>
    ${renderKpiGrid([
      { label: 'Completed Groups', value: fmt(completedGroups(activities), 'int') },
      { label: 'Completed Sessions', value: fmt(sm.completedCount, 'int') },
      { label: 'Completed Teaching Hours', value: fmt(sm.completedHours, 'hours') },
      { label: 'Active Instructors', value: fmt(activeInstructors, 'int'), sub: `${data.instructors.filter((i) => i.status === 'Active').length} on roster` },
      { label: 'Courses Delivered', value: fmt(new Set(sessions.filter((s) => s.status_clean === 'COMPLETED').map((s) => s.course_id)).size, 'int') },
      { label: 'Avg Satisfaction', value: fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—', sub: fm.satDenom ? `n=${fmt(fm.satDenom, 'int')}` : 'N/A' },
      { label: 'NPS', value: fm.nps != null ? fmt(fm.nps, 'number') : '—', sub: fm.npsDenom ? `n=${fmt(fm.npsDenom, 'int')}` : 'N/A' },
      { label: 'Students', value: students.total ? fmt(students.total, 'int') : 'N/A', sub: fmtStudents(students.total, students.totalActivities, students.activitiesWith) },
    ])}
    ${renderPipelineStrip([
      { label: 'Planned Groups', value: fmt(plannedGroups(activities), 'int') },
      { label: 'Planned Sessions', value: fmt(sm.plannedCount, 'int') },
      { label: 'Planned Hours', value: fmt(sm.plannedHours, 'hours') },
    ])}
    <div class="chart-grid">
      ${renderChartCard('chart-activity-time', 'Activity Over Time', 'Completed vs planned sessions by month')}
      ${renderChartCard('chart-int-ext', 'Internal vs External', 'Completed sessions only')}
      ${renderChartCard('chart-hours-trend', 'Teaching Hours Trend', 'Historical (HIGH confidence, non-planned)')}
      ${renderChartCard('chart-course-mix', 'Course Mix', 'Top courses by teaching hours')}
      ${renderChartCard('chart-workload', 'Instructor Workload', 'Top instructors by completed hours')}
      ${renderChartCard('chart-sat-trend', 'Satisfaction Trend', 'Monthly average, distinct feedback')}
    </div>
  `;

  const monthly = monthlySeries(sessions);
  renderLineChart(document.getElementById('chart-activity-time'), {
    categories: monthly.map((m) => m.month),
    series: [
      { name: 'Completed', data: monthly.map((m) => m.completed), color: COLORS.completed },
      { name: 'Planned', data: monthly.map((m) => m.planned), color: COLORS.planned },
    ],
  });

  const breakdown = activityTypeBreakdown(sessions);
  renderDonut(document.getElementById('chart-int-ext'), {
    data: breakdown.map((b) => ({ name: activityTypeLabel(b.type), value: b.sessions })),
  });

  renderLineChart(document.getElementById('chart-hours-trend'), {
    categories: monthly.map((m) => m.month),
    series: [{ name: 'Hours', data: monthly.map((m) => Math.round(m.hours)), color: COLORS.primary }],
    yName: 'Hours',
  });

  const courses = topCourses(sessions, idx.courseMap, 8);
  renderBarChart(document.getElementById('chart-course-mix'), {
    categories: courses.map((c) => c.name.slice(0, 30)),
    series: [{ name: 'Hours', data: courses.map((c) => Math.round(c.hours)), color: COLORS.primary }],
    horizontal: true,
  });

  const workload = instructorWorkload(sessions, idx.instructorMap, 10);
  renderBarChart(document.getElementById('chart-workload'), {
    categories: workload.map((w) => w.name),
    series: [{ name: 'Hours', data: workload.map((w) => Math.round(w.hours)), color: COLORS.secondary }],
    horizontal: true,
  });

  const sat = satisfactionTrend(feedback);
  renderLineChart(document.getElementById('chart-sat-trend'), {
    categories: sat.map((s) => s.month),
    series: [{ name: 'Avg Satisfaction', data: sat.map((s) => Number(s.avg.toFixed(2))), color: COLORS.completed }],
  });
}
