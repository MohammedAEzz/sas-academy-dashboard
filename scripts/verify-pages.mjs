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
  { hash: '#/groups/DBA', name: 'group-detail' },
  { hash: '#/instructors/INS_001', name: 'instructor-profile' },
];

const BAD_TEXT = /\b(undefined|NaN|null)\b/;

async function checkPage(page, route, screenshotName) {
  await page.evaluate((r) => { window.location.hash = r; }, route);
  await page.waitForTimeout(1000);
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
  await page.waitForSelector('.kpi-row, .kpi-grid, .page-header', { timeout: 15000 });

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

  await page.close();
}

await browser.close();

if (errors.length) {
  console.error('Errors:', errors);
  process.exit(1);
}
console.log('All pages rendered with no console errors');
console.log('Screenshots:', screenshots.join(', '));
