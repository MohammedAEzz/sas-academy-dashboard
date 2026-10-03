import { getDb } from "./_lib/db.js";
import { AppError } from "./_lib/errors.js";
import { requireConfig, sendJson, withHandler } from "./_lib/http.js";
import { loadPublicData } from "./_lib/import-service.js";

export default withHandler(async (req, res) => {
  if (req.method !== "GET") {
    throw new AppError("METHOD_NOT_ALLOWED", "Use GET to read uploaded records.", 405);
  }
  requireConfig(["DATABASE_URL"]);
  sendJson(res, 200, await loadPublicData(getDb()));
});
