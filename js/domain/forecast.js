import { monthKeyOf } from './dates.js';
import { roundDigits } from './round.js';

const METHOD = 'Holt-Winters additive exponential smoothing (period=12)';
const CAPACITY_FORMULA = 'forecast teaching hours (direct) — cross-check: group_starts/mo × sessions/group × hours/session';
const SERIES_SOURCE = 'legacy_sessions';

/** Non-planned sessions with a date and HIGH date confidence. */
export function trendSessions(sessions) {
  return (sessions || []).filter((session) => (
    session.status_clean !== 'PLANNED'
    && session.session_date
    && session.date_confidence === 'HIGH'
  ));
}

function groupCode(session) {
  const code = session.group_code;
  if (code == null || code === '') return null;
  return String(code);
}

export function monthlySeries(sessions) {
  const trend = trendSessions(sessions);
  const empty = { teaching_hours: [], sessions: [], groups: [] };
  if (!trend.length) return empty;
  const buckets = new Map();
  for (const session of trend) {
    const period = monthKeyOf(session.session_date);
    if (!period) continue;
    if (!buckets.has(period)) buckets.set(period, { hours: 0, sessions: 0, groups: new Set() });
    const bucket = buckets.get(period);
    if (session.duration_hours != null && session.duration_hours !== '') {
      bucket.hours += Number(session.duration_hours) || 0;
    }
    bucket.sessions += 1;
    const code = groupCode(session);
    if (code) bucket.groups.add(code);
  }
  const periods = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  return {
    teaching_hours: periods.map((period) => ({ period, value: buckets.get(period).hours })),
    sessions: periods.map((period) => ({ period, value: buckets.get(period).sessions })),
    groups: periods.map((period) => ({ period, value: buckets.get(period).groups.size })),
  };
}

export function holtWintersAdditive(values, period = 12, alpha = 0.4, beta = 0.15, gamma = 0.3, horizon = 12) {
  const n = values.length;
  if (n < period + 1) {
    let level = values[0];
    const fitted = [];
    for (const value of values) {
      fitted.push(level);
      level = alpha * value + (1 - alpha) * level;
    }
    const forecasts = Array(horizon).fill(level);
    const residStd = n > 1
      ? Math.sqrt(values.reduce((sum, value, index) => sum + (value - fitted[index]) ** 2, 0) / Math.max(n - 1, 1))
      : Math.abs(values[0]) * 0.15 || 1;
    const lower = forecasts.map((forecast, index) => forecast - 1.96 * residStd * Math.sqrt(index + 1));
    const upper = forecasts.map((forecast, index) => forecast + 1.96 * residStd * Math.sqrt(index + 1));
    return { fitted, forecasts, lower, upper };
  }

  const seasons = Array.from({ length: period }, () => []);
  values.forEach((value, index) => seasons[index % period].push(value));
  let seasonal = seasons.map((bucket) => (bucket.length ? bucket.reduce((sum, value) => sum + value, 0) / bucket.length : 0));
  const mean0 = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  seasonal = seasonal.map((value) => value - mean0);
  let level = mean0;
  let trend = period ? (values[period] - values[0]) / period : 0;

  const fitted = [];
  for (let index = 0; index < n; index += 1) {
    const value = values[index];
    const seasonIndex = index % period;
    const prevLevel = level;
    const prevTrend = trend;
    const prevSeason = seasonal[seasonIndex];
    level = alpha * (value - prevSeason) + (1 - alpha) * (prevLevel + prevTrend);
    trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    seasonal[seasonIndex] = gamma * (value - level) + (1 - gamma) * prevSeason;
    fitted.push(level + trend + seasonal[seasonIndex]);
  }

  const resid = values.map((value, index) => value - fitted[index]);
  const residStd = n > 1
    ? Math.sqrt(resid.reduce((sum, value) => sum + value * value, 0) / Math.max(n - 1, 1))
    : 1;
  const forecasts = [];
  const lower = [];
  const upper = [];
  for (let step = 1; step <= horizon; step += 1) {
    const seasonIndex = (n + step - 1) % period;
    const point = level + step * trend + seasonal[seasonIndex];
    const spread = 1.96 * residStd * Math.sqrt(step);
    forecasts.push(Math.max(0, point));
    lower.push(Math.max(0, point - spread));
    upper.push(point + spread);
  }
  return { fitted, forecasts, lower, upper };
}

function horizonLabels(startPeriod, count) {
  let [year, month] = startPeriod.split('-').map(Number);
  const labels = [];
  for (let index = 0; index < count; index += 1) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    labels.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
  }
  return labels;
}

function horizonBlock(startPeriod, point, lower, upper) {
  return {
    periods: horizonLabels(startPeriod, point.length),
    point: point.map((value) => roundDigits(value, 2)),
    lower: lower.map((value) => roundDigits(value, 2)),
    upper: upper.map((value) => roundDigits(value, 2)),
  };
}

export function capacityBaselines(sessions) {
  const trend = trendSessions(sessions);
  const empty = {
    avg_sessions_per_group: 0,
    avg_hours_per_session: 0,
    avg_group_starts_per_month: 0,
    historical_hours_per_month: 0,
  };
  if (!trend.length) return empty;
  const byGroup = new Map();
  const months = new Set();
  for (const session of trend) {
    const month = monthKeyOf(session.session_date);
    if (month) months.add(month);
    const code = groupCode(session);
    if (!code) continue;
    if (!byGroup.has(code)) byGroup.set(code, { sessions: 0, hours: 0, first: String(session.session_date) });
    const bucket = byGroup.get(code);
    bucket.sessions += 1;
    if (session.duration_hours != null && session.duration_hours !== '') {
      bucket.hours += Number(session.duration_hours) || 0;
    }
    if (String(session.session_date) < bucket.first) bucket.first = String(session.session_date);
  }
  const groups = [...byGroup.values()];
  const totalSessions = groups.reduce((sum, group) => sum + group.sessions, 0);
  const totalHours = groups.reduce((sum, group) => sum + group.hours, 0);
  const avgSessions = groups.length ? groups.reduce((sum, group) => sum + group.sessions, 0) / groups.length : 0;
  const avgHours = totalSessions ? totalHours / totalSessions : 0;
  const nMonths = months.size;
  const startsPerMonth = nMonths ? groups.length / nMonths : 0;
  return {
    avg_sessions_per_group: roundDigits(avgSessions, 2),
    avg_hours_per_session: roundDigits(avgHours, 2),
    avg_group_starts_per_month: roundDigits(startsPerMonth, 2),
    historical_hours_per_month: nMonths ? roundDigits(totalHours / nMonths, 1) : 0,
  };
}

export function buildForecast(sessions, asOfDate) {
  const monthly = monthlySeries(sessions);
  const observationCount = monthly.teaching_hours.length;
  const limitations = `Only ~${observationCount} monthly observations available (clean series from 2024-03). A 12-period seasonal Holt-Winters model is under-identified with fewer than ~24 months; forecasts are indicative scenario ranges, not operational targets.`;
  const series = {};
  for (const metric of ['teaching_hours', 'sessions', 'groups']) {
    const rows = monthly[metric];
    const periods = rows.map((row) => row.period);
    const values = rows.map((row) => Number(row.value));
    if (!values.length) {
      series[metric] = { periods: [], actual: [], fitted: [], forecasts: {} };
      continue;
    }
    const short = holtWintersAdditive(values, 12, 0.4, 0.15, 0.3, 3);
    const mid = holtWintersAdditive(values, 12, 0.4, 0.15, 0.3, 6);
    const long = holtWintersAdditive(values, 12, 0.4, 0.15, 0.3, 12);
    const lastPeriod = periods[periods.length - 1];
    series[metric] = {
      periods,
      actual: values.map((value) => roundDigits(value, 2)),
      fitted: short.fitted.map((value) => roundDigits(value, 2)),
      forecasts: {
        '3_month': horizonBlock(lastPeriod, short.forecasts, short.lower, short.upper),
        '6_month': horizonBlock(lastPeriod, mid.forecasts, mid.lower, mid.upper),
        '12_month': horizonBlock(lastPeriod, long.forecasts, long.lower, long.upper),
      },
      source: SERIES_SOURCE,
    };
  }
  return {
    as_of_date: asOfDate,
    method: METHOD,
    observation_count: observationCount,
    limitations,
    series,
    capacity_baselines: capacityBaselines(sessions),
    capacity_formula: CAPACITY_FORMULA,
    source: SERIES_SOURCE,
  };
}

/** Identity used when extending the published group series with uploaded rows. */
export function groupKey(session) {
  if (session.group_code) return `g:${session.group_code}`;
  if (session.activity_type === 'DIPLOMA' && session.diploma_type) return `d:${session.diploma_type}`;
  if (session.activity_id) return `a:${session.activity_id}`;
  return null;
}

function keysByMonth(sessions) {
  const map = new Map();
  for (const session of trendSessions(sessions)) {
    const period = monthKeyOf(session.session_date);
    const key = groupKey(session);
    if (!period || !key) continue;
    if (!map.has(period)) map.set(period, new Set());
    map.get(period).add(key);
  }
  return map;
}

function seriesFromActual(periods, actual) {
  const values = actual.map(Number);
  if (!values.length) return { periods: [], actual: [], fitted: [], forecasts: {}, source: SERIES_SOURCE };
  const short = holtWintersAdditive(values, 12, 0.4, 0.15, 0.3, 3);
  const mid = holtWintersAdditive(values, 12, 0.4, 0.15, 0.3, 6);
  const long = holtWintersAdditive(values, 12, 0.4, 0.15, 0.3, 12);
  const lastPeriod = periods[periods.length - 1];
  return {
    periods,
    actual: values.map((value) => roundDigits(value, 2)),
    fitted: short.fitted.map((value) => roundDigits(value, 2)),
    forecasts: {
      '3_month': horizonBlock(lastPeriod, short.forecasts, short.lower, short.upper),
      '6_month': horizonBlock(lastPeriod, mid.forecasts, mid.lower, mid.upper),
      '12_month': horizonBlock(lastPeriod, long.forecasts, long.lower, long.upper),
    },
    source: SERIES_SOURCE,
  };
}

/**
 * Keep published group counts for months already in forecast.json, then add
 * uploaded group keys that are not already visible on the base rows.
 * forecast.json counted pre-canonical group codes that sessions.json no longer stores.
 */
export function extendGroupSeries(baseForecast, baseSessions, uploadedSessions) {
  const published = baseForecast?.series?.groups;
  const baseKeys = keysByMonth(baseSessions);
  const uploadKeys = keysByMonth(uploadedSessions);
  const periods = new Set(published?.periods || []);
  for (const period of uploadKeys.keys()) periods.add(period);
  const ordered = [...periods].sort((a, b) => a.localeCompare(b));
  const publishedActual = new Map((published?.periods || []).map((period, index) => [period, published.actual[index]]));
  const actual = ordered.map((period) => {
    const known = baseKeys.get(period) || new Set();
    let extra = 0;
    for (const key of uploadKeys.get(period) || []) {
      if (!known.has(key)) extra += 1;
    }
    if (publishedActual.has(period)) return publishedActual.get(period) + extra;
    return (baseKeys.get(period)?.size || 0) + extra;
  });
  return seriesFromActual(ordered, actual);
}

export function forecastFromCombined({ baseForecast, baseSessions, sessions, uploadedSessions, asOfDate }) {
  if (!trendSessions(uploadedSessions).length) return baseForecast;
  const forecast = buildForecast(sessions, asOfDate);
  forecast.series.groups = extendGroupSeries(baseForecast, baseSessions, uploadedSessions);
  forecast.source = 'combined';
  return forecast;
}
