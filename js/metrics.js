import { applyFilters } from './filters.js';
import {
  fmt, fmtAvg, isHistoricalSession, isCompletedSession, isPlannedSession, monthKey,
} from './format.js';
import { distinctFeedbackIds, dedupeFeedback } from './indexes.js';

export function filterSessions(sessions, dataset = 'sessions') {
  return applyFilters(sessions, dataset);
}

export function filterActivities(activities) {
  return applyFilters(activities, 'activities');
}

export function filterFeedback(feedback) {
  return applyFilters(feedback, 'feedback');
}

export function countDistinctFeedback(rows) {
  return distinctFeedbackIds(rows).size;
}

export function sessionMetrics(sessions) {
  const completed = sessions.filter(isCompletedSession);
  const planned = sessions.filter(isPlannedSession);
  const historical = sessions.filter(isHistoricalSession);
  return {
    total: sessions.length,
    completedCount: completed.length,
    plannedCount: planned.length,
    unknownCount: sessions.filter((s) => s.status_clean === 'UNKNOWN').length,
    completedHours: completed.reduce((s, r) => s + (r.duration_hours || 0), 0),
    plannedHours: planned.reduce((s, r) => s + (r.duration_hours || 0), 0),
    historical,
    completed,
    planned,
  };
}

export function completedGroups(activities) {
  const groups = new Set();
  for (const a of activities) {
    if (a.status_clean === 'COMPLETED') groups.add(a.group_code);
  }
  return groups.size;
}

export function plannedGroups(activities) {
  const groups = new Set();
  for (const a of activities) {
    if (a.status_clean === 'PLANNED') groups.add(a.group_code);
  }
  return groups.size;
}

export function feedbackMetrics(rows) {
  const distinct = dedupeFeedback(rows);
  // overall_satisfaction is a Likert LABEL ("Very satisfied"); overall_rating is its
  // 1-5 numeric companion. Averaging the label yields NaN.
  const withSat = distinct.filter(
    (r) => r.overall_rating != null && !Number.isNaN(Number(r.overall_rating)),
  );
  const satSum = withSat.reduce((s, r) => s + Number(r.overall_rating), 0);
  const withNps = distinct.filter((r) => r.recommendation_score != null);
  const promoters = withNps.filter((r) => r.nps_category === 'promoter').length;
  const detractors = withNps.filter((r) => r.nps_category === 'detractor').length;
  const nps = withNps.length ? ((promoters - detractors) / withNps.length) * 100 : null;
  return {
    distinctCount: distinct.length,
    avgSatisfaction: withSat.length ? satSum / withSat.length : null,
    satDenom: withSat.length,
    nps,
    npsDenom: withNps.length,
    promoters,
    detractors,
    passives: withNps.length - promoters - detractors,
    distinct,
  };
}

export function avgRating(rows, field = 'overall_rating') {
  const distinct = dedupeFeedback(rows);
  const valid = distinct.filter((r) => r[field] != null && !Number.isNaN(Number(r[field])));
  if (!valid.length) return { avg: null, count: 0 };
  const sum = valid.reduce((s, r) => s + Number(r[field]), 0);
  return { avg: sum / valid.length, count: valid.length };
}

export function studentMetrics(activities, overview) {
  const withStudents = activities.filter((a) => a.num_students != null && a.num_students > 0);
  const total = withStudents.reduce((s, a) => s + Number(a.num_students), 0);
  const cov = overview?.student_count_coverage || {};
  return {
    total,
    activitiesWith: withStudents.length,
    totalActivities: cov.total_activities || activities.length,
    coveragePct: cov.total_activities
      ? Math.round((cov.activities_with_students / cov.total_activities) * 100)
      : 0,
  };
}

export function monthlySeries(sessions, field = 'count') {
  const hist = sessions.filter(isHistoricalSession);
  const months = new Map();
  for (const s of hist) {
    const m = monthKey(s.session_date);
    if (!m) continue;
    if (!months.has(m)) months.set(m, { completed: 0, planned: 0, hours: 0 });
    const bucket = months.get(m);
    if (s.status_clean === 'COMPLETED') {
      bucket.completed += 1;
      bucket.hours += s.duration_hours || 0;
    }
  }
  const planned = sessions.filter(isPlannedSession);
  for (const s of planned) {
    const m = monthKey(s.session_date);
    if (!m) continue;
    if (!months.has(m)) months.set(m, { completed: 0, planned: 0, hours: 0 });
    months.get(m).planned += 1;
  }
  const sorted = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([month, v]) => ({ month, ...v }));
}

export function activityTypeBreakdown(sessions) {
  const hist = sessions.filter((s) => s.status_clean === 'COMPLETED');
  const map = new Map();
  for (const s of hist) {
    const t = s.activity_type || 'UNKNOWN';
    if (!map.has(t)) map.set(t, { sessions: 0, hours: 0 });
    const b = map.get(t);
    b.sessions += 1;
    b.hours += s.duration_hours || 0;
  }
  return [...map.entries()].map(([type, v]) => ({ type, ...v }));
}

export function topCourses(sessions, courseMap, n = 8) {
  const hist = sessions.filter(isCompletedSession);
  const map = new Map();
  const sessionNames = new Map();
  for (const s of hist) {
    if (!s.course_id) continue;
    if (s.course_name_clean && !sessionNames.has(s.course_id)) {
      sessionNames.set(s.course_id, s.course_name_clean);
    }
    if (!map.has(s.course_id)) map.set(s.course_id, { hours: 0, sessions: 0 });
    const b = map.get(s.course_id);
    b.hours += s.duration_hours || 0;
    b.sessions += 1;
  }
  return [...map.entries()]
    .map(([id, v]) => ({
      course_id: id,
      name: courseMap.get(id)?.course_name_clean || sessionNames.get(id) || 'Unknown Course',
      ...v,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, n);
}

export function instructorWorkload(sessions, instructorMap, n = 10) {
  const hist = sessions.filter(isCompletedSession);
  const map = new Map();
  for (const s of hist) {
    if (!s.instructor_id) continue;
    if (!map.has(s.instructor_id)) map.set(s.instructor_id, 0);
    map.set(s.instructor_id, map.get(s.instructor_id) + (s.duration_hours || 0));
  }
  return [...map.entries()]
    .map(([id, hours]) => ({
      instructor_id: id,
      name: instructorMap.get(id)?.instructor_name_clean || id,
      hours,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, n);
}

export function satisfactionTrend(feedback) {
  const distinct = dedupeFeedback(feedback).filter(
    (r) => r.feedback_date && r.overall_rating != null && !Number.isNaN(Number(r.overall_rating)),
  );
  const months = new Map();
  for (const r of distinct) {
    const m = monthKey(r.feedback_date);
    if (!m || m < '2024-03') continue;
    if (!months.has(m)) months.set(m, { sum: 0, count: 0 });
    const b = months.get(m);
    b.sum += Number(r.overall_rating);
    b.count += 1;
  }
  return [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, avg: v.sum / v.count, count: v.count }));
}

export function ratingDistribution(feedback, field = 'overall_rating') {
  const distinct = dedupeFeedback(feedback);
  const buckets = new Map();
  for (const r of distinct) {
    const v = r[field];
    if (v == null || Number.isNaN(Number(v))) continue;
    const key = Math.round(Number(v));
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([rating, count]) => ({ rating, count }));
}

export function npsDistribution(feedback) {
  const distinct = dedupeFeedback(feedback);
  const cats = { promoter: 0, passive: 0, detractor: 0 };
  for (const r of distinct) {
    if (r.nps_category && cats[r.nps_category] !== undefined) cats[r.nps_category] += 1;
  }
  return cats;
}

export function perQuestionBreakdown(feedback) {
  const distinct = dedupeFeedback(feedback);
  const fields = [
    ['E-Learning', 'rating_elearning_score'],
    ['Guided Activities', 'rating_guided_score'],
    ['Project', 'rating_project_score'],
    ['Skill Knowledge', 'rating_knowledge_score'],
    ['Leadership', 'rating_leadership_score'],
    ['Soft Skills', 'rating_soft_skills_score'],
  ];
  return fields.map(([label, field]) => {
    const valid = distinct.filter(
      (r) => r[field] != null && !Number.isNaN(Number(r[field])) && Number(r[field]) >= 1,
    );
    const sum = valid.reduce((s, r) => s + Number(r[field]), 0);
    return { label, avg: valid.length ? sum / valid.length : null, count: valid.length };
  });
}

export function groupRowMetrics(groupCode, idx, filteredSessions, filteredActivities, filteredFeedback) {
  const acts = filteredActivities.filter((a) => a.group_code === groupCode);
  const sess = filteredSessions.filter((s) => s.group_code === groupCode);
  const sm = sessionMetrics(sess);
  const fb = filteredFeedback.filter((f) => f.group_match_status === 'MAPPED' && f.group_code_clean === groupCode);
  const fm = feedbackMetrics(fb);
  const students = acts.filter((a) => a.num_students != null);
  const studentSum = students.reduce((s, a) => s + Number(a.num_students), 0);
  const instructors = [...new Set(acts.map((a) => a.instructor_name_clean).filter(Boolean))];
  const dates = sess.map((s) => s.session_date).filter(Boolean).sort();
  return {
    groupCode,
    activities: acts,
    sessions: sess,
    type: acts[0]?.activity_type,
    degree: acts[0]?.degree,
    course: acts[0]?.course_name_clean,
    instructors,
    start: dates[0] || acts[0]?.expected_end_date,
    end: dates[dates.length - 1] || acts[0]?.last_lecture_date,
    sessionMetrics: sm,
    feedback: fm,
    students: students.length ? studentSum : null,
    studentCoverage: students.length,
    status: acts[0]?.status_clean,
  };
}

export function instructorRowMetrics(instructorId, idx, filteredSessions, filteredActivities, filteredFeedback) {
  const sess = filteredSessions.filter((s) => s.instructor_id === instructorId);
  const sm = sessionMetrics(sess);
  const acts = filteredActivities.filter((a) => a.instructor_id === instructorId);
  const groups = new Set(acts.map((a) => a.group_code));
  const completedGroups = new Set(acts.filter((a) => a.status_clean === 'COMPLETED').map((a) => a.group_code));
  const plannedGroups = new Set(acts.filter((a) => a.status_clean === 'PLANNED').map((a) => a.group_code));
  const courses = new Set(sess.map((s) => s.course_id).filter(Boolean));
  const fb = filteredFeedback.filter((f) => f.instructor_id === instructorId);
  const fm = feedbackMetrics(fb);
  const students = acts.filter((a) => a.num_students != null);
  const ins = idx.instructorMap.get(instructorId);
  return {
    instructorId,
    instructor: ins,
    sessions: sess,
    activities: acts,
    groups: groups.size,
    completedGroups: completedGroups.size,
    plannedGroups: plannedGroups.size,
    courses: courses.size,
    sessionMetrics: sm,
    feedback: fm,
    students: students.length ? students.reduce((s, a) => s + Number(a.num_students), 0) : null,
    studentActivities: students.length,
  };
}

export { fmt, fmtAvg };
