import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBaseData } from "../api/_lib/base-data.js";
import { indexDatasets } from "../js/core/catalog.js";
import { classifyUpload } from "../js/core/classify.js";
import { normalizeStartTime } from "../js/core/normalize.js";
import { AS_OF } from "./helpers.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../data");

describe("base data integrity", () => {
  it("maps every feedback, session, and activity instructor id to the same instructor name", () => {
    const base = loadBaseData();
    const names = new Map(base.instructors.map((row) => [row.instructor_id, row.instructor_name_clean]));
    for (const row of [...base.feedback, ...base.sessions, ...base.activities]) {
      if (!row.instructor_id) continue;
      assert.equal(names.get(row.instructor_id), row.instructor_name_clean, row.instructor_id);
    }
  });

  it("classifies a historical feedback response as a duplicate", () => {
    const base = loadBaseData();
    const instructors = new Map(base.instructors.map((row) => [row.instructor_id, row.instructor_name_clean]));
    const courses = new Map(base.courses.map((row) => [row.course_id, row.course_name_clean]));
    const words = { 5: "Excellent", 4: "Above average", 3: "Average", 2: "Below average", 1: "Poor" };
    const groups = new Map();
    for (const row of base.feedback) {
      const list = groups.get(row.feedback_id) || [];
      list.push(row);
      groups.set(row.feedback_id, list);
    }
    const sample = [...groups.values()].find((rows) => rows.length === 1 && rows[0].instructor_id && rows[0].course_id && rows[0].overall_satisfaction);
    const row = sample[0];
    const result = classifyUpload({
      dataset: "feedback",
      asOf: AS_OF,
      catalog: indexDatasets(base, []),
      rows: [{
        rowNumber: 2,
        values: {
          response_id: "",
          feedback_date: row.feedback_date,
          activity_type: row.activity_type,
          group_code: row.group_code_clean || "",
          course_name: courses.get(row.course_id) || "",
          instructor_names: instructors.get(row.instructor_id),
          overall_satisfaction: row.overall_satisfaction,
          rating_elearning: words[row.rating_elearning_score] || "",
          rating_guided: words[row.rating_guided_score] || "",
          rating_project: words[row.rating_project_score] || "",
          rating_knowledge: words[row.rating_knowledge_score] || "",
          rating_leadership: words[row.rating_leadership_score] || "",
          rating_soft_skills: words[row.rating_soft_skills_score] || "",
          recommendation_score: row.recommendation_score ?? "",
          comment: row.student_comment || "",
        },
      }],
    });
    assert.equal(result.rows[0].status, "duplicate", result.rows[0].message);
    assert.match(result.rows[0].duplicateOf, new RegExp(row.feedback_id));
    assert.equal(readFileSync(join(dataDir, "feedback.json"), "utf8").includes(row.feedback_id), true);
  });

  it("classifies a historical session as a duplicate without rewriting base JSON", () => {
    const before = readFileSync(join(dataDir, "sessions.json"));
    const base = loadBaseData();
    const instructors = new Map(base.instructors.map((row) => [row.instructor_id, row.instructor_name_clean]));
    const courses = new Map(base.courses.map((row) => [row.course_id, row.course_name_clean]));
    const session = base.sessions.find((row) => (
      row.group_code
      && row.duration_hours
      && row.instructor_id
      && row.course_id
      && row.language
      && row.activity_type !== "DIPLOMA"
      && normalizeStartTime(row.start_time)
    ));
    const result = classifyUpload({
      dataset: "sessions",
      asOf: AS_OF,
      catalog: indexDatasets(base, []),
      rows: [{
        rowNumber: 2,
        values: {
          session_date: session.session_date,
          group_code: session.group_code,
          course_name: courses.get(session.course_id),
          instructor_name: instructors.get(session.instructor_id),
          session_number: session.session_number,
          duration_hours: session.duration_hours,
          language: session.language,
          activity_type: session.activity_type,
          start_time: normalizeStartTime(session.start_time),
          status: session.status_clean,
          diploma_type: "",
        },
      }],
    });
    assert.equal(result.rows[0].status, "duplicate", result.rows[0].message);
    assert.deepEqual(readFileSync(join(dataDir, "sessions.json")), before);
  });
});
