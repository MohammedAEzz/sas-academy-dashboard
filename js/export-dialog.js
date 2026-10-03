import { getFilters, describeAppliedFilters } from './filters.js';
import { downloadReportPdf } from './export-pdf.js';

function filterSummary(idx) {
  const labels = describeAppliedFilters(getFilters(), idx);
  return labels.length ? labels : ['No filters applied'];
}

function hasActiveFilters() {
  const filters = getFilters();
  return Boolean(
    filters.dateFrom || filters.dateTo || filters.activityType || filters.groupCode
    || filters.courseId || filters.instructorId || filters.language || filters.status,
  );
}

export function mountExportDialog({ getData, getIdx }) {
  const button = document.getElementById('export-pdf');
  if (!button || button.dataset.bound === '1') return;
  button.dataset.bound = '1';

  const modal = document.createElement('div');
  modal.className = 'export-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="export-modal-card" role="dialog" aria-modal="true" aria-labelledby="export-pdf-title">
      <h2 id="export-pdf-title">Export PDF report</h2>
      <p class="export-modal-lead">The report is built from the latest combined data, not a screenshot of the page.</p>
      <fieldset>
        <legend>Scope</legend>
        <label><input type="radio" name="export-scope" value="current"> Current filters</label>
        <label><input type="radio" name="export-scope" value="full"> Full dataset (all filters cleared)</label>
      </fieldset>
      <div class="export-filter-list" id="export-filter-list"></div>
      <p class="export-status" id="export-status" role="status"></p>
      <div class="export-modal-actions">
        <button type="button" class="btn btn-primary" id="export-generate">Generate PDF</button>
        <button type="button" class="btn" id="export-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const status = modal.querySelector('#export-status');
  const generate = modal.querySelector('#export-generate');
  let busy = false;

  const refresh = () => {
    const labels = filterSummary(getIdx());
    modal.querySelector('#export-filter-list').innerHTML = `<p>Active filters</p><ul>${labels.map((label) => `<li>${label.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</li>`).join('')}</ul>`;
    const current = modal.querySelector('input[value="current"]');
    const full = modal.querySelector('input[value="full"]');
    if (hasActiveFilters()) current.checked = true;
    else full.checked = true;
    status.textContent = '';
  };

  const close = () => {
    if (busy) return;
    modal.hidden = true;
  };

  button.addEventListener('click', () => {
    refresh();
    modal.hidden = false;
    generate.focus();
  });
  modal.querySelector('#export-cancel').addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  generate.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    generate.disabled = true;
    button.disabled = true;
    status.textContent = 'Generating the report…';
    const scope = modal.querySelector('input[name="export-scope"]:checked')?.value || 'full';
    try {
      await downloadReportPdf({
        data: getData(),
        idx: getIdx(),
        scope,
        filters: getFilters(),
        onProgress: (message) => { status.textContent = message; },
      });
      status.textContent = 'PDF downloaded.';
    } catch (error) {
      status.textContent = 'The PDF could not be generated. Please try again.';
      console.error(error);
    } finally {
      busy = false;
      generate.disabled = false;
      button.disabled = false;
    }
  });
}
