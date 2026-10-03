import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootDatabase, csvBuffer, resetDatabase } from "./helpers.js";
import { commitImport, loadPublicData, previewImport, revertImport } from "../api/_lib/import-service.js";
import { createRepository } from "../api/_lib/repository.js";

const instructorsFile = join(dirname(fileURLToPath(import.meta.url)), "../data/instructors.json");
let db;

describe("import storage", () => {
  before(async () => {
    db = await bootDatabase();
  });
  beforeEach(async () => {
    await resetDatabase(db);
  });
  after(async () => {
    await db.close();
  });

  it("rolls back the import and its rows when an insert fails midway", async () => {
    const buffer = csvBuffer("instructors", [
      { instructor_name: "Layla Hassan", title: "Dr.", status: "Active" },
      { instructor_name: "Omar Farouk", title: "Eng.", status: "Not Active" },
    ]);
    const preview = await previewImport(db, { dataset: "instructors", filename: "instructors.csv", buffer });
    await assert.rejects(
      () => commitImport(db, {
        dataset: "instructors",
        filename: "instructors.csv",
        buffer,
        sha256: preview.sha256,
        faultAfterInserts: 1,
      }),
      (error) => error.name === "ForcedFailure",
    );
    const repo = createRepository(db);
    assert.equal(await repo.countImports(), 0);
    assert.equal(await repo.countRecords(), 0);
  });

  it("imports only the still-valid rows when another import lands after preview", async () => {
    const first = csvBuffer("instructors", [
      { instructor_name: "Layla Hassan", title: "Dr.", status: "Active" },
    ]);
    const second = Buffer.concat([first, Buffer.from("\n")]);
    assert.notEqual(createHash("sha256").update(first).digest("hex"), createHash("sha256").update(second).digest("hex"));
    const preview = await previewImport(db, { dataset: "instructors", filename: "a.csv", buffer: first });
    assert.equal(preview.counts.valid, 1);
    const other = await previewImport(db, { dataset: "instructors", filename: "b.csv", buffer: second });
    await commitImport(db, { dataset: "instructors", filename: "b.csv", buffer: second, sha256: other.sha256 });
    await assert.rejects(
      () => commitImport(db, {
        dataset: "instructors",
        filename: "a.csv",
        buffer: first,
        sha256: preview.sha256,
        previewCounts: preview.counts,
      }),
      (error) => {
        assert.equal(error.code, "NOTHING_TO_IMPORT");
        assert.equal(error.status, 400);
        assert.equal(error.details.changedSincePreview, true);
        assert.equal(error.details.counts.duplicate, 1);
        return true;
      },
    );
    const repo = createRepository(db);
    assert.equal(await repo.countImports(), 1);
    assert.equal(await repo.countRecords(), 1);
  });

  it("rejects a second insert of an active key and leaves the database empty", async () => {
    const repo = createRepository(db);
    const sql = [];
    const original = db.transaction.bind(db);
    db.transaction = async (fn) => original(async (tx) => {
      const query = tx.query.bind(tx);
      tx.query = async (text, params) => {
        sql.push(text);
        return query(text, params);
      };
      return fn(tx);
    });
    try {
      await assert.rejects(() => repo.transaction(async (tx) => {
        await repo.lockImports(tx);
        await repo.insertImport(tx, {
          id: "IMP_test",
          dataset: "instructors",
          filename: "a.csv",
          fileSha256: "abc",
          totalRows: 2,
          importedCount: 2,
          duplicateCount: 0,
          conflictCount: 0,
          errorCount: 0,
          skipped: [],
          changedSincePreview: false,
        });
        const row = {
          dataset: "instructors",
          recordKey: "same-key",
          contentHash: "hash",
          entityId: "INS_U0001",
          data: { rows: [{ instructor_id: "INS_U0001" }] },
          importId: "IMP_test",
        };
        await repo.insertRecord(tx, { ...row, id: "rec-1" });
        await repo.insertRecord(tx, { ...row, id: "rec-2", entityId: "INS_U0002" });
      }), (error) => error.code === "CONFLICT");
    } finally {
      db.transaction = original;
    }
    assert.equal(await repo.countImports(), 0);
    assert.equal(await repo.countRecords(), 0);
    assert.ok(sql.some((text) => text.includes("pg_advisory_xact_lock")));
  });

  it("hides reverted records and refuses to revert an import that later records depend on", async () => {
    const instructorFile = csvBuffer("instructors", [
      { instructor_name: "Layla Hassan", title: "Dr.", status: "Active" },
    ]);
    const instructorPreview = await previewImport(db, { dataset: "instructors", filename: "instructors.csv", buffer: instructorFile });
    const instructorCommit = await commitImport(db, {
      dataset: "instructors", filename: "instructors.csv", buffer: instructorFile, sha256: instructorPreview.sha256,
    });
    const sessionFile = csvBuffer("sessions", [{
      session_date: "2026-11-01",
      group_code: "MBA-G990",
      course_name: "Leading with Analytics",
      instructor_name: "Layla Hassan",
      session_number: 1,
      duration_hours: 3,
      language: "Arabic",
      activity_type: "INTERNAL",
      start_time: "17:00",
      status: "PLANNED",
      diploma_type: "",
    }]);
    const sessionPreview = await previewImport(db, { dataset: "sessions", filename: "sessions.csv", buffer: sessionFile });
    assert.equal(sessionPreview.counts.valid, 1, JSON.stringify(sessionPreview.rows[0]));
    const sessionCommit = await commitImport(db, {
      dataset: "sessions", filename: "sessions.csv", buffer: sessionFile, sha256: sessionPreview.sha256,
    });
    await assert.rejects(
      () => revertImport(db, { importId: instructorCommit.importId, reason: "wrong file" }),
      (error) => {
        assert.equal(error.code, "DEPENDENTS");
        assert.match(error.message, /sessions/);
        assert.equal(error.details.dependents[0].importId, sessionCommit.importId);
        return true;
      },
    );
    await revertImport(db, { importId: sessionCommit.importId, reason: "session first" });
    await revertImport(db, { importId: instructorCommit.importId, reason: "now unused" });
    const data = await loadPublicData(db);
    assert.deepEqual(data.instructors, []);
    assert.deepEqual(data.sessions, []);
    assert.equal(data.meta.importCount, 0);
    assert.equal(data.meta.lastUpdatedAt, null);
  });

  it("does not modify base instructor JSON when a conflicting row is committed", async () => {
    const before = readFileSync(instructorsFile);
    const buffer = csvBuffer("instructors", [
      { instructor_name: "Ahmed Tealeb", title: "Eng.", status: "Not Active" },
    ]);
    const preview = await previewImport(db, { dataset: "instructors", filename: "conflict.csv", buffer });
    assert.equal(preview.counts.conflict, 1);
    await assert.rejects(
      () => commitImport(db, {
        dataset: "instructors", filename: "conflict.csv", buffer, sha256: preview.sha256,
      }),
      (error) => error.code === "NOTHING_TO_IMPORT" && error.status === 400,
    );
    assert.equal(await createRepository(db).countImports(), 0);
    assert.deepEqual(readFileSync(instructorsFile), before);
    const data = await loadPublicData(db);
    assert.deepEqual(data.instructors, []);
  });

  it("reports that the exact file was already imported", async () => {
    const buffer = csvBuffer("courses", [
      { course_name: "Upload Template Course Alpha", declared_hours: 6, course_category: "Visual Analytics" },
    ]);
    const preview = await previewImport(db, { dataset: "courses", filename: "courses.csv", buffer });
    await commitImport(db, { dataset: "courses", filename: "courses.csv", buffer, sha256: preview.sha256 });
    const again = await previewImport(db, { dataset: "courses", filename: "courses.csv", buffer });
    assert.equal(again.counts.duplicate, 1);
    assert.match(again.alreadyImportedMessage, /imported on/);
    await assert.rejects(
      () => commitImport(db, { dataset: "courses", filename: "courses.csv", buffer, sha256: preview.sha256 }),
      (error) => error.code === "ALREADY_IMPORTED",
    );
  });

  it("stamps lastUpdatedAt from the latest active import that stored a row", async () => {
    const firstFile = csvBuffer("instructors", [
      { instructor_name: "Layla Hassan", title: "Dr.", status: "Active" },
    ]);
    const firstPreview = await previewImport(db, { dataset: "instructors", filename: "first.csv", buffer: firstFile });
    const first = await commitImport(db, {
      dataset: "instructors", filename: "first.csv", buffer: firstFile, sha256: firstPreview.sha256,
    });
    const afterFirst = await loadPublicData(db);
    assert.equal(afterFirst.meta.importCount, 1);
    assert.ok(afterFirst.meta.lastUpdatedAt);

    const emptyFile = csvBuffer("instructors", [
      { instructor_name: "Ahmed Tealeb", title: "Eng.", status: "Not Active" },
    ]);
    const emptyPreview = await previewImport(db, { dataset: "instructors", filename: "empty.csv", buffer: emptyFile });
    assert.equal(emptyPreview.counts.valid, 0);
    await assert.rejects(
      () => commitImport(db, {
        dataset: "instructors", filename: "empty.csv", buffer: emptyFile, sha256: emptyPreview.sha256,
      }),
      (error) => {
        assert.equal(error.code, "NOTHING_TO_IMPORT");
        assert.match(error.message, /no valid rows/);
        return true;
      },
    );
    const stillFirst = await loadPublicData(db);
    assert.equal(stillFirst.meta.lastUpdatedAt, afterFirst.meta.lastUpdatedAt);
    assert.equal(await createRepository(db).countImports(), 1);

    const secondFile = csvBuffer("courses", [
      { course_name: "Upload Template Course Alpha", declared_hours: 6, course_category: "Visual Analytics" },
    ]);
    const secondPreview = await previewImport(db, { dataset: "courses", filename: "second.csv", buffer: secondFile });
    const second = await commitImport(db, {
      dataset: "courses", filename: "second.csv", buffer: secondFile, sha256: secondPreview.sha256,
    });
    const afterSecond = await loadPublicData(db);
    assert.equal(afterSecond.meta.importCount, 2);
    assert.ok(afterSecond.meta.lastUpdatedAt >= afterFirst.meta.lastUpdatedAt);

    await revertImport(db, { importId: second.importId, reason: "drop latest" });
    const afterRevertLatest = await loadPublicData(db);
    assert.equal(afterRevertLatest.meta.importCount, 1);
    assert.equal(afterRevertLatest.meta.lastUpdatedAt, afterFirst.meta.lastUpdatedAt);

    await revertImport(db, { importId: first.importId, reason: "drop remaining" });
    const cleared = await loadPublicData(db);
    assert.equal(cleared.meta.importCount, 0);
    assert.equal(cleared.meta.lastUpdatedAt, null);
  });
});
