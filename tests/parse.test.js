import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { MAX_UPLOAD_BYTES, prepareUpload } from "../api/_lib/parse-upload.js";
import { buildXlsx } from "../api/_lib/templates.js";
import { classifyUpload } from "../js/core/classify.js";
import { indexDatasets } from "../js/core/catalog.js";
import { loadBaseData } from "../api/_lib/base-data.js";
import { AS_OF } from "./helpers.js";

describe("upload files", () => {
  it("rejects an empty file, a non-UTF-8 CSV, an oversized file, too many rows, and an unreadable workbook", async () => {
    await assert.rejects(
      () => prepareUpload({ dataset: "instructors", filename: "instructors.csv", buffer: Buffer.from("instructor_name,title,status,full_name_ar,system_name_ar\n", "utf8") }),
      (error) => error.code === "FILE_INVALID" && /no data rows/.test(error.message),
    );
    await assert.rejects(
      () => prepareUpload({ dataset: "instructors", filename: "instructors.csv", buffer: Buffer.from([0xff, 0xfe, 0x41, 0x00]) }),
      (error) => /CSV UTF-8/.test(error.message),
    );
    await assert.rejects(
      () => prepareUpload({ dataset: "instructors", filename: "instructors.csv", buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61) }),
      (error) => /4 MB/.test(error.message),
    );
    const lines = ["instructor_name,title,status,full_name_ar,system_name_ar"];
    for (let index = 0; index < 20001; index += 1) lines.push(`Person ${index},Dr.,Active,,`);
    await assert.rejects(
      () => prepareUpload({ dataset: "instructors", filename: "instructors.csv", buffer: Buffer.from(lines.join("\n"), "utf8") }),
      (error) => /20,000/.test(error.message),
    );
    await assert.rejects(
      () => prepareUpload({ dataset: "instructors", filename: "instructors.xlsx", buffer: Buffer.from("this is not a workbook") }),
      (error) => /could not be read/.test(error.message),
    );
  });

  it("keeps the spreadsheet row number when a quoted CSV field contains a newline", async () => {
    const prepared = await prepareUpload({
      dataset: "instructors",
      filename: "instructors.csv",
      buffer: Buffer.from('instructor_name,title,status,full_name_ar,system_name_ar\n"Layla\nHassan",Dr.,Active,,\n', "utf8"),
    });
    assert.equal(prepared.rows.length, 1);
    assert.equal(prepared.rows[0].rowNumber, 2);
    assert.match(String(prepared.rows[0].values.instructor_name), /Layla/);
  });

  it("round-trips an xlsx template into rows that validate", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildXlsx("sessions"));
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Data", "Instructions", "Example"]);
    const sheet = workbook.getWorksheet("Data");
    const headers = sheet.getRow(1).values.slice(1);
    const record = {
      session_date: new Date(Date.UTC(2026, 10, 1)),
      group_code: "MBA-G990",
      course_name: "Leading with Analytics",
      instructor_name: "Ahmed Tealeb",
      session_number: 7,
      duration_hours: 3,
      language: "Arabic",
      activity_type: "INTERNAL",
      start_time: "17:00",
      status: "PLANNED",
      diploma_type: "",
    };
    headers.forEach((header, index) => {
      const value = record[header];
      sheet.getRow(2).getCell(index + 1).value = value == null || value === "" ? null : value;
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const prepared = await prepareUpload({ dataset: "sessions", filename: "sessions.xlsx", buffer });
    assert.equal(prepared.rows[0].values.session_date, "2026-11-01");
    const result = classifyUpload({
      dataset: "sessions",
      rows: prepared.rows,
      catalog: indexDatasets(loadBaseData(), []),
      asOf: AS_OF,
    });
    assert.equal(result.rows[0].status, "valid");
    assert.equal(result.rows[0].preview[0].date_confidence, "HIGH");
    assert.equal(result.rows[0].preview[0].start_time, "17:00");
  });
});
