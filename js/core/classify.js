/** Row validation and valid | duplicate | conflict | error classification. */

import {
  columnIds,
  DATASETS,
  exampleRows,
  RATING_SCORES,
  RATING_VALUES,
  SATISFACTION_SCORES,
  SATISFACTION_VALUES,
} from "./schema.js";
import {
  addYears,
  cleanMultiline,
  cleanText,
  closestLabels,
  groupCodeValidity,
  isBlank,
  matchEnum,
  matchTitle,
  normalizeGroupCodeCandidate,
  normalizeLookupKey,
  normalizeStartTime,
  parseISODate,
  parseLooseInteger,
  parseLooseNumber,
  splitInstructorNames,
  todayISO,
} from "./normalize.js";
import { redactPii } from "./pii.js";
import { canonicalJson, contentHash, joinKey } from "./fingerprint.js";

const RATING_FIELDS = [
  ["rating_elearning", "elearning"],
  ["rating_guided", "guided"],
  ["rating_project", "project"],
  ["rating_knowledge", "knowledge"],
  ["rating_leadership", "leadership"],
  ["rating_soft_skills", "soft_skills"],
];

function clip(value) {
  const text = value == null ? "" : String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function fail(column, value, message, fix) {
  return { column, value: clip(value), message, fix };
}

function notice(column, message) {
  return { column, message };
}

function countsOf(rows) {
  const counts = { total: rows.length, valid: 0, duplicate: 0, conflict: 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function resolveName(raw, byKey, labels, noun) {
  const display = cleanText(raw);
  const key = normalizeLookupKey(display);
  if (!key) return { error: fail(noun === "instructor" ? "instructor_name" : "course_name", raw, `${noun === "instructor" ? "Instructor" : "Course"} name is empty.`, `Enter a ${noun} name.`) };
  const found = byKey.get(key);
  if (found) {
    const canonical = found[noun === "instructor" ? "instructor_name_clean" : "course_name_clean"];
    const notes = [];
    if (canonical !== display) {
      notes.push(notice(noun === "instructor" ? "instructor_name" : "course_name", `Using the existing ${noun} name "${canonical}" for "${display}".`));
    }
    return { row: found, notes };
  }
  const suggestions = closestLabels(key, labels);
  const suggestionText = suggestions.length ? ` Closest names: ${suggestions.join(", ")}.` : "";
  const column = noun === "instructor" ? "instructor_name" : "course_name";
  return {
    error: fail(
      column,
      display,
      `"${display}" does not match a known ${noun}.${suggestionText}`,
      `Use one of the existing ${noun} names, or upload the ${noun} first.`,
    ),
  };
}

function takeGroupCode(raw, master, { required, column = "group_code" }) {
  const notes = [];
  if (isBlank(raw)) {
    if (!required) return { code: "", notes };
    return {
      error: fail(column, raw, "Group code is required.", "Use a code such as MBA-G281 or DBA-G12."),
    };
  }
  const original = cleanText(raw);
  const canonical = normalizeGroupCodeCandidate(original);
  const validity = groupCodeValidity(canonical, master);
  if (validity === "ok") {
    if (canonical !== original) {
      notes.push(notice(column, `Normalized "${original}" to "${canonical}".`));
    }
    return { code: canonical, notes };
  }
  if (validity === "long") {
    return {
      error: fail(
        column,
        original,
        `Group code ${canonical} has 4 or more digits and is not an existing group.`,
        "Use a 1–3 digit code such as MBA-G281, or a 4-digit code that already exists (for example MBA-G2272).",
      ),
    };
  }
  return {
    error: fail(column, original, `"${original}" is not a valid group code.`, "Use the form MBA-G281 or DBA-G12."),
  };
}

function takeEnum(column, raw, values, { required, label }) {
  if (isBlank(raw)) {
    if (!required) return { value: null };
    return { error: fail(column, raw, `${label} is required.`, `Use one of: ${values.join(", ")}.`) };
  }
  const matched = matchEnum(raw, values);
  if (!matched) {
    return { error: fail(column, raw, `"${cleanText(raw)}" is not an allowed ${label}.`, `Use one of: ${values.join(", ")}.`) };
  }
  const notes = [];
  if (matched.changed) notes.push(notice(column, `Stored ${label} as "${matched.value}" instead of "${cleanText(raw)}".`));
  return { value: matched.value, notes };
}

function takeDate(column, raw, { required, label, maxDate }) {
  if (isBlank(raw)) {
    if (!required) return { value: null };
    return { error: fail(column, raw, `${label} is required.`, "Use a date in YYYY-MM-DD format.") };
  }
  const parsed = parseISODate(raw);
  if (!parsed) {
    return { error: fail(column, raw, `"${cleanText(raw)}" is not a valid date.`, "Use YYYY-MM-DD, for example 2026-11-01.") };
  }
  if (maxDate && parsed > maxDate) {
    return {
      error: fail(column, parsed, `${label} ${parsed} is more than 2 years in the future.`, `Use a date on or before ${maxDate}.`),
    };
  }
  return { value: parsed };
}

function takeNumber(column, raw, { required, min, max, integer, exclusiveMin, label, units }) {
  if (isBlank(raw)) {
    if (!required) return { value: null };
    return { error: fail(column, raw, `${label} is required.`, units ? `Enter a ${units} value.` : "Enter a number.") };
  }
  const parsed = integer ? parseLooseInteger(raw) : parseLooseNumber(raw);
  if (parsed == null) {
    return { error: fail(column, raw, `"${cleanText(raw)}" is not a ${integer ? "whole number" : "number"}.`, integer ? "Enter a whole number without decimals." : "Enter a number such as 3 or 1.5.") };
  }
  if (exclusiveMin != null && parsed <= exclusiveMin) {
    return { error: fail(column, raw, `${label} must be greater than ${exclusiveMin}.`, `Enter a ${units || "numeric"} value greater than ${exclusiveMin}.`) };
  }
  if (min != null && parsed < min) {
    return { error: fail(column, raw, `${label} must be at least ${min}.`, `Enter a value from ${min} to ${max}.`) };
  }
  if (max != null && parsed > max) {
    return { error: fail(column, raw, `${label} must be at most ${max}.`, `Enter a value from ${min ?? 0} to ${max}.`) };
  }
  return { value: parsed };
}

function classifyAgainstIndex(index, dataset, key, content, rowNumber) {
  const hash = contentHash(dataset, content);
  const existing = index.get(key) || [];
  const same = existing.find((entry) => entry.contentHash === hash);
  if (same) {
    const duplicateOf = same.source.startsWith("row ") ? same.source : same.source;
    return {
      status: "duplicate",
      recordKey: key,
      contentHash: hash,
      duplicateOf,
      message: `Row ${rowNumber} duplicates ${duplicateOf} and was skipped.`,
      conflict: null,
    };
  }
  if (existing.length) {
    const priorCount = existing.length;
    const sources = existing.slice(0, 3).map((entry) => ({
      source: entry.source,
      fields: diffFields(content, entry.content),
    }));
    existing.push({ contentHash: hash, content, source: `row ${rowNumber} in this file`, entityId: null });
    const first = sources[0];
    const fieldText = first.fields.map((field) => `${field.field} (uploaded ${show(field.uploaded)}, existing ${show(field.existing)})`).join("; ");
    const extra = priorCount > 1 ? ` ${priorCount} records share this key and none match.` : "";
    return {
      status: "conflict",
      recordKey: key,
      contentHash: hash,
      duplicateOf: null,
      conflict: { sources },
      message: `Row ${rowNumber} matches a record in ${first.source}, but details differ: ${fieldText}.${extra} Nothing was overwritten.`,
    };
  }
  index.set(key, [{ contentHash: hash, content, source: `row ${rowNumber} in this file`, entityId: null }]);
  return {
    status: "valid",
    recordKey: key,
    contentHash: hash,
    duplicateOf: null,
    conflict: null,
    message: `Row ${rowNumber} is ready to import.`,
  };
}

function show(value) {
  if (value == null || value === "") return "blank";
  if (typeof value === "object") return clip(JSON.stringify(value));
  return clip(value);
}

function diffFields(uploaded, existing) {
  const fields = new Set([...Object.keys(uploaded), ...Object.keys(existing)]);
  const diffs = [];
  for (const field of [...fields].sort()) {
    if (canonicalJson(uploaded[field]) !== canonicalJson(existing[field])) {
      diffs.push({ field, uploaded: uploaded[field], existing: existing[field] });
    }
  }
  return diffs;
}

function finish(rowNumber, errors, notes, outcome, preview, toRows) {
  if (errors.length) {
    return {
      rowNumber,
      status: "error",
      notices: notes,
      errors,
      recordKey: null,
      contentHash: null,
      message: errors.map((error) => `Row ${rowNumber}, column ${error.column}: ${error.message} ${error.fix}`).join(" "),
      conflict: null,
      duplicateOf: null,
      preview: null,
      toRows: null,
    };
  }
  return {
    rowNumber,
    notices: notes,
    errors: [],
    preview,
    toRows,
    ...outcome,
  };
}

function requireText(column, raw, label) {
  const text = cleanText(raw);
  if (!text) return { error: fail(column, raw, `${label} is required.`, `Enter a ${label.toLowerCase()}.`) };
  if (text.length > 300) return { error: fail(column, text, `${label} is too long.`, "Use 300 characters or fewer.") };
  return { value: text };
}

function classifyInstructors(values, rowNumber, catalog, index) {
  const errors = [];
  const notes = [];
  const name = requireText("instructor_name", values.instructor_name, "Instructor name");
  if (name.error) errors.push(name.error);
  const title = matchTitle(values.title);
  if (!title) errors.push(fail("title", values.title, "Title must be Dr. or Eng.", "Enter Dr. or Eng."));
  else if (title.changed) notes.push(notice("title", `Stored title as "${title.value}" instead of "${cleanText(values.title)}".`));
  const status = takeEnum("status", values.status, ["Active", "Not Active"], { required: true, label: "status" });
  if (status.error) errors.push(status.error);
  else if (status.notes) notes.push(...status.notes);
  if (errors.length) return finish(rowNumber, errors, notes);
  const content = {
    full_name_ar: cleanText(values.full_name_ar),
    status: status.value,
    system_name_ar: cleanText(values.system_name_ar),
    title: title.value,
  };
  const key = normalizeLookupKey(name.value);
  const outcome = classifyAgainstIndex(index, "instructors", key, content, rowNumber);
  const preview = dashboardInstructor(null, name.value, content);
  return finish(rowNumber, [], notes, outcome, [preview], (ids) => [dashboardInstructor(ids.entityId, name.value, content)]);
}

function dashboardInstructor(id, name, content) {
  return {
    instructor_id: id,
    instructor_name_clean: name,
    full_name_ar: content.full_name_ar,
    system_name_ar: content.system_name_ar,
    first_name_en: "",
    last_name_en: "",
    title: content.title,
    status: content.status,
  };
}

function classifyCourses(values, rowNumber, catalog, index) {
  const errors = [];
  const notes = [];
  const name = requireText("course_name", values.course_name, "Course name");
  if (name.error) errors.push(name.error);
  const hours = takeNumber("declared_hours", values.declared_hours, {
    required: false, exclusiveMin: 0, label: "Declared hours", units: "hours",
  });
  if (hours.error) errors.push(hours.error);
  const category = takeEnum("course_category", values.course_category, DATASETS.courses.columns.find((column) => column.id === "course_category").values, {
    required: false, label: "course category",
  });
  if (category.error) errors.push(category.error);
  else if (category.notes) notes.push(...category.notes);
  if (errors.length) return finish(rowNumber, errors, notes);
  const content = { course_category: category.value || "", declared_hours: hours.value };
  const key = normalizeLookupKey(name.value);
  const outcome = classifyAgainstIndex(index, "courses", key, content, rowNumber);
  const preview = dashboardCourse(null, name.value, content);
  return finish(rowNumber, [], notes, outcome, [preview], (ids) => [dashboardCourse(ids.entityId, name.value, content)]);
}

function dashboardCourse(id, name, content) {
  return {
    course_id: id,
    course_name_clean: name,
    declared_hours: content.declared_hours,
    source_count: 1,
    source: "upload",
    course_category: content.course_category || "",
  };
}

function classifyGroups(values, rowNumber, catalog, index) {
  const errors = [];
  const notes = [];
  const group = takeGroupCode(values.group_code, catalog.groupMaster, { required: true });
  if (group.error) errors.push(group.error);
  else notes.push(...group.notes);
  const course = resolveName(values.course_name, catalog.courseByKey, catalog.courseLabels, "course");
  if (course.error) errors.push({ ...course.error, column: "course_name" });
  else notes.push(...(course.notes || []));
  const instructor = resolveName(values.instructor_name, catalog.instructorByKey, catalog.instructorLabels, "instructor");
  if (instructor.error) errors.push(instructor.error);
  else notes.push(...(instructor.notes || []));
  const activityType = takeEnum("activity_type", values.activity_type, ["INTERNAL", "EXTERNAL"], { required: true, label: "activity type" });
  if (activityType.error) errors.push(activityType.error);
  else if (activityType.notes) notes.push(...activityType.notes);
  const degree = takeEnum("degree", values.degree, ["MBA", "DBA"], { required: true, label: "degree" });
  if (degree.error) errors.push(degree.error);
  else if (degree.notes) notes.push(...degree.notes);
  const language = takeEnum("language", values.language, ["Arabic", "English"], { required: true, label: "language" });
  if (language.error) errors.push(language.error);
  else if (language.notes) notes.push(...language.notes);
  const students = takeNumber("num_students", values.num_students, {
    required: false, integer: true, min: 1, max: 500, label: "Number of students", units: "students",
  });
  if (students.error) errors.push(students.error);
  const day = takeEnum("day", values.day, DATASETS.groups.columns.find((column) => column.id === "day").values, { required: false, label: "day" });
  if (day.error) errors.push(day.error);
  else if (day.notes) notes.push(...day.notes);
  const status = takeEnum("status", values.status, ["COMPLETED", "PLANNED", "UNKNOWN"], { required: false, label: "status" });
  if (status.error) errors.push(status.error);
  else if (status.notes) notes.push(...status.notes);
  if (errors.length) return finish(rowNumber, errors, notes);
  const statusClean = status.value || "UNKNOWN";
  const content = {
    activity_type: activityType.value,
    day: day.value || "",
    degree: degree.value,
    language: language.value,
    num_students: students.value,
    status: statusClean,
  };
  const key = joinKey([group.code, course.row.course_id, instructor.row.instructor_id]);
  const outcome = classifyAgainstIndex(index, "groups", key, content, rowNumber);
  const build = (activityId) => [{
    activity_id: activityId,
    group_code: group.code,
    course_id: course.row.course_id,
    course_name_clean: course.row.course_name_clean,
    course_category: course.row.course_category || "",
    instructor_id: instructor.row.instructor_id,
    instructor_name_clean: instructor.row.instructor_name_clean,
    instructor_mapping_status: "MAPPED",
    activity_type: activityType.value,
    activity_type_source: "upload",
    degree: degree.value,
    language: language.value,
    num_students: students.value,
    day: day.value || "",
    time_slot: "",
    expected_end_date: null,
    last_lecture_date: null,
    grain: "upload",
    status_clean: statusClean,
    status_basis: status.value ? "EXPLICIT" : "MISSING_IN_SOURCE",
  }];
  if (outcome.status === "valid") catalog.groupMaster.add(group.code);
  return finish(rowNumber, [], notes, outcome, build(null), (ids) => build(ids.entityId));
}

function classifySessions(values, rowNumber, catalog, index, asOf) {
  const errors = [];
  const notes = [];
  const maxDate = addYears(asOf, 2);
  const date = takeDate("session_date", values.session_date, { required: true, label: "Session date", maxDate });
  if (date.error) errors.push(date.error);
  const activityType = takeEnum("activity_type", values.activity_type, ["INTERNAL", "EXTERNAL", "DIPLOMA"], { required: true, label: "activity type" });
  if (activityType.error) errors.push(activityType.error);
  else if (activityType.notes) notes.push(...activityType.notes);
  const diploma = takeEnum("diploma_type", values.diploma_type, ["MBA", "DBA"], { required: false, label: "diploma type" });
  if (diploma.error) errors.push(diploma.error);
  else if (diploma.notes) notes.push(...diploma.notes);
  const isDiploma = activityType.value === "DIPLOMA";
  if (isDiploma && !diploma.value && !diploma.error) {
    errors.push(fail("diploma_type", values.diploma_type, "Diploma lectures require diploma_type MBA or DBA.", "Enter MBA or DBA and leave group_code blank."));
  }
  if (!isDiploma && diploma.value) {
    errors.push(fail("diploma_type", diploma.value, "diploma_type is only used when activity_type is DIPLOMA.", "Clear diploma_type, or set activity_type to DIPLOMA."));
  }
  let group = { code: "", notes: [] };
  if (isDiploma) {
    if (!isBlank(values.group_code)) {
      errors.push(fail("group_code", values.group_code, "Diploma lectures do not use a group code.", "Leave group_code blank and set diploma_type."));
    }
  } else if (!activityType.error) {
    group = takeGroupCode(values.group_code, catalog.groupMaster, { required: true });
    if (group.error) errors.push(group.error);
    else notes.push(...group.notes);
  }
  const course = resolveName(values.course_name, catalog.courseByKey, catalog.courseLabels, "course");
  if (course.error) errors.push({ ...course.error, column: "course_name" });
  else notes.push(...(course.notes || []));
  const instructor = resolveName(values.instructor_name, catalog.instructorByKey, catalog.instructorLabels, "instructor");
  if (instructor.error) errors.push(instructor.error);
  else notes.push(...(instructor.notes || []));
  const sessionNumber = takeNumber("session_number", values.session_number, {
    required: true, integer: true, min: 1, max: 50, label: "Session number",
  });
  if (sessionNumber.error) errors.push(sessionNumber.error);
  const duration = takeNumber("duration_hours", values.duration_hours, {
    required: true, min: 0.5, max: 12, label: "Duration", units: "hours",
  });
  if (duration.error) errors.push(duration.error);
  const language = takeEnum("language", values.language, ["Arabic", "English"], { required: false, label: "language" });
  if (language.error) errors.push(language.error);
  else if (language.notes) notes.push(...language.notes);
  const status = takeEnum("status", values.status, ["COMPLETED", "PLANNED", "UNKNOWN"], { required: false, label: "status" });
  if (status.error) errors.push(status.error);
  else if (status.notes) notes.push(...status.notes);
  let startTime = null;
  if (!isBlank(values.start_time)) {
    const typed = cleanText(values.start_time);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(typed)) {
      errors.push(fail("start_time", values.start_time, `"${typed}" is not a 24-hour time.`, "Use HH:MM, for example 17:00."));
    } else {
      startTime = normalizeStartTime(typed);
    }
  }
  if (errors.length) return finish(rowNumber, errors, notes);
  const content = {
    activity_type: activityType.value,
    duration_hours: duration.value,
    language: language.value || "",
    start_time: startTime,
    status: status.value,
  };
  const groupPart = isDiploma ? diploma.value : group.code;
  const key = joinKey([date.value, groupPart, course.row.course_id, sessionNumber.value, instructor.row.instructor_id]);
  const outcome = classifyAgainstIndex(index, "sessions", key, content, rowNumber);
  const triple = `${group.code}\u001f${course.row.course_id}\u001f${instructor.row.instructor_id}`;
  const linkedActivityId = !isDiploma && catalog.activityByTriple.get(triple) || null;
  const build = (ids) => [{
    session_id: ids.entityId,
    activity_id: linkedActivityId,
    group_code: isDiploma ? null : group.code,
    course_id: course.row.course_id,
    course_name_clean: course.row.course_name_clean,
    instructor_id: instructor.row.instructor_id,
    instructor_name_clean: instructor.row.instructor_name_clean,
    instructor_mapping_status: "MAPPED",
    session_number: sessionNumber.value,
    session_date: date.value,
    date_confidence: "HIGH",
    start_time: startTime,
    duration_hours: duration.value,
    language: language.value || "",
    activity_type: activityType.value,
    diploma_type: isDiploma ? diploma.value : null,
    status_clean: status.value,
    status_basis: status.value ? "EXPLICIT" : null,
  }];
  return finish(rowNumber, [], notes, outcome, build({ entityId: null }), build);
}

function ratingScore(column, raw, notes, errors) {
  if (isBlank(raw)) return null;
  const matched = matchEnum(raw, RATING_VALUES);
  if (!matched) {
    errors.push(fail(column, raw, `"${cleanText(raw)}" is not an allowed rating.`, "Use Excellent, Above average, Average, Below average, or Poor. Leave the cell blank if it was not answered."));
    return null;
  }
  if (matched.changed) notes.push(notice(column, `Stored rating as "${matched.value}" instead of "${cleanText(raw)}".`));
  return RATING_SCORES[matched.value.toLowerCase()];
}

function classifyFeedback(values, rowNumber, catalog, index) {
  const errors = [];
  const notes = [];
  const date = takeDate("feedback_date", values.feedback_date, { required: true, label: "Feedback date" });
  if (date.error) errors.push(date.error);
  const activityType = takeEnum("activity_type", values.activity_type, ["INTERNAL", "EXTERNAL"], { required: true, label: "activity type" });
  if (activityType.error) errors.push(activityType.error);
  else if (activityType.notes) notes.push(...activityType.notes);
  let groupCode = "";
  let groupStatus = "REVIEW";
  if (!isBlank(values.group_code)) {
    const group = takeGroupCode(values.group_code, catalog.groupMaster, { required: false });
    if (group.error || !group.code) {
      groupStatus = "REVIEW";
      notes.push(notice("group_code", `"${cleanText(values.group_code)}" is not a valid group code, so the response is marked REVIEW.`));
    } else {
      groupCode = group.code;
      groupStatus = "MAPPED";
      notes.push(...group.notes);
    }
  }
  let course = null;
  if (!isBlank(values.course_name)) {
    const resolved = resolveName(values.course_name, catalog.courseByKey, catalog.courseLabels, "course");
    if (resolved.error) errors.push({ ...resolved.error, column: "course_name" });
    else {
      course = resolved.row;
      notes.push(...(resolved.notes || []));
    }
  }
  const fragments = splitInstructorNames(values.instructor_names);
  const instructors = [];
  const seenInstructors = new Set();
  for (const fragment of fragments) {
    const resolved = resolveName(fragment, catalog.instructorByKey, catalog.instructorLabels, "instructor");
    if (resolved.error) {
      errors.push({ ...resolved.error, column: "instructor_names" });
      continue;
    }
    notes.push(...(resolved.notes || []).map((item) => ({ ...item, column: "instructor_names" })));
    if (seenInstructors.has(resolved.row.instructor_id)) {
      errors.push(fail("instructor_names", fragment, `Instructor "${resolved.row.instructor_name_clean}" is listed more than once.`, "Keep each instructor once."));
      continue;
    }
    seenInstructors.add(resolved.row.instructor_id);
    instructors.push(resolved.row);
  }
  const satisfaction = takeEnum("overall_satisfaction", values.overall_satisfaction, SATISFACTION_VALUES, { required: true, label: "overall satisfaction" });
  if (satisfaction.error) errors.push(satisfaction.error);
  else if (satisfaction.notes) notes.push(...satisfaction.notes);
  const ratings = {};
  for (const [column, key] of RATING_FIELDS) ratings[key] = ratingScore(column, values[column], notes, errors);
  const recommendation = takeNumber("recommendation_score", values.recommendation_score, {
    required: false, integer: true, min: 0, max: 10, label: "Recommendation score", units: "score",
  });
  if (recommendation.error) errors.push(recommendation.error);
  const commentRaw = cleanMultiline(values.comment);
  if (commentRaw.length > 4000) errors.push(fail("comment", commentRaw, "Comment is too long.", "Use 4000 characters or fewer."));
  const redacted = redactPii(commentRaw);
  if (redacted.changed) notes.push(notice("comment", `Removed ${redacted.redactions} email or long-number value(s) from the comment.`));
  let responseId = cleanText(values.response_id);
  if (responseId.length > 128) errors.push(fail("response_id", responseId, "response_id is too long.", "Use 128 characters or fewer, or leave it blank."));
  if (errors.length) return finish(rowNumber, errors, notes);
  const nps = recommendation.value == null ? null
    : recommendation.value >= 9 ? "promoter"
      : recommendation.value >= 7 ? "passive"
        : "detractor";
  const instructorSlots = instructors.length ? instructors : [null];
  const build = (feedbackId) => instructorSlots.map((instructor) => ({
    feedback_id: feedbackId,
    feedback_date: date.value,
    activity_type: activityType.value,
    group_id: null,
    group_code_clean: groupCode,
    group_match_status: groupStatus,
    course_id: course ? course.course_id : null,
    course_name_clean: course ? course.course_name_clean : null,
    instructor_id: instructor ? instructor.instructor_id : null,
    instructor_name_clean: instructor ? instructor.instructor_name_clean : null,
    instructor_match_status: instructor ? "MAPPED" : "UNMAPPED",
    overall_satisfaction: satisfaction.value,
    overall_rating: SATISFACTION_SCORES[satisfaction.value.toLowerCase()],
    rating_elearning_score: ratings.elearning,
    rating_guided_score: ratings.guided,
    rating_project_score: ratings.project,
    rating_knowledge_score: ratings.knowledge,
    rating_leadership_score: ratings.leadership,
    rating_soft_skills_score: ratings.soft_skills,
    recommendation_score: recommendation.value,
    nps_category: nps,
    student_comment: redacted.text,
  }));
  const preview = build(null);
  const content = {
    activity_type: activityType.value,
    comment: redacted.text,
    course_id: course ? course.course_id : "",
    date: date.value,
    group_code: groupCode,
    group_match_status: groupStatus,
    instructors: instructors.map((instructor) => ({
      id: instructor.instructor_id,
      name: normalizeLookupKey(instructor.instructor_name_clean),
    })).sort((a, b) => `${a.id}${a.name}`.localeCompare(`${b.id}${b.name}`)),
    ratings,
    recommendation: recommendation.value,
    satisfaction: satisfaction.value,
  };
  const key = responseId ? `response:${responseId}` : contentHash("feedback", content);
  const outcome = classifyAgainstIndex(index, "feedback", key, content, rowNumber);
  return finish(rowNumber, [], notes, outcome, preview, (ids) => build(ids.entityId));
}

function classifyEvents(values, rowNumber, catalog, index) {
  const errors = [];
  const notes = [];
  const name = requireText("event_name", values.event_name, "Event name");
  if (name.error) errors.push(name.error);
  const eventType = takeEnum("event_type", values.event_type, ["BOOTCAMP", "HACKATHON", "WORKSHOP", "OTHER"], { required: true, label: "event type" });
  if (eventType.error) errors.push(eventType.error);
  else if (eventType.notes) notes.push(...eventType.notes);
  const start = takeDate("event_date_start", values.event_date_start, { required: true, label: "Start date" });
  if (start.error) errors.push(start.error);
  const end = takeDate("event_date_end", values.event_date_end, { required: true, label: "End date" });
  if (end.error) errors.push(end.error);
  if (start.value && end.value && end.value < start.value) {
    errors.push(fail("event_date_end", end.value, "End date is before the start date.", "Use an end date on or after the start date."));
  }
  const participants = takeNumber("participant_count", values.participant_count, {
    required: true, integer: true, min: 0, label: "Participant count", units: "participants",
  });
  if (participants.error) errors.push(participants.error);
  if (errors.length) return finish(rowNumber, errors, notes);
  const content = {
    event_date_end: end.value,
    event_type: eventType.value,
    participant_count: participants.value,
  };
  const key = joinKey([normalizeLookupKey(name.value), start.value]);
  const outcome = classifyAgainstIndex(index, "events", key, content, rowNumber);
  const build = (eventId) => [{
    event_id: eventId,
    event_name: name.value,
    event_type: eventType.value,
    event_date_start: start.value,
    event_date_end: end.value,
    participant_count: participants.value,
  }];
  return finish(rowNumber, [], notes, outcome, build(null), (ids) => build(ids.entityId));
}

const CLASSIFIERS = {
  instructors: classifyInstructors,
  courses: classifyCourses,
  groups: classifyGroups,
  sessions: classifySessions,
  feedback: classifyFeedback,
  events: classifyEvents,
};

function cellSignature(value) {
  const text = value == null ? "" : String(value).trim().toLowerCase();
  return text !== "" && Number.isFinite(Number(text)) ? String(Number(text)) : text;
}

function rowSignature(dataset, values) {
  return columnIds(dataset).map((id) => cellSignature(values[id])).join("\u0001");
}

/** Rows identical to a template example are never imported, so an example file can't reach the dashboard. */
function exampleRowError(dataset, rowNumber) {
  return finish(rowNumber, [fail(
    "row",
    "",
    "This is the template's example row, not real data.",
    "Replace it with your own record or delete the row, then upload again.",
  )], []);
}

export function classifyUpload({ dataset, rows, catalog, asOf }) {
  const schema = DATASETS[dataset];
  if (!schema) {
    return {
      dataset,
      counts: { total: 0, valid: 0, duplicate: 0, conflict: 0, error: 0 },
      rows: [],
      fileErrors: [{ code: "UNKNOWN_DATASET", message: `Unknown dataset "${dataset}". Use one of: ${Object.keys(DATASETS).join(", ")}.` }],
    };
  }
  const resolvedAsOf = asOf || todayISO();
  const index = catalog.records[dataset];
  const examples = new Set(exampleRows(dataset).map((row) => rowSignature(dataset, row)));
  const classified = rows.map((row) => {
    const values = row.values || {};
    if (examples.has(rowSignature(dataset, values))) return exampleRowError(dataset, row.rowNumber);
    if (dataset === "sessions") return classifySessions(values, row.rowNumber, catalog, index, resolvedAsOf);
    return CLASSIFIERS[dataset](values, row.rowNumber, catalog, index);
  });
  return {
    dataset,
    asOf: resolvedAsOf,
    counts: countsOf(classified),
    rows: classified,
    fileErrors: [],
  };
}

export function publicRow(row) {
  return {
    rowNumber: row.rowNumber,
    status: row.status,
    notices: row.notices,
    errors: row.errors,
    recordKey: row.recordKey,
    message: row.message,
    conflict: row.conflict,
    duplicateOf: row.duplicateOf,
    preview: row.preview,
  };
}
