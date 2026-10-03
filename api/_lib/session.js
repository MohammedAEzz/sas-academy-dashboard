import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";

const COOKIE = "sas_admin";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

export function passwordMatches(input, expected) {
  const left = createHash("sha256").update(String(input ?? "")).digest();
  const right = createHash("sha256").update(String(expected ?? "")).digest();
  return timingSafeEqual(left, right);
}

export function signSession(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + EIGHT_HOURS_MS })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.exp === "number" && data.exp > now;
  } catch {
    return false;
  }
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie || "";
  for (const part of header.split(/;\s*/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1));
  }
  return "";
}

function secureFlag(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto === "https") return "; Secure";
  if (proto === "http") return "";
  const host = String(req.headers.host || "");
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) return "";
  return "; Secure";
}

export function sessionCookie(token, req) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureFlag(req)}`;
}

export function clearSessionCookie(req) {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag(req)}`;
}

export function sessionFromRequest(req) {
  return verifySession(readCookie(req), process.env.SESSION_SECRET || "");
}

export function assertSession(req) {
  if (!sessionFromRequest(req)) {
    throw new AppError("UNAUTHORIZED", "Sign in to continue.", 401);
  }
}
