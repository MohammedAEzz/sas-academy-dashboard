import { inDateRange } from './format.js';

const defaultState = {
  dateFrom: '',
  dateTo: '',
  activityType: '',
  groupCode: '',
  courseId: '',
  instructorId: '',
  language: '',
  status: '',
};

let state = { ...defaultState };
const listeners = new Set();

export function getFilters() {
  return { ...state };
}

export function setFilter(key, value) {
  state[key] = value;
  notify();
}

export function clearFilters() {
  state = { ...defaultState };
  notify();
}

export function removeFilter(key) {
  state[key] = '';
  notify();
}

export function onFilterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(getFilters()));
}

function matchField(recordValue, filterValue) {
  if (!filterValue) return true;
  return String(recordValue || '') === filterValue;
}

export function applyFilters(records, dataset = 'sessions') {
  if (!records || !records.length) return [];
  const f = getFilters();
  return records.filter((r) => {
    if (f.activityType && r.activity_type !== f.activityType) return false;
    if (f.groupCode && r.group_code !== f.groupCode && r.group_code_clean !== f.groupCode) return false;
    if (f.courseId && r.course_id !== f.courseId) return false;
    if (f.instructorId && r.instructor_id !== f.instructorId) return false;
    if (f.language && r.language !== f.language) return false;
    if (f.status && r.status_clean !== f.status) return false;
    if (f.dateFrom || f.dateTo) {
      const dateField = dataset === 'feedback' ? 'feedback_date' : 'session_date';
      const altDate = dataset === 'activities' ? (r.last_lecture_date || r.expected_end_date) : null;
      const d = r[dateField] || altDate;
      if (!d || !inDateRange(d, f.dateFrom, f.dateTo)) return false;
    }
    return true;
  });
}

export function activeFilterChips(idx) {
  const f = getFilters();
  const chips = [];
  const labels = {
    dateFrom: 'From',
    dateTo: 'To',
    activityType: 'Type',
    groupCode: 'Group',
    courseId: 'Course',
    instructorId: 'Instructor',
    language: 'Language',
    status: 'Status',
  };
  for (const [key, label] of Object.entries(labels)) {
    if (!f[key]) continue;
    let display = f[key];
    if (key === 'courseId') display = idx?.courseName(f[key]) || f[key];
    if (key === 'instructorId') display = idx?.instructorName(f[key]) || f[key];
    chips.push({ key, label: `${label}: ${display}` });
  }
  return chips;
}
