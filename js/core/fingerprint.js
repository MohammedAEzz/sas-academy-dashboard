/** Stable content hashes and record keys. Ids and provenance fields are excluded. */

import { sha256 } from "./sha256.js";
import { normalizeLookupKey, normalizeStartTime } from "./normalize.js";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(dataset, content) {
  return sha256(canonicalJson({ dataset, content }));
}

export function joinKey(parts) {
  return parts.map((part) => (part == null ? "" : String(part))).join("\u001f");
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function instructorContent(row) {
  return {
    full_name_ar: row.full_name_ar || "",
    status: row.status,
    system_name_ar: row.system_name_ar || "",
    title: row.title,
  };
}

export function courseContent(row) {
  return {
    course_category: row.course_category || "",
    declared_hours: numberOrNull(row.declared_hours),
  };
}

export function groupContent(row) {
  return {
    activity_type: row.activity_type,
    day: row.day || "",
    degree: row.degree || "",
    language: row.language || "",
    num_students: numberOrNull(row.num_students),
    status: row.status_clean || null,
  };
}

export function sessionContent(row) {
  return {
    activity_type: row.activity_type,
    duration_hours: numberOrNull(row.duration_hours),
    language: row.language || "",
    start_time: normalizeStartTime(row.start_time),
    status: row.status_clean ?? null,
  };
}

export function eventContent(row) {
  return {
    event_date_end: row.event_date_end,
    event_type: row.event_type,
    participant_count: numberOrNull(row.participant_count),
  };
}

export function feedbackContentFromRows(rows) {
  const first = rows[0];
  const instructors = [];
  const seen = new Set();
  for (const row of rows) {
    const id = row.instructor_id || "";
    const name = normalizeLookupKey(row.instructor_name_clean || "");
    if (!id && !name) continue;
    const token = `${id}\u001f${name}`;
    if (seen.has(token)) continue;
    seen.add(token);
    instructors.push({ id, name });
  }
  instructors.sort((a, b) => `${a.id}${a.name}`.localeCompare(`${b.id}${b.name}`));
  return {
    activity_type: first.activity_type,
    comment: first.student_comment || "",
    course_id: first.course_id || "",
    date: first.feedback_date,
    group_code: first.group_code_clean || "",
    group_match_status: first.group_match_status || "",
    instructors,
    ratings: {
      elearning: numberOrNull(first.rating_elearning_score),
      guided: numberOrNull(first.rating_guided_score),
      knowledge: numberOrNull(first.rating_knowledge_score),
      leadership: numberOrNull(first.rating_leadership_score),
      project: numberOrNull(first.rating_project_score),
      soft_skills: numberOrNull(first.rating_soft_skills_score),
    },
    recommendation: numberOrNull(first.recommendation_score),
    satisfaction: first.overall_satisfaction || "",
  };
}

export function sessionKeyFromRow(row, diplomaType = null) {
  let groupPart = row.group_code || "";
  if (!groupPart) {
    if (diplomaType) groupPart = diplomaType;
    else if (row.activity_type === "DIPLOMA") groupPart = "DIPLOMA";
  }
  return joinKey([row.session_date, groupPart, row.course_id || "", row.session_number, row.instructor_id || ""]);
}

export function contentOf(dataset, rows) {
  const row = rows[0];
  if (dataset === "instructors") return instructorContent(row);
  if (dataset === "courses") return courseContent(row);
  if (dataset === "groups") return groupContent(row);
  if (dataset === "sessions") return sessionContent(row);
  if (dataset === "events") return eventContent(row);
  if (dataset === "feedback") return feedbackContentFromRows(rows);
  throw new Error(`Unknown dataset ${dataset}`);
}

export function keyOfStored(dataset, recordKey, rows) {
  if (recordKey) return recordKey;
  const row = rows[0];
  if (dataset === "instructors") return normalizeLookupKey(row.instructor_name_clean);
  if (dataset === "courses") return normalizeLookupKey(row.course_name_clean);
  if (dataset === "groups") return joinKey([row.group_code, row.course_id, row.instructor_id]);
  if (dataset === "sessions") return sessionKeyFromRow(row);
  if (dataset === "events") return joinKey([normalizeLookupKey(row.event_name), row.event_date_start]);
  return contentHash(dataset, contentOf(dataset, rows));
}
