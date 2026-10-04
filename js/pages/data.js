import { DATASET_IDS, DATASETS } from '../core/schema.js';
import { escapeHtml } from '../core/escape.js';
import { inspectUploadFile } from '../domain/upload-file.js';
import {
  commitImport, friendlyError, importHistory, login, logout, previewImport, revertImport, session,
} from '../api-client.js';
import { paginate } from '../components.js';

const FEEDS = {
  instructors: {
    purpose: 'People who teach. New names become available to groups, sessions, and feedback.',
    feeds: 'Instructors, Overview roster, Forecast capacity',
  },
  courses: {
    purpose: 'The course catalogue. Groups, sessions, and feedback must use these names.',
    feeds: 'Programs, Groups, Overview',
  },
  groups: {
    purpose: 'One offering: a group code, course, instructor, language, and status.',
    feeds: 'Groups, Programs clients, Overview',
  },
  sessions: {
    purpose: 'Dated lectures. Diploma lectures update the diploma summary.',
    feeds: 'Overview, Groups, Instructors, Programs diplomas, Forecast',
  },
  feedback: {
    purpose: 'Learner responses. Counts use distinct feedback ids, including when one response names several instructors.',
    feeds: 'Feedback, Overview, Groups, Instructors, Programs',
  },
  events: {
    purpose: 'Workshops, bootcamps, hackathons, and other events.',
    feeds: 'Programs events',
  },
};

const PAGE_SIZE = 25;
const state = {
  authenticated: false,
  authChecked: false,
  dataset: 'instructors',
  file: null,
  fileError: '',
  preview: null,
  previewFilter: 'all',
  previewPage: 1,
  busy: false,
  status: '',
  error: '',
  success: null,
  history: [],
  historyError: '',
  expanded: '',
  focus: '',
  revertId: '',
};

function statusClass(status) {
  if (status === 'valid') return 'chip-valid';
  if (status === 'duplicate') return 'chip-duplicate';
  if (status === 'conflict') return 'chip-conflict';
  return 'chip-error';
}

function formatValue(value) {
  if (value == null || value === '') return 'blank';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowDetails(row) {
  const parts = [];
  for (const error of row.errors || []) {
    parts.push(`<li><strong>${escapeHtml(error.column || 'field')}</strong>: ${escapeHtml(error.message || '')} <span class="fix">${escapeHtml(error.fix || '')}</span>${error.value != null && error.value !== '' ? ` <span class="muted">Value: ${escapeHtml(formatValue(error.value))}</span>` : ''}</li>`);
  }
  for (const notice of row.notices || []) {
    parts.push(`<li class="notice">${escapeHtml(notice.message || notice.column || '')}</li>`);
  }
  if (row.duplicateOf) parts.push(`<li>Duplicate of ${escapeHtml(row.duplicateOf)}.</li>`);
  const sources = row.conflict?.sources || [];
  for (const source of sources) {
    const fields = (source.fields || []).map((field) => `${escapeHtml(field.field)} (uploaded ${escapeHtml(formatValue(field.uploaded))}, existing ${escapeHtml(formatValue(field.existing))})`).join('; ');
    parts.push(`<li>Conflict with ${escapeHtml(source.source || 'an existing record')}${fields ? `: ${fields}` : ''}.</li>`);
  }
  if (!parts.length) return '';
  return `<ul class="row-detail">${parts.join('')}</ul>`;
}

function columnReference(dataset) {
  const columns = DATASETS[dataset].columns.map((column) => `
    <tr>
      <td><code>${escapeHtml(column.id)}</code></td>
      <td>${column.required ? 'Required' : 'Optional'}</td>
      <td>${escapeHtml(column.type || 'text')}</td>
      <td>${escapeHtml(column.format || '—')}</td>
      <td>${escapeHtml(column.units || '—')}</td>
      <td>${column.values ? escapeHtml(column.values.join(', ')) : '—'}</td>
      <td>${escapeHtml(column.description || '')}</td>
    </tr>`).join('');
  return `<details class="column-reference"><summary>Column reference</summary>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Column</th><th>Required</th><th>Type</th><th>Format</th><th>Units</th><th>Allowed values</th><th>Description</th></tr></thead><tbody>${columns}</tbody></table></div>
  </details>`;
}

function templatesSection() {
  return `<section class="data-section" aria-labelledby="templates-heading">
    <div class="section-intro"><div><span>Templates</span><h3 id="templates-heading">Download a template, then upload one dataset at a time</h3></div><p>Templates and the column reference are available without signing in. Example files show the format only: example rows are rejected if uploaded unchanged.</p></div>
    <div class="dataset-grid">
      ${DATASET_IDS.map((id) => {
        const copy = FEEDS[id];
        const label = DATASETS[id].label;
        return `<article class="dataset-card">
          <h3>${escapeHtml(label)}</h3>
          <p>${escapeHtml(copy.purpose)}</p>
          <p class="feeds"><span>Feeds</span> ${escapeHtml(copy.feeds)}</p>
          <div class="button-row">
            <a class="btn btn-primary" href="/api/templates?dataset=${id}&format=xlsx">Excel template</a>
            <a class="btn" href="/api/templates?dataset=${id}&format=csv">CSV template</a>
            <a class="btn" href="/api/templates?dataset=${id}&format=example-csv">Example CSV</a>
          </div>
          ${columnReference(id)}
        </article>`;
      }).join('')}
    </div>
  </section>`;
}

function adminGate() {
  if (!state.authenticated) {
    return `<form class="login-form" id="login-form">
      <h3>Sign in to upload</h3>
      <label for="admin-password">Password</label>
      <input class="filter-input" id="admin-password" name="password" type="password" autocomplete="current-password" required>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>`;
  }
  return `<div class="admin-bar"><p>Signed in as admin.</p><button class="btn" type="button" id="sign-out">Sign out</button></div>`;
}

function previewSection() {
  const preview = state.preview;
  if (!preview) return '';
  const counts = preview.counts || {};
  const valid = Number(counts.valid || 0);
  const rows = (preview.rows || []).filter((row) => state.previewFilter === 'all' || row.status === state.previewFilter);
  const page = paginate(rows, state.previewPage, PAGE_SIZE);
  const fileErrors = preview.fileErrors || [];
  return `<section class="data-section" id="preview-panel" aria-labelledby="preview-title">
    <h3 id="preview-title" tabindex="-1">Preview · ${escapeHtml(DATASETS[preview.dataset]?.label || preview.dataset)} · ${escapeHtml(preview.filename || '')}</h3>
    ${preview.alreadyImportedMessage ? `<div class="note-box warning-box" role="status">${escapeHtml(preview.alreadyImportedMessage)}</div>` : ''}
    ${fileErrors.map((error) => `<div class="note-box critical-box">${escapeHtml(error.message || '')}</div>`).join('')}
    <div class="count-chips" aria-label="Row counts">
      ${['valid', 'duplicate', 'conflict', 'error'].map((key) => `<span class="count-chip ${statusClass(key)}">${escapeHtml(key)} ${escapeHtml(counts[key] ?? 0)}</span>`).join('')}
    </div>
    <p class="import-note">Duplicates, conflicts, and errors will not be imported. Only valid rows are saved.</p>
    <div class="preview-toolbar">
      <label for="preview-filter">Show</label>
      <select class="filter-input" id="preview-filter">
        ${['all', 'valid', 'duplicate', 'conflict', 'error'].map((key) => `<option value="${key}"${state.previewFilter === key ? ' selected' : ''}>${key}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap"><table class="data-table preview-table">
      <thead><tr><th>Row</th><th>Status</th><th>Message</th></tr></thead>
      <tbody>
        ${page.rows.map((row) => `<tr>
          <td class="num">${escapeHtml(row.rowNumber)}</td>
          <td><span class="count-chip ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
          <td>${escapeHtml(row.message || '')}${rowDetails(row)}</td>
        </tr>`).join('') || '<tr><td colspan="3" class="card-empty">No rows for this filter</td></tr>'}
      </tbody>
    </table></div>
    <div class="table-footer"><span>${page.total} rows</span><div class="pagination">Page ${page.page} of ${page.pages}<button class="btn btn-sm" type="button" id="preview-prev" ${page.page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn btn-sm" type="button" id="preview-next" ${page.page >= page.pages ? 'disabled' : ''}>Next</button></div></div>
    <div class="button-row">
      <button class="btn btn-primary" type="button" id="commit-import" ${valid === 0 ? 'disabled' : ''}>Import ${valid} valid rows</button>
      <button class="btn" type="button" id="cancel-preview">Cancel</button>
    </div>
  </section>`;
}

function successSection() {
  if (!state.success) return '';
  const item = state.success;
  return `<section class="note-box" id="import-success" tabindex="-1" role="status">
    <strong>Imported ${escapeHtml(item.imported)} rows</strong> from ${escapeHtml(item.filename)} into ${escapeHtml(DATASETS[item.dataset]?.label || item.dataset)}.
    ${item.changedSincePreview ? ' The file changed between preview and import, so the saved counts differ from the preview.' : ''}
    The dashboard has been refreshed.
  </section>`;
}

function historySection() {
  if (!state.authenticated) return '';
  const rows = state.history.map((item) => {
    const active = !item.revertedAt;
    const skipped = item.skipped || [];
    return `<tbody class="history-block">
      <tr>
        <td>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString() : '')}</td>
        <td>${escapeHtml(DATASETS[item.dataset]?.label || item.dataset)}</td>
        <td>${escapeHtml(item.filename)}</td>
        <td class="num">${escapeHtml(item.importedCount)}</td>
        <td class="num">${escapeHtml(item.duplicateCount)}</td>
        <td class="num">${escapeHtml(item.conflictCount)}</td>
        <td class="num">${escapeHtml(item.errorCount)}</td>
        <td>${active ? 'Active' : 'Reverted'}</td>
        <td>${active ? `<button class="btn btn-sm" type="button" data-revert="${escapeHtml(item.id)}">Revert</button>` : escapeHtml(item.revertReason || '')}</td>
      </tr>
      <tr><td colspan="9"><details ${state.expanded === item.id ? 'open' : ''} data-history="${escapeHtml(item.id)}"><summary>Skipped rows (${skipped.length})</summary>
        ${skipped.length ? `<ul class="row-detail">${skipped.map((row) => `<li>Row ${escapeHtml(row.rowNumber)} · ${escapeHtml(row.status)} · ${escapeHtml(row.message || '')}</li>`).join('')}</ul>` : '<p class="muted">No skipped rows stored for this import.</p>'}
      </details></td></tr>
    </tbody>`;
  }).join('');
  return `<section class="data-section" aria-labelledby="history-heading">
    <h3 id="history-heading">Import history</h3>
    ${state.historyError ? `<div class="note-box critical-box">${escapeHtml(state.historyError)}</div>` : ''}
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Dataset</th><th>File</th><th class="num">Imported</th><th class="num">Duplicate</th><th class="num">Conflict</th><th class="num">Error</th><th>Status</th><th></th></tr></thead>
      ${rows || '<tbody><tr><td colspan="9" class="card-empty">No imports yet</td></tr></tbody>'}
    </table></div>
  </section>`;
}

function uploadSection() {
  if (!state.authenticated) return '';
  return `<section class="data-section" aria-labelledby="upload-heading">
    <h3 id="upload-heading">Upload</h3>
    <form id="upload-form" class="upload-form">
      <div class="filter-field"><label for="upload-dataset">Dataset</label>
        <select class="filter-input" id="upload-dataset" name="dataset">${DATASET_IDS.map((id) => `<option value="${id}"${state.dataset === id ? ' selected' : ''}>${escapeHtml(DATASETS[id].label)}</option>`).join('')}</select>
      </div>
      <div class="filter-field"><label for="upload-file">File</label>
        <input class="filter-input" id="upload-file" name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      </div>
      <button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>Preview</button>
    </form>
    ${state.fileError ? `<div class="note-box critical-box">${escapeHtml(state.fileError)}</div>` : ''}
    ${successSection()}
    ${previewSection()}
    ${historySection()}
  </section>`;
}

function applyFocus(app) {
  if (!state.focus) return;
  const target = state.focus === 'preview'
    ? app.querySelector('#preview-title')
    : app.querySelector('#import-success');
  target?.focus();
  state.focus = '';
}

async function loadHistory() {
  try {
    const payload = await importHistory();
    state.history = payload.imports || [];
    state.historyError = '';
  } catch (error) {
    state.history = [];
    state.historyError = friendlyError(error);
    if (error.status === 401) state.authenticated = false;
  }
}

export function renderData(app, context) {
  app.innerHTML = `
    <div class="page-header"><h2>Data</h2><p>Templates, column reference, and admin upload for the six dashboard datasets.</p></div>
    <div id="data-status" class="visually-hidden" aria-live="polite">${escapeHtml(state.status)}</div>
    ${state.error ? `<div class="note-box critical-box" role="alert">${escapeHtml(state.error)}</div>` : ''}
    ${templatesSection()}
    <section class="data-section" aria-labelledby="admin-heading">
      <h3 id="admin-heading">Admin</h3>
      ${adminGate()}
      ${uploadSection()}
    </section>
    <dialog id="revert-dialog" aria-labelledby="revert-title">
      <form id="revert-form">
        <h3 id="revert-title">Revert this import?</h3>
        <p id="revert-copy">Active rows from this file will disappear from the dashboard. Later imports that still use them must be reverted first.</p>
        <label for="revert-reason">Reason (optional)</label>
        <textarea class="filter-input" id="revert-reason" maxlength="500"></textarea>
        <div class="button-row">
          <button class="btn" type="button" id="revert-cancel">Cancel</button>
          <button class="btn btn-primary" type="submit" id="revert-confirm">Revert import</button>
        </div>
      </form>
    </dialog>`;

  const rerender = () => {
    if (app.dataset.route !== 'data') return;
    renderData(app, context);
  };
  app.querySelector('#login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = new FormData(event.target).get('password');
    state.busy = true;
    state.error = '';
    state.status = 'Signing in';
    rerender();
    try {
      await login(password);
      state.authenticated = true;
      state.status = 'Signed in';
      await loadHistory();
    } catch (error) {
      state.error = friendlyError(error);
      state.status = state.error;
    } finally {
      state.busy = false;
      rerender();
    }
  });
  app.querySelector('#sign-out')?.addEventListener('click', async () => {
    try { await logout(); } catch { /* The local session is cleared either way. */ }
    state.authenticated = false;
    state.history = [];
    state.preview = null;
    state.success = null;
    state.status = 'Signed out';
    rerender();
  });
  app.querySelector('#upload-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const dataset = form.querySelector('#upload-dataset').value;
    const file = form.querySelector('#upload-file').files[0];
    state.dataset = dataset;
    state.fileError = inspectUploadFile(file);
    state.error = '';
    state.success = null;
    if (state.fileError) {
      state.status = state.fileError;
      rerender();
      return;
    }
    state.busy = true;
    state.status = 'Preparing preview';
    rerender();
    try {
      state.preview = await previewImport({ dataset, file });
      state.file = file;
      state.previewFilter = 'all';
      state.previewPage = 1;
      state.focus = 'preview';
      state.status = `Preview ready. ${state.preview.counts?.valid || 0} valid rows.`;
    } catch (error) {
      state.preview = null;
      state.file = null;
      if (error.status === 401) state.authenticated = false;
      const fileErrors = error.details?.fileErrors;
      state.error = fileErrors?.length
        ? fileErrors.map((item) => item.message).join(' ')
        : friendlyError(error);
      state.status = state.error;
    } finally {
      state.busy = false;
      rerender();
    }
  });
  app.querySelector('#preview-filter')?.addEventListener('change', (event) => {
    state.previewFilter = event.target.value;
    state.previewPage = 1;
    rerender();
  });
  app.querySelector('#preview-prev')?.addEventListener('click', () => { state.previewPage -= 1; rerender(); });
  app.querySelector('#preview-next')?.addEventListener('click', () => { state.previewPage += 1; rerender(); });
  app.querySelector('#cancel-preview')?.addEventListener('click', () => {
    state.preview = null;
    state.file = null;
    state.status = 'Preview cancelled';
    rerender();
  });
  app.querySelector('#commit-import')?.addEventListener('click', async () => {
    if (!state.preview || !state.file) return;
    state.busy = true;
    state.error = '';
    state.status = 'Importing';
    const snapshot = { dataset: state.dataset, file: state.file, preview: state.preview };
    rerender();
    try {
      const result = await commitImport({
        dataset: snapshot.dataset,
        file: snapshot.file,
        sha256: snapshot.preview.sha256,
        previewCounts: snapshot.preview.counts,
      });
      state.success = {
        imported: result.imported,
        changedSincePreview: result.changedSincePreview,
        filename: snapshot.preview.filename,
        dataset: snapshot.dataset,
      };
      state.preview = null;
      state.file = null;
      state.busy = false;
      state.focus = 'success';
      state.status = `Imported ${result.imported} rows. Dashboard refreshed.`;
      await loadHistory();
      await context.reload();
    } catch (error) {
      if (error.status === 401) state.authenticated = false;
      state.error = friendlyError(error);
      state.status = state.error;
      state.busy = false;
      rerender();
    }
  });
  app.querySelectorAll('[data-revert]').forEach((button) => {
    button.addEventListener('click', () => {
      state.revertId = button.dataset.revert;
      const dialog = app.querySelector('#revert-dialog');
      app.querySelector('#revert-reason').value = '';
      dialog.showModal();
    });
  });
  app.querySelector('#revert-cancel')?.addEventListener('click', () => app.querySelector('#revert-dialog')?.close());
  app.querySelector('#revert-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const importId = state.revertId;
    const reason = app.querySelector('#revert-reason').value;
    app.querySelector('#revert-dialog')?.close();
    state.error = '';
    state.status = 'Reverting import';
    try {
      await revertImport(importId, reason);
      state.status = 'Import reverted. Dashboard refreshed.';
      state.success = null;
      await loadHistory();
      await context.reload();
    } catch (error) {
      if (error.status === 401) state.authenticated = false;
      state.error = friendlyError(error);
      state.status = state.error;
      rerender();
    }
  });
  if (!state.authChecked) {
    state.authChecked = true;
    session().then(async (payload) => {
      state.authenticated = Boolean(payload?.authenticated);
      if (state.authenticated) await loadHistory();
      rerender();
    }).catch(() => { state.authenticated = false; });
  }
  applyFocus(app);
}
