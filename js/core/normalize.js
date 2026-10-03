/** Shared normalizers for names, group codes, dates, and times. */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const JUNK = new Set(["nan", "none", "nat", "null", "<na>", "undefined"]);
const LEADING_TITLE = /^(?:dr|eng|prof|professor|mr|mrs|ms|doc)\.?\s+/i;
const TRAILING_TITLE = /\s+(?:dr|eng|prof|professor|mr|mrs|ms|doc)\.?$/i;

export function isBlank(value) {
  if (value == null) return true;
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text === "" || JUNK.has(text.toLowerCase());
}

export function collapseWhitespace(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

export function cleanText(value) {
  if (isBlank(value)) return "";
  return collapseWhitespace(value).replace(/\s+/g, " ");
}

export function cleanMultiline(value) {
  if (value == null) return "";
  const text = String(value).replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
  if (JUNK.has(text.toLowerCase())) return "";
  return text;
}

export function normalizeArabicIndicDigits(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (ch) => String(ARABIC_INDIC.indexOf(ch)));
}

function stripTitles(name) {
  let text = collapseWhitespace(name);
  let previous;
  do {
    previous = text;
    text = text.replace(LEADING_TITLE, "").replace(TRAILING_TITLE, "").trim();
  } while (text !== previous);
  return text;
}

/** One lookup key for instructor and course names: case, spacing, titles, punctuation. */
export function normalizeLookupKey(value) {
  if (isBlank(value)) return "";
  let text = stripTitles(String(value).normalize("NFKC"));
  text = text.replace(/[®™©]/g, "");
  text = text.replace(/\(\s*\d+(?:\.\d+)?\s*hours?\s*\)/gi, "");
  text = text.toLowerCase();
  text = text.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeGroupCodeCandidate(raw) {
  if (isBlank(raw)) return null;
  let text = normalizeArabicIndicDigits(collapseWhitespace(raw)).replace(/\s+/g, " ");
  if (text.toLowerCase() === "unmatched group") return null;
  text = text.replace(/\.0$/, "");
  const match = /^(MBA|DBA)\s*[- ]?\s*G\s*(\d+)\s*$/i.exec(text);
  if (!match) return null;
  return `${match[1].toUpperCase()}-G${Number(match[2])}`;
}

export function groupCodeValidity(canonical, master) {
  if (!canonical) return "invalid";
  if (/^(MBA|DBA)-G\d{1,3}$/.test(canonical)) return "ok";
  if (/^(MBA|DBA)-G\d{4,}$/.test(canonical)) {
    return master.has(canonical) ? "ok" : "long";
  }
  return "invalid";
}

export function parseISODate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return text;
}

export function addYears(isoDate, years) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year + years, month - 1, day));
  return date.toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Canonical 24-hour HH:MM. Accepts base-data forms such as "5PM" and "9 PM". */
export function normalizeStartTime(value) {
  if (isBlank(value)) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hours = String(value.getUTCHours()).padStart(2, "0");
    const minutes = String(value.getUTCMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  const compact = cleanText(value).replace(/\s+/g, "");
  const twentyFour = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(compact);
  if (twentyFour) return `${twentyFour[1]}:${twentyFour[2]}`;
  const ampm = /^(\d{1,2})(?::([0-5]\d))?(AM|PM)$/i.exec(compact);
  if (!ampm) return null;
  let hours = Number(ampm[1]);
  const minutes = ampm[2] == null ? "00" : ampm[2];
  if (hours < 1 || hours > 12) return null;
  const meridiem = ampm[3].toUpperCase();
  if (meridiem === "AM") hours = hours === 12 ? 0 : hours;
  else hours = hours === 12 ? 12 : hours + 12;
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

export function matchEnum(raw, values) {
  const text = cleanText(raw);
  if (!text) return null;
  const exact = values.find((value) => value === text);
  if (exact) return { value: exact, changed: false };
  const folded = values.find((value) => value.toLowerCase() === text.toLowerCase());
  if (folded) return { value: folded, changed: folded !== text };
  return null;
}

export function matchTitle(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  if (/^dr\.?$/i.test(text)) return { value: "Dr.", changed: text !== "Dr." };
  if (/^eng\.?$/i.test(text)) return { value: "Eng.", changed: text !== "Eng." };
  return null;
}

export function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = new Uint16Array(right.length + 1);
  let current = new Uint16Array(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) previous[column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

export function closestLabels(inputKey, entries, limit = 3) {
  const seen = new Set();
  return entries
    .map((entry) => ({ entry, distance: levenshtein(inputKey, entry.key) }))
    .sort((a, b) => a.distance - b.distance || a.entry.label.localeCompare(b.entry.label))
    .filter((item) => {
      if (seen.has(item.entry.label)) return false;
      seen.add(item.entry.label);
      return true;
    })
    .slice(0, limit)
    .map((item) => item.entry.label);
}

export function parseLooseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

export function parseLooseInteger(value) {
  const number = parseLooseNumber(value);
  if (number == null || !Number.isInteger(number)) return null;
  return number;
}

export function headerKey(value) {
  return cleanText(value).toLowerCase();
}

export function splitInstructorNames(value) {
  if (isBlank(value)) return [];
  return String(value)
    .split(/[;؛；]/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}
