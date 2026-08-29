#!/usr/bin/env node
/**
 * Scan dashboard/data/*.json for PII patterns, forbidden keys, and junk string values.
 * Exit 1 on any hit. Run: node dashboard/scripts/verify-privacy.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function toAsciiDigits(text) {
  return String(text).replace(/[٠-٩]/g, (ch) => String(ARABIC_INDIC_DIGITS.indexOf(ch)));
}

const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const phoneRe = /(?<!\d)\d{9,}(?!\d)/g;
const forbiddenKeyRe = /"(mobile|username|first_name|last_name)"\s*:/g;
const junkValueRe = /"(?:[^"\\]|\\.)*"/g;
const JUNK_VALUES = new Set(['nan', 'none', 'nat', 'null', '<na>']);

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));
const hits = [];

for (const file of files) {
  const raw = readFileSync(join(dataDir, file), 'utf8');
  const text = toAsciiDigits(raw);

  const emails = text.match(emailRe) || [];
  const phones = text.match(phoneRe) || [];
  const keys = raw.match(forbiddenKeyRe) || [];

  let junkHits = 0;
  for (const m of raw.matchAll(junkValueRe)) {
    const val = m[0].slice(1, -1).toLowerCase();
    if (JUNK_VALUES.has(val)) junkHits += 1;
  }

  if (emails.length) hits.push(`${file}: ${emails.length} email pattern(s)`);
  if (phones.length) hits.push(`${file}: ${phones.length} 9+ digit run(s)`);
  if (keys.length) hits.push(`${file}: forbidden key(s) ${keys.join(', ')}`);
  if (junkHits) hits.push(`${file}: ${junkHits} junk string value(s) (nan/none/nat/null/<na>)`);
}

if (hits.length) {
  console.error('Privacy scan FAILED:');
  for (const h of hits) console.error(' -', h);
  process.exit(1);
}
console.log(`Privacy scan PASSED (${files.length} JSON files, 0 hits)`);
process.exit(0);
