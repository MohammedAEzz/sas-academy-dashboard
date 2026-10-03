import { Readable } from "node:stream";
import { migrate } from "../db/migrate.js";
import { setDbAdapter } from "../api/_lib/db.js";
import { columnIds } from "../js/core/schema.js";

export const AS_OF = "2026-10-03";

export async function bootDatabase() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const adapter = {
    async query(text, params = []) {
      const result = await pg.query(text, params);
      return { rows: result.rows };
    },
    async transaction(fn) {
      return pg.transaction(async (tx) => fn({
        async query(text, params = []) {
          const result = await tx.query(text, params);
          return { rows: result.rows };
        },
      }));
    },
    async close() {
      await pg.close();
    },
  };
  await migrate(adapter);
  await migrate(adapter);
  setDbAdapter(adapter);
  process.env.DATABASE_URL = "postgres://test:test@localhost/test";
  process.env.ADMIN_PASSWORD = "test-password-value";
  process.env.SESSION_SECRET = "test-session-secret-value";
  return adapter;
}

export async function resetDatabase(adapter) {
  await adapter.query("TRUNCATE TABLE records, imports, login_attempts, id_counters RESTART IDENTITY");
}

export function csvBuffer(dataset, records) {
  const headers = columnIds(dataset);
  const lines = [headers.join(",")];
  for (const record of records) {
    lines.push(headers.map((id) => csvEscape(record[id] ?? "")).join(","));
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function mockReq({ method = "GET", url = "/", headers = {}, body = null, ip = "203.0.113.10" } = {}) {
  const payload = body == null
    ? null
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost:3000",
    origin: "http://localhost:3000",
    "x-requested-with": "fetch",
    "content-type": "application/json",
    "x-forwarded-for": ip,
    ...headers,
  };
  req.socket = { remoteAddress: ip };
  return req;
}

export function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

export async function call(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  let json = null;
  if (typeof res.body === "string") {
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
  }
  return { status: res.statusCode, headers: res.headers, body: res.body, json };
}

export function cookiePair(setCookie) {
  const match = /sas_admin=([^;]*)/.exec(setCookie || "");
  return match ? `sas_admin=${match[1]}` : "";
}
