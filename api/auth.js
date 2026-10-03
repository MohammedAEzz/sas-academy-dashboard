import { getDb } from "./_lib/db.js";
import { AppError } from "./_lib/errors.js";
import {
  assertMutatingRequest,
  clientKey,
  readRequestBody,
  requestUrl,
  requireConfig,
  sendJson,
  withHandler,
} from "./_lib/http.js";
import { createRepository } from "./_lib/repository.js";
import {
  clearSessionCookie,
  passwordMatches,
  sessionCookie,
  sessionFromRequest,
  signSession,
} from "./_lib/session.js";

const MAX_FAILURES = 5;

async function login(req, res, body) {
  assertMutatingRequest(req);
  const repo = createRepository(getDb());
  const client = clientKey(req);
  const failures = await repo.countRecentFailures(client);
  if (failures >= MAX_FAILURES) {
    res.setHeader("Retry-After", "900");
    throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Try again in 15 minutes.", 429);
  }
  if (!passwordMatches(body?.password, process.env.ADMIN_PASSWORD)) {
    await repo.recordLoginAttempt(client, false);
    throw new AppError("UNAUTHORIZED", "Incorrect password.", 401);
  }
  await repo.recordLoginAttempt(client, true);
  res.setHeader("Set-Cookie", sessionCookie(signSession(process.env.SESSION_SECRET), req));
  sendJson(res, 200, { ok: true });
}

async function logout(req, res) {
  assertMutatingRequest(req);
  res.setHeader("Set-Cookie", clearSessionCookie(req));
  sendJson(res, 200, { ok: true });
}

function me(req, res) {
  sendJson(res, 200, { authenticated: sessionFromRequest(req) });
}

export default withHandler(async (req, res) => {
  requireConfig(["DATABASE_URL", "ADMIN_PASSWORD", "SESSION_SECRET"]);
  const action = requestUrl(req).searchParams.get("action") || "";
  if (req.method === "GET") {
    me(req, res);
    return;
  }
  if (req.method !== "POST") {
    throw new AppError("METHOD_NOT_ALLOWED", "Use GET for the session and POST to sign in or out.", 405);
  }
  const body = await readRequestBody(req);
  if (action === "logout") {
    await logout(req, res);
    return;
  }
  if (action === "login") {
    await login(req, res, body);
    return;
  }
  throw new AppError("BAD_REQUEST", "Use action=login or action=logout.", 400);
});
