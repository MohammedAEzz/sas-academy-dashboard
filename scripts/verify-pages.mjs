#!/usr/bin/env node
import { chromium } from 'playwright';

const routes = [
  '#/overview',
  '#/groups',
  '#/instructors',
  '#/feedback',
  '#/programs',
  '#/forecast',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.waitForSelector('.kpi-grid', { timeout: 15000 });

for (const route of routes) {
  await page.evaluate((r) => { window.location.hash = r; }, route);
  await page.waitForTimeout(800);
  const content = await page.textContent('#app');
  if (!content || content.includes('Failed to load')) {
    errors.push(`Empty/failed render for ${route}`);
  }
  console.log('Rendered', route, '— chars:', content?.length);
  await page.screenshot({ path: `/tmp/dashboard-${route.replace('#/', '')}.png`, fullPage: true });
  console.log('Screenshot:', `/tmp/dashboard-${route.replace('#/', '')}.png`);
}

// Detail pages
await page.evaluate(() => { window.location.hash = '#/groups/DBA'; });
await page.waitForTimeout(800);
console.log('Rendered #/groups/DBA');
await page.screenshot({ path: '/tmp/dashboard-group-detail.png', fullPage: true });

await page.evaluate(() => { window.location.hash = '#/instructors/INS_001'; });
await page.waitForTimeout(800);
console.log('Rendered #/instructors/INS_001');
await page.screenshot({ path: '/tmp/dashboard-instructor-profile.png', fullPage: true });

await browser.close();

if (errors.length) {
  console.error('Console errors:', errors);
  process.exit(1);
}
console.log('All pages rendered with no console errors');
