export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function inspectUploadFile(file) {
  if (!file) return 'Choose a .csv or .xlsx file.';
  const name = String(file.name || '');
  if (!/\.(csv|xlsx)$/i.test(name)) return 'Upload a .csv or .xlsx file.';
  if (file.size > MAX_UPLOAD_BYTES) return 'The file is larger than 4 MB. Split it into smaller files.';
  return '';
}
