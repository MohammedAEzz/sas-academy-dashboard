/** In-memory indexes over base JSON plus active uploaded records. */

import { DATASET_IDS } from "./schema.js";
import { normalizeLookupKey } from "./normalize.js";
import { contentHash, contentOf, keyOfStored } from "./fingerprint.js";

function rowsOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  return [data];
}

function pushEntry(map, key, entry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

export function indexDatasets(base, activeRecords = []) {
  const records = Object.fromEntries(DATASET_IDS.map((dataset) => [dataset, new Map()]));
  const instructorByKey = new Map();
  const courseByKey = new Map();
  const instructorLabels = [];
  const courseLabels = [];
  const groupMaster = new Set();
  const activityByTriple = new Map();

  function rememberInstructor(row) {
    const key = normalizeLookupKey(row.instructor_name_clean);
    if (!key) return;
    instructorByKey.set(key, row);
    instructorLabels.push({ key, label: row.instructor_name_clean });
  }

  function rememberCourse(row) {
    const key = normalizeLookupKey(row.course_name_clean);
    if (!key) return;
    courseByKey.set(key, row);
    courseLabels.push({ key, label: row.course_name_clean });
  }

  function rememberActivity(row) {
    if (row.group_code) groupMaster.add(row.group_code);
    if (row.group_code && row.course_id && row.instructor_id && row.activity_id) {
      const triple = `${row.group_code}\u001f${row.course_id}\u001f${row.instructor_id}`;
      if (!activityByTriple.has(triple)) activityByTriple.set(triple, row.activity_id);
    }
  }

  function rememberRecord(dataset, key, content, source, entityId) {
    pushEntry(records[dataset], key, {
      contentHash: contentHash(dataset, content),
      content,
      source,
      entityId: entityId || null,
    });
  }

  for (const row of base.instructors || []) {
    rememberInstructor(row);
    rememberRecord("instructors", normalizeLookupKey(row.instructor_name_clean), contentOf("instructors", [row]), `base data (${row.instructor_id})`, row.instructor_id);
  }
  for (const row of base.courses || []) {
    rememberCourse(row);
    rememberRecord("courses", normalizeLookupKey(row.course_name_clean), contentOf("courses", [row]), `base data (${row.course_id})`, row.course_id);
  }
  for (const row of base.activities || []) {
    rememberActivity(row);
    if (!row.group_code || !row.course_id || !row.instructor_id) continue;
    const key = [row.group_code, row.course_id, row.instructor_id].join("\u001f");
    rememberRecord("groups", key, contentOf("groups", [row]), `base data (${row.activity_id})`, row.activity_id);
  }
  for (const row of base.sessions || []) {
    if (row.group_code) groupMaster.add(row.group_code);
    rememberRecord("sessions", keyOfStored("sessions", null, [row]), contentOf("sessions", [row]), `base data (${row.session_id})`, row.session_id);
  }

  const feedbackGroups = new Map();
  for (const row of base.feedback || []) {
    const list = feedbackGroups.get(row.feedback_id) || [];
    list.push(row);
    feedbackGroups.set(row.feedback_id, list);
  }
  for (const [feedbackId, group] of feedbackGroups) {
    const content = contentOf("feedback", group);
    rememberRecord("feedback", contentHash("feedback", content), content, `base data (${feedbackId})`, feedbackId);
  }

  for (const row of base.events || []) {
    const key = [normalizeLookupKey(row.event_name), row.event_date_start].join("\u001f");
    rememberRecord("events", key, contentOf("events", [row]), `base data (${row.event_id})`, row.event_id);
  }

  for (const record of activeRecords) {
    const storedRows = rowsOf(record.data);
    if (!storedRows.length) continue;
    const content = contentOf(record.dataset, storedRows);
    const key = record.recordKey || keyOfStored(record.dataset, record.recordKey, storedRows);
    const source = record.source || "an earlier import";
    rememberRecord(record.dataset, key, content, source, record.entityId);
    if (record.dataset === "instructors") rememberInstructor(storedRows[0]);
    if (record.dataset === "courses") rememberCourse(storedRows[0]);
    if (record.dataset === "groups") rememberActivity(storedRows[0]);
    if (record.dataset === "sessions" && storedRows[0].group_code) groupMaster.add(storedRows[0].group_code);
  }

  return {
    records,
    instructorByKey,
    courseByKey,
    instructorLabels,
    courseLabels,
    groupMaster,
    activityByTriple,
  };
}
