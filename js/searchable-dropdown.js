/** Lightweight searchable select — no framework deps. */

export function createSearchableSelect({
  id, label, options, value, placeholder = 'All', onChange, wide = false,
}) {
  const selected = options.find((o) => o.value === value);
  const display = selected ? selected.label : placeholder;

  const wrapper = document.createElement('div');
  wrapper.className = `filter-field searchable-select${wide ? ' wide' : ''}`;
  wrapper.innerHTML = `
    <label for="${id}-trigger">${label}</label>
    <div class="searchable-select" data-id="${id}">
      <button type="button" class="searchable-select-trigger" id="${id}-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="${selected ? '' : 'placeholder'}">${display}</span>
        <span class="chevron">▾</span>
      </button>
      <div class="searchable-dropdown" role="listbox">
        <input type="search" placeholder="Search…" aria-label="Search ${label}">
        <div class="searchable-options"></div>
      </div>
    </div>
  `;

  const root = wrapper.querySelector('.searchable-select');
  const trigger = wrapper.querySelector('.searchable-select-trigger');
  const dropdown = wrapper.querySelector('.searchable-dropdown');
  const searchInput = wrapper.querySelector('input[type="search"]');
  const optionsEl = wrapper.querySelector('.searchable-options');
  let highlightIdx = -1;

  function renderOptions(filter = '') {
    const q = filter.toLowerCase();
    const filtered = [{ value: '', label: placeholder }, ...options.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q),
    )];
    if (filtered.length <= 1 && q) {
      optionsEl.innerHTML = '<div class="searchable-empty">No matches</div>';
      return;
    }
    optionsEl.innerHTML = filtered.map((o, i) => `
      <div class="searchable-option${o.value === value ? ' selected' : ''}${i === highlightIdx ? ' highlighted' : ''}"
           role="option" data-value="${o.value}" tabindex="-1">${o.label}</div>
    `).join('');
    optionsEl.querySelectorAll('.searchable-option').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        close();
        onChange(el.dataset.value);
      });
    });
  }

  function open() {
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    highlightIdx = -1;
    searchInput.value = '';
    renderOptions();
    searchInput.focus();
  }

  function close() {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) close();
    else open();
  });

  searchInput.addEventListener('input', () => {
    highlightIdx = -1;
    renderOptions(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = [...optionsEl.querySelectorAll('.searchable-option')];
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightIdx = Math.min(highlightIdx + 1, items.length - 1); renderOptions(searchInput.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIdx = Math.max(highlightIdx - 1, 0); renderOptions(searchInput.value); }
    else if (e.key === 'Enter' && highlightIdx >= 0 && items[highlightIdx]) {
      e.preventDefault();
      close();
      onChange(items[highlightIdx].dataset.value);
    } else if (e.key === 'Escape') close();
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });

  return wrapper;
}
