#!/usr/bin/env node
/**
 * Export the dashboard PDF (full scope, filtered, and after an upload) and check the files.
 * Requires `npm run dev:local` on http://127.0.0.1:3100. Exits within two minutes.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildIndexes } from '../js/indexes.js';
import { buildReport } from '../js/domain/report-model.js';

const BASE = 'http://127.0.0.1:3100';
const OUT = '/tmp/dashboard-screenshots';
const ROOT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const hardStop = setTimeout(() => {
  console.error('verify-pdf exceeded 115s');
  process.exit(1);
}, 115000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('OK', message);
}

function loadBase() {
  const read = (name) => JSON.parse(readFileSync(join(ROOT, '..', 'data', name), 'utf8'));
  return {
    overview: read('overview.json'),
    activities: read('activities.json'),
    sessions: read('sessions.json'),
    instructors: read('instructors.json'),
    courses: read('courses.json'),
    feedback: read('feedback.json'),
    events: read('events.json'),
    diplomas: read('diplomas.json'),
    forecast: read('forecast.json'),
    meta: { lastUpdatedAt: null },
  };
}

async function pdfText(file) {
  const data = new Uint8Array(readFileSync(file));
  const doc = await getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  return { pageCount: doc.numPages, pages, text: pages.join('\n') };
}

async function exportPdf(page, file, scope) {
  await page.evaluate(() => document.getElementById('export-pdf')?.click());
  await page.waitForFunction(() => document.querySelector('.export-modal:not([hidden])'));
  await page.evaluate((value) => {
    const input = document.querySelector(`input[name="export-scope"][value="${value}"]`);
    if (input) input.checked = true;
  }, scope);
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
  await page.evaluate(() => document.getElementById('export-generate')?.click());
  const download = await downloadPromise;
  const target = join(OUT, file);
  await download.saveAs(target);
  await page.waitForFunction(() => (document.getElementById('export-status')?.textContent || '').includes('PDF downloaded'));
  await page.evaluate(() => document.getElementById('export-cancel')?.click());
  return target;
}

async function uploadProofSession() {
  const csv = 'session_date,group_code,course_name,instructor_name,session_number,duration_hours,language,activity_type,start_time,status,diploma_type\n2026-09-20,MBA-G991,Leading with Analytics,Ahmed Tealeb,1,3,English,INTERNAL,17:00,COMPLETED,\n';
  const body = Buffer.from(csv);
  const headers = {
    Origin: BASE,
    'X-Requested-With': 'fetch',
  };
  const login = await fetch(`${BASE}/api/auth?action=login`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev-admin-password' }),
  });
  assert(login.ok, `login ${login.status}`);
  const cookie = (login.headers.getSetCookie?.()[0] || login.headers.get('set-cookie') || '').split(';')[0];
  assert(cookie.includes('='), 'session cookie');
  const previewUrl = `${BASE}/api/imports?${new URLSearchParams({ action: 'preview', dataset: 'sessions', filename: 'pdf-proof.csv' })}`;
  const previewRes = await fetch(previewUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', Cookie: cookie },
    body,
  });
  const preview = await previewRes.json();
  assert(previewRes.ok && preview.counts?.valid >= 1, `preview valid rows ${JSON.stringify(preview.counts || preview)}`);
  const commitUrl = `${BASE}/api/imports?${new URLSearchParams({
    action: 'commit',
    dataset: 'sessions',
    filename: 'pdf-proof.csv',
    sha256: preview.sha256,
    previewCounts: JSON.stringify(preview.counts),
  })}`;
  const commitRes = await fetch(commitUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', Cookie: cookie },
    body,
  });
  const commit = await commitRes.json();
  assert(commitRes.ok, `commit ${commitRes.status} ${JSON.stringify(commit)}`);
  assert(createHash('sha256').update(body).digest('hex') === preview.sha256, 'uploaded bytes match preview hash');
}

async function screenshotPdfPages(browser, pdfPath, pageNumbers) {
  const pdfjsDir = join(ROOT, '../node_modules/pdfjs-dist/legacy/build');
  const page = await browser.newPage({ viewport: { width: 980, height: 1400 } });
  const pngs = [];
  try {
    await page.route('**/pdf.mjs', (route) => route.fulfill({
      path: join(pdfjsDir, 'pdf.mjs'),
      contentType: 'text/javascript',
    }));
    await page.route('**/pdf.worker.mjs', (route) => route.fulfill({
      path: join(pdfjsDir, 'pdf.worker.mjs'),
      contentType: 'text/javascript',
    }));
    await page.route('**/report.pdf', (route) => route.fulfill({
      path: pdfPath,
      contentType: 'application/pdf',
    }));
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#fff">
<canvas id="c"></canvas>
<script type="module">
import * as pdfjs from '/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
const data = new Uint8Array(await (await fetch('/report.pdf')).arrayBuffer());
const doc = await pdfjs.getDocument({ data }).promise;
window.renderPage = async (number) => {
  const pdfPage = await doc.getPage(number);
  const viewport = pdfPage.getViewport({ scale: 1.35 });
  const canvas = document.getElementById('c');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvas, viewport }).promise;
  document.body.dataset.ready = String(number);
};
document.body.dataset.ready = '0';
</script></body></html>`;
    await page.route('**/pdf-preview.html', (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: html,
    }));
    await page.goto(`${BASE}/pdf-preview.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => typeof window.renderPage === 'function', null, { timeout: 20000 });
    for (const number of pageNumbers) {
      await page.evaluate((value) => window.renderPage(value), number);
      await page.waitForFunction((value) => document.body.dataset.ready === String(value), number);
      const out = join(OUT, `pdf-page-${number}.png`);
      await page.locator('#c').screenshot({ path: out });
      pngs.push(out);
      console.log('PNG', out);
    }
    return pngs;
  } finally {
    await page.close();
  }
}

async function main() {
  const base = loadBase();
  const fullModel = buildReport({ data: base, idx: buildIndexes(base), scope: 'full', generatedAt: new Date('2026-10-04T00:00:00') });
  const groupTable = fullModel.sections.find((section) => section.id === 'groups').tables.find((item) => item.id === 'groups-register');
  const commentTable = fullModel.sections.find((section) => section.id === 'feedback').tables.find((item) => item.id === 'feedback-comments');
  const lastGroup = groupTable.body.at(-1)[0];
  const lastComment = commentTable.body.at(-1)[0];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.setDefaultTimeout(20000);

  try {
    await page.goto(`${BASE}/#/overview`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app[data-route="overview"] .answer-band');
    await page.waitForSelector('#export-pdf');

    const fullPath = await exportPdf(page, 'SAS-full.pdf', 'full');
    const full = await pdfText(fullPath);
    assert(full.pageCount > 7, `full PDF has ${full.pageCount} pages`);
    for (const phrase of [
      'SAS Academy Analytics Report',
      'Report generated at',
      'Historical data only',
      'no uploads',
      'Historical data as of',
      base.overview.as_of_date,
      'Full dataset (all filters cleared)',
      'No filters applied',
      'Overview',
      'Groups',
      'Instructors',
      'Feedback',
      'Programs',
      'Forecast & Capacity',
      'Data notes',
      '1537',
      '204',
      '7020',
      '3742',
      lastGroup,
      lastComment,
    ]) {
      assert(full.text.includes(phrase), `full PDF contains ${phrase}`);
    }
    console.log('Full PDF', fullPath, 'pages', full.pageCount);

    await page.evaluate(() => document.getElementById('toggle-more-filters')?.click());
    await page.selectOption('#f-language', 'English');
    await page.waitForFunction(() => (document.getElementById('app')?.textContent || '').length > 20);
    const filteredPath = await exportPdf(page, 'SAS-filtered.pdf', 'current');
    const filtered = await pdfText(filteredPath);
    assert(filtered.text.includes('Current filters'), 'filtered PDF scope');
    assert(filtered.text.includes('Language: English'), 'filtered PDF lists the language filter');
    assert(!filtered.text.includes('Completed sessions 1537') && filtered.text.includes('Completed sessions'), 'filtered KPI label is present');
    const filteredSessions = Number((filtered.text.match(/Completed sessions\s+(\d+)/) || [])[1]);
    assert(filteredSessions && filteredSessions !== 1537, `filtered completed sessions ${filteredSessions}`);
    console.log('Filtered PDF', filteredPath, 'pages', filtered.pageCount, 'sessions', filteredSessions);

    const tablePage = full.pages.findIndex((text) => text.includes('Group register')) + 1;
    assert(tablePage > 0, 'found a group-register page');
    const pngs = await screenshotPdfPages(browser, fullPath, [...new Set([1, 2, 3, 4, tablePage])]);
    console.log('PNG list', pngs.join(', '));

    await uploadProofSession();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app[data-route="overview"] .answer-band');
    try {
      await page.waitForFunction(() => /1,538|1538/.test(document.querySelector('#app')?.innerText || ''));
    } catch (error) {
      const text = await page.evaluate(() => document.querySelector('.answer-band')?.innerText || '');
      throw new Error(`Uploaded session did not reach the overview: ${text.slice(0, 400)}`);
    }
    const uploadedPath = await exportPdf(page, 'SAS-uploaded.pdf', 'full');
    const uploaded = await pdfText(uploadedPath);
    assert(uploaded.text.includes('1538'), 'uploaded session count is in the PDF');
    console.log('Uploaded PDF', uploadedPath, 'pages', uploaded.pageCount);

    const exportErrors = consoleErrors.filter((line) => !/favicon/i.test(line));
    assert(exportErrors.length === 0, `no console errors during export${exportErrors.length ? `: ${exportErrors.join(' | ')}` : ''}`);
    console.log('verify-pdf passed');
  } finally {
    await browser.close();
    clearTimeout(hardStop);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
