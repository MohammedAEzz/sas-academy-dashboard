export function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthKeyOf(value) {
  if (!value) return null;
  const text = String(value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
}

export function dateKeyOf(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
