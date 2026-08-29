import { inDateRange } from './format.js';

const defaultState = {
  dateFrom: '',
  dateTo: '',
  datePreset: 'all',
  activityType: '',
  groupCode: '',
  courseId: '',
  instructorId: '',
  language: '',
  status: '',
};

export function applyDatePreset(preset) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (preset === 'last6') {
    const from = new Date(today);
    from.setMonth(from.getMonth() - 6);
    state.dateFrom = fmt(from);
    state.dateTo = fmt(today);
    state.datePreset = 'last6';
  } else if (preset === 'thisyear') {
    state.dateFrom = `${today.getFullYear()}-01-01`;
    state.dateTo = fmt(today);
    state.datePreset = 'thisyear';
  } else {
    state.dateFrom = '';
    state.dateTo = '';
    state.datePreset = 'all';
  }
  notify();
}

export function setDateRange(from, to) {
  state.dateFrom = from;
  state.dateTo = to;
  state.datePreset = '';
  notify();
}

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

const ACTIVITY_COLORS = {
  INTERNAL: '#eb6834',
  EXTERNAL: '#2a78d6',
  DIPLOMA: '#1baf7a',
  EVENT: '#eda100',
};

export function activeFilterChips(idx) {
  const f = getFilters();
  const chips = [];
  if (f.dateFrom || f.dateTo) {
    chips.push({ key: 'dateFrom', label: `Dates: ${f.dateFrom || '…'} – ${f.dateTo || '…'}`, color: null });
  }
  const labels = {
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
    let color = null;
    if (key === 'courseId') display = idx?.courseName(f[key]) || f[key];
    if (key === 'instructorId') display = idx?.instructorName(f[key]) || f[key];
    if (key === 'activityType') {
      display = f[key];
      color = ACTIVITY_COLORS[f[key]] || null;
    }
    chips.push({ key, label: `${label}: ${display}`, color });
  }
  return chips;
}

export function removeFilter(key) {
  if (key === 'dateFrom') {
    state.dateFrom = '';
    state.dateTo = '';
    state.datePreset = 'all';
  } else {
    state[key] = '';
  }
  notify();
}
