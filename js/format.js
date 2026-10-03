import { escapeHtml } from './core/escape.js';

const MONTH_START = '2024-03';

export function fmt(value, type = 'text') {
  if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
    return '—';
  }
  if (type === 'number') {
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }
  if (type === 'int') {
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }
  if (type === 'percent') {
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    return `${n.toFixed(1)}%`;
  }
  if (type === 'hours') {
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} h`;
  }
  if (type === 'rating') {
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    return n.toFixed(2);
  }
  if (type === 'date') {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const s = String(value).trim();
  return s ? escapeHtml(s) : '—';
}

export function fmtAvg(sum, count, type = 'rating') {
  if (!count || count <= 0) return { value: '—', sub: 'N/A' };
  return { value: fmt(sum / count, type), sub: `n=${fmt(count, 'int')}` };
}

export function fmtStudents(count, totalActivities, withStudents) {
  if (count === null || count === undefined) return 'N/A';
  const pct = totalActivities ? Math.round((withStudents / totalActivities) * 100) : 0;
  return `${fmt(count, 'int')} — from ${pct}% of activities`;
}

export function monthKey(dateStr) {
  if (!dateStr) return null;
  return String(dateStr).slice(0, 7);
}

export function isHistoricalSession(s) {
  return s.status_clean !== 'PLANNED'
    && s.session_date
    && s.date_confidence === 'HIGH'
    && monthKey(s.session_date) >= MONTH_START;
}

export function isCompletedSession(s) {
  return s.status_clean === 'COMPLETED';
}

export function isPlannedSession(s) {
  return s.status_clean === 'PLANNED';
}

export function parseDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function inDateRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function statusBadge(status) {
  const s = (status || '').toUpperCase();
  const cls = s === 'COMPLETED' ? 'badge-completed' : s === 'PLANNED' ? 'badge-planned' : 'badge-unknown';
  return `<span class="badge ${cls}">${fmt(status)}</span>`;
}

export function activityTypeLabel(t) {
  const map = { INTERNAL: 'Internal', EXTERNAL: 'External', EVENT: 'Event', DIPLOMA: 'Diploma' };
  return map[t] || fmt(t);
}
