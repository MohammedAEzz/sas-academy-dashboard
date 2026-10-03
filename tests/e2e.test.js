import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import authHandler from "../api/auth.js";
import dataHandler from "../api/data.js";
import importsHandler from "../api/imports.js";
import templatesHandler from "../api/templates.js";
import { bootDatabase, call, cookiePair, csvBuffer, resetDatabase } from "./helpers.js";

let db;
let cookie;

describe("preview, commit, data, and revert", () => {
  before(async () => {
    db = await bootDatabase();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    process.env.ADMIN_PASSWORD = "test-password-value";
    process.env.SESSION_SECRET = "test-session-secret-value";
    process.env.DATABASE_URL = "postgres://test:test@localhost/test";
    const login = await call(authHandler, {
      method: "POST",
      url: "/api/auth?action=login",
      ip: "203.0.113.70",
      body: { password: "test-password-value" },
    });
    cookie = cookiePair(login.headers["set-cookie"]);
    assert.equal(login.status, 200);
    assert.match(login.headers["set-cookie"], /HttpOnly/);
    assert.match(login.headers["set-cookie"], /SameSite=Strict/);
    assert.doesNotMatch(login.headers["set-cookie"], /Secure/);
  });
  after(async () => {
    await db.close();
  });

  it("appends an instructor and hides it after revert", async () => {
    const empty = await call(dataHandler, { method: "GET", url: "/api/data" });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.instructors, []);
    assert.equal(empty.json.meta.importCount, 0);

    const buffer = csvBuffer("instructors", [
      { instructor_name: "Layla Hassan", title: "Dr.", status: "Active", full_name_ar: "د. ليلى حسن", system_name_ar: "" },
    ]);
    const preview = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=preview",
      headers: { cookie },
      body: { dataset: "instructors", filename: "instructors.csv", contentBase64: buffer.toString("base64") },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.counts.valid, 1);
    assert.equal(preview.json.alreadyImportedAt, null);

    const committed = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=commit",
      headers: { cookie },
      body: {
        dataset: "instructors",
        filename: "instructors.csv",
        contentBase64: buffer.toString("base64"),
        sha256: preview.json.sha256,
        previewCounts: preview.json.counts,
      },
    });
    assert.equal(committed.status, 200, JSON.stringify(committed.json));
    assert.equal(committed.json.changedSincePreview, false);
    assert.equal(committed.json.imported, 1);

    const data = await call(dataHandler, { method: "GET", url: "/api/data" });
    assert.equal(data.json.instructors.length, 1);
    assert.equal(data.json.instructors[0].instructor_id, "INS_U0001");
    assert.equal(data.json.instructors[0].instructor_name_clean, "Layla Hassan");
    assert.equal(data.json.instructors[0].title, "Dr.");
    assert.equal(data.json.instructors[0].status, "Active");
    assert.equal(data.json.meta.importCount, 1);
    assert.equal("rows" in data.json.instructors[0], false);

    const history = await call(importsHandler, {
      method: "GET",
      url: "/api/imports?action=history",
      headers: { cookie },
    });
    assert.equal(history.json.imports.length, 1);

    const reverted = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=revert",
      headers: { cookie },
      body: { importId: committed.json.importId, reason: "uploaded in error" },
    });
    assert.equal(reverted.status, 200);
    const after = await call(dataHandler, { method: "GET", url: "/api/data" });
    assert.deepEqual(after.json.instructors, []);
    assert.equal(after.json.meta.importCount, 0);
  });

  it("accepts a multipart preview", async () => {
    const file = csvBuffer("instructors", [
      { instructor_name: "Nour El Din", title: "Dr.", status: "Active" },
    ]);
    const boundary = "----sasboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dataset"\r\n\r\ninstructors\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="instructors.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=preview",
      headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.counts.valid, 1);
  });

  it("serves a CSV template with a UTF-8 BOM", async () => {
    const response = await call(templatesHandler, {
      method: "GET",
      url: "/api/templates?dataset=instructors&format=csv",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /text\/csv/);
    assert.equal(response.body.charCodeAt(0), 0xfeff);
    assert.match(response.body.toString("utf8"), /instructor_name/);
  });
});
