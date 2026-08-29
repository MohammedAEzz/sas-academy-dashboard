import { fmt } from '../metrics.js';
import { renderChartCard, renderKpiGrid } from '../components.js';
import { renderForecastChart, colorFor } from '../charts.js';

let capacityState = { hoursPerInstructor: 30, horizon: '6_month', metric: 'teaching_hours' };

export function renderForecast(app, { data }) {
  const forecast = data.forecast;
  const baselines = forecast.capacity_baselines || {};
  const activeCount = data.instructors.filter((i) => i.status === 'Active').length;

  app.innerHTML = `
    <div class="page-header">
      <h2>Forecast &amp; Capacity</h2>
      <p>Scenario planning — separate from historical achievement metrics</p>
    </div>

    <div class="note-box warning-box">
      <strong>Forecast caveat:</strong> ${forecast.limitations}
    </div>

    <div class="forecast-narrative" id="narrative-steps">
      <div class="narrative-step">
        <div class="step-num">Step 1</div>
        <h4>History</h4>
        <p>${forecast.observation_count} monthly observations from Mar 2024 (HIGH confidence, non-planned)</p>
      </div>
      <div class="narrative-step">
        <div class="step-num">Step 2</div>
        <h4>Forecast</h4>
        <p id="narr-step-forecast">Seasonal model projection over selected horizon</p>
      </div>
      <div class="narrative-step">
        <div class="step-num">Step 3</div>
        <h4>Required Capacity</h4>
        <p id="narr-step-capacity">Derived from forecast teaching-hours demand</p>
      </div>
      <div class="narrative-step">
        <div class="step-num">Step 4</div>
        <h4>Gap</h4>
        <p id="narr-step-gap">Assumption-based shortfall or surplus</p>
      </div>
    </div>

    <div class="forecast-section">
      <h3 style="margin:0 0 16px">Forecast Model</h3>
      <p style="margin:0 0 16px;color:var(--text-secondary);font-size:13px">Method: ${forecast.method}</p>
      <div class="rank-controls">
        <label>Metric
          <select id="fc-metric" class="filter-input" style="height:32px">
            <option value="teaching_hours">Teaching Hours</option>
            <option value="sessions">Sessions</option>
            <option value="groups">Groups</option>
          </select>
        </label>
        <label>Horizon
          <select id="fc-horizon" class="filter-input" style="height:32px">
            <option value="3_month">3 months</option>
            <option value="6_month" selected>6 months</option>
            <option value="12_month">12 months</option>
          </select>
        </label>
      </div>
      ${renderChartCard('fc-chart', 'Fitted vs Actual & Forecast', 'Shaded band = confidence range (not observed data)', 12)}
      <div id="fc-summary"></div>
    </div>

    <div class="forecast-section">
      <h3 style="margin:0 0 8px">Capacity Scenario</h3>
      <div class="note-box">Assumptions only — no instructor availability or contracted-hours data exists. All capacity figures are computed from inputs you control.</div>
      <div class="capacity-controls">
        <div class="filter-field">
          <label for="cap-hours">Assumed available hours per instructor per month</label>
          <input type="number" class="filter-input" id="cap-hours" value="${capacityState.hoursPerInstructor}" min="1" max="200">
        </div>
        <div class="filter-field">
          <label for="cap-horizon">Forecast horizon for capacity</label>
          <select class="filter-input" id="cap-horizon">
            <option value="3_month">3 months</option>
            <option value="6_month" selected>6 months</option>
            <option value="12_month">12 months</option>
          </select>
        </div>
      </div>
      <div id="capacity-results" class="capacity-result"></div>
    </div>
  `;

  const updateForecastChart = () => {
    const metric = capacityState.metric;
    const horizon = capacityState.horizon;
    const series = forecast.series[metric];
    const fc = series.forecasts[horizon];
    renderForecastChart(document.getElementById('fc-chart'), {
      periods: series.periods,
      actual: series.actual,
      fitted: series.fitted,
      forecastPeriods: fc.periods,
      forecast: fc.point,
      lower: fc.lower,
      upper: fc.upper,
    });
    const totalFc = fc.point.reduce((s, v) => s + v, 0);
    document.getElementById('fc-summary').innerHTML = renderKpiGrid([
      { label: 'Forecast Total', value: fmt(totalFc, 'number'), sub: `Sum over ${fc.periods.length} periods` },
      { label: 'Range Low', value: fmt(fc.lower.reduce((s, v) => s + v, 0), 'number') },
      { label: 'Range High', value: fmt(fc.upper.reduce((s, v) => s + v, 0), 'number') },
    ]);
    updateCapacity(totalFc, fc.periods.length);
  };

  const updateCapacity = (forecastHoursOverride, monthsOverride) => {
    const horizon = app.querySelector('#cap-horizon')?.value || capacityState.horizon;
    const hoursPerInst = Number(app.querySelector('#cap-hours')?.value) || capacityState.hoursPerInstructor;
    capacityState.hoursPerInstructor = hoursPerInst;
    capacityState.horizon = horizon;

    const hoursFc = forecast.series.teaching_hours.forecasts[horizon];
    const months = monthsOverride || hoursFc.point.length;
    const forecastHours = forecastHoursOverride ?? hoursFc.point.reduce((s, v) => s + v, 0);
    const avgGroups = baselines.avg_group_starts_per_month || 0;
    const avgSessPerGroup = baselines.avg_sessions_per_group || 0;
    const avgHrsPerSess = baselines.avg_hours_per_session || 0;
    const crossCheck = avgGroups * avgSessPerGroup * avgHrsPerSess * months;
    const availablePerMonth = hoursPerInst * activeCount;
    const totalAvailable = availablePerMonth * months;
    const requiredEquiv = forecastHours / (hoursPerInst * months) || 0;
    const gap = forecastHours - totalAvailable;

    document.getElementById('narr-step-forecast').textContent = `${fmt(forecastHours, 'hours')} teaching hours over ${months} months`;
    document.getElementById('narr-step-capacity').textContent = `${fmt(requiredEquiv, 'number')} instructor equivalents at ${hoursPerInst}h/mo`;
    document.getElementById('narr-step-gap').textContent = gap > 0
      ? `${fmt(gap, 'hours')} shortfall (assumption)`
      : `${fmt(Math.abs(gap), 'hours')} surplus (assumption)`;

    document.getElementById('capacity-results').innerHTML = `
      ${renderKpiGrid([
        { label: 'Forecast Hours Required', value: fmt(forecastHours, 'hours'), sub: `From forecast teaching-hours series · ${months} months` },
        { label: 'Cross-check Hours', value: fmt(crossCheck, 'hours'), sub: 'Group starts/mo × sessions/group × hours/session' },
        { label: 'Group Starts / month', value: fmt(avgGroups, 'number'), sub: 'Historical baseline' },
        { label: 'Assumed Available', value: fmt(totalAvailable, 'hours'), sub: `${activeCount} active × ${hoursPerInst}h × ${months} mo` },
        { label: 'Required Equivalents', value: fmt(requiredEquiv, 'number'), sub: 'Assumption-based' },
        { label: 'Capacity Gap', value: fmt(gap, 'hours'), sub: gap > 0 ? 'Shortfall (assumption)' : 'Surplus (assumption)' },
      ])}
    `;
  };

  app.querySelector('#fc-metric')?.addEventListener('change', (e) => { capacityState.metric = e.target.value; updateForecastChart(); });
  app.querySelector('#fc-horizon')?.addEventListener('change', (e) => { capacityState.horizon = e.target.value; updateForecastChart(); });
  app.querySelector('#cap-hours')?.addEventListener('input', () => updateCapacity());
  app.querySelector('#cap-horizon')?.addEventListener('change', () => updateCapacity());

  updateForecastChart();
}
