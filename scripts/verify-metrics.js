#!/usr/bin/env node
/**
 * Headless KPI and filter verification for dashboard gates.
 * Run: node dashboard/scripts/verify-metrics.js
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dir, '..', 'data');

const load = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

const overview = load('overview.json');
const sessions = load('sessions.json');
const activities = load('activities.json');
const feedback = load('feedback.json');

const MONTH_START = '2024-03';

function applyFilters(records, f, dataset = 'sessions') {
  return records.filter((r) => {
    if (f.activityType && r.activity_type !== f.activityType) return false;
    if (f.groupCode && r.group_code !== f.groupCode && r.group_code_clean !== f.groupCode) return false;
    if (f.courseId && r.course_id !== f.courseId) return false;
    if (f.instructorId && r.instructor_id !== f.instructorId) return false;
    if (f.language && r.language !== f.language) return false;
    if (f.status && r.status_clean !== f.status) return false;
    if (f.dateFrom || f.dateTo) {
      const dateField = dataset === 'feedback' ? 'feedback_date' : 'session_date';
      const d = (r[dateField] || '').slice(0, 10);
      if (!d) return false;
      if (f.dateFrom && d < f.dateFrom) return false;
      if (f.dateTo && d > f.dateTo) return false;
    }
    return true;
  });
}

function sessionMetrics(sess) {
  const completed = sess.filter((s) => s.status_clean === 'COMPLETED');
  const planned = sess.filter((s) => s.status_clean === 'PLANNED');
  return {
    completedCount: completed.length,
    plannedCount: planned.length,
    completedHours: completed.reduce((s, r) => s + (r.duration_hours || 0), 0),
  };
}

function distinctFeedback(rows) {
  return new Set(rows.map((r) => r.feedback_id)).size;
}

function compute(sess, acts, fb, label) {
  const sm = sessionMetrics(sess);
  const plannedInCompleted = sess.filter((s) => s.status_clean === 'PLANNED').length;
  return {
    label,
    completedSessions: sm.completedCount,
    plannedSessions: sm.plannedCount,
    completedHours: Math.round(sm.completedHours),
    distinctFeedback: distinctFeedback(fb),
    plannedNeverInCompleted: plannedInCompleted === sm.plannedCount,
  };
}

const scenarios = [
  { label: 'no filters', f: {} },
  { label: 'Internal only', f: { activityType: 'INTERNAL' } },
  { label: 'External only', f: { activityType: 'EXTERNAL' } },
  { label: 'one course', f: { courseId: sessions.find((s) => s.course_id)?.course_id } },
  { label: 'one instructor', f: { instructorId: sessions.find((s) => s.instructor_id)?.instructor_id } },
  { label: 'one group', f: { groupCode: sessions[0]?.group_code } },
  { label: 'one year', f: { dateFrom: '2025-01-01', dateTo: '2025-12-31' } },
  { label: 'Group+Instructor combined', f: { groupCode: sessions[0]?.group_code, instructorId: sessions[0]?.instructor_id } },
  { label: 'empty combination', f: { groupCode: 'NONEXISTENT_XYZ', instructorId: 'INS_999' } },
];

console.log('=== KPI Reconciliation ===');
const allSess = sessions;
const sm = sessionMetrics(allSess);
console.log('Completed sessions:', sm.completedCount, '(expected 1537)');
console.log('Planned sessions:', sm.plannedCount, '(expected 204)');
console.log('Completed hours:', Math.round(sm.completedHours), '(expected 7020)');
console.log('Distinct feedback:', distinctFeedback(feedback), '(expected 3742)');

console.log('\n=== Filter Scenarios ===');
for (const sc of scenarios) {
  const sess = applyFilters(sessions, sc.f);
  const acts = applyFilters(activities, sc.f, 'activities');
  const fb = applyFilters(feedback, sc.f, 'feedback');
  console.log(JSON.stringify(compute(sess, acts, fb, sc.label)));
}
