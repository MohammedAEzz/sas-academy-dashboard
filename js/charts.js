const COLORS = {
  primary: '#0d5c8c',
  secondary: '#4a90a4',
  completed: '#1a7f4b',
  planned: '#6b4fa0',
  external: '#c45c26',
  internal: '#0d5c8c',
  diploma: '#7a5c1e',
  event: '#2d6a6a',
  muted: '#94a3b8',
  palette: ['#0d5c8c', '#1a7f4b', '#6b4fa0', '#c45c26', '#2d6a6a', '#7a5c1e', '#4a90a4', '#b45309'],
};

const charts = new Map();

export function disposeChart(id) {
  if (charts.has(id)) {
    charts.get(id).dispose();
    charts.delete(id);
  }
}

export function disposeAllCharts() {
  charts.forEach((c) => c.dispose());
  charts.clear();
}

function baseOption() {
  return {
    color: COLORS.palette,
    textStyle: { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: 12 },
    grid: { left: 48, right: 24, top: 40, bottom: 32 },
    tooltip: { trigger: 'axis' },
  };
}

export function renderLineChart(el, { title, categories, series, yName = '' }) {
  if (!el || !window.echarts) return;
  const id = el.id || `chart-${Math.random()}`;
  el.id = id;
  disposeChart(id);
  const chart = window.echarts.init(el);
  charts.set(id, chart);
  chart.setOption({
    ...baseOption(),
    title: title ? { text: title, textStyle: { fontSize: 13, fontWeight: 600 } } : undefined,
    xAxis: { type: 'category', data: categories, axisLabel: { rotate: categories.length > 12 ? 45 : 0 } },
    yAxis: { type: 'value', name: yName },
    legend: series.length > 1 ? { top: 0, right: 0 } : undefined,
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.data,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2 },
      itemStyle: { color: s.color },
    })),
  });
  return chart;
}

export function renderBarChart(el, { title, categories, series, horizontal = false, stacked = false }) {
  if (!el || !window.echarts) return;
  const id = el.id || `chart-${Math.random()}`;
  el.id = id;
  disposeChart(id);
  const chart = window.echarts.init(el);
  charts.set(id, chart);
  // Horizontal bars carry long labels (instructor and course names). Reserve gutter
  // width proportional to the longest label so names are not clipped, and keep a
  // sane ceiling so the plot area stays usable.
  const longest = horizontal
    ? categories.reduce((m, c) => Math.max(m, String(c ?? '').length), 0)
    : 0;
  const leftGutter = horizontal ? Math.min(220, Math.max(90, longest * 7 + 16)) : 48;
  const axis = horizontal
    ? {
        xAxis: { type: 'value' },
        yAxis: {
          type: 'category',
          data: categories,
          axisLabel: {
            width: leftGutter - 12,
            overflow: 'truncate',
            ellipsis: '…',
          },
        },
      }
    : { xAxis: { type: 'category', data: categories }, yAxis: { type: 'value' } };
  chart.setOption({
    ...baseOption(),
    grid: { left: leftGutter, right: 24, top: 40, bottom: 32 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    title: title ? { text: title, textStyle: { fontSize: 13, fontWeight: 600 } } : undefined,
    ...axis,
    legend: series.length > 1 ? { top: 0, right: 0 } : undefined,
    series: series.map((s) => ({
      type: 'bar',
      name: s.name,
      data: s.data,
      stack: stacked ? 'total' : undefined,
      itemStyle: { color: s.color },
    })),
  });
  return chart;
}

export function renderDonut(el, { title, data }) {
  if (!el || !window.echarts) return;
  const id = el.id || `chart-${Math.random()}`;
  el.id = id;
  disposeChart(id);
  const chart = window.echarts.init(el);
  charts.set(id, chart);
  chart.setOption({
    ...baseOption(),
    title: title ? { text: title, textStyle: { fontSize: 13, fontWeight: 600 } } : undefined,
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', right: 10, top: 'center' },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      center: ['40%', '50%'],
      data,
      label: { formatter: '{b}: {d}%' },
    }],
  });
  return chart;
}

export function renderForecastChart(el, { periods, actual, fitted, forecastPeriods, forecast, lower, upper, title }) {
  if (!el || !window.echarts) return;
  const id = el.id || `chart-${Math.random()}`;
  el.id = id;
  disposeChart(id);
  const chart = window.echarts.init(el);
  charts.set(id, chart);
  const allCats = [...periods, ...forecastPeriods];
  const actualData = [...actual, ...forecastPeriods.map(() => null)];
  const fittedData = [...fitted, ...forecastPeriods.map(() => null)];
  const fcData = [...periods.map(() => null), ...forecast];
  const lowerData = [...periods.map(() => null), ...lower];
  const upperData = [...periods.map(() => null), ...upper];
  chart.setOption({
    ...baseOption(),
    title: title ? { text: title, textStyle: { fontSize: 13, fontWeight: 600 } } : undefined,
    xAxis: { type: 'category', data: allCats, axisLabel: { rotate: 45 } },
    yAxis: { type: 'value' },
    legend: { top: 0 },
    series: [
      { name: 'Actual', type: 'line', data: actualData, itemStyle: { color: COLORS.primary } },
      { name: 'Fitted', type: 'line', data: fittedData, lineStyle: { type: 'dashed' }, itemStyle: { color: COLORS.secondary } },
      { name: 'Forecast', type: 'line', data: fcData, itemStyle: { color: COLORS.planned } },
      { name: 'Lower', type: 'line', data: lowerData, lineStyle: { opacity: 0 }, showSymbol: false, stack: 'band' },
      { name: 'Upper', type: 'line', data: upperData, lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(107,79,160,0.15)' }, showSymbol: false, stack: 'band' },
    ],
  });
  return chart;
}

export function resizeCharts() {
  charts.forEach((c) => c.resize());
}

export { COLORS };
