import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { sha256 } from "../js/core/sha256.js";
import { columnIds, DATASET_IDS, exampleRows } from "../js/core/schema.js";
import { classifyUpload } from "../js/core/classify.js";
import { indexDatasets } from "../js/core/catalog.js";
import { normalizeStartTime } from "../js/core/normalize.js";
import { loadBaseData } from "../api/_lib/base-data.js";
import { buildCsv, buildXlsx } from "../api/_lib/templates.js";
import { prepareUpload } from "../api/_lib/parse-upload.js";
import { fixtureBase, values } from "./fixture.js";
import { AS_OF } from "./helpers.js";

function classify(dataset, rows, base = fixtureBase()) {
  return classifyUpload({ dataset, rows, catalog: indexDatasets(base, []), asOf: AS_OF });
}

describe("shared core", () => {
  it("sha256 matches node crypto", () => {
    for (const text of ["", "abc", "Arabic عربي"]) {
      assert.equal(sha256(text), createHash("sha256").update(text).digest("hex"));
    }
  });

  it("template headers match schema columns and example rows are valid against base data", async () => {
    const base = loadBaseData();
    const catalog = indexDatasets(base, []);
    for (const dataset of DATASET_IDS) {
      const csv = buildCsv(dataset).replace(/^\uFEFF/, "");
      assert.deepEqual(csv.trim().split(","), columnIds(dataset), dataset);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await buildXlsx(dataset));
      const header = workbook.getWorksheet("Data").getRow(1).values.slice(1);
      assert.deepEqual(header, columnIds(dataset), dataset);
      const instructions = workbook.getWorksheet("Instructions").getSheetValues().join("\n");
      for (const id of columnIds(dataset)) assert.match(instructions, new RegExp(id));
      const result = classifyUpload({
        dataset,
        rows: exampleRows(dataset).map((row, index) => values(index + 2, row)),
        catalog: indexDatasets(base, []),
        asOf: AS_OF,
      });
      assert.deepEqual(result.counts, { total: 3, valid: 3, duplicate: 0, conflict: 0, error: 0 }, dataset);
      assert.equal(catalog.instructorByKey.size > 0, true);
    }
  });

  it("accepts a new instructor", () => {
    const result = classify("instructors", [values(2, {
      instructor_name: "Layla Hassan", title: "Dr.", status: "Active", full_name_ar: "", system_name_ar: "",
    })]);
    assert.equal(result.rows[0].status, "valid");
    assert.equal(result.rows[0].preview[0].instructor_id, null);
    assert.equal(result.rows[0].preview[0].title, "Dr.");
  });

  it("accepts a new course", () => {
    const result = classify("courses", [values(2, {
      course_name: "Upload Template Course Alpha", declared_hours: 12, course_category: "Visual Analytics",
    })]);
    assert.equal(result.rows[0].status, "valid");
    assert.equal(result.rows[0].preview[0].declared_hours, 12);
    assert.equal(result.rows[0].preview[0].source, "upload");
  });

  it("accepts a group and links a session to the existing offering", () => {
    const group = classify("groups", [values(2, {
      group_code: "MBA-G990",
      course_name: "Leading with Analytics",
      instructor_name: "Ahmed Tealeb",
      activity_type: "INTERNAL",
      degree: "MBA",
      language: "Arabic",
      num_students: 20,
      day: "Sunday",
      status: "COMPLETED",
    })]);
    assert.equal(group.rows[0].status, "valid");
    assert.equal(group.rows[0].preview[0].group_code, "MBA-G990");
    assert.equal(group.rows[0].preview[0].instructor_mapping_status, "MAPPED");

    const session = classify("sessions", [
      values(2, {
        session_date: "2026-11-01",
        group_code: "MBA-G281",
        course_name: "leading with analytics",
        instructor_name: "dr. ahmed tealeb",
        session_number: 4,
        duration_hours: 3,
        language: "Arabic",
        activity_type: "INTERNAL",
        start_time: "17:00",
        status: "PLANNED",
        diploma_type: "",
      }),
      values(3, {
        session_date: "2026-11-02",
        group_code: "",
        course_name: "Leading with Analytics",
        instructor_name: "Ahmed Tealeb",
        session_number: 1,
        duration_hours: 3,
        language: "",
        activity_type: "DIPLOMA",
        start_time: "",
        status: "",
        diploma_type: "MBA",
      }),
    ]);
    assert.equal(session.rows[0].status, "valid");
    assert.equal(session.rows[0].preview[0].activity_id, "ACT_00090");
    assert.equal(session.rows[0].preview[0].instructor_name_clean, "Ahmed Tealeb");
    assert.equal(session.rows[1].status, "valid");
    assert.equal(session.rows[1].preview[0].group_code, null);
    assert.equal(session.rows[1].preview[0].activity_type, "DIPLOMA");
    assert.equal(session.rows[1].preview[0].status_clean, null);
  });

  it("accepts feedback and events", () => {
    const feedback = classify("feedback", [values(2, {
      response_id: "SURVEY-1",
      feedback_date: "2026-11-01",
      activity_type: "INTERNAL",
      group_code: "MBA-G281",
      course_name: "Leading with Analytics",
      instructor_names: "Ahmed Tealeb",
      overall_satisfaction: "Very satisfied",
      rating_elearning: "Excellent",
      rating_guided: "",
      rating_project: "",
      rating_knowledge: "",
      rating_leadership: "",
      rating_soft_skills: "",
      recommendation_score: 10,
      comment: "Helpful",
    })]);
    assert.equal(feedback.rows[0].status, "valid");
    assert.equal(feedback.rows[0].preview[0].nps_category, "promoter");
    assert.equal(feedback.rows[0].preview[0].rating_guided_score, null);
    const event = classify("events", [values(2, {
      event_name: "Template Workshop Alpha",
      event_type: "WORKSHOP",
      event_date_start: "2026-11-01",
      event_date_end: "2026-11-02",
      participant_count: 0,
    })]);
    assert.equal(event.rows[0].status, "valid");
    assert.equal(event.rows[0].preview[0].event_type, "WORKSHOP");
  });

  it("reports a missing required column and names the template", async () => {
    await assert.rejects(
      () => prepareUpload({
        dataset: "instructors",
        filename: "instructors.csv",
        buffer: Buffer.from("instructor_name,title\nLayla Hassan,Dr.\n", "utf8"),
      }),
      (error) => {
        assert.equal(error.code, "FILE_INVALID");
        assert.match(error.message, /status/);
        assert.match(error.message, /instructors/);
        assert.match(error.message, /\/api\/templates/);
        return true;
      },
    );
  });

  it("reports an unknown column", async () => {
    await assert.rejects(
      () => prepareUpload({
        dataset: "instructors",
        filename: "instructors.csv",
        buffer: Buffer.from("instructor_name,title,status,full_name_ar,system_name_ar,nickname\nLayla Hassan,Dr.,Active,,,\n", "utf8"),
      }),
      (error) => {
        assert.match(error.message, /nickname/);
        return true;
      },
    );
  });

  it("reports wrong types, bad dates, out-of-range numbers, and bad enums with spreadsheet row numbers", () => {
    const result = classify("sessions", [
      values(2, {
        session_date: "2026-11-01", group_code: "MBA-G281", course_name: "Leading with Analytics",
        instructor_name: "Ahmed Tealeb", session_number: 1, duration_hours: 3, language: "Arabic",
        activity_type: "INTERNAL", start_time: "17:00", status: "PLANNED", diploma_type: "",
      }),
      values(3, {
        session_date: "2026-13-40", group_code: "MBA-G281", course_name: "Leading with Analytics",
        instructor_name: "Ahmed Tealeb", session_number: "many", duration_hours: 0.25, language: "Arabic",
        activity_type: "SIDEWAYS", start_time: "5 PM", status: "DONE", diploma_type: "",
      }),
    ]);
    assert.equal(result.rows[0].status, "valid");
    assert.equal(result.rows[1].status, "error");
    assert.equal(result.rows[1].rowNumber, 3);
    const columns = result.rows[1].errors.map((error) => error.column);
    assert.ok(columns.includes("session_date"));
    assert.ok(columns.includes("session_number"));
    assert.ok(columns.includes("duration_hours"));
    assert.ok(columns.includes("activity_type"));
    assert.ok(columns.includes("start_time"));
    assert.ok(columns.includes("status"));
    const students = classify("groups", [values(4, {
      group_code: "MBA-G991", course_name: "Leading with Analytics", instructor_name: "Ahmed Tealeb",
      activity_type: "INTERNAL", degree: "MBA", language: "Arabic", num_students: 0, day: "Sunday", status: "COMPLETED",
    })]);
    assert.equal(students.rows[0].rowNumber, 4);
    assert.equal(students.rows[0].errors[0].column, "num_students");
  });

  it("suggests the closest instructor when a name does not resolve", () => {
    const result = classify("groups", [values(2, {
      group_code: "MBA-G990", course_name: "Leading with Analytics", instructor_name: "Ahmed Taleb",
      activity_type: "INTERNAL", degree: "MBA", language: "Arabic", num_students: "", day: "", status: "",
    })]);
    assert.equal(result.rows[0].status, "error");
    assert.match(result.rows[0].message, /Ahmed Tealeb/);
    assert.match(result.rows[0].message, /upload the instructor first/);
  });

  it("normalizes group codes and enforces the 4-digit rule", () => {
    const notice = classify("groups", [values(2, {
      group_code: "mba g990", course_name: "Leading with Analytics", instructor_name: "Ahmed Tealeb",
      activity_type: "internal", degree: "mba", language: "arabic", num_students: "", day: "", status: "",
    })]);
    assert.equal(notice.rows[0].status, "valid");
    assert.equal(notice.rows[0].preview[0].group_code, "MBA-G990");
    assert.match(notice.rows[0].notices.map((item) => item.message).join(" "), /MBA-G990/);
    assert.equal(notice.rows[0].preview[0].status_clean, "UNKNOWN");

    const long = classify("groups", [values(2, {
      group_code: "MBA-G9999", course_name: "Leading with Analytics", instructor_name: "Ahmed Tealeb",
      activity_type: "INTERNAL", degree: "MBA", language: "Arabic", num_students: "", day: "", status: "",
    })]);
    assert.equal(long.rows[0].status, "error");
    assert.match(long.rows[0].message, /4 or more digits/);

    const known = classify("groups", [values(2, {
      group_code: "MBA-G2272", course_name: "Leading with Analytics", instructor_name: "Ahmed Tealeb",
      activity_type: "INTERNAL", degree: "MBA", language: "Arabic", num_students: 12, day: "Monday", status: "PLANNED",
    })]);
    assert.equal(known.rows[0].status, "valid");
  });

  it("marks a repeated key in the same file as a duplicate", () => {
    const result = classify("instructors", [
      values(2, { instructor_name: "Layla Hassan", title: "Dr.", status: "Active", full_name_ar: "", system_name_ar: "" }),
      values(3, { instructor_name: " layla   hassan ", title: "Dr.", status: "Active", full_name_ar: "", system_name_ar: "" }),
    ]);
    assert.equal(result.rows[0].status, "valid");
    assert.equal(result.rows[1].status, "duplicate");
    assert.match(result.rows[1].duplicateOf, /row 2/);
  });

  it("treats the same key with different content as a conflict and leaves base rows unchanged", () => {
    const base = fixtureBase();
    const before = JSON.stringify(base.instructors[0]);
    const result = classify("instructors", [values(2, {
      instructor_name: "Ahmed Tealeb", title: "Eng.", status: "Active", full_name_ar: "", system_name_ar: "",
    })], base);
    assert.equal(result.rows[0].status, "conflict");
    assert.match(result.rows[0].message, /title/);
    assert.match(result.rows[0].message, /base data/);
    assert.match(result.rows[0].message, /Nothing was overwritten/);
    assert.equal(JSON.stringify(base.instructors[0]), before);
  });

  it("detects a re-upload of a base session as a duplicate", () => {
    const base = fixtureBase();
    const result = classify("sessions", [values(2, {
      session_date: "2024-01-03",
      group_code: "MBA-G281",
      course_name: "Leading with Analytics",
      instructor_name: "Ahmed Tealeb",
      session_number: 2,
      duration_hours: 6,
      language: "Arabic",
      activity_type: "EXTERNAL",
      start_time: normalizeStartTime("5PM"),
      status: "COMPLETED",
      diploma_type: "",
    })], base);
    assert.equal(result.rows[0].status, "duplicate");
    assert.match(result.rows[0].duplicateOf, /SES_00433/);
  });

  it("expands multiple instructors, derives NPS, and redacts PII", () => {
    const result = classify("feedback", [values(2, {
      response_id: "",
      feedback_date: "2026-11-01",
      activity_type: "EXTERNAL",
      group_code: "not-a-group",
      course_name: "",
      instructor_names: "Ahmed Tealeb; Osama Mobarez",
      overall_satisfaction: "Somewhat satisfied",
      rating_elearning: "Poor",
      rating_guided: "",
      rating_project: "",
      rating_knowledge: "",
      rating_leadership: "",
      rating_soft_skills: "",
      recommendation_score: 8,
      comment: "Email me at student@example.com or 0123456789 and ٠١٢٣٤٥٦٧٨٩",
    })]);
    assert.equal(result.rows[0].status, "valid");
    assert.equal(result.rows[0].preview.length, 2);
    assert.equal(result.rows[0].preview[0].feedback_id, null);
    assert.equal(result.rows[0].preview[0].instructor_name_clean, "Ahmed Tealeb");
    assert.equal(result.rows[0].preview[1].instructor_name_clean, "Osama Mobarez");
    assert.equal(result.rows[0].preview[0].nps_category, "passive");
    assert.equal(result.rows[0].preview[0].group_match_status, "REVIEW");
    assert.equal(result.rows[0].preview[0].rating_elearning_score, 1);
    assert.match(result.rows[0].preview[0].student_comment, /\[REDACTED-PII\]/);
    assert.doesNotMatch(result.rows[0].preview[0].student_comment, /example\.com/);
    assert.doesNotMatch(result.rows[0].preview[0].student_comment, /0123456789/);
    const detractor = classify("feedback", [values(2, {
      response_id: "", feedback_date: "2026-11-02", activity_type: "INTERNAL", group_code: "",
      course_name: "", instructor_names: "", overall_satisfaction: "Very dissatisfied",
      rating_elearning: "", rating_guided: "", rating_project: "", rating_knowledge: "",
      rating_leadership: "", rating_soft_skills: "", recommendation_score: 6, comment: "",
    })]);
    assert.equal(detractor.rows[0].preview[0].nps_category, "detractor");
    assert.equal(detractor.rows[0].preview[0].instructor_match_status, "UNMAPPED");
    const blank = classify("feedback", [values(2, {
      response_id: "", feedback_date: "2026-11-03", activity_type: "INTERNAL", group_code: "",
      course_name: "", instructor_names: "", overall_satisfaction: "Very satisfied",
      rating_elearning: "", rating_guided: "", rating_project: "", rating_knowledge: "",
      rating_leadership: "", rating_soft_skills: "", recommendation_score: "", comment: "",
    })]);
    assert.equal(blank.rows[0].preview[0].nps_category, null);
    assert.equal(blank.rows[0].preview[0].recommendation_score, null);
  });

  it("rejects a session date more than two years ahead", () => {
    const result = classify("sessions", [values(2, {
      session_date: "2028-10-04", group_code: "MBA-G281", course_name: "Leading with Analytics",
      instructor_name: "Ahmed Tealeb", session_number: 1, duration_hours: 1, language: "Arabic",
      activity_type: "INTERNAL", start_time: "", status: "", diploma_type: "",
    })]);
    assert.equal(result.rows[0].status, "error");
    assert.match(result.rows[0].message, /2 years/);
  });
});
