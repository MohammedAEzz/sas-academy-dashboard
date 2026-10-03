import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { escapeHtml } from '../js/core/escape.js';
import { combineDashboard, deriveSessionStatus, mergeDiplomas, recomputeOverview } from '../js/domain/combine.js';
import { buildForecast } from '../js/domain/forecast.js';
import { describeFreshness } from '../js/domain/freshness.js';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cur += '"'; index += 1; }
        else quoted = false;
      } else cur += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cur); cur = ''; }
    else if (char === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (char !== '\r') cur += char;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const [header, ...body] = rows.filter((item) => item.length > 1 && item.some(Boolean));
  return body.map((cols) => Object.fromEntries(header.map((name, index) => [name, cols[index] ?? ''])));
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../data');
const load = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8'));

function diffValues(actual, expected, path, errors) {
  if (typeof expected === 'number') {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-6) {
      errors.push(`${path}: ${actual} !== ${expected}`);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      errors.push(`${path}: length ${actual?.length} !== ${expected.length}`);
      return;
    }
    expected.forEach((item, index) => diffValues(actual[index], item, `${path}[${index}]`, errors));
    return;
  }
  if (expected && typeof expected === 'object') {
    for (const key of Object.keys(expected)) {
      diffValues(actual?.[key], expected[key], `${path}.${key}`, errors);
    }
    return;
  }
  if (actual !== expected) errors.push(`${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

describe('forecast parity', () => {
  it('matches teaching-hour and session series on dashboard sessions.json', () => {
    const sessions = load('sessions.json');
    const expected = load('forecast.json');
    const actual = buildForecast(sessions, expected.as_of_date);
    for (const metric of ['teaching_hours', 'sessions']) {
      const errors = [];
      diffValues(actual.series[metric], expected.series[metric], metric, errors);
      assert.equal(errors.length, 0, errors.slice(0, 8).join('\n'));
    }
  });

  it('matches forecast.json, including groups and baselines, on the pre-canonical session group codes', () => {
    const technicalPath = join(dirname(fileURLToPath(import.meta.url)), '../../output/technical/sessions.csv');
    const technical = parseCsv(readFileSync(technicalPath, 'utf8')).map((row) => ({
      ...row,
      duration_hours: row.duration_hours === '' ? null : Number(row.duration_hours),
      group_code: row.group_code || null,
    }));
    const expected = load('forecast.json');
    const actual = buildForecast(technical, expected.as_of_date);
    const errors = [];
    diffValues(actual, expected, 'forecast', errors);
    assert.equal(errors.length, 0, errors.slice(0, 12).join('\n'));
  });
});

describe('combined aggregates', () => {
  const base = {
    overview: load('overview.json'),
    activities: load('activities.json'),
    sessions: load('sessions.json'),
    instructors: load('instructors.json'),
    courses: load('courses.json'),
    feedback: load('feedback.json'),
    events: load('events.json'),
    diplomas: load('diplomas.json'),
    forecast: load('forecast.json'),
  };

  it('reproduces overview footer fields from base rows', () => {
    const overview = recomputeOverview(base.overview, base, { hasUploads: false });
    assert.equal(overview.as_of_date, base.overview.as_of_date);
    assert.equal(overview.total_feedback, base.overview.total_feedback);
    assert.equal(overview.total_feedback_expanded_rows, base.overview.total_feedback_expanded_rows);
    assert.equal(overview.feedback_instructor_match_rate, base.overview.feedback_instructor_match_rate);
    assert.equal(overview.comments_non_empty_count, base.overview.comments_non_empty_count);
    assert.equal(overview.clean_series_first_month, base.overview.clean_series_first_month);
    assert.equal(overview.forecast_excluded_low_date_confidence, base.overview.forecast_excluded_low_date_confidence);
    assert.deepEqual(overview.student_count_coverage, base.overview.student_count_coverage);
    assert.deepEqual(overview.teaching_hour_coverage, base.overview.teaching_hour_coverage);
    assert.equal(overview.completed_sessions, base.overview.completed_sessions);
    assert.equal(overview.planned_sessions, base.overview.planned_sessions);
    assert.equal(overview.completed_teaching_hours, base.overview.completed_teaching_hours);
    assert.equal(overview.legacy_sessions_provenance, base.overview.legacy_sessions_provenance);
    assert.equal(overview.comments_note, base.overview.comments_note);
  });

  it('leaves base-only combined output aligned with the shipped JSON', () => {
    const combined = combineDashboard(base, null, { today: '2026-10-04' });
    assert.equal(combined.sessions.length, base.sessions.length);
    assert.equal(combined.activities.length, base.activities.length);
    assert.equal(combined.instructors.length, base.instructors.length);
    assert.equal(combined.courses.length, base.courses.length);
    assert.equal(combined.events.length, base.events.length);
    assert.deepEqual(combined.diplomas, base.diplomas);
    assert.equal(combined.forecast.as_of_date, base.forecast.as_of_date);
    assert.equal(combined.forecast.observation_count, base.forecast.observation_count);
    assert.equal(combined.overview.total_feedback, 3742);
    assert.equal(combined.sessions[0], base.sessions[0]);
  });

  it('derives blank uploaded session status without mutating the source row', () => {
    const source = { session_id: 'SES_U000001', session_date: '2026-09-01', status_clean: null, status_basis: null, duration_hours: 2 };
    const completed = deriveSessionStatus(source, '2026-10-04');
    assert.equal(completed.status_clean, 'COMPLETED');
    assert.equal(completed.status_basis, 'DERIVED_FROM_DATE');
    assert.equal(source.status_clean, null);
    const planned = deriveSessionStatus({ ...source, session_date: '2026-12-01' }, '2026-10-04');
    assert.equal(planned.status_clean, 'PLANNED');
    const explicit = deriveSessionStatus({ ...source, status_clean: 'UNKNOWN', status_basis: 'EXPLICIT' }, '2026-10-04');
    assert.equal(explicit.status_basis, 'EXPLICIT');
  });

  it('extends diploma totals only from uploaded diploma sessions', () => {
    const merged = mergeDiplomas(base.diplomas, [
      { activity_type: 'DIPLOMA', diploma_type: 'MBA', session_date: '2026-09-16' },
      { activity_type: 'DIPLOMA', diploma_type: 'MBA', session_date: '2024-01-02' },
      { activity_type: 'INTERNAL', diploma_type: null, session_date: '2026-09-16' },
    ]);
    const mba = merged.find((row) => row.diploma_type === 'MBA');
    const dba = merged.find((row) => row.diploma_type === 'DBA');
    assert.equal(mba.session_count, 36);
    assert.equal(mba.date_min, '2024-01-02');
    assert.equal(mba.date_max, '2026-09-16');
    assert.equal(dba.session_count, 37);
    assert.equal(base.diplomas[1].session_count, 34);
  });

  it('counts distinct feedback ids after an upload and extends the forecast month', () => {
    const combined = combineDashboard(base, {
      instructors: [],
      courses: [],
      groups: [],
      sessions: [{
        session_id: 'SES_U000009',
        session_date: '2026-09-15',
        date_confidence: 'HIGH',
        status_clean: 'COMPLETED',
        status_basis: 'EXPLICIT',
        duration_hours: 4,
        group_code: 'MBA-G990',
        activity_type: 'INTERNAL',
      }],
      feedback: [
        { feedback_id: 'FB_NEW', instructor_match_status: 'MAPPED', student_comment: 'hello' },
        { feedback_id: 'FB_NEW', instructor_match_status: 'MAPPED', student_comment: '' },
      ],
      events: [{ event_id: 'EVT_U001', event_name: 'Extra', participant_count: 3 }],
    }, { today: '2026-10-04' });
    assert.equal(combined.overview.total_feedback, 3743);
    assert.equal(combined.overview.completed_sessions, 1538);
    assert.equal(combined.events.length, base.events.length + 1);
    assert.equal(combined.forecast.series.teaching_hours.periods.at(-1), '2026-09');
    assert.equal(combined.forecast.series.groups.periods.at(-1), '2026-09');
    assert.equal(combined.forecast.series.groups.actual[0], base.forecast.series.groups.actual[0]);
    assert.ok(combined.forecast.as_of_date >= '2026-09-15');
    assert.equal(combined.overview.legacy_sessions_provenance, base.overview.legacy_sessions_provenance);
  });
});

describe('escapeHtml', () => {
  it('neutralises markup from uploaded names and comments', () => {
    const raw = `<img src=x onerror="alert(1)"> & 'quote'`;
    const escaped = escapeHtml(raw);
    assert.equal(escaped.includes('<'), false);
    assert.equal(escaped.includes('>'), false);
    assert.match(escaped, /&lt;img/);
    assert.match(escaped, /&amp;/);
    assert.match(escaped, /&#39;quote&#39;/);
    assert.match(escaped, /&quot;/);
  });
});

describe('freshness label', () => {
  it('describes historical data, a failed upload load, and a recent import', () => {
    assert.equal(describeFreshness({}), 'Historical data only');
    assert.equal(
      describeFreshness({ uploadNotice: 'Uploaded data could not be loaded — showing historical data only' }),
      'Uploaded data could not be loaded — showing historical data only',
    );
    const label = describeFreshness({
      lastUpdatedAt: '2026-10-04T09:00:00.000Z',
      now: new Date('2026-10-04T09:05:00.000Z'),
    });
    assert.match(label, /^Data updated 5 minutes ago \(/);
  });
});
