import { combineDashboard, UPLOAD_NOTICE } from './domain/combine.js';
import { localISODate } from './domain/dates.js';

const FILES = [
  'overview.json',
  'activities.json',
  'sessions.json',
  'instructors.json',
  'courses.json',
  'feedback.json',
  'events.json',
  'diplomas.json',
  'forecast.json',
];

const UPLOAD_TIMEOUT_MS = 2500;

const data = {
  overview: null,
  activities: [],
  sessions: [],
  instructors: [],
  courses: [],
  feedback: [],
  events: [],
  diplomas: [],
  forecast: null,
  meta: { lastUpdatedAt: null, importCount: 0 },
  uploadNotice: null,
};

let baseSnapshot = null;
const listeners = new Set();

export function onDataReload(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyCombined(uploaded) {
  const today = localISODate();
  const combined = combineDashboard(baseSnapshot, uploaded, { today });
  data.overview = combined.overview;
  data.activities = combined.activities;
  data.sessions = combined.sessions;
  data.instructors = combined.instructors;
  data.courses = combined.courses;
  data.feedback = combined.feedback;
  data.events = combined.events;
  data.diplomas = combined.diplomas;
  data.forecast = combined.forecast;
  data.meta = uploaded?.meta || { lastUpdatedAt: null, importCount: 0 };
  data.uploadNotice = uploaded ? null : UPLOAD_NOTICE;
}

async function fetchUploads() {
  if (typeof location !== 'undefined' && location.port === '8080') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch('/api/data', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function reloadCombinedData() {
  const uploaded = await fetchUploads();
  applyCombined(uploaded);
  listeners.forEach((listener) => listener(data));
  return data;
}

async function loadBase() {
  const entries = await Promise.all(FILES.map(async (file) => {
    const response = await fetch(`data/${file}`);
    if (!response.ok) throw new Error(`Failed to load ${file}`);
    return [file.replace('.json', ''), await response.json()];
  }));
  baseSnapshot = Object.fromEntries(entries);
}

const ready = loadBase().then(() => reloadCombinedData()).then(() => data);

export { data, ready };
