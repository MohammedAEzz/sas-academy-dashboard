#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const SCREENSHOT_DIR = '/tmp/dashboard-screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const routes = [
  '#/overview',
  '#/groups',
  '#/instructors',
  '#/feedback',
  '#/programs',
  '#/forecast',
];

const detailRoutes = [
  { hash: '#/groups/MBA-G1', name: 'group-detail' },
  { hash: '#/instructors/INS_001', name: 'instructor-profile' },
];

const BAD_TEXT = /\b(undefined|NaN|null|nan|none|nat)\b/i;

async function checkPage(page, route, screenshotName) {
  await page.evaluate((r) => { window.location.hash = r; }, route);
  const routeKey = route.replace(/^#\//, '');
  await page.waitForSelector(`#app[data-route="${routeKey}"]`, { timeout: 15000 });
  await page.waitForSelector('.answer-band, .profile-header, .page-header, .empty-state', { timeout: 15000 });
  await page.waitForTimeout(750);
  const content = await page.textContent('#app');
  if (!content || content.includes('Failed to load')) {
    throw new Error(`Empty/failed render for ${route}`);
  }
  if (BAD_TEXT.test(content)) {
    throw new Error(`Found undefined/NaN/null in rendered text for ${route}`);
  }
  const path = `${SCREENSHOT_DIR}/${screenshotName}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('Rendered', route, '— chars:', content?.length);
  console.log('Screenshot:', path);
  return path;
}

async function checkInteractions(page) {
  await page.evaluate(() => { window.location.hash = '#/overview'; });
  await page.waitForSelector('#app[data-route="overview"]');
  if (await page.locator('input[type="date"]').count()) throw new Error('Native date input remains visible in the dashboard');

  await page.click('#date-range-trigger');
  await page.waitForSelector('.date-range-popover.open');
  await page.click('#date-range-trigger');

  await page.click('#toggle-more-filters');
  await page.waitForSelector('.filter-more.open');
  await page.click('#toggle-more-filters');

  await page.click('#pulse-switch [data-metric="hours"]');
  if (!(await page.locator('#pulse-switch [data-metric="hours"]').getAttribute('class'))?.includes('active')) {
    throw new Error('Overview delivery metric switcher did not activate Hours');
  }

  await page.evaluate(() => { window.location.hash = '#/instructors'; });
  await page.waitForSelector('#app[data-route="instructors"]');
  await page.click('#instructor-topn [data-top="10"]');
  await page.waitForSelector('#instructor-topn [data-top="10"].active');

  await page.evaluate(() => { window.location.hash = '#/feedback'; });
  await page.waitForSelector('#app[data-route="feedback"]');
  await page.click('#comparison-switch [data-mode="instructor"]');
  await page.waitForSelector('#comparison-switch [data-mode="instructor"].active');

  await page.evaluate(() => { window.location.hash = '#/programs'; });
  await page.waitForSelector('#app[data-route="programs"]');
  for (const tab of ['clients', 'diplomas', 'events', 'courses']) {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForSelector(`[data-tab="${tab}"].active`);
  }

  await page.evaluate(() => { window.location.hash = '#/forecast'; });
  await page.waitForSelector('#app[data-route="forecast"]');
  await page.selectOption('#fc-metric', 'sessions');
  await page.selectOption('#fc-horizon', '3_month');
  await page.fill('#capacity-hours', '35');
  await page.locator('#capacity-hours').press('Tab');
  console.log('Interactions: filters, date picker, switchers, tabs, and capacity scenario passed');
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const screenshots = [];

for (const viewport of [{ width: 1280, height: 900, suffix: '' }, { width: 390, height: 844, suffix: '-mobile' }]) {
  const page = await browser.newPage({ viewport });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.answer-band, .profile-header, .page-header', { timeout: 15000 });

  for (const route of routes) {
    const name = route.replace('#/', '') + viewport.suffix;
    try {
      const p = await checkPage(page, route, name);
      screenshots.push(p);
    } catch (e) {
      errors.push(e.message);
    }
  }

  for (const { hash, name } of detailRoutes) {
    try {
      const p = await checkPage(page, hash, `${name}${viewport.suffix}`);
      screenshots.push(p);
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (!viewport.suffix) {
    try {
      await checkInteractions(page);
    } catch (e) {
      errors.push(e.message);
    }
  }

  await page.close();
}

await browser.close();

if (errors.length) {
  console.error('Errors:', errors);
  process.exit(1);
}
console.log('All pages rendered with no console errors');
console.log('Screenshots:', screenshots.join(', '));
