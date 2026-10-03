import { AppError } from "./errors.js";

export function requireConfig(names) {
  const missing = [];
  for (const name of names) {
    const value = process.env[name];
    if (value == null || String(value).trim() === "") missing.push(name);
  }
  if (!missing.includes("SESSION_SECRET") && names.includes("SESSION_SECRET")) {
    if (String(process.env.SESSION_SECRET).length < 16) {
      throw new AppError("CONFIG", "Server is missing required configuration: SESSION_SECRET must be at least 16 characters.", 500);
    }
  }
  if (missing.length) {
    throw new AppError("CONFIG", `Server is missing required configuration: ${missing.join(", ")}`, 500);
  }
}

export function requestUrl(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
  }
  res.end(JSON.stringify(body));
}

export function sendBytes(res, status, { type, filename, body }) {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export function withHandler(fn) {
  return async function handler(req, res) {
    try {
      await fn(req, res);
    } catch (error) {
      if (res.headersSent && res.statusCode && res.body != null) return;
      const known = error instanceof AppError;
      if (!known) console.error("request_failed", error?.name || "Error");
      const payload = {
        error: {
          code: known ? error.code : "INTERNAL",
          message: known ? error.message : "Something went wrong.",
        },
      };
      if (known && error.details) payload.error.details = error.details;
      sendJson(res, known ? error.status : 500, payload);
    }
  };
}

export function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = forwarded
    ? String(forwarded).split(",")[0].trim()
    : (req.socket?.remoteAddress || "unknown");
  return raw.slice(0, 200) || "unknown";
}

export function assertMutatingRequest(req) {
  const requestedWith = req.headers["x-requested-with"];
  if (!requestedWith || !String(requestedWith).trim()) {
    throw new AppError("CSRF", "Missing X-Requested-With header.", 403);
  }
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) {
    throw new AppError("CSRF", "This request was blocked. Reload the dashboard and try again.", 403);
  }
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("CSRF", "This request was blocked. Reload the dashboard and try again.", 403);
  }
  if (originHost !== host) {
    throw new AppError("CSRF", "This request was blocked because its origin does not match this site.", 403);
  }
}

export async function readRequestBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  // The Vercel Node runtime may already have consumed the stream and exposed the raw
  // body as a Buffer or string (e.g. multipart); use it instead of re-reading.
  let buffer;
  if (Buffer.isBuffer(req.body)) {
    buffer = req.body;
  } else if (typeof req.body === "string") {
    buffer = Buffer.from(req.body, "utf8");
  } else {
    const chunks = [];
    if (req[Symbol.asyncIterator]) {
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    buffer = Buffer.concat(chunks);
  }
  const type = String(req.headers["content-type"] || "");
  if (type.includes("multipart/form-data")) return parseMultipart(buffer, type);
  if (type.includes("application/octet-stream")) return uploadFromRawBody(req, buffer);
  if (!buffer.length) return {};
  if (type.includes("application/json") || buffer[0] === 0x7b || buffer[0] === 0x5b) {
    try {
      return JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new AppError("BAD_REQUEST", "The request body is not valid JSON.", 400);
    }
  }
  throw new AppError("BAD_REQUEST", "Send JSON or multipart form data.", 400);
}

// Raw file upload: the file bytes are the body and the fields travel in the query string.
// Used by the browser because the Vercel runtime drains multipart bodies before the handler.
function uploadFromRawBody(req, buffer) {
  const params = requestUrl(req).searchParams;
  let previewCounts = null;
  if (params.get("previewCounts")) {
    try {
      previewCounts = JSON.parse(params.get("previewCounts"));
    } catch {
      throw new AppError("BAD_REQUEST", "previewCounts must be JSON.", 400);
    }
  }
  return {
    dataset: params.get("dataset") || "",
    filename: params.get("filename") || "",
    sha256: params.get("sha256") || "",
    previewCounts,
    contentBase64: buffer.toString("base64"),
  };
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new AppError("BAD_REQUEST", "The upload body is not valid multipart data.", 400);
  const boundary = Buffer.from(`--${(match[1] || match[2]).trim()}`);
  const fields = {};
  let cursor = buffer.indexOf(boundary);
  if (cursor < 0) throw new AppError("BAD_REQUEST", "The upload body is not valid multipart data.", 400);
  while (cursor >= 0 && cursor < buffer.length) {
    if (buffer.subarray(cursor + boundary.length, cursor + boundary.length + 2).toString() === "--") break;
    const start = buffer.indexOf("\r\n\r\n", cursor);
    if (start < 0) break;
    const headers = buffer.subarray(cursor + boundary.length, start).toString("utf8");
    const next = buffer.indexOf(boundary, start + 4);
    if (next < 0) break;
    let bodyEnd = next - 2;
    if (buffer[bodyEnd] !== 0x0d) bodyEnd = next;
    const disposition = /name="([^"]+)"/i.exec(headers);
    const filename = /filename="([^"]*)"/i.exec(headers);
    const name = disposition ? disposition[1] : "";
    const value = buffer.subarray(start + 4, bodyEnd);
    if (name) {
      if (filename) fields[name] = { filename: filename[1], buffer: Buffer.from(value) };
      else fields[name] = value.toString("utf8");
    }
    cursor = next;
  }
  const file = fields.file;
  let previewCounts = null;
  if (fields.previewCounts) {
    try {
      previewCounts = JSON.parse(fields.previewCounts);
    } catch {
      throw new AppError("BAD_REQUEST", "previewCounts must be JSON.", 400);
    }
  }
  return {
    dataset: fields.dataset || "",
    filename: file?.filename || fields.filename || "",
    sha256: fields.sha256 || "",
    previewCounts,
    contentBase64: file ? file.buffer.toString("base64") : fields.contentBase64 || "",
  };
}
