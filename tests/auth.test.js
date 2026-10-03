import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import authHandler from "../api/auth.js";
import importsHandler from "../api/imports.js";
import { bootDatabase, call, cookiePair, csvBuffer, resetDatabase } from "./helpers.js";

let db;

describe("admin session", () => {
  before(async () => {
    db = await bootDatabase();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    process.env.ADMIN_PASSWORD = "test-password-value";
    process.env.SESSION_SECRET = "test-session-secret-value";
    process.env.DATABASE_URL = "postgres://test:test@localhost/test";
  });
  after(async () => {
    await db.close();
  });

  it("rejects a wrong password", async () => {
    const response = await call(authHandler, {
      method: "POST",
      url: "/api/auth?action=login",
      body: { password: "nope" },
    });
    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, "UNAUTHORIZED");
  });

  it("rate-limits repeated failed sign-ins", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await call(authHandler, {
        method: "POST",
        url: "/api/auth?action=login",
        ip: "203.0.113.50",
        body: { password: "nope" },
      });
      assert.equal(response.status, 401);
    }
    const blocked = await call(authHandler, {
      method: "POST",
      url: "/api/auth?action=login",
      ip: "203.0.113.50",
      body: { password: "test-password-value" },
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, "RATE_LIMITED");
  });

  it("rejects a tampered session cookie", async () => {
    const login = await call(authHandler, {
      method: "POST",
      url: "/api/auth?action=login",
      body: { password: "test-password-value" },
    });
    const cookie = cookiePair(login.headers["set-cookie"]).replace("sas_admin=", "sas_admin=x");
    const me = await call(authHandler, {
      method: "GET",
      url: "/api/auth",
      headers: { cookie, "x-requested-with": "" },
    });
    assert.equal(me.json.authenticated, false);
    const commit = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=commit",
      headers: { cookie },
      body: { dataset: "instructors", filename: "a.csv", contentBase64: csvBuffer("instructors", []).toString("base64"), sha256: "abc" },
    });
    assert.equal(commit.status, 401);
    assert.equal(commit.json.error.code, "UNAUTHORIZED");
  });

  it("rejects a mutating request without the CSRF header", async () => {
    const login = await call(authHandler, {
      method: "POST",
      url: "/api/auth?action=login",
      ip: "203.0.113.60",
      body: { password: "test-password-value" },
    });
    const response = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=preview",
      headers: {
        cookie: cookiePair(login.headers["set-cookie"]),
        "x-requested-with": "",
      },
      body: { dataset: "instructors", filename: "a.csv", contentBase64: Buffer.from("x").toString("base64") },
    });
    assert.equal(response.status, 403);
    assert.equal(response.json.error.code, "CSRF");
  });

  it("rejects a commit with no session", async () => {
    const response = await call(importsHandler, {
      method: "POST",
      url: "/api/imports?action=commit",
      body: { dataset: "instructors", filename: "a.csv", contentBase64: Buffer.from("x").toString("base64"), sha256: "abc" },
    });
    assert.equal(response.status, 401);
  });

  it("fails closed when configuration is missing", async () => {
    const previous = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    try {
      const response = await call(authHandler, {
        method: "POST",
        url: "/api/auth?action=login",
        body: { password: "test-password-value" },
      });
      assert.equal(response.status, 500);
      assert.equal(response.json.error.code, "CONFIG");
      assert.match(response.json.error.message, /ADMIN_PASSWORD/);
      assert.equal(JSON.stringify(response.json).includes("test-session-secret"), false);
    } finally {
      process.env.ADMIN_PASSWORD = previous;
    }
  });
});
