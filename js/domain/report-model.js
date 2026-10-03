/**
 * Pure report assembly. Chart specs and metrics come from the same builders the pages render.
 * No DOM. Arabic script is omitted from cell text; instructor names use instructor_name_clean.
 */
import { describeAppliedFilters, withFilters } from '../filters.js';
import {
  filterSessions, filterActivities, filterFeedback,
  sessionMetrics, completedGroups, plannedGroups, feedbackMetrics,
  activityTypeBreakdown, topCourses, instructorWorkload, satisfactionTrend,
  ratingDistribution, groupRowMetrics, fmt,
} from '../metrics.js';
import { activityTypeLabel } from '../format.js';
import { dedupeFeedback } from '../indexes.js';
import { computeThemes, computeWordFrequencies, filterValidComments } from '../text-insights.js';
import { dataQualityNotes } from './data-notes.js';
import {
  recentDirection, overviewPulseMetric, overviewPulseSpec, overviewCourseSpec,
  overviewWorkloadSpec, overviewSatisfactionSpec,
} from '../pages/overview.js';
import { groupStatusSummary, groupsMonthlySpec } from '../pages/groups.js';
import {
  buildInstructorRows, sortInstructorRows, instructorChartSpecs,
} from '../pages/instructors.js';
import {
  feedbackChartSpecs, feedbackComparisonMode, VALIDATED_TOP_TOKENS,
} from '../pages/feedback.js';
import {
  programPortfolio, programChartSpecs, diplomaChartSpec, eventChartSpec, selectedProgramCourseId,
} from '../pages/programs.js';
import { forecastCapacity, forecastChartSpec, forecastViewState } from '../pages/forecast.js';

export const APPENDIX_ROW_LIMIT = 300;

export const SECTION_ORDER = ['overview', 'groups', 'instructors', 'feedback', 'programs', 'forecast'];

const ARABIC = /[\u0600-\u06FF]/;
const EXTRA = new Set(['—', '–', '’', '‘', '“', '”', '…', '•']);

/** Characters the embedded Latin font can draw. Arabic script is omitted. */
export function pdfText(value) {
  if (value == null || value === '') return '—';
  const raw = String(value);
  if (ARABIC.test(raw)) {
    const latin = [...raw].filter((ch) => !ARABIC.test(ch)).join('').replace(/\s+/g, ' ').trim();
    if (/[A-Za-z0-9]/.test(latin)) return pdfText(latin);
    return '(Arabic text omitted)';
  }
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) {
      out += ' ';
      continue;
    }
    if ((code >= 32 && code <= 255) || EXTRA.has(ch)) out += ch;
  }
  const cleaned = out.replace(/\s+/g, ' ').trim();
  return cleaned || '—';
}

export function formatReportStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return {
    generatedAt: `${y}-${m}-${d} ${hh}:${mm} ${timeZone} (${offset})`,
    timezone: `${timeZone} (${offset})`,
    filename: `SAS-Academy-Report-${y}-${m}-${d}-${hh}${mm}.pdf`,
  };
}

function metric(label, value, sub = '') {
  return { label, value: pdfText(value), sub: sub ? pdfText(sub) : '' };
}

function chart(id, title, caption, kind, spec) {
  if (!spec) return null;
  return { id, title, caption, kind, spec };
}

function table(id, title, head, body) {
  const rows = body.map((row) => row.map((cell) => pdfText(cell)));
  return {
    id,
    title,
    head,
    body: rows,
    appendix: rows.length > APPENDIX_ROW_LIMIT,
  };
}

function dataUpdatedLabel(meta) {
  if (!meta?.lastUpdatedAt) return 'Historical data only — no uploads';
  const then = new Date(meta.lastUpdatedAt);
  if (Number.isNaN(then.getTime())) return 'Historical data only — no uploads';
  return then.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function overviewSection(data, idx) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const sm = sessionMetrics(sessions);
  const fm = feedbackMetrics(feedback);
  const deliveredGroups = completedGroups(activities);
  const upcomingGroups = plannedGroups(activities);
  const trendDirection = recentDirection(sessions);
  const rosterActive = data.instructors.filter((instructor) => instructor.status === 'Active').length;
  const breakdown = activityTypeBreakdown(sessions).sort((a, b) => b.hours - a.hours);
  const totalMixHours = breakdown.reduce((sum, item) => sum + item.hours, 0);
  const workload = instructorWorkload(sessions, idx.instructorMap, 10);
  const topFiveHours = workload.slice(0, 5).reduce((sum, item) => sum + item.hours, 0);
  const concentration = sm.completedHours ? ((topFiveHours / sm.completedHours) * 100).toFixed(1) : '0.0';
  const courses = topCourses(sessions, idx.courseMap, 6);
  const sat = satisfactionTrend(feedback);
  const pulseMetric = overviewPulseMetric();
  return {
    id: 'overview',
    title: 'Overview',
    headline: `${fmt(sm.completedCount, 'int')} sessions delivered across ${fmt(deliveredGroups, 'int')} completed groups`,
    summary: `The academy has delivered ${fmt(sm.completedHours, 'hours')} of completed teaching. Learners rate the experience ${fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—'} out of 5, while ${fmt(sm.plannedCount, 'int')} sessions are already in the forward plan.`,
    metrics: [
      metric('Completed hours', fmt(sm.completedHours, 'hours')),
      metric('Recent direction', trendDirection.label, trendDirection.detail),
      metric('Satisfaction', fm.avgSatisfaction != null ? fmt(fm.avgSatisfaction, 'rating') : '—', fm.satDenom ? `n=${fmt(fm.satDenom, 'int')}` : 'N/A'),
      metric('NPS', fm.nps != null ? fmt(fm.nps, 'number') : '—', fm.npsDenom ? `n=${fmt(fm.npsDenom, 'int')}` : 'N/A'),
    ],
    notes: [
      `${fmt(upcomingGroups, 'int')} groups are in the plan.`,
      `Planned sessions ${fmt(sm.plannedCount, 'int')}; planned hours ${fmt(sm.plannedHours, 'hours')}; active roster ${fmt(rosterActive, 'int')} instructors.`,
      `The top five instructors deliver ${concentration}% of completed hours.`,
    ],
    charts: [
      chart('overview-pulse', 'Completed delivery and committed work', 'HIGH-confidence history from Mar 2024; planned work is dashed.', 'line', overviewPulseSpec(sessions, pulseMetric)),
      chart('overview-courses', 'Course contribution', 'Top courses by completed teaching hours.', 'bar', overviewCourseSpec(courses)),
      chart('overview-workload', 'Instructor workload', 'Top 10 by completed hours. Names are English instructor_name_clean.', 'bar', overviewWorkloadSpec(workload)),
      chart('overview-satisfaction', 'Satisfaction over time', 'Average overall rating from distinct feedback.', 'line', overviewSatisfactionSpec(sat)),
    ].filter(Boolean),
    tables: [
      table(
        'overview-mix',
        'Delivery mix',
        ['Type', 'Hours', 'Share'],
        breakdown.map((item) => {
          const pct = totalMixHours ? Math.round((item.hours / totalMixHours) * 100) : 0;
          return [activityTypeLabel(item.type), fmt(item.hours, 'hours'), `${pct}%`];
        }),
      ),
      table(
        'overview-concentration',
        'Top five instructors by completed hours',
        ['Instructor', 'Hours'],
        workload.slice(0, 5).map((item) => [item.name, fmt(item.hours, 'hours')]),
      ),
    ],
    kpis: {
      completedSessions: sm.completedCount,
      plannedSessions: sm.plannedCount,
      completedHours: sm.completedHours,
      distinctFeedback: fm.distinctCount,
    },
  };
}

function groupsSection(data, idx) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const codes = [...new Set(activities.map((activity) => activity.group_code).filter(Boolean))];
  const summary = groupStatusSummary(codes, activities);
  const rows = codes.map((code) => groupRowMetrics(code, idx, sessions, activities, feedback));
  rows.sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
  return {
    id: 'groups',
    title: 'Groups',
    headline: `${fmt(summary.completed, 'int')} groups are completed; ${fmt(summary.planned, 'int')} are upcoming`,
    summary: `${fmt(codes.length, 'int')} group codes are in scope. Status remains explicit: ${fmt(summary.unknown, 'int')} cannot be confidently classified from the source.`,
    metrics: [
      metric('Completed', fmt(summary.completed, 'int')),
      metric('Upcoming', fmt(summary.planned, 'int'), 'Planned status'),
      metric('Internal', fmt(summary.internal, 'int')),
      metric('External', fmt(summary.external, 'int')),
    ],
    notes: [`${fmt(summary.unknown, 'int')} group codes have unknown status.`],
    charts: [
      chart('groups-monthly', 'Groups by month and status', 'A group can appear in more than one month when delivery spans months.', 'bar', groupsMonthlySpec(sessions)),
    ].filter(Boolean),
    tables: [
      table(
        'groups-register',
        'Group register',
        ['Group', 'Course', 'Lead instructors', 'Start', 'End', 'Sessions', 'Hours', 'Status'],
        rows.map((row) => [
          row.groupCode,
          row.course || '—',
          row.instructors.join(', ') || '—',
          fmt(row.start, 'date'),
          fmt(row.end, 'date'),
          fmt(row.sessionMetrics.completedCount, 'int'),
          fmt(row.sessionMetrics.completedHours, 'int'),
          row.status || '—',
        ]),
      ),
    ],
  };
}

function instructorsSection(data, idx) {
  const sessions = filterSessions(data.sessions);
  const activities = filterActivities(data.activities);
  const feedback = filterFeedback(data.feedback);
  const rows = buildInstructorRows(data, idx, sessions, activities, feedback);
  sortInstructorRows(rows, 'hours', 'desc');
  const ranked = instructorChartSpecs(rows, { topN: 5, minFeedback: 10 });
  const totalHours = sessionMetrics(sessions).completedHours;
  const topFiveShare = totalHours
    ? (ranked.byHours.slice(0, 5).reduce((sum, row) => sum + row.sessionMetrics.completedHours, 0) / totalHours * 100).toFixed(1)
    : '0.0';
  const activeCount = rows.filter((row) => row.status === 'Active').length;
  const lead = ranked.byHours[0];
  return {
    id: 'instructors',
    title: 'Instructors',
    headline: `${lead?.name || 'No instructor'} leads delivery with ${fmt(lead?.sessionMetrics.completedHours, 'hours')}`,
    summary: `${fmt(activeCount, 'int')} of ${fmt(rows.length, 'int')} instructors are active on the roster. The top five account for ${topFiveShare}% of completed teaching hours, a workload concentration signal rather than observed capacity.`,
    metrics: [
      metric('Instructors', fmt(rows.length, 'int')),
      metric('Active roster', fmt(activeCount, 'int')),
      metric('Top-five share', `${topFiveShare}%`),
      metric('Rating threshold', 'n≥10', 'Applied to every rating rank'),
    ],
    notes: ['Rankings use the page default of Top 5 and a minimum of 10 distinct responses. Names are English instructor_name_clean.'],
    charts: [
      chart('rank-hours', 'Completed teaching hours', 'Volume leaders under the current filters.', 'bar', ranked.charts.hours),
      chart('rank-breadth', 'Widest course range', 'Distinct courses with completed delivery.', 'bar', ranked.charts.breadth),
      chart('rank-rating', 'Highest learner rating', 'Minimum 10 distinct responses; label shows n.', 'bar', ranked.charts.rating),
      chart('rank-upcoming', 'Upcoming workload', 'Planned teaching hours only.', 'bar', ranked.charts.upcoming),
    ].filter(Boolean),
    tables: [
      table(
        'instructors-roster',
        'Instructor roster',
        ['Instructor', 'Status', 'Groups', 'Hours', 'Courses', 'Rating', 'Responses', 'Upcoming'],
        rows.map((row) => [
          row.name,
          row.status,
          fmt(row.completedGroups, 'int'),
          fmt(row.sessionMetrics.completedHours, 'int'),
          fmt(row.courses, 'int'),
          row.feedback.avgSatisfaction != null ? fmt(row.feedback.avgSatisfaction, 'rating') : '—',
          fmt(row.feedback.distinctCount, 'int'),
          fmt(row.sessionMetrics.plannedCount, 'int'),
        ]),
      ),
    ],
  };
}

function feedbackSection(data, idx) {
  const feedback = filterFeedback(data.feedback);
  const metrics = feedbackMetrics(feedback);
  const distinct = dedupeFeedback(feedback);
  const distribution = ratingDistribution(feedback);
  const themes = distinct.length ? computeThemes(feedback) : { themes: [], unclassified: 0, classified: 0, total: 0, coveragePct: 0 };
  const words = distinct.length ? computeWordFrequencies(feedback, { topN: 12 }) : { unigrams: [], afterJunkFilter: 0, arabicPct: 0 };
  const isFullCorpus = metrics.distinctCount === data.overview?.total_feedback;
  const topTokens = isFullCorpus ? VALIDATED_TOP_TOKENS : words.unigrams.map((item) => [item.word, item.count]);
  const mode = feedbackComparisonMode();
  const specs = distinct.length ? feedbackChartSpecs(feedback, idx, mode) : { charts: {} };
  const comments = filterValidComments(dedupeFeedback(feedback))
    .slice()
    .sort((a, b) => String(a.feedback_id).localeCompare(String(b.feedback_id)));
  return {
    id: 'feedback',
    title: 'Feedback',
    headline: `Learners rate the academy ${metrics.avgSatisfaction != null ? fmt(metrics.avgSatisfaction, 'rating') : '—'} out of 5`,
    summary: distinct.length
      ? `The result comes from ${fmt(metrics.satDenom, 'int')} distinct rated responses. NPS is ${metrics.nps != null ? fmt(metrics.nps, 'number') : '—'}; qualitative evidence is explored separately without sentiment or AI claims.`
      : 'No feedback matches these filters.',
    metrics: [
      metric('Distinct responses', fmt(metrics.distinctCount, 'int'), 'COUNT(DISTINCT feedback_id)'),
      metric('Satisfaction', metrics.avgSatisfaction != null ? fmt(metrics.avgSatisfaction, 'rating') : '—', `n=${fmt(metrics.satDenom, 'int')}`),
      metric('NPS', metrics.nps != null ? fmt(metrics.nps, 'number') : '—', `n=${fmt(metrics.npsDenom, 'int')}`),
      metric('Substantive comments', fmt(words.afterJunkFilter, 'int'), `${words.arabicPct || 0}% contain Arabic`),
    ],
    notes: [
      `Comparison uses ${mode === 'course' ? 'courses' : 'instructors'} (the feedback page default is courses).`,
      'Comments that contain Arabic script are omitted from the PDF. They remain in the dashboard explorer.',
    ],
    charts: [
      chart('feedback-trend', 'Satisfaction trend', 'Monthly average overall rating.', 'line', specs.charts.trend),
      chart('feedback-comparison', mode === 'course' ? 'Course comparison' : 'Instructor comparison', 'Average rating; minimum 10 distinct rated responses.', 'bar', specs.charts.comparison),
      chart('feedback-questions', 'Six experience dimensions', 'Average 1–5 score from distinct responses.', 'diverging', specs.charts.questions),
    ].filter(Boolean),
    tables: [
      table('feedback-distribution', 'Rating distribution', ['Rating', 'Responses'], distribution.map((item) => [`${item.rating} / 5`, fmt(item.count, 'int')])),
      table('feedback-themes', 'Keyword-matched themes', ['Theme', 'Comments'], [
        ...themes.themes.map((item) => [item.theme, fmt(item.count, 'int')]),
        ['Unclassified', fmt(themes.unclassified, 'int')],
      ]),
      table('feedback-tokens', 'Top tokens', ['Token', 'Count'], topTokens.map(([word, count]) => [word, fmt(count, 'int')])),
      table(
        'feedback-comments',
        'Substantive comments',
        ['Feedback ID', 'Date', 'Instructor', 'Course', 'Comment'],
        comments.map((row) => [
          row.feedback_id,
          fmt(row.feedback_date, 'date'),
          row.instructor_name_clean || '—',
          row.course_name_clean || '—',
          row.student_comment,
        ]),
      ),
    ],
  };
}

function programsSection(data) {
  const portfolio = programPortfolio(data);
  const { courseRows, externalRows } = portfolio;
  const specs = programChartSpecs(portfolio, selectedProgramCourseId());
  const lead = courseRows[0];
  const selected = specs.selected;
  const totalSessions = externalRows.reduce((sum, row) => sum + row.metrics.completedCount, 0);
  const totalHours = externalRows.reduce((sum, row) => sum + row.metrics.completedHours, 0);
  const diplomas = data.diplomas || [];
  const events = data.events || [];
  const diplomaSessions = diplomas.reduce((sum, row) => sum + Number(row.session_count || 0), 0);
  const diplomaLead = [...diplomas].sort((a, b) => Number(b.session_count || 0) - Number(a.session_count || 0))[0];
  const participants = events.reduce((sum, row) => sum + Number(row.participant_count || 0), 0);
  const eventLead = [...events].sort((a, b) => Number(b.participant_count || 0) - Number(a.participant_count || 0))[0];
  return {
    id: 'programs',
    title: 'Programs',
    headline: `${lead?.course.course_name_clean || 'No course'} contributes the most teaching volume`,
    summary: `${fmt(lead?.metrics.completedHours, 'hours')} across ${fmt(lead?.metrics.completedCount, 'int')} completed sessions. The demand chart follows ${selected?.course.course_name_clean || 'the lead course'}. External delivery, diplomas, and events are included in full.`,
    metrics: [
      metric('Courses delivered', fmt(courseRows.length, 'int')),
      metric('Lead course hours', fmt(lead?.metrics.completedHours, 'hours')),
      metric('External codes', fmt(externalRows.length, 'int')),
      metric('Diploma sessions', fmt(diplomaSessions, 'int')),
      metric('Events', fmt(events.length, 'int')),
      metric('Event participants', fmt(participants, 'int')),
    ],
    notes: [
      'Clients means external group codes. No client or organisation field exists.',
      `${diplomaLead?.diploma_type || 'No diploma'} is the largest recorded diploma programme (${fmt(diplomaLead?.session_count, 'int')} sessions).`,
      `${eventLead?.event_name || 'No event'} has the largest recorded participant count.`,
      `External codes account for ${fmt(totalSessions, 'int')} completed sessions and ${fmt(totalHours, 'hours')}.`,
    ],
    charts: [
      chart('program-course-hours', 'Teaching hours by course', 'Top eight delivered courses.', 'bar', specs.hours),
      chart('program-course-demand', 'Selected course demand over time', selected?.course.course_name_clean || 'Selected course', 'line', specs.demand),
      chart('program-clients', 'Largest external delivery codes', 'Completed sessions by code.', 'bar', specs.clients),
      chart('program-diplomas', 'Sessions by diploma programme', 'Diploma summary source.', 'bar', diplomaChartSpec(diplomas)),
      chart('program-events', 'Participants by event', 'Yellow event colour with direct labels.', 'bar', eventChartSpec(events)),
    ].filter(Boolean),
    tables: [
      table(
        'programs-courses',
        'Course catalog',
        ['Course', 'Groups', 'Sessions', 'Hours', 'Instructors', 'Rating', 'Responses'],
        courseRows.map((row) => [
          row.course.course_name_clean,
          fmt(row.groups, 'int'),
          fmt(row.metrics.completedCount, 'int'),
          fmt(row.metrics.completedHours, 'int'),
          fmt(row.instructors, 'int'),
          row.learner.avgSatisfaction != null ? fmt(row.learner.avgSatisfaction, 'rating') : '—',
          fmt(row.learner.satDenom, 'int'),
        ]),
      ),
      table(
        'programs-clients',
        'External group-code register',
        ['External group code', 'Course', 'Sessions', 'Hours', 'Status'],
        externalRows.map((row) => [
          row.code,
          row.activity?.course_name_clean || '—',
          fmt(row.metrics.completedCount, 'int'),
          fmt(row.metrics.completedHours, 'int'),
          row.activity?.status_clean || '—',
        ]),
      ),
      table(
        'programs-diplomas',
        'Diploma programmes',
        ['Programme', 'Sessions', 'From', 'To'],
        diplomas.map((row) => [row.diploma_type, fmt(row.session_count, 'int'), fmt(row.date_min, 'date'), fmt(row.date_max, 'date')]),
      ),
      table(
        'programs-events',
        'Events',
        ['Event', 'Type', 'Start', 'End', 'Participants'],
        events.map((row) => [
          row.event_name,
          activityTypeLabel(row.event_type),
          fmt(row.event_date_start, 'date'),
          fmt(row.event_date_end, 'date'),
          row.participant_count != null ? fmt(row.participant_count, 'int') : '—',
        ]),
      ),
    ],
  };
}

function forecastSection(data) {
  const view = forecastViewState();
  const forecast = data.forecast;
  const activeCount = data.instructors.filter((instructor) => instructor.status === 'Active').length;
  const capacity = forecastCapacity({
    forecast,
    activeCount,
    hoursPerInstructor: view.hoursPerInstructor,
    horizon: view.horizon,
  });
  const gapLabel = capacity.gap > 0 ? `${fmt(capacity.gap, 'hours')} shortfall` : `${fmt(Math.abs(capacity.gap), 'hours')} surplus`;
  const chartSpec = forecastChartSpec(forecast, view.metric, view.horizon);
  const selected = chartSpec.selectedForecast;
  const total = selected.point.reduce((sum, value) => sum + value, 0);
  return {
    id: 'forecast',
    title: 'Forecast & Capacity',
    headline: `${fmt(capacity.demand, 'hours')} of expected demand requires ${fmt(capacity.required, 'number')} instructor equivalents`,
    summary: `Under the explicit assumption of ${fmt(view.hoursPerInstructor, 'int')} available teaching hours per active instructor per month, the ${capacity.months}-month scenario shows a ${gapLabel}. This is planning evidence, not observed availability.`,
    metrics: [
      metric('Expected demand', fmt(capacity.demand, 'hours'), `${capacity.months}-month teaching-hours forecast`),
      metric('Required equivalents', fmt(capacity.required, 'number'), 'Assumption-based'),
      metric('Assumed capacity', fmt(capacity.available, 'hours'), `${activeCount} active instructors`),
      metric('Gap', gapLabel, 'Scenario result'),
    ],
    notes: [
      forecast.limitations,
      `Chart metric: ${view.metric.replaceAll('_', ' ')}; horizon: ${view.horizon.replaceAll('_', ' ')}.`,
      `Point forecast total ${fmt(total, 'number')} over ${selected.periods.length} periods.`,
      'The forecast page does not apply global filters; this section uses the same precomputed series.',
    ],
    charts: [
      chart('forecast-chart', 'Actual, fitted, and forecast', forecast.method, 'forecast', chartSpec),
    ].filter(Boolean),
    tables: [
      table('forecast-reconciliation', 'Capacity reconciliation', ['Measure', 'Value'], [
        ['Forecast demand', fmt(capacity.demand, 'hours')],
        ['Cross-check', fmt(capacity.crossCheck, 'hours')],
        ['Group starts / month', fmt(capacity.baselines.avg_group_starts_per_month, 'number')],
        ['Scenario gap', gapLabel],
        ['Observed months', fmt(forecast.observation_count, 'int')],
      ]),
    ],
  };
}

function assemble(data, idx, { scope, stamp }) {
  const overview = overviewSection(data, idx);
  const filterLabels = describeAppliedFilters(scope === 'full' ? {} : undefined, idx);
  const sections = [
    overview,
    groupsSection(data, idx),
    instructorsSection(data, idx),
    feedbackSection(data, idx),
    programsSection(data),
    forecastSection(data),
  ];
  return {
    title: 'SAS Academy Analytics Report',
    generatedAt: stamp.generatedAt,
    timezone: stamp.timezone,
    filename: stamp.filename,
    cover: {
      dataUpdated: dataUpdatedLabel(data.meta),
      historicalAsOf: data.overview?.historical_as_of_date || data.overview?.as_of_date || '—',
      scope,
      scopeLabel: scope === 'full' ? 'Full dataset (all filters cleared)' : 'Current filters',
      filters: filterLabels.length ? filterLabels : ['No filters applied'],
    },
    kpis: overview.kpis,
    sections,
    dataNotes: dataQualityNotes(data.overview, idx),
  };
}

export function buildReport({ data, idx, scope = 'full', filters = null, generatedAt = new Date() } = {}) {
  const stamp = formatReportStamp(generatedAt);
  const applied = scope === 'full' ? {} : { ...(filters || {}) };
  return withFilters(applied, () => assemble(data, idx, { scope, stamp }));
}
