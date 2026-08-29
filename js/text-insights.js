/**
 * Transparent word/phrase frequency — NOT sentiment, NOT AI, NOT themes.
 * Normalizes case, strips punctuation, stopword filter, unigrams + bigrams.
 * Preserves Arabic script (Unicode \u0600-\u06FF).
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'am', 'so', 'if', 'not', 'no', 'yes', 'very', 'too',
  'also', 'just', 'about', 'up', 'out', 'all', 'some', 'any', 'can', 'get', 'got',
  'في', 'من', 'على', 'إلى', 'عن', 'هذا', 'هذه', 'التي', 'الذي', 'كان', 'كانت', 'ما',
]);

const JUNK = new Set(['no', '0', 'ok', 'good']);

function hasArabic(s) {
  return /[\u0600-\u06FF]/.test(s);
}

function isValidToken(t) {
  if (!t || t.length < 2) return false;
  if (/^[-–—_.]+$/.test(t)) return false;
  // Must contain at least one letter (Latin or Arabic)
  return /[a-z\u0600-\u06FF]/i.test(t);
}

function tokenize(text) {
  const lower = text.toLowerCase();
  const cleaned = lower.replace(/[^\w\s\u0600-\u06FF'-]/g, ' ');
  return cleaned.split(/\s+/).filter(isValidToken);
}

function isValidComment(text) {
  if (!text || !String(text).trim()) return false;
  const t = String(text).trim().toLowerCase();
  if (JUNK.has(t)) return false;
  const letters = t.match(/\p{L}/gu) || [];
  if (letters.length < 4) return false;
  return true;
}

export function isSubstantiveComment(text) {
  return isValidComment(text);
}

export function filterValidComments(rows) {
  return rows.filter((r) => isValidComment(r.student_comment));
}

export function computeWordFrequencies(rows, { topN = 20 } = {}) {
  const seen = new Set();
  const distinct = rows.filter((r) => {
    const id = r.feedback_id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const comments = filterValidComments(distinct);
  const unigrams = new Map();
  const bigrams = new Map();
  let arabicCount = 0;

  for (const r of comments) {
    const text = String(r.student_comment).trim();
    if (hasArabic(text)) arabicCount += 1;
    const tokens = tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length >= 2);
    for (const t of tokens) {
      unigrams.set(t, (unigrams.get(t) || 0) + 1);
    }
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const bg = `${tokens[i]} ${tokens[i + 1]}`;
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
  }

  const sortTop = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));

  return {
    totalWithComment: distinct.filter((r) => r.student_comment && String(r.student_comment).trim()).length,
    afterJunkFilter: comments.length,
    arabicPct: comments.length ? Math.round((arabicCount / comments.length) * 100) : 0,
    unigrams: sortTop(unigrams),
    bigrams: sortTop(bigrams),
  };
}

export const THEME_DICTIONARY = {
  'Teaching Quality': ['instructor', 'trainer', 'lecturer', 'teaching', 'explain', 'explanation', 'knowledgeable', 'professional', 'supportive'],
  'Course Content': ['course', 'content', 'topic', 'curriculum', 'module'],
  'Hands-on Practice': ['practical', 'practice', 'exercise', 'exercises', 'hands-on', 'project', 'lab'],
  Pace: ['pace', 'fast', 'slow', 'rushed'],
  'Time / Duration': ['time', 'duration', 'hour', 'hours', 'longer', 'shorter'],
  Materials: ['material', 'materials', 'slides', 'manual', 'document', 'resources'],
  'Technical Issues': ['technical', 'issue', 'problem', 'access', 'login', 'system', 'internet', 'drive', 'online', 'connection'],
};

export function computeThemes(rows) {
  const seen = new Set();
  const comments = filterValidComments(rows.filter((r) => {
    if (seen.has(r.feedback_id)) return false;
    seen.add(r.feedback_id);
    return true;
  }));
  const themes = Object.entries(THEME_DICTIONARY).map(([theme, keywords]) => ({ theme, keywords, count: 0 }));
  let classified = 0;
  for (const row of comments) {
    const tokens = tokenize(String(row.student_comment));
    const normalized = tokens.join(' ');
    let matched = false;
    for (const item of themes) {
      if (item.keywords.some((keyword) => keyword.includes(' ') ? normalized.includes(keyword) : tokens.includes(keyword))) {
        item.count += 1;
        matched = true;
      }
    }
    if (matched) classified += 1;
  }
  return {
    themes,
    total: comments.length,
    classified,
    unclassified: comments.length - classified,
    coveragePct: comments.length ? Math.round((classified / comments.length) * 100) : 0,
  };
}

export function commentMatchesKeyword(comment, keyword) {
  if (!keyword) return true;
  const tokens = tokenize(String(comment));
  const kw = keyword.toLowerCase();
  if (kw.includes(' ')) {
    return tokenize(String(comment)).join(' ').includes(kw);
  }
  return tokens.some((t) => t === kw || t.includes(kw));
}
