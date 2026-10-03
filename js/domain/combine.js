import { dateKeyOf, monthKeyOf } from './dates.js';
import { forecastFromCombined, trendSessions } from './forecast.js';
import { roundDigits } from './round.js';

const UPLOAD_NOTICE = 'Uploaded data could not be loaded — showing historical data only';

export { UPLOAD_NOTICE };

const EMPTY_UPLOAD = {
  instructors: [],
  courses: [],
  groups: [],
  sessions: [],
  feedback: [],
  events: [],
  meta: { lastUpdatedAt: null, importCount: 0 },
};

export function deriveSessionStatus(session, today) {
  if (session.status_clean) return session;
  const date = dateKeyOf(session.session_date);
  const completed = Boolean(date) && date <= today;
  return {
    ...session,
    status_clean: completed ? 'COMPLETED' : 'PLANNED',
    status_basis: 'DERIVED_FROM_DATE',
  };
}

export function mergeDiplomas(baseDiplomas, uploadedSessions) {
  const rows = (baseDiplomas || []).map((row) => ({ ...row }));
  const byType = new Map(rows.map((row) => [row.diploma_type, row]));
  for (const session of uploadedSessions || []) {
    if (session.activity_type !== 'DIPLOMA' || !session.diploma_type) continue;
    let row = byType.get(session.diploma_type);
    const date = dateKeyOf(session.session_date);
    if (!row) {
      row = {
        diploma_id: `DIP_U_${session.diploma_type}`,
        diploma_type: session.diploma_type,
        session_count: 0,
        date_min: date,
        date_max: date,
      };
      rows.push(row);
      byType.set(session.diploma_type, row);
    }
    row.session_count = Number(row.session_count || 0) + 1;
    if (date && (!row.date_min || date < row.date_min)) row.date_min = date;
    if (date && (!row.date_max || date > row.date_max)) row.date_max = date;
  }
  return rows;
}

function distinctIds(rows, predicate) {
  const ids = new Set();
  for (const row of rows) {
    if (predicate && !predicate(row)) continue;
    if (row.feedback_id != null) ids.add(row.feedback_id);
  }
  return ids.size;
}

function statusCounts(sessions) {
  const completed = sessions.filter((session) => session.status_clean === 'COMPLETED');
  const unknown = sessions.filter((session) => session.status_clean === 'UNKNOWN');
  const planned = sessions.filter((session) => session.status_clean === 'PLANNED');
  const hours = (rows) => rows.reduce((sum, row) => sum + (Number(row.duration_hours) || 0), 0);
  return {
    completed_sessions: completed.length,
    unknown_status_sessions: unknown.length,
    planned_sessions: planned.length,
    completed_teaching_hours: hours(completed),
    unknown_status_teaching_hours: hours(unknown),
    planned_teaching_hours: hours(planned),
  };
}

export function recomputeOverview(baseOverview, combined, { hasUploads = false } = {}) {
  const overview = { ...baseOverview };
  const sessions = combined.sessions || [];
  const activities = combined.activities || [];
  const feedback = combined.feedback || [];
  const counts = statusCounts(sessions);
  const distinct = distinctIds(feedback);
  const mapped = distinctIds(feedback, (row) => row.instructor_match_status === 'MAPPED');
  const comments = feedback.filter((row) => String(row.student_comment || '').trim() !== '').length;
  const withStudents = activities.filter((row) => row.num_students != null && row.num_students !== '').length;
  const withHours = sessions.filter((row) => row.duration_hours != null && row.duration_hours !== '').length;
  const trend = trendSessions(sessions);
  const months = trend.map((session) => monthKeyOf(session.session_date)).filter(Boolean).sort();
  const excluded = sessions.filter((session) => (
    session.status_clean !== 'PLANNED'
    && session.session_date
    && session.date_confidence === 'LOW'
  )).length;

  overview.total_sessions = sessions.length;
  Object.assign(overview, counts);
  overview.total_activities = activities.length;
  overview.total_instructors = (combined.instructors || []).length;
  overview.total_courses = (combined.courses || []).length;
  overview.total_feedback = distinct;
  overview.total_feedback_expanded_rows = feedback.length;
  overview.feedback_instructor_match_rate = distinct ? roundDigits((mapped / distinct) * 100, 1) : 0;
  overview.comments_non_empty_count = comments;
  overview.student_count_coverage = {
    activities_with_students: withStudents,
    total_activities: activities.length,
  };
  overview.teaching_hour_coverage = {
    sessions_with_hours: withHours,
    total_sessions: sessions.length,
    pct: sessions.length ? roundDigits((withHours / sessions.length) * 100, 0) : 0,
  };
  if (months.length) overview.clean_series_first_month = months[0];
  overview.forecast_excluded_low_date_confidence = excluded;
  if (hasUploads && combined.asOfDate) overview.as_of_date = combined.asOfDate;
  return overview;
}

function latestDate(rows, fields) {
  let max = '';
  for (const row of rows) {
    for (const field of fields) {
      const date = dateKeyOf(row[field]);
      if (date && date > max) max = date;
    }
  }
  return max;
}

function resolveAsOf(baseAsOf, uploadedSessions) {
  if (!uploadedSessions.length) return baseAsOf;
  const trendDates = trendSessions(uploadedSessions).map((session) => dateKeyOf(session.session_date)).filter(Boolean);
  const latest = trendDates.sort().at(-1) || '';
  if (latest && latest > baseAsOf) return latest;
  return baseAsOf;
}

export function combineDashboard(base, uploaded, { today } = {}) {
  const extra = uploaded || EMPTY_UPLOAD;
  const uploadedSessions = (extra.sessions || []).map((session) => deriveSessionStatus(session, today));
  const sessions = (base.sessions || []).concat(uploadedSessions);
  const activities = (base.activities || []).concat(extra.groups || []);
  const instructors = (base.instructors || []).concat(extra.instructors || []);
  const courses = (base.courses || []).concat(extra.courses || []);
  const feedback = (base.feedback || []).concat(extra.feedback || []);
  const events = (base.events || []).concat(extra.events || []);
  const diplomas = mergeDiplomas(base.diplomas, uploadedSessions);
  const hasUploads = Boolean(
    (extra.instructors || []).length
    || (extra.courses || []).length
    || (extra.groups || []).length
    || (extra.sessions || []).length
    || (extra.feedback || []).length
    || (extra.events || []).length,
  );
  const baseAsOf = base.forecast?.as_of_date || base.overview?.as_of_date;
  const asOfDate = resolveAsOf(baseAsOf, uploadedSessions);
  const forecast = forecastFromCombined({
    baseForecast: base.forecast,
    baseSessions: base.sessions || [],
    sessions,
    uploadedSessions,
    asOfDate,
  });
  const overview = recomputeOverview(base.overview, {
    sessions,
    activities,
    feedback,
    instructors,
    courses,
    asOfDate,
  }, { hasUploads });
  return {
    overview,
    activities,
    sessions,
    instructors,
    courses,
    feedback,
    events,
    diplomas,
    forecast,
  };
}

export function uploadArrays(payload) {
  return {
    instructors: payload?.instructors || [],
    courses: payload?.courses || [],
    groups: payload?.groups || [],
    sessions: payload?.sessions || [],
    feedback: payload?.feedback || [],
    events: payload?.events || [],
    meta: payload?.meta || { lastUpdatedAt: null, importCount: 0 },
  };
}
