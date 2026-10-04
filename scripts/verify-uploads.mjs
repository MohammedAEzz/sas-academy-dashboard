#!/usr/bin/env node
/**
 * Browser checks for templates, preview, commit, conflicts, persistence, and revert.
 * Requires `npm run dev:local` on http://127.0.0.1:3100.
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { columnIds } from '../js/core/schema.js';
import { qaRows } from '../tests/qa-rows.js';

const BASE = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.ADMIN_PASSWORD || 'dev-admin-password';
const SCREENSHOT_DIR = '/tmp/dashboard-screenshots';
const FIXTURES = '/tmp/sas-upload-fixtures';
const DATASETS = ['instructors', 'courses', 'groups', 'sessions', 'feedback', 'events'];
mkdirSync(SCREENSHOT_DIR, { recursive: true });
mkdirSync(FIXTURES, { recursive: true });

const screenshots = [];
const consoleErrors = [];
const assertions = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  assertions.push(message);
  console.log('OK', message);
}

function numberIn(text, pattern) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Could not find ${pattern} in: ${text.slice(0, 500)}`);
  return Number(match[1].replace(/,/g, ''));
}

async function shot(page, name) {
  const path = join(SCREENSHOT_DIR, `uploads-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  console.log('Screenshot:', path);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Realistic rows (not the template examples, which the importer rejects) as a CSV UTF-8 file. */
function qaCsv(dataset) {
  const ids = columnIds(dataset);
  const lines = [ids.join(','), ...qaRows(dataset).map((row) => ids.map((id) => csvCell(row[id])).join(','))];
  return `\uFEFF${lines.join('\n')}\n`;
}

async function overviewNumbers(page) {
  await page.goto(`${BASE}/#/overview`);
  await page.waitForSelector('#app[data-route="overview"] .answer-band');
  const text = await page.textContent('#app');
  const footer = await page.textContent('#data-quality');
  return {
    completedSessions: numberIn(text, /([\d,]+) sessions delivered across/),
    completedGroups: numberIn(text, /sessions delivered across ([\d,]+) completed groups/),
    completedHours: numberIn(text, /delivered ([\d,]+) h of completed teaching/),
    plannedSessions: numberIn(text, /while ([\d,]+) sessions are already/),
    distinctFeedback: numberIn(footer, /([\d,]+) distinct feedback/),
  };
}

async function previewFile(page, dataset, filePath) {
  // Read without auto-waiting: these elements are often absent before the first preview.
  const { titleBefore, alertBefore } = await page.evaluate(() => ({
    titleBefore: document.querySelector('#preview-title')?.textContent || '',
    alertBefore: document.querySelector('[role="alert"]')?.textContent || '',
  }));
  await page.selectOption('#upload-dataset', dataset);
  await page.setInputFiles('#upload-file', filePath);
  await page.click('#upload-form button[type="submit"]');
  await page.waitForFunction(({ titleBefore: previousTitle, alertBefore: previousAlert }) => {
    const status = document.querySelector('#data-status')?.textContent || '';
    if (status === 'Preparing preview') return false;
    const title = document.querySelector('#preview-title')?.textContent || '';
    const alert = document.querySelector('[role="alert"]')?.textContent || '';
    return (title && title !== previousTitle) || (alert && alert !== previousAlert);
  }, { titleBefore, alertBefore });
}

async function commitPreview(page) {
  const button = page.locator('#commit-import');
  await button.waitFor();
  assert(await button.isEnabled(), 'Import button is enabled when valid rows exist');
  await button.click();
  await page.waitForSelector('#import-success');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('dialog', async (dialog) => {
    consoleErrors.push(`unexpected dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow([
    'session_date', 'group_code', 'course_name', 'instructor_name', 'session_number',
    'duration_hours', 'language', 'activity_type', 'start_time', 'status', 'diploma_type',
  ]);
  sheet.addRow(['2026-09-15', 'MBA-G990', 'Leading with Analytics', 'Layla Hassan', 1, 4, 'Arabic', 'INTERNAL', '17:00', 'COMPLETED', '']);
  sheet.addRow(['2026-09-16', '', 'Leading with Analytics', 'Ahmed Tealeb', 1, 2, 'Arabic', 'DIPLOMA', '17:00', 'COMPLETED', 'MBA']);
  const xlsxPath = join(FIXTURES, 'completed-sessions.xlsx');
  await workbook.xlsx.writeFile(xlsxPath);

  writeFileSync(join(FIXTURES, 'conflict-instructor.csv'), 'instructor_name,title,status,full_name_ar,system_name_ar\nAhmed Tealeb,Eng.,Not Active,,\n');
  writeFileSync(join(FIXTURES, 'missing-column.csv'), 'title,status\nDr.,Active\n');
  writeFileSync(join(FIXTURES, 'wrong-type.csv'), 'course_name,declared_hours,course_category\nWrong Type Course,abc,Visual Analytics\n');
  writeFileSync(join(FIXTURES, 'bad-date.csv'), 'session_date,group_code,course_name,instructor_name,session_number,duration_hours,language,activity_type,start_time,status,diploma_type\n2026-13-40,MBA-G990,Leading with Analytics,Ahmed Tealeb,1,2,Arabic,INTERNAL,17:00,COMPLETED,\n');
  writeFileSync(join(FIXTURES, 'xss-instructor.csv'), 'instructor_name,title,status,full_name_ar,system_name_ar\n"<img src=x onerror=alert(1)>",Dr.,Active,,\n');

  await page.goto(`${BASE}/#/overview`);
  await page.waitForSelector('#app[data-route="overview"] .answer-band');
  const base = await overviewNumbers(page);
  assert(base.completedSessions === 1537, `base completed sessions ${base.completedSessions}`);
  assert(base.plannedSessions === 204, `base planned sessions ${base.plannedSessions}`);
  assert(base.completedHours === 7020, `base completed hours ${base.completedHours}`);
  assert(base.distinctFeedback === 3742, `base distinct feedback ${base.distinctFeedback}`);

  const authCheck = page.waitForResponse((response) => response.url().includes('/api/auth') && response.request().method() === 'GET');
  await page.goto(`${BASE}/#/data`);
  await authCheck;
  await page.waitForSelector('#app[data-route="data"] #admin-password');
  await shot(page, 'templates');
  assert(await page.locator('.dataset-card').count() === 6, 'six template cards without login');
  const references = await page.locator('.column-reference').count();
  assert(references === 6, `column reference on every dataset (${references})`);

  for (const dataset of DATASETS) {
    for (const format of ['csv', 'xlsx', 'example-csv']) {
      const response = await page.request.get(`${BASE}/api/templates?dataset=${dataset}&format=${format}`);
      assert(response.status() === 200, `${dataset} ${format} downloads (${response.status()})`);
      const body = await response.body();
      if (format === 'xlsx') assert(body[0] === 0x50 && body[1] === 0x4b, `${dataset} xlsx is a zip`);
      else assert(body.includes(Buffer.from('instructor_name')) || body.includes(Buffer.from('course_name')) || body.includes(Buffer.from('group_code')) || body.includes(Buffer.from('session_date')) || body.includes(Buffer.from('feedback_date')) || body.includes(Buffer.from('event_name')) || body.length > 20, `${dataset} ${format} has content`);
      if (format === 'example-csv') writeFileSync(join(FIXTURES, `${dataset}-example.csv`), body);
    }
  }

  await page.fill('#admin-password', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#upload-file');
  assert(await page.locator('#sign-out').isVisible(), 'signed in');

  // A downloaded Example CSV must never import: every row is the template's example row.
  await previewFile(page, 'events', join(FIXTURES, 'events-example.csv'));
  const examplePreview = await page.textContent('#preview-panel');
  assert(/valid 0/.test(examplePreview) && /error 3/.test(examplePreview), `example CSV rows are rejected: ${examplePreview.slice(0, 160)}`);
  assert(/template's example row/.test(examplePreview), 'example rows explain how to fix them');
  assert(await page.locator('#commit-import').isDisabled(), 'example CSV cannot be imported');

  for (const dataset of DATASETS) {
    const filePath = join(FIXTURES, `${dataset}-qa.csv`);
    writeFileSync(filePath, qaCsv(dataset));
    await previewFile(page, dataset, filePath);
    const previewText = await page.textContent('#preview-panel');
    assert(/valid [1-9]/.test(previewText), `${dataset} QA preview has valid rows: ${previewText.slice(0, 180)}`);
    await commitPreview(page);
    const success = await page.textContent('#import-success');
    assert(/Imported [1-9]/.test(success), `${dataset} QA rows committed`);
  }

  await previewFile(page, 'sessions', xlsxPath);
  const xlsxPreview = await page.textContent('#preview-panel');
  assert(/valid 2/.test(xlsxPreview), `filled xlsx preview has 2 valid rows: ${xlsxPreview.slice(0, 220)}`);
  await shot(page, 'preview');
  await commitPreview(page);

  const uploaded = await overviewNumbers(page);
  assert(uploaded.completedSessions === base.completedSessions + 2, `completed sessions ${base.completedSessions} -> ${uploaded.completedSessions}`);
  assert(uploaded.completedHours === base.completedHours + 6, `completed hours ${base.completedHours} -> ${uploaded.completedHours}`);
  assert(uploaded.plannedSessions === base.plannedSessions + 3, `planned sessions ${base.plannedSessions} -> ${uploaded.plannedSessions}`);
  assert(uploaded.completedGroups === base.completedGroups + 3, `completed groups ${base.completedGroups} -> ${uploaded.completedGroups}`);
  assert(uploaded.distinctFeedback === base.distinctFeedback + 3, `distinct feedback ${base.distinctFeedback} -> ${uploaded.distinctFeedback}`);
  await shot(page, 'overview');

  await page.goto(`${BASE}/#/instructors`);
  await page.waitForSelector('#inst-search');
  await page.fill('#inst-search', 'Layla');
  await page.waitForTimeout(200);
  const instructors = await page.textContent('#app');
  assert(instructors.includes('Layla Hassan'), 'Layla Hassan appears on Instructors');
  await shot(page, 'instructors');

  await page.goto(`${BASE}/#/groups`);
  await page.waitForSelector('#group-search');
  await page.fill('#group-search', 'MBA-G990');
  await page.waitForTimeout(200);
  const groups = await page.textContent('#app');
  assert(groups.includes('MBA-G990'), 'MBA-G990 appears on Groups');
  await shot(page, 'groups');

  await page.goto(`${BASE}/#/programs`);
  await page.waitForSelector('[data-tab="events"]');
  await page.click('[data-tab="diplomas"]');
  await page.waitForSelector('[data-tab="diplomas"].active');
  const diplomas = await page.textContent('#app');
  assert(/16 Sept? 2026/.test(diplomas), `MBA diploma date range extends to the uploaded lecture (${diplomas.slice(0, 300)})`);
  await page.click('[data-tab="events"]');
  const events = await page.textContent('#app');
  assert(/5 events reached/.test(events), `programs events count: ${events.slice(0, 240)}`);
  assert(events.includes('Template Workshop Alpha'), 'uploaded event name is listed');
  await shot(page, 'events');

  await page.goto(`${BASE}/#/data`);
  await page.waitForSelector('#upload-file');
  const exampleInstructors = join(FIXTURES, 'instructors-qa.csv');
  await previewFile(page, 'instructors', exampleInstructors);
  const duplicatePreview = await page.textContent('#preview-panel');
  assert(/imported on/.test(duplicatePreview), 're-upload shows already imported banner');
  assert(/duplicate 3/.test(duplicatePreview), 're-upload marks every instructor row as duplicate');
  assert(await page.locator('#commit-import').isDisabled(), 'import stays disabled when nothing new is valid');
  const sha = createHash('sha256').update(readFileSync(exampleInstructors)).digest('hex');
  const commitParams = new URLSearchParams({
    action: 'commit',
    dataset: 'instructors',
    filename: 'instructors-qa.csv',
    sha256: sha,
    previewCounts: JSON.stringify({ total: 3, valid: 0, duplicate: 3, conflict: 0, error: 0 }),
  });
  const rejected = await page.request.post(`${BASE}/api/imports?${commitParams}`, {
    data: readFileSync(exampleInstructors),
    headers: { 'X-Requested-With': 'fetch', Origin: BASE, 'Content-Type': 'application/octet-stream' },
  });
  const rejectedBody = await rejected.json();
  assert(rejected.status() === 409 && rejectedBody.error?.code === 'ALREADY_IMPORTED', `same file commit is ALREADY_IMPORTED (${rejected.status()} ${rejectedBody.error?.code})`);

  await previewFile(page, 'instructors', join(FIXTURES, 'conflict-instructor.csv'));
  const conflict = await page.textContent('#preview-panel');
  assert(/conflict 1/.test(conflict), 'conflicting instructor is a conflict');
  assert(conflict.includes('title') && conflict.includes('status'), 'conflict names the fields that differ');
  assert(/\b2\b/.test(conflict), 'conflict shows the spreadsheet row number');
  await shot(page, 'conflict');
  await page.click('#cancel-preview');

  await previewFile(page, 'instructors', join(FIXTURES, 'missing-column.csv'));
  const missing = await page.textContent('#app');
  assert(missing.includes('instructor_name'), 'missing required column is named');
  await shot(page, 'file-error');

  await previewFile(page, 'courses', join(FIXTURES, 'wrong-type.csv'));
  const wrongType = await page.textContent('#preview-panel');
  assert(/error 1/.test(wrongType), 'wrong type is a row error');
  assert(/\b2\b/.test(wrongType), 'wrong type shows row 2');
  assert(/number/i.test(wrongType), 'wrong type explains the number format');

  await previewFile(page, 'sessions', join(FIXTURES, 'bad-date.csv'));
  const badDate = await page.textContent('#preview-panel');
  assert(/error 1/.test(badDate), 'bad date is a row error');
  assert(/\b2\b/.test(badDate), 'bad date shows row 2');
  assert(/date/i.test(badDate), 'bad date explains the date format');
  await shot(page, 'row-errors');
  await page.click('#cancel-preview');

  await previewFile(page, 'instructors', join(FIXTURES, 'xss-instructor.csv'));
  await commitPreview(page);
  await page.goto(`${BASE}/#/instructors`);
  await page.waitForSelector('#inst-search');
  await page.fill('#inst-search', '<img');
  await page.waitForTimeout(200);
  const rosterHtml = await page.locator('#app').innerHTML();
  const rosterText = await page.locator('#app').innerText();
  assert(rosterHtml.includes('&lt;img'), 'uploaded markup is escaped in the instructors table');
  assert(rosterText.includes('<img src=x onerror=alert(1)>'), 'escaped name is still readable as text');

  await page.reload();
  await page.waitForSelector('#app[data-route="instructors"] #inst-search');
  await page.fill('#inst-search', 'Layla');
  await page.waitForTimeout(200);
  assert((await page.textContent('#app')).includes('Layla Hassan'), 'uploaded instructor persists after reload');
  const persisted = await overviewNumbers(page);
  assert(persisted.completedSessions === uploaded.completedSessions, 'completed sessions persist after reload');
  assert(persisted.distinctFeedback === uploaded.distinctFeedback, 'feedback persists after reload');

  await page.goto(`${BASE}/#/data`);
  await page.waitForSelector('[data-revert]');
  const instructorRow = page.locator('tr', { hasText: 'instructors-qa.csv' });
  const instructorRevertId = await instructorRow.locator('[data-revert]').getAttribute('data-revert');
  await instructorRow.locator('[data-revert]').click();
  await page.locator('#revert-dialog[open] #revert-confirm').click();
  await page.waitForSelector('[role="alert"]');
  const blocked = await page.textContent('[role="alert"]');
  assert(/cannot be reverted/i.test(blocked), `dependents error is shown: ${blocked.slice(0, 180)}`);

  const skippedIds = new Set([instructorRevertId]);
  for (let guard = 0; guard < 30; guard += 1) {
    const ids = await page.locator('[data-revert]').evaluateAll((els) => els.map((el) => el.getAttribute('data-revert')));
    if (!ids.length) break;
    const id = ids.find((item) => item && !skippedIds.has(item));
    if (!id) throw new Error(`Remaining imports are blocked: ${ids.join(', ')}`);
    const before = await page.locator('#data-status').textContent();
    await page.locator(`[data-revert="${id}"]`).click();
    await page.locator('#revert-dialog[open] #revert-confirm').click();
    const removed = await page.waitForFunction(({ id: importId, before: previous }) => {
      if (!document.querySelector(`[data-revert="${importId}"]`)) return 'reverted';
      const status = document.querySelector('#data-status')?.textContent || '';
      if (status !== previous && /cannot be reverted/i.test(status)) return 'blocked';
      return false;
    }, { id, before }, { timeout: 120000 });
    if (await removed.jsonValue() === 'blocked') skippedIds.add(id);
    else skippedIds.clear();
  }
  assert(await page.locator('[data-revert]').count() === 0, 'every import was reverted');
  const restored = await overviewNumbers(page);
  assert(restored.completedSessions === base.completedSessions, 'completed sessions return to base');
  assert(restored.completedHours === base.completedHours, 'completed hours return to base');
  assert(restored.plannedSessions === base.plannedSessions, 'planned sessions return to base');
  assert(restored.completedGroups === base.completedGroups, 'completed groups return to base');
  assert(restored.distinctFeedback === base.distinctFeedback, 'distinct feedback returns to base');
  await page.goto(`${BASE}/#/data`);
  await page.waitForSelector('#history-heading');
  await shot(page, 'reverted');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/data`);
  await page.waitForSelector('.dataset-card');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 8, `data page fits a phone width (overflow ${overflow}px)`);
  await shot(page, 'data-mobile');

  const unexpected = consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of (400|409)/.test(message));
  assert(unexpected.length === 0, `zero console errors (${unexpected.join(' | ') || 'only expected upload responses'})`);
  await browser.close();
  console.log('Assertions:', assertions.length);
  console.log('Screenshots:', screenshots.join(', '));
}

main().catch((error) => {
  console.error(error);
  console.error('Console errors so far:', consoleErrors);
  process.exit(1);
});
