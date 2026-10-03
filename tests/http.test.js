import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Readable } from "node:stream";
import { readRequestBody } from "../api/_lib/http.js";

const boundary = "----sasboundary";
const multipart = Buffer.from(
  [
    `--${boundary}`,
    'Content-Disposition: form-data; name="dataset"',
    "",
    "instructors",
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="a.csv"',
    "Content-Type: text/csv",
    "",
    "instructor_name,title,status",
    `--${boundary}--`,
    "",
  ].join("\r\n"),
);

describe("readRequestBody", () => {
  it("parses multipart when the runtime already consumed the stream into req.body", async () => {
    // Vercel's Node runtime exposes the raw body as a Buffer and leaves the stream empty.
    const req = Readable.from([]);
    req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    req.body = multipart;

    const body = await readRequestBody(req);

    assert.equal(body.dataset, "instructors");
    assert.equal(body.filename, "a.csv");
    assert.equal(Buffer.from(body.contentBase64, "base64").toString("utf8"), "instructor_name,title,status");
  });
});

describe("raw file uploads", () => {
  it("reads the file from an octet-stream body and the fields from the query string", async () => {
    const req = Readable.from([]);
    req.url = "/api/imports?action=commit&dataset=instructors&filename=a.csv&sha256=abc&previewCounts=%7B%22valid%22%3A1%7D";
    req.headers = { host: "localhost:3000", "content-type": "application/octet-stream" };
    req.body = Buffer.from("instructor_name,title,status");

    const body = await readRequestBody(req);

    assert.deepEqual(
      { dataset: body.dataset, filename: body.filename, sha256: body.sha256, previewCounts: body.previewCounts },
      { dataset: "instructors", filename: "a.csv", sha256: "abc", previewCounts: { valid: 1 } },
    );
    assert.equal(Buffer.from(body.contentBase64, "base64").toString("utf8"), "instructor_name,title,status");
  });
});
