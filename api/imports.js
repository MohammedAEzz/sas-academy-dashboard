import { getDb } from "./_lib/db.js";
import { AppError } from "./_lib/errors.js";
import {
  assertMutatingRequest,
  readRequestBody,
  requestUrl,
  requireConfig,
  sendJson,
  withHandler,
} from "./_lib/http.js";
import { commitImport, listHistory, previewImport, revertImport } from "./_lib/import-service.js";
import { assertSession } from "./_lib/session.js";

function uploadFromBody(body) {
  if (!body?.contentBase64) {
    throw new AppError("BAD_REQUEST", "The request needs a file.", 400);
  }
  return {
    dataset: body.dataset,
    filename: body.filename,
    buffer: Buffer.from(String(body.contentBase64), "base64"),
    sha256: body.sha256,
    previewCounts: body.previewCounts,
  };
}

export default withHandler(async (req, res) => {
  requireConfig(["DATABASE_URL", "ADMIN_PASSWORD", "SESSION_SECRET"]);
  const action = requestUrl(req).searchParams.get("action") || "";
  if (req.method === "GET" && action === "history") {
    assertSession(req);
    sendJson(res, 200, { imports: await listHistory(getDb()) });
    return;
  }
  if (req.method !== "POST") {
    throw new AppError("METHOD_NOT_ALLOWED", "Use GET ?action=history, or POST ?action=preview, commit, or revert.", 405);
  }
  assertMutatingRequest(req);
  assertSession(req);
  const body = await readRequestBody(req);
  if (action === "preview") {
    sendJson(res, 200, await previewImport(getDb(), uploadFromBody(body)));
    return;
  }
  if (action === "commit") {
    const result = await commitImport(getDb(), uploadFromBody(body));
    sendJson(res, 200, {
      importId: result.importId,
      changedSincePreview: result.changedSincePreview,
      counts: result.counts,
      imported: result.imported,
      sha256: body.sha256,
    });
    return;
  }
  if (action === "revert") {
    sendJson(res, 200, await revertImport(getDb(), { importId: body.importId, reason: body.reason }));
    return;
  }
  throw new AppError("BAD_REQUEST", "Use action=preview, commit, revert, or history.", 400);
});
