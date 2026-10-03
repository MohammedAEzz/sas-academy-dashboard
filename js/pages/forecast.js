import { fmt } from '../metrics.js';
import { renderAnswerBand, renderSectionIntro } from '../components.js';
import { renderForecastChart } from '../charts.js';

let capacityState = { hoursPerInstructor: 30, horizon: '6_month', metric: 'teaching_hours' };

const metricLabels = { teaching_hours: 'Teaching hours', sessions: 'Sessions', groups: 'Groups' };

export function forecastViewState() {
  return { ...capacityState };
}

export function forecastCapacity({ forecast, activeCount, hoursPerInstructor = 30, horizon = '6_month' }) {
  const baselines = forecast.capacity_baselines || {};
  const hoursSeries = forecast.series.teaching_hours.forecasts[horizon];
  const months = hoursSeries.point.length;
  const demand = hoursSeries.point.reduce((sum, value) => sum + value, 0);
  const available = activeCount * hoursPerInstructor * months;
  const required = demand / (hoursPerInstructor * months);
  const gap = demand - available;
  const crossCheck = Number(baselines.avg_group_starts_per_month || 0)
    * Number(baselines.avg_sessions_per_group || 0)
    * Number(baselines.avg_hours_per_session || 0) * months;
  return { months, demand, available, required, gap, crossCheck, baselines };
}

export function forecastChartSpec(forecast, metric = 'teaching_hours', horizon = '6_month') {
  const series = forecast.series[metric];
  const selectedForecast = series.forecasts[horizon];
  return {
    periods: series.periods,
    actual: series.actual,
    fitted: series.fitted,
    forecastPeriods: selectedForecast.periods,
    forecast: selectedForecast.point,
    lower: selectedForecast.lower,
    upper: selectedForecast.upper,
    selectedForecast,
  };
}

export function renderForecast(app, { data }) {
  const forecast = data.forecast;
  const baselines = forecast.capacity_baselines || {};
  const activeCount = data.instructors.filter((instructor) => instructor.status === 'Active').length;

  const computeCapacity = () => forecastCapacity({
    forecast,
    activeCount,
    hoursPerInstructor: capacityState.hoursPerInstructor,
    horizon: capacityState.horizon,
  });

  const capacity = computeCapacity();
  const gapLabel = capacity.gap > 0 ? `${fmt(capacity.gap, 'hours')} shortfall` : `${fmt(Math.abs(capacity.gap), 'hours')} surplus`;

  app.innerHTML = `
    ${renderAnswerBand({
      eyebrow: 'Forecast and capacity',
      title: `${fmt(capacity.demand, 'hours')} of expected demand requires ${fmt(capacity.required, 'number')} instructor equivalents`,
      summary: `Under the explicit assumption of ${fmt(capacityState.hoursPerInstructor, 'int')} available teaching hours per active instructor per month, the ${capacity.months}-month scenario shows a ${gapLabel}. This is planning evidence, not observed availability.`,
      metrics: [
        { label: 'Expected demand', value: fmt(capacity.demand, 'hours'), sub: `${capacity.months}-month teaching-hours forecast` },
        { label: 'Required equivalents', value: fmt(capacity.required, 'number'), sub: 'Assumption-based' },
        { label: 'Assumed capacity', value: fmt(capacity.available, 'hours'), sub: `${activeCount} active instructors` },
        { label: 'Gap', value: gapLabel, sub: 'Scenario result' },
      ],
    })}

    <div class="note-box warning-box"><strong>Forecast caveat:</strong> ${forecast.limitations}</div>

    ${renderSectionIntro('1 · Decision path', 'PAST → EXPECTED DEMAND → AVAILABLE CAPACITY → GAP', 'The teaching-hours forecast is the demand source; group starts are a cross-check only.')}
    <div class="flow-ribbon">
      <div class="flow-step"><span>Past</span><strong>${fmt(forecast.observation_count, 'int')} months</strong><p>HIGH-confidence, non-planned series from Mar 2024</p></div>
      <div class="flow-step"><span>Expected demand</span><strong id="flow-demand">${fmt(capacity.demand, 'hours')}</strong><p>Teaching-hours forecast directly</p></div>
      <div class="flow-step"><span>Available capacity</span><strong id="flow-capacity">${fmt(capacity.available, 'hours')}</strong><p id="flow-capacity-note">${activeCount} active × ${capacityState.hoursPerInstructor}h × ${capacity.months} months</p></div>
      <div class="flow-step"><span>Gap</span><strong id="flow-gap">${gapLabel}</strong><p>Scenario assumption, not observed data</p></div>
    </div>

    ${renderSectionIntro('2 · Supporting evidence', 'Historical fit and expected range', 'The shaded interval is model output, not observed delivery.')}
    <div class="story-grid">
      <section class="evidence-panel story-primary">
        <div class="panel-header"><div><h3>Actual, fitted, and forecast</h3><p>${forecast.method}</p></div><div class="rank-controls" style="margin:0"><label>Metric <select id="fc-metric"><option value="teaching_hours">Teaching hours</option><option value="sessions">Sessions</option><option value="groups">Groups</option></select></label><label>Horizon <select id="fc-horizon"><option value="3_month">3 months</option><option value="6_month">6 months</option><option value="12_month">12 months</option></select></label></div></div>
        <div class="chart-container tall" id="forecast-chart"></div>
        <div class="metric-strip" id="forecast-summary" style="margin:16px 0 0"></div>
      </section>
      <aside class="insight-panel story-support">
        <div class="panel-kicker">Scenario assumptions</div>
        <h3>Capacity is user-controlled</h3>
        <p>No instructor availability, contracted-hours, leave, or utilisation data exists.</p>
        <div class="filter-field" style="margin-top:20px"><label for="capacity-hours">Available hours per instructor / month</label><input type="number" class="filter-input" id="capacity-hours" min="1" max="200" value="${capacityState.hoursPerInstructor}"></div>
        <ul class="insight-list"><li><span>Active roster</span><strong>${fmt(activeCount, 'int')}</strong></li><li><span>Horizon</span><strong id="scenario-horizon">${capacity.months} months</strong></li><li><span>Required equivalents</span><strong id="scenario-required">${fmt(capacity.required, 'number')}</strong></li></ul>
      </aside>
    </div>

    ${renderSectionIntro('3 · Diagnostic detail', 'Capacity reconciliation', 'Demand and its group-start cross-check remain visibly distinct.')}
    <div class="metric-strip" id="capacity-reconciliation">
      <div class="metric-strip-item"><span>Forecast demand</span><strong>${fmt(capacity.demand, 'hours')}</strong><small>Teaching-hours series</small></div>
      <div class="metric-strip-item"><span>Cross-check</span><strong>${fmt(capacity.crossCheck, 'hours')}</strong><small>Starts/mo × sessions/group × hours/session</small></div>
      <div class="metric-strip-item"><span>Group starts / month</span><strong>${fmt(baselines.avg_group_starts_per_month, 'number')}</strong><small>Historical baseline</small></div>
      <div class="metric-strip-item"><span>Scenario gap</span><strong>${gapLabel}</strong><small>User-entered capacity assumption</small></div>
    </div>
  `;

  const metricSelect = app.querySelector('#fc-metric');
  const horizonSelect = app.querySelector('#fc-horizon');
  metricSelect.value = capacityState.metric;
  horizonSelect.value = capacityState.horizon;

  const update = () => {
    const chartSpec = forecastChartSpec(forecast, capacityState.metric, capacityState.horizon);
    const selectedForecast = chartSpec.selectedForecast;
    renderForecastChart(document.getElementById('forecast-chart'), chartSpec);
    const total = selectedForecast.point.reduce((sum, value) => sum + value, 0);
    const low = selectedForecast.lower.reduce((sum, value) => sum + value, 0);
    const high = selectedForecast.upper.reduce((sum, value) => sum + value, 0);
    document.getElementById('forecast-summary').innerHTML = `
      <div class="metric-strip-item"><span>${metricLabels[capacityState.metric]} forecast</span><strong>${capacityState.metric === 'teaching_hours' ? fmt(total, 'hours') : fmt(total, 'number')}</strong><small>${selectedForecast.periods.length} periods</small></div>
      <div class="metric-strip-item"><span>Range low</span><strong>${fmt(low, 'number')}</strong><small>Model interval total</small></div>
      <div class="metric-strip-item"><span>Range high</span><strong>${fmt(high, 'number')}</strong><small>Model interval total</small></div>
      <div class="metric-strip-item"><span>Observed months</span><strong>${fmt(forecast.observation_count, 'int')}</strong><small>Seasonality remains under-identified</small></div>`;

    const current = computeCapacity();
    const currentGap = current.gap > 0 ? `${fmt(current.gap, 'hours')} shortfall` : `${fmt(Math.abs(current.gap), 'hours')} surplus`;
    document.getElementById('flow-demand').textContent = fmt(current.demand, 'hours');
    document.getElementById('flow-capacity').textContent = fmt(current.available, 'hours');
    document.getElementById('flow-capacity-note').textContent = `${activeCount} active × ${capacityState.hoursPerInstructor}h × ${current.months} months`;
    document.getElementById('flow-gap').textContent = currentGap;
    document.getElementById('scenario-horizon').textContent = `${current.months} months`;
    document.getElementById('scenario-required').textContent = fmt(current.required, 'number');
    document.getElementById('capacity-reconciliation').innerHTML = `
      <div class="metric-strip-item"><span>Forecast demand</span><strong>${fmt(current.demand, 'hours')}</strong><small>Teaching-hours series</small></div>
      <div class="metric-strip-item"><span>Cross-check</span><strong>${fmt(current.crossCheck, 'hours')}</strong><small>Starts/mo × sessions/group × hours/session</small></div>
      <div class="metric-strip-item"><span>Required equivalents</span><strong>${fmt(current.required, 'number')}</strong><small>At ${capacityState.hoursPerInstructor}h per month</small></div>
      <div class="metric-strip-item"><span>Scenario gap</span><strong>${currentGap}</strong><small>User-entered assumption</small></div>`;
  };

  metricSelect.addEventListener('change', (event) => { capacityState.metric = event.target.value; update(); });
  horizonSelect.addEventListener('change', (event) => { capacityState.horizon = event.target.value; update(); });
  app.querySelector('#capacity-hours')?.addEventListener('input', (event) => { capacityState.hoursPerInstructor = Number(event.target.value) || 30; update(); });
  update();
}
