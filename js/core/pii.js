/** Redact emails and runs of 9+ digits (Arabic-Indic digits count). */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const LONG_DIGIT_RE = /(?<![0-9٠-٩])[0-9٠-٩]{9,}(?![0-9٠-٩])/g;
export const REDACTED_PII = "[REDACTED-PII]";

export function redactPii(value) {
  const original = value == null ? "" : String(value);
  if (!original) return { text: "", redactions: 0, changed: false };
  let redactions = 0;
  const text = original
    .replace(EMAIL_RE, () => {
      redactions += 1;
      return REDACTED_PII;
    })
    .replace(LONG_DIGIT_RE, () => {
      redactions += 1;
      return REDACTED_PII;
    });
  return { text, redactions, changed: text !== original };
}
