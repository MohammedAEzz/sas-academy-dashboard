import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, completedGroups, plannedGroups, feedbackMetrics,
  activityTypeBreakdown, topCourses, instructorWorkload, satisfactionTrend, fmt,
} from '../metrics.js';
import { renderAnswerBand, renderSectionIntro, renderCardEmpty } from '../components.js';
import {
  renderLineChart, renderBarChart, colorFor, activityColor, completedStyle, plannedStyle,
} from '../charts.js';
import { activityTypeLabel, isHistoricalSession, isPlannedSession, monthKey } from '../format.js';

let pulseMetric = 'sessions';

function deliveryPulse(sessions, metric) {
  const buckets = new Map();
  const ensure = (month) => {
    if (!buckets.has(month)) buckets.set(month, { completed: 0, planned: 0, completedGroups: new Set(), plannedGroups: new Set() });
    return buckets.get(month);
  };
  for (const session of sessions) {
    const month = monthKey(session.session_date);
    if (!month) continue;
    if (isHistoricalSession(session) && session.status_clean === 'COMPLETED') {
      const bucket = ensure(month);
      bucket.completed += metric === 'hours' ? Number(session.duration_hours || 0) : 1;
      if (session.group_code) bucket.completedGroups.add(session.group_code);
    } else if (isPlannedSession(session)) {
      const bucket = ensure(month);
      bucket.planned += metric === 'hours' ? Number(session.duration_hours || 0) : 1;
      if (session.group_code) bucket.plannedGroups.add(session.group_code);
    }
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, bucket]) => ({
    month,
    completed: metric === 'groups' ? bucket.completedGroups.size : bucket.completed,
    planned: metric === 'groups' ? bucket.plannedGroups.size : bucket.planned,
  }));
}

function recentDirection(sessions) {
  const series = deliveryPulse(sessions, 'hours').filter((d) => d.completed > 0);
  if (series.length < 6) return { label: 'Trend unavailable', detail: 'Fewer than six completed months in the current filter' };
  const recent = series.slice(-3).reduce((sum, d) => sum + d.completed, 0);
  const prior = series.slice(-6, -3).reduce((sum, d) => sum + d.completed, 0);
  if (!prior) return { label: 'Trend unavailable', detail: 'No comparable prior-period hours' };
  const pct = Math.round(((recent - prior) / prior) * 100);
  return {
    label: `${Math.abs(pct)}% ${pct >= 0 ? 'higher' : 'lower'}`,
    detail: 'Completed hours in the latest 3 active months vs the prior 3',
  };
}

export function renderOverview(app, { data, idx }) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const sm = sessionMetrics(sessions);
  const fm = feedbackMetrics(feedback);
  const deliveredGroups = completedGroups(activities);
  const upcomingGroups = plannedGroups(activities);
  const trendDirection = recentDirection(sessions);
  const rosterActive = data.instructors.filter((i) => i.status === 'Active').length;
  const comp = completedStyle();
  const plan = plannedStyle();
  const breakdown = activityTypeBreakdown(sessions).sort((a, b) => b.hours - a.hours);
  const totalMixHours = breakdown.reduce((sum, item) => sum + item.hours, 0);
  const workload = instructorWorkload(sessions, idx.instructorMap, 10);
  const topFiveHours = workload.slice(0, 5).reduce((sum, item) => sum + item.hours, 0);
  const concentration = sm.completedHours ? ((topFiveHours / sm.completedHours) * 100).toFixed(1) : '0.0';
  const courses = topCourses(sessions, idx.courseMap, 6);
  const sat = satisfactionTrend(feedback);

  app.innerHTML = `
    ${renderAnswerBand({
      eyebrow: 'Delivery at a glance',
      title: `${fmt(sm.completedCount, 'int')} sessions delivered across ${fmt(deliveredGroups, 'int')} completed groups`,
      summary: `The academy has delivered ${fmt(sm.completedHours, 'hours')} of completed teaching. Learners rate the experience ${fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—'} out of 5, while ${fmt(sm.plannedCount, 'int')} sessions are already in the forward plan.`,
      metrics: [
        { label: 'Completed hours', value: fmt(sm.completedHours, 'hours') },
        { label: 'Recent direction', value: trendDirection.label, sub: trendDirection.detail },
        { label: 'Satisfaction', value: fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—', sub: fm.satDenom ? `n=${fmt(fm.satDenom, 'int')}` : 'N/A' },
        { label: 'NPS', value: fm.nps != null ? fmt(fm.nps, 'number') : '—', sub: fm.npsDenom ? `n=${fmt(fm.npsDenom, 'int')}` : 'N/A' },
      ],
    })}

    ${renderSectionIntro('1 · Supporting evidence', 'Delivery pulse', 'Switch the unit without splitting one trend into three repetitive charts.')}
    <div class="story-grid">
      <section class="evidence-panel story-primary">
        <div class="panel-header">
          <div><h3>Completed delivery and committed work</h3><p>HIGH-confidence history from Mar 2024; planned work is dashed.</p></div>
          <div class="segmented-control" id="pulse-switch" aria-label="Delivery metric">
            ${['groups', 'sessions', 'hours'].map((metric) => `<button class="segment-btn${pulseMetric === metric ? ' active' : ''}" data-metric="${metric}">${metric[0].toUpperCase()}${metric.slice(1)}</button>`).join('')}
          </div>
        </div>
        <div class="chart-container tall" id="overview-pulse"></div>
      </section>
      <aside class="insight-panel story-support">
        <div class="panel-kicker">Looking ahead</div>
        <h3>${fmt(upcomingGroups, 'int')} groups are in the plan</h3>
        <p>Committed work is kept separate from achievement so future demand never inflates delivered performance.</p>
        <ul class="insight-list">
          <li><span>Planned sessions</span><strong>${fmt(sm.plannedCount, 'int')}</strong></li>
          <li><span>Planned hours</span><strong>${fmt(sm.plannedHours, 'hours')}</strong></li>
          <li><span>Active roster</span><strong>${fmt(rosterActive, 'int')} instructors</strong></li>
        </ul>
      </aside>
    </div>

    ${renderSectionIntro('2 · What drives delivery', 'Mix, courses, and concentration', 'Entity colours remain fixed when filters change.')}
    <div class="story-grid">
      <section class="evidence-panel story-support">
        <div class="panel-header"><div><h3>Delivery mix</h3><p>Completed teaching hours</p></div></div>
        <div class="mix-list">
          ${breakdown.map((item) => {
            const pct = totalMixHours ? Math.round((item.hours / totalMixHours) * 100) : 0;
            return `<div class="mix-row"><span><i class="status-dot" style="background:${activityColor(item.type)}"></i>${activityTypeLabel(item.type)}</span><div class="track"><div class="fill" style="width:${pct}%;background:${activityColor(item.type)}"></div></div><strong>${pct}%</strong></div>`;
          }).join('') || '<div class="card-empty">No delivery mix for these filters</div>'}
        </div>
      </section>
      <section class="evidence-panel story-primary">
        <div class="panel-header"><div><h3>Course contribution</h3><p>Top courses by completed teaching hours · long axis labels shorten; hover for the full name</p></div></div>
        <div class="chart-container" id="overview-courses"></div>
      </section>
      <section class="evidence-panel story-primary">
        <div class="panel-header"><div><h3>Instructor workload</h3><p>Top 10 by completed hours</p></div></div>
        <div class="chart-container" id="overview-workload"></div>
      </section>
      <aside class="insight-panel story-support">
        <div class="panel-kicker">Concentration</div>
        <h3>The top five instructors deliver ${concentration}% of completed hours</h3>
        <p>This is a workload concentration signal, not a capacity measure. Contracted availability is not in the source.</p>
        <ul class="insight-list">
          ${workload.slice(0, 5).map((item) => `<li><span>${item.name}</span><strong>${fmt(item.hours, 'hours')}</strong></li>`).join('')}
        </ul>
      </aside>
    </div>

    ${renderSectionIntro('3 · Learner experience', 'Experience remains strong', 'Monthly averages use distinct feedback IDs only.')}
    <div class="story-grid">
      <section class="evidence-panel story-primary">
        <div class="panel-header"><div><h3>Satisfaction over time</h3><p>Average overall rating, with response count in the tooltip</p></div></div>
        <div class="chart-container" id="overview-satisfaction"></div>
      </section>
      <aside class="insight-panel story-support">
        <div class="panel-kicker">Experience summary</div>
        <h3>${fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—'} average satisfaction</h3>
        <p>Based on ${fmt(fm.satDenom, 'int')} distinct rated responses. NPS is ${fm.nps != null ? fmt(fm.nps, 'number') : '—'} from ${fmt(fm.npsDenom, 'int')} responses.</p>
        <ul class="insight-list">
          <li><span>Promoters</span><strong>${fmt(fm.promoters, 'int')}</strong></li>
          <li><span>Passives</span><strong>${fmt(fm.passives, 'int')}</strong></li>
          <li><span>Detractors</span><strong>${fmt(fm.detractors, 'int')}</strong></li>
        </ul>
      </aside>
    </div>
  `;

  const renderPulse = () => {
    const pulse = deliveryPulse(sessions, pulseMetric);
    const target = document.getElementById('overview-pulse');
    if (!pulse.length) { target.innerHTML = renderCardEmpty(); return; }
    renderLineChart(target, {
      categories: pulse.map((item) => item.month),
      series: [
        { name: 'Completed', data: pulse.map((item) => Math.round(item.completed)), color: comp.color, area: true },
        { name: 'Planned', data: pulse.map((item) => Math.round(item.planned)), color: plan.color, dashed: true },
      ],
      yName: pulseMetric === 'hours' ? 'Hours' : pulseMetric === 'groups' ? 'Groups' : 'Sessions',
    });
  };
  renderPulse();
  app.querySelectorAll('#pulse-switch [data-metric]').forEach((button) => button.addEventListener('click', () => {
    pulseMetric = button.dataset.metric;
    app.querySelectorAll('#pulse-switch [data-metric]').forEach((item) => item.classList.toggle('active', item.dataset.metric === pulseMetric));
    renderPulse();
  }));

  if (courses.length) renderBarChart(document.getElementById('overview-courses'), {
    categories: courses.map((course) => course.name),
    series: [{ name: 'Hours', data: courses.map((course) => Math.round(course.hours)), color: colorFor('DIPLOMA') }],
    horizontal: true,
  });
  else document.getElementById('overview-courses').innerHTML = renderCardEmpty();

  if (workload.length) renderBarChart(document.getElementById('overview-workload'), {
    categories: workload.map((item) => item.name).reverse(),
    series: [{ name: 'Hours', data: workload.map((item) => Math.round(item.hours)).reverse(), color: colorFor('EXTERNAL') }],
    horizontal: true,
  });
  else document.getElementById('overview-workload').innerHTML = renderCardEmpty();

  if (sat.length) renderLineChart(document.getElementById('overview-satisfaction'), {
    categories: sat.map((item) => item.month),
    series: [{ name: 'Satisfaction', data: sat.map((item) => Number(item.avg.toFixed(2))), color: colorFor('DIPLOMA'), area: true }],
    showLegend: false,
  });
  else document.getElementById('overview-satisfaction').innerHTML = renderCardEmpty();
}
