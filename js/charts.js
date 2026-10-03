/** ECharts wrappers with SAS design-system tokens and chart rules. */

const charts = new Map();

let themeLock = null;
let exportLayout = false;

function isDark() {
  if (themeLock === 'light') return false;
  if (themeLock === 'dark') return true;
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.theme === 'dark';
}

function fs(size) {
  return exportLayout ? size + 4 : size;
}

/** Light colours and larger type for print. Restores the previous theme afterwards. */
export function withExportCharts(fn) {
  const previousTheme = themeLock;
  const previousExport = exportLayout;
  themeLock = 'light';
  exportLayout = true;
  try {
    return fn();
  } finally {
    themeLock = previousTheme;
    exportLayout = previousExport;
  }
}

export const PALETTE = {
  EXTERNAL: { light: '#2a78d6', dark: '#3987e5' },
  INTERNAL: { light: '#eb6834', dark: '#d95926' },
  DIPLOMA: { light: '#1baf7a', dark: '#199e70' },
  EVENT: { light: '#eda100', dark: '#c98500' },
  slots: [
    { light: '#2a78d6', dark: '#3987e5' },
    { light: '#eb6834', dark: '#d95926' },
    { light: '#1baf7a', dark: '#199e70' },
    { light: '#eda100', dark: '#c98500' },
    { light: '#e87ba4', dark: '#d55181' },
    { light: '#008300', dark: '#008300' },
    { light: '#4a3aa7', dark: '#9085e9' },
    { light: '#e34948', dark: '#e66767' },
  ],
};

const ACTIVITY_COLOR = {
  EXTERNAL: () => colorFor('EXTERNAL'),
  INTERNAL: () => colorFor('INTERNAL'),
  DIPLOMA: () => colorFor('DIPLOMA'),
  EVENT: () => colorFor('EVENT'),
};

export function colorFor(entityOrSlot) {
  const dark = isDark();
  if (typeof entityOrSlot === 'number') {
    const slot = PALETTE.slots[entityOrSlot] || PALETTE.slots[0];
    return dark ? slot.dark : slot.light;
  }
  const key = String(entityOrSlot || '').toUpperCase();
  const entry = PALETTE[key];
  if (entry) return dark ? entry.dark : entry.light;
  return dark ? PALETTE.slots[0].dark : PALETTE.slots[0].light;
}

export function activityColor(type) {
  return ACTIVITY_COLOR[String(type || '').toUpperCase()]?.() || colorFor(0);
}

export function completedStyle() {
  const c = colorFor('EXTERNAL');
  return { color: c, fill: hexToRgba(c, 0.12) };
}

export function plannedStyle() {
  const c = colorFor('EXTERNAL');
  return { color: c, fill: hexToRgba(c, isDark() ? 0.08 : 0.06), dashed: true };
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ink() {
  return isDark() ? '#ffffff' : '#0b0b0b';
}

function inkSecondary() {
  return isDark() ? '#c3c2b7' : '#52514e';
}

function inkMuted() {
  return '#8a8984';
}

function surface() {
  return isDark() ? '#1a1a19' : '#fcfcfb';
}

function baseOption() {
  return {
    textStyle: { fontFamily: 'Inter, Segoe UI, system-ui, sans-serif', fontSize: fs(12), color: inkSecondary() },
    grid: { left: 20, right: 20, top: 48, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: inkMuted() } },
      backgroundColor: isDark() ? '#242423' : '#ffffff',
      borderColor: isDark() ? '#333330' : '#e5e4e0',
      textStyle: { color: ink(), fontSize: fs(12) },
    },
  };
}

function axisStyle() {
  return {
    axisLine: { lineStyle: { color: isDark() ? '#333330' : '#e5e4e0' } },
    axisTick: { show: false },
    axisLabel: { color: inkMuted(), fontSize: fs(11) },
    splitLine: { lineStyle: { color: isDark() ? '#2a2a28' : '#f0efec', type: 'dashed' } },
  };
}

function barSeriesItem(s, stacked) {
  const c = s.color || colorFor(0);
  return {
    type: 'bar',
    name: s.name,
    data: s.data,
    stack: stacked ? 'total' : undefined,
    barGap: '20%',
    barCategoryGap: stacked ? '2px' : '30%',
    itemStyle: {
      color: s.fill || c,
      borderColor: c,
      borderWidth: s.dashed ? 2 : 0,
      borderType: s.dashed ? 'dashed' : 'solid',
      borderRadius: s.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
    },
    emphasis: { itemStyle: { borderWidth: s.dashed ? 2 : 0 } },
    label: s.showLabel ? {
      show: true,
      position: s.horizontal ? 'right' : 'top',
      color: ink(),
      fontSize: fs(11),
      formatter: (p) => (p.value != null ? p.value : ''),
    } : undefined,
  };
}

function lineSeriesItem(s) {
  const c = s.color || colorFor(0);
  return {
    type: 'line',
    name: s.name,
    data: s.data,
    smooth: false,
    symbol: 'circle',
    symbolSize: exportLayout ? 10 : 8,
    showSymbol: true,
    lineStyle: { width: 2, color: c, type: s.dashed ? 'dashed' : 'solid' },
    itemStyle: { color: c, borderWidth: 2, borderColor: surface() },
    areaStyle: s.area ? { color: hexToRgba(c, 0.08) } : undefined,
  };
}

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

function initChart(el) {
  if (!el || !window.echarts) return null;
  const id = el.id || `chart-${Math.random().toString(36).slice(2)}`;
  el.id = id;
  disposeChart(id);
  const chart = window.echarts.init(el, null, { renderer: 'canvas' });
  charts.set(id, chart);
  return chart;
}

export function lineChartOption({ categories, series, yName = '', showLegend = null }) {
  const legend = showLegend ?? series.length > 1;
  const many = (categories || []).length > 12;
  const option = {
    ...baseOption(),
    legend: legend ? {
      top: 4, right: 8, textStyle: { color: inkSecondary(), fontSize: fs(12) },
      itemWidth: 10, itemHeight: 10,
    } : undefined,
    xAxis: { type: 'category', data: categories, ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, rotate: many ? 40 : 0 } },
    yAxis: { type: 'value', name: yName, nameTextStyle: { color: inkMuted(), fontSize: fs(12) }, ...axisStyle() },
    series: series.map(lineSeriesItem),
  };
  if (exportLayout) option.grid = { left: 16, right: 28, top: 56, bottom: many ? 84 : 40, containLabel: true };
  return option;
}

export function renderLineChart(el, spec) {
  const chart = initChart(el);
  if (!chart) return null;
  chart.setOption(lineChartOption(spec));
  return chart;
}

export function barChartOption({ categories, series, horizontal = false, stacked = false, showLegend = null }, width = 800) {
  const longest = horizontal
    ? categories.reduce((m, c) => Math.max(m, String(c ?? '').length), 0)
    : 0;
  const availableWidth = exportLayout ? 1600 : width;
  const labelLimit = exportLayout ? 80 : (availableWidth < 500 ? 15 : 42);
  const gutterCap = exportLayout ? 540 : (availableWidth < 500 ? 132 : Math.min(340, Math.round(availableWidth * 0.44)));
  const visibleLongest = Math.min(longest, labelLimit);
  const leftGutter = horizontal ? Math.min(gutterCap, Math.max(exportLayout ? 180 : 88, visibleLongest * 7 + 20)) : 20;
  const legend = showLegend ?? series.length > 1;
  const axis = horizontal
    ? {
        xAxis: { type: 'value', ...axisStyle() },
        yAxis: {
          type: 'category',
          data: categories,
          ...axisStyle(),
          axisLabel: {
            ...axisStyle().axisLabel,
            width: leftGutter - 16,
            overflow: exportLayout ? 'break' : 'truncate',
            ellipsis: '…',
            formatter: exportLayout ? undefined : (value) => {
              const label = String(value ?? '');
              return label.length > labelLimit ? `${label.slice(0, labelLimit - 1)}…` : label;
            },
          },
        },
      }
    : {
        xAxis: { type: 'category', data: categories, ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, rotate: exportLayout && categories.length > 8 ? 32 : 0 } },
        yAxis: { type: 'value', ...axisStyle() },
      };
  return {
    ...baseOption(),
    grid: {
      left: leftGutter,
      right: series.length === 1 ? (exportLayout ? 72 : 56) : 28,
      top: legend ? (exportLayout ? 56 : 48) : 20,
      bottom: !horizontal && categories.length > 8 ? (exportLayout ? 80 : 28) : (exportLayout ? 36 : 28),
    },
    tooltip: { ...baseOption().tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: legend ? { top: 4, right: 8, textStyle: { color: inkSecondary(), fontSize: fs(12) } } : undefined,
    ...axis,
    series: series.map((s) => barSeriesItem({ ...s, horizontal, showLabel: series.length <= 4 }, stacked)),
  };
}

export function renderBarChart(el, spec) {
  const chart = initChart(el);
  if (!chart) return null;
  chart.setOption(barChartOption(spec, el?.clientWidth || 800));
  return chart;
}

export function renderStackedBarChart(el, opts) {
  return renderBarChart(el, { ...opts, stacked: true });
}

export function renderDonut(el, { data, title = '' }) {
  const chart = initChart(el);
  if (!chart) return null;
  const colored = data.map((d, i) => ({
    ...d,
    itemStyle: { color: d.color || activityColor(d.activityType || d.name) || colorFor(i) },
  }));
  chart.setOption({
    ...baseOption(),
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: data.length >= 2 ? {
      orient: 'vertical', right: 12, top: 'center',
      textStyle: { color: inkSecondary() },
      formatter: (name) => name,
    } : undefined,
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['38%', '50%'],
      data: colored,
      label: {
        show: true,
        color: ink(),
        formatter: '{b}\n{d}%',
        fontSize: fs(11),
      },
      labelLine: { lineStyle: { color: inkMuted() } },
      itemStyle: { borderColor: surface(), borderWidth: 2 },
    }],
  });
  return chart;
}

export function renderGroupedBarChart(el, { categories, series, horizontal = false }) {
  return renderBarChart(el, { categories, series, horizontal, stacked: false, showLegend: true });
}

export function renderHistogram(el, { bins, title = '' }) {
  const chart = initChart(el);
  if (!chart) return null;
  chart.setOption({
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: bins.map((b) => b.label), ...axisStyle() },
    yAxis: { type: 'value', name: 'Instructors', ...axisStyle() },
    series: [{
      type: 'bar',
      data: bins.map((b) => b.count),
      itemStyle: { color: colorFor('INTERNAL'), borderRadius: [4, 4, 0, 0] },
      barWidth: '60%',
      label: { show: true, position: 'top', color: ink(), fontSize: fs(11) },
    }],
  });
  return chart;
}

export function forecastChartOption({ periods, actual, fitted, forecastPeriods, forecast, lower, upper }) {
  const allCats = [...periods, ...forecastPeriods];
  const comp = completedStyle();
  const plan = plannedStyle();
  const actualData = [...actual, ...forecastPeriods.map(() => null)];
  const fittedData = [...fitted, ...forecastPeriods.map(() => null)];
  const fcData = [...periods.map(() => null), ...forecast];
  const lowerData = [...periods.map(() => null), ...lower];
  const upperData = [...periods.map(() => null), ...upper];
  return {
    ...baseOption(),
    grid: exportLayout ? { left: 16, right: 24, top: 56, bottom: 88, containLabel: true } : baseOption().grid,
    legend: { top: 4, textStyle: { color: inkSecondary(), fontSize: fs(12) }, data: ['Actual', 'Fitted', 'Forecast'] },
    xAxis: { type: 'category', data: allCats, ...axisStyle(), axisLabel: { rotate: 35, color: inkMuted(), fontSize: fs(10) } },
    yAxis: { type: 'value', ...axisStyle() },
    series: [
      { ...lineSeriesItem({ name: 'Actual', data: actualData, color: comp.color }) },
      { ...lineSeriesItem({ name: 'Fitted', data: fittedData, color: inkMuted(), dashed: true }) },
      { ...lineSeriesItem({ name: 'Forecast', data: fcData, color: plan.color, dashed: true }) },
      { name: 'Lower bound', type: 'line', data: lowerData, lineStyle: { opacity: 0 }, showSymbol: false, stack: 'band', areaStyle: { opacity: 0 }, tooltip: { show: false } },
      {
        name: 'Forecast range', type: 'line', data: upperData.map((value, index) => (value == null || lowerData[index] == null ? null : value - lowerData[index])),
        lineStyle: { opacity: 0 }, showSymbol: false, stack: 'band',
        areaStyle: { color: hexToRgba(plan.color, 0.16) }, tooltip: { show: false },
      },
    ],
  };
}

export function renderForecastChart(el, spec) {
  const chart = initChart(el);
  if (!chart) return null;
  chart.setOption(forecastChartOption(spec));
  return chart;
}

export function divergingBarOption({ categories, values, max = 5 }) {
  const mid = max / 2;
  return {
    ...baseOption(),
    grid: { left: exportLayout ? 340 : 190, right: exportLayout ? 64 : 40, top: 24, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value', min: 1, max,
      ...axisStyle(),
      axisLine: { onZero: true, lineStyle: { color: inkMuted() } },
    },
    yAxis: {
      type: 'category',
      data: categories,
      ...axisStyle(),
      ...(exportLayout ? { axisLabel: { ...axisStyle().axisLabel, width: 310, overflow: 'break' } } : {}),
    },
    series: [{
      type: 'bar',
      data: values.map((v) => ({
        value: v,
        itemStyle: {
          color: v >= mid + 0.5 ? colorFor('DIPLOMA') : v <= mid - 0.5 ? colorFor(7) : inkMuted(),
          borderRadius: [0, 4, 4, 0],
        },
      })),
      label: {
        show: true,
        position: 'right',
        color: ink(),
        ...(exportLayout ? { fontSize: fs(11) } : {}),
        formatter: (p) => (p.value != null ? Number(p.value).toFixed(2) : ''),
      },
      barWidth: exportLayout ? 22 : 16,
    }],
  };
}

export function renderDivergingBar(el, spec) {
  const chart = initChart(el);
  if (!chart) return null;
  chart.setOption(divergingBarOption(spec));
  return chart;
}

export function buildChartOption(kind, spec) {
  if (kind === 'line') return lineChartOption(spec);
  if (kind === 'bar') return barChartOption(spec, 1600);
  if (kind === 'forecast') return forecastChartOption(spec);
  if (kind === 'diverging') return divergingBarOption(spec);
  throw new Error(`Unknown chart kind: ${kind}`);
}

export function resizeCharts() {
  charts.forEach((c) => c.resize());
}

/** @deprecated use colorFor */
export const COLORS = {
  get primary() { return colorFor('EXTERNAL'); },
  get completed() { return colorFor('EXTERNAL'); },
  get planned() { return colorFor('EXTERNAL'); },
  get external() { return colorFor('EXTERNAL'); },
  get internal() { return colorFor('INTERNAL'); },
  palette: PALETTE.slots.map((s) => s.light),
};
