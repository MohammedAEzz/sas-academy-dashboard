import { fmt } from '../metrics.js';
import { renderChartCard, renderKpiGrid } from '../components.js';
import { renderForecastChart } from '../charts.js';

let capacityState = { hoursPerInstructor: 30, horizon: '6_month', metric: 'teaching_hours' };

export function renderForecast(app, { data }) {
  const forecast = data.forecast;
  const baselines = forecast.capacity_baselines || {};

  app.innerHTML = `
    <div class="page-header"><h2>Forecast &amp; Capacity</h2><p>Scenario planning — separate from historical achievement</p></div>

    <div class="note-box warning-box">
      <strong>Forecast caveat:</strong> ${forecast.limitations}
    </div>

    <div class="forecast-section">
      <h3>Forecast (pre-computed)</h3>
      <p>Method: ${forecast.method} · ${forecast.observation_count} monthly observations</p>
      <div class="rank-controls">
        <label>Metric:
          <select id="fc-metric">
            <option value="teaching_hours">Teaching Hours</option>
            <option value="sessions">Sessions</option>
            <option value="groups">Groups</option>
          </select>
        </label>
        <label>Horizon:
          <select id="fc-horizon">
            <option value="3_month">3 months</option>
            <option value="6_month" selected>6 months</option>
            <option value="12_month">12 months</option>
          </select>
        </label>
      </div>
      ${renderChartCard('fc-chart', 'Fitted vs Actual & Forecast', 'Shaded band = scenario range (not observed data)', true)}
      <div id="fc-summary"></div>
    </div>

    <div class="forecast-section" style="margin-top:24px">
      <h3>Capacity Scenario (assumptions only)</h3>
      <div class="note-box">No instructor availability or contracted-hours data exists. All capacity figures below are computed from assumptions you control — not observed facts.</div>
      <div class="capacity-controls">
        <div class="filter-group">
          <label>Assumed available hours per instructor per month</label>
          <input type="number" id="cap-hours" value="${capacityState.hoursPerInstructor}" min="1" max="200">
        </div>
        <div class="filter-group">
          <label>Forecast horizon for capacity</label>
          <select id="cap-horizon">
            <option value="3_month">3 months</option>
            <option value="6_month" selected>6 months</option>
            <option value="12_month">12 months</option>
          </select>
        </div>
      </div>
      <div id="capacity-results"></div>
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
      title: `${metric.replace(/_/g, ' ')} — ${horizon.replace('_', ' ')}`,
    });
    const totalFc = fc.point.reduce((s, v) => s + v, 0);
    document.getElementById('fc-summary').innerHTML = renderKpiGrid([
      { label: 'Forecast Total', value: fmt(totalFc, 'number'), sub: `Sum of ${fc.periods.length} periods` },
      { label: 'Range Low', value: fmt(fc.lower.reduce((s, v) => s + v, 0), 'number') },
      { label: 'Range High', value: fmt(fc.upper.reduce((s, v) => s + v, 0), 'number') },
    ]);
    updateCapacity();
  };

  const updateCapacity = () => {
    const horizon = app.querySelector('#cap-horizon')?.value || capacityState.horizon;
    const hoursPerInst = Number(app.querySelector('#cap-hours')?.value) || capacityState.hoursPerInstructor;
    capacityState.hoursPerInstructor = hoursPerInst;
    capacityState.horizon = horizon;

    // Demand comes from the forecast TEACHING HOURS series directly, so the capacity
    // figures agree with the forecast chart above. The groups x sessions x hours
    // decomposition is shown only as a cross-check, and it uses group STARTS per month
    // (each group contributes its sessions once) rather than groups active per month.
    const hoursFc = forecast.series.teaching_hours.forecasts[horizon];
    const months = hoursFc.point.length;
    const forecastHours = hoursFc.point.reduce((s, v) => s + v, 0);
    const avgGroups = baselines.avg_group_starts_per_month || 0;
    const avgSessPerGroup = baselines.avg_sessions_per_group || 0;
    const avgHrsPerSess = baselines.avg_hours_per_session || 0;
    const crossCheck = avgGroups * avgSessPerGroup * avgHrsPerSess * months;
    const availablePerMonth = hoursPerInst * data.instructors.filter((i) => i.status === 'Active').length;
    const totalAvailable = availablePerMonth * months;
    const requiredEquiv = forecastHours / (hoursPerInst * months) || 0;
    const gap = forecastHours - totalAvailable;

    document.getElementById('capacity-results').innerHTML = `
      ${renderKpiGrid([
        { label: 'Forecast Hours Required', value: fmt(forecastHours, 'hours'), sub: `Forecast teaching hours over ${months} months` },
        { label: 'Group Starts / month', value: fmt(avgGroups, 'number'), sub: 'Historical baseline (cross-check)' },
        { label: 'Avg Sessions/Group', value: fmt(avgSessPerGroup, 'number'), sub: 'Historical completed baseline' },
        { label: 'Avg Hours/Session', value: fmt(avgHrsPerSess, 'number'), sub: 'Historical completed baseline' },
        { label: 'Cross-check Hours', value: fmt(crossCheck, 'hours'), sub: 'starts/mo × sessions/group × hours/session' },
        { label: 'Assumed Available Hours', value: fmt(totalAvailable, 'hours'), sub: `${data.instructors.filter((i) => i.status === 'Active').length} active × ${hoursPerInst}h × ${months} mo` },
        { label: 'Required Instructor Equivalents', value: fmt(requiredEquiv, 'number'), sub: 'Assumption-based' },
        { label: 'Capacity Gap', value: fmt(gap, 'hours'), sub: gap > 0 ? 'Shortfall (assumption)' : 'Surplus (assumption)' },
      ])}
    `;
  };

  app.querySelector('#fc-metric')?.addEventListener('change', (e) => { capacityState.metric = e.target.value; updateForecastChart(); });
  app.querySelector('#fc-horizon')?.addEventListener('change', (e) => { capacityState.horizon = e.target.value; updateForecastChart(); });
  app.querySelector('#cap-hours')?.addEventListener('input', updateCapacity);
  app.querySelector('#cap-horizon')?.addEventListener('change', updateCapacity);

  updateForecastChart();
}
