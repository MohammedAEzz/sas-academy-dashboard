import { AppError } from "./_lib/errors.js";
import { requestUrl, sendBytes, withHandler } from "./_lib/http.js";
import { buildCsv, buildXlsx, templateFilename } from "./_lib/templates.js";
import { DATASET_IDS } from "../js/core/schema.js";

const FORMATS = new Set(["csv", "xlsx", "example-csv"]);

export default withHandler(async (req, res) => {
  if (req.method !== "GET") {
    throw new AppError("METHOD_NOT_ALLOWED", "Use GET to download a template.", 405);
  }
  const url = requestUrl(req);
  const dataset = url.searchParams.get("dataset") || "";
  const format = url.searchParams.get("format") || "";
  if (!DATASET_IDS.includes(dataset) || !FORMATS.has(format)) {
    throw new AppError(
      "BAD_REQUEST",
      `Use dataset (${DATASET_IDS.join(", ")}) and format=csv, xlsx, or example-csv.`,
      400,
    );
  }
  const filename = templateFilename(dataset, format);
  if (format === "xlsx") {
    sendBytes(res, 200, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename,
      body: await buildXlsx(dataset),
    });
    return;
  }
  sendBytes(res, 200, {
    type: "text/csv; charset=utf-8",
    filename,
    body: buildCsv(dataset, { example: format === "example-csv" }),
  });
});
