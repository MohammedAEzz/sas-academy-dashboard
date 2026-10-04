import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildIndexes } from '../js/indexes.js';
import { clearFilters, getFilters, setFilter } from '../js/filters.js';
import { buildReport, pdfText, SECTION_ORDER } from '../js/domain/report-model.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function loadData() {
  const read = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
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
    meta: { lastUpdatedAt: null, importCount: 0 },
  };
}

const data = loadData();
const idx = buildIndexes(data);
const generatedAt = new Date('2026-10-04T12:34:00');

test('full-scope report matches overview KPIs and section order', () => {
  clearFilters();
  const report = buildReport({ data, idx, scope: 'full', generatedAt });
  assert.deepEqual(report.sections.map((section) => section.id), SECTION_ORDER);
  assert.deepEqual(report.sections.map((section) => section.title), [
    'Overview', 'Groups', 'Instructors', 'Feedback', 'Programs', 'Forecast & Capacity',
  ]);
  assert.equal(report.kpis.completedSessions, 1537);
  assert.equal(report.kpis.plannedSessions, 204);
  assert.equal(report.kpis.completedHours, 7020);
  assert.equal(report.kpis.distinctFeedback, 3742);
  assert.equal(report.cover.scopeLabel, 'Full dataset (all filters cleared)');
  assert.deepEqual(report.cover.filters, ['No filters applied']);
  assert.equal(report.cover.dataUpdated, 'Historical data only — no uploads');
  assert.equal(report.cover.historicalAsOf, data.overview.as_of_date);
  assert.match(report.generatedAt, /2026-10-04 12:34/);
  assert.match(report.filename, /^SAS-Academy-Report-2026-10-04-1234\.pdf$/);
  assert.ok(report.dataNotes.some((note) => note.includes(data.overview.as_of_date)));

  const groups = report.sections.find((section) => section.id === 'groups');
  const register = groups.tables.find((item) => item.id === 'groups-register');
  const codes = new Set(data.activities.map((activity) => activity.group_code).filter(Boolean));
  assert.equal(register.body.length, codes.size);
  assert.equal(register.appendix, false);

  const instructors = report.sections.find((section) => section.id === 'instructors');
  const roster = instructors.tables.find((item) => item.id === 'instructors-roster');
  assert.equal(roster.body.length, data.instructors.length);

  const courses = report.sections.find((section) => section.id === 'programs')
    .tables.find((item) => item.id === 'programs-courses');
  assert.ok(courses.body.length > 0);
  assert.ok(courses.body.length <= data.courses.length);

  const comments = report.sections.find((section) => section.id === 'feedback')
    .tables.find((item) => item.id === 'feedback-comments');
  assert.equal(comments.appendix, comments.body.length > 300);
  assert.ok(comments.body.length > 0);
  assert.ok(report.sections.every((section) => section.charts.length > 0));
});

test('a language filter changes KPI counts and is listed on the cover', () => {
  setFilter('language', 'Arabic');
  const report = buildReport({
    data,
    idx,
    scope: 'current',
    filters: { language: 'English' },
    generatedAt,
  });
  assert.equal(getFilters().language, 'Arabic');
  assert.notEqual(report.kpis.completedSessions, 1537);
  assert.ok(report.kpis.completedSessions > 0);
  assert.ok(report.cover.filters.some((label) => label === 'Language: English'));
  const groups = report.sections.find((section) => section.id === 'groups')
    .tables.find((item) => item.id === 'groups-register');
  const englishCodes = new Set(
    data.activities.filter((activity) => activity.language === 'English').map((activity) => activity.group_code),
  );
  assert.equal(groups.body.length, englishCodes.size);
  clearFilters();
});

test.describe('pdfText', () => {
  test.it('keeps Arabic text instead of omitting it', () => {
    assert.equal(pdfText('  المحاضر  متمكن جدا (SAS) '), 'المحاضر متمكن جدا (SAS)');
  });

  test.it('spells out comparison signs the embedded fonts cannot draw', () => {
    assert.equal(pdfText('n≥10, share ≤ 5%'), 'n>=10, share <= 5%');
  });
});
