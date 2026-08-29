#!/usr/bin/env node
/** Fetch all dashboard assets to verify they serve without error */
const BASE = 'http://localhost:8080';
const paths = [
  '/',
  '/index.html',
  '/css/main.css',
  '/assets/echarts.min.js',
  '/data/overview.json',
  '/data/activities.json',
  '/data/sessions.json',
  '/data/instructors.json',
  '/data/courses.json',
  '/data/feedback.json',
  '/data/events.json',
  '/data/diplomas.json',
  '/data/forecast.json',
  '/js/app.js',
  '/js/data.js',
  '/js/format.js',
  '/js/filters.js',
  '/js/indexes.js',
  '/js/metrics.js',
  '/js/charts.js',
  '/js/components.js',
  '/js/router.js',
  '/js/pages/overview.js',
  '/js/pages/groups.js',
  '/js/pages/instructors.js',
  '/js/pages/feedback.js',
  '/js/pages/programs.js',
  '/js/pages/forecast.js',
];

let failed = 0;
for (const p of paths) {
  const res = await fetch(BASE + p);
  if (!res.ok) {
    console.error('FAIL', p, res.status);
    failed++;
  } else {
    console.log('OK', p, res.headers.get('content-length') || '');
  }
}
process.exit(failed ? 1 : 0);
