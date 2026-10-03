import { createHash } from "node:crypto";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { AppError } from "./errors.js";
import { columnIds, DATASET_IDS, DATASETS, requiredColumnIds } from "../../js/core/schema.js";
import { headerKey, isBlank, parseISODate } from "../../js/core/normalize.js";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 20000;

export function fileSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function safeFilename(name) {
  const base = String(name || "upload.csv").split(/[/\\]/).pop().replace(/[\u0000-\u001f]/g, "").trim();
  return (base || "upload.csv").slice(0, 200);
}

function templateHint(dataset) {
  return `/api/templates?dataset=${dataset}&format=csv`;
}

function fileInvalid(fileErrors) {
  return new AppError("FILE_INVALID", fileErrors.map((error) => error.message).join(" "), 400, { fileErrors });
}

export async function prepareUpload({ dataset, filename, buffer }) {
  const safeName = safeFilename(filename);
  if (!DATASET_IDS.includes(dataset)) {
    throw fileInvalid([{
      code: "UNKNOWN_DATASET",
      message: `Unknown dataset "${dataset || ""}". Use one of: ${DATASET_IDS.join(", ")}.`,
    }]);
  }
  if (!buffer || !buffer.length) {
    throw fileInvalid([{ code: "EMPTY_FILE", message: "The file is empty. Use the template and add at least one data row." }]);
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw fileInvalid([{
      code: "TOO_LARGE",
      message: "The file is larger than 4 MB. Split it into smaller files.",
    }]);
  }
  const extension = safeName.toLowerCase().split(".").pop();
  let parsed;
  if (extension === "csv") parsed = parseCsv(buffer, dataset);
  else if (extension === "xlsx") parsed = await parseXlsx(buffer, dataset);
  else {
    throw fileInvalid([{
      code: "UNSUPPORTED_TYPE",
      message: "Upload a .csv (CSV UTF-8) or .xlsx file.",
    }]);
  }
  if (parsed.fileErrors.length) throw fileInvalid(parsed.fileErrors);
  return {
    dataset,
    filename: safeName,
    sha256: fileSha256(buffer),
    rows: parsed.rows,
  };
}

function parseCsv(buffer, dataset) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return {
      rows: [],
      fileErrors: [{
        code: "NOT_UTF8",
        message: 'This CSV is not UTF-8. In Excel, use Save As and choose "CSV UTF-8".',
      }],
    };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
  const quoteError = (parsed.errors || []).find((error) => /quote/i.test(`${error.type || ""} ${error.code || ""}`));
  if (quoteError) {
    return {
      rows: [],
      fileErrors: [{ code: "UNREADABLE_CSV", message: "The CSV could not be read. Check quotes and line breaks, and save it as CSV UTF-8." }],
    };
  }
  return rowsFromMatrix(parsed.data || [], dataset);
}

async function parseXlsx(buffer, dataset) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Data") || workbook.worksheets[0];
    if (!sheet) {
      return { rows: [], fileErrors: [{ code: "UNREADABLE_XLSX", message: "The workbook has no sheets. Upload a valid .xlsx file." }] };
    }
    const headerRow = sheet.getRow(1);
    const width = Math.max(headerRow.cellCount, sheet.columnCount || 0);
    const matrix = [readExcelRow(headerRow, width, null)];
    const columns = mapHeaders(matrix[0], dataset);
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      matrix.push(readExcelRow(row, width, columns.ids));
      matrix[matrix.length - 1].__rowNumber = rowNumber;
    });
    return rowsFromMatrix(matrix, dataset, true);
  } catch {
    return {
      rows: [],
      fileErrors: [{ code: "UNREADABLE_XLSX", message: "The workbook could not be read. Upload a valid .xlsx file." }],
    };
  }
}

function readExcelRow(row, width, columnIdsForTypes) {
  const values = [];
  for (let index = 1; index <= width; index += 1) {
    const raw = row.getCell(index).value;
    values.push(excelCell(raw, columnIdsForTypes ? columnIdsForTypes[index - 1] : null));
  }
  return values;
}

function excelCell(value, columnId) {
  if (value == null) return "";
  if (typeof value === "object" && value.text && value.richText == null && !(value instanceof Date)) {
    return value.text;
  }
  if (typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("");
  }
  if (typeof value === "object" && value.result != null && !(value instanceof Date)) return excelCell(value.result, columnId);
  if (value instanceof Date) {
    if (columnId && columnType(columnId) === "time") {
      const hours = value.getUTCHours() === 0 && value.getHours() !== 0 ? value.getHours() : value.getUTCHours();
      const minutes = value.getUTCHours() === 0 && value.getHours() !== 0 ? value.getMinutes() : value.getUTCMinutes();
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    return excelDateToIso(value);
  }
  if (typeof value === "number" && columnId && columnType(columnId) === "date" && value > 20000 && value < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  return value;
}

function excelDateToIso(value) {
  const utcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
  const localMidnight = value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0;
  const useLocal = localMidnight && !utcMidnight;
  const year = useLocal ? value.getFullYear() : value.getUTCFullYear();
  const month = String((useLocal ? value.getMonth() : value.getUTCMonth()) + 1).padStart(2, "0");
  const day = String(useLocal ? value.getDate() : value.getUTCDate()).padStart(2, "0");
  const iso = `${year}-${month}-${day}`;
  return parseISODate(iso) || iso;
}

function columnType(columnId) {
  for (const dataset of DATASET_IDS) {
    const column = DATASETS[dataset].columns.find((item) => item.id === columnId);
    if (column) return column.type;
  }
  return "text";
}

function rowsFromMatrix(matrix, dataset, excelNumbers = false) {
  const header = (matrix[0] || []).map((cell) => (cell == null ? "" : String(cell)));
  while (header.length && headerKey(header[header.length - 1]) === "") header.pop();
  if (!header.length || header.every((cell) => headerKey(cell) === "")) {
    return { rows: [], fileErrors: [{ code: "EMPTY_FILE", message: "The file is empty. Use the template and add at least one data row." }] };
  }
  const mapped = mapHeaders(header, dataset);
  if (mapped.fileErrors.length) return { rows: [], fileErrors: mapped.fileErrors };
  const rows = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const source = matrix[index] || [];
    const rowNumber = source.__rowNumber || index + 1;
    const values = {};
    let any = false;
    mapped.ids.forEach((columnId, columnIndex) => {
      if (!columnId) return;
      const cell = source[columnIndex];
      if (!isBlank(cell)) any = true;
      values[columnId] = cell == null ? "" : cell;
    });
    if (!any) continue;
    rows.push({ rowNumber, values });
    if (rows.length > MAX_UPLOAD_ROWS) {
      return {
        rows: [],
        fileErrors: [{
          code: "TOO_MANY_ROWS",
          message: `The file has more than ${MAX_UPLOAD_ROWS.toLocaleString("en-US")} data rows. Split it into smaller files.`,
        }],
      };
    }
  }
  if (!rows.length) {
    return { rows: [], fileErrors: [{ code: "EMPTY_FILE", message: "The file has a header but no data rows. Add at least one record under the header." }] };
  }
  return { rows, fileErrors: [] };
}

function mapHeaders(header, dataset) {
  const expected = new Map(columnIds(dataset).map((id) => [headerKey(id), id]));
  const seen = new Set();
  const unknown = [];
  const ids = [];
  const duplicate = [];
  for (const cell of header) {
    const key = headerKey(cell);
    if (!key) {
      ids.push(null);
      continue;
    }
    const columnId = expected.get(key);
    if (!columnId) {
      unknown.push(String(cell).trim());
      ids.push(null);
      continue;
    }
    if (seen.has(columnId)) duplicate.push(columnId);
    seen.add(columnId);
    ids.push(columnId);
  }
  const missing = requiredColumnIds(dataset).filter((id) => !seen.has(id));
  const fileErrors = [];
  if (duplicate.length) {
    fileErrors.push({
      code: "DUPLICATE_COLUMNS",
      columns: duplicate,
      message: `The header repeats ${duplicate.join(", ")}. Keep each column once.`,
    });
  }
  if (missing.length || unknown.length) {
    const parts = [];
    if (missing.length) parts.push(`Missing required columns: ${missing.join(", ")}.`);
    if (unknown.length) parts.push(`Unknown columns: ${unknown.join(", ")}.`);
    const suggestion = suggestDataset(header);
    const suggestText = suggestion && suggestion !== dataset
      ? ` These columns look like the ${suggestion} template.`
      : "";
    parts.push(`Use the ${dataset} template (${templateHint(dataset)}).${suggestText}`);
    fileErrors.push({
      code: missing.length ? "MISSING_COLUMNS" : "UNKNOWN_COLUMNS",
      columns: missing.length ? missing : unknown,
      message: parts.join(" "),
    });
  }
  return { ids, fileErrors };
}

function suggestDataset(header) {
  let best = null;
  let bestScore = 0;
  for (const dataset of DATASET_IDS) {
    const keys = new Set(columnIds(dataset).map((id) => headerKey(id)));
    let score = 0;
    for (const cell of header) if (keys.has(headerKey(cell))) score += 1;
    if (score > bestScore) {
      best = dataset;
      bestScore = score;
    }
  }
  return bestScore ? best : null;
}
