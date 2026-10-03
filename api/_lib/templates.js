import ExcelJS from "exceljs";
import {
  DATASETS,
  GENERAL_INSTRUCTIONS,
  columnIds,
  exampleRows,
} from "../../js/core/schema.js";

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(dataset, { example = false } = {}) {
  const headers = columnIds(dataset);
  const lines = [headers.join(",")];
  if (example) {
    for (const row of exampleRows(dataset)) {
      lines.push(headers.map((id) => csvEscape(row[id] ?? "")).join(","));
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function columnLetter(index) {
  let number = index + 1;
  let letters = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

export async function buildXlsx(dataset) {
  const schema = DATASETS[dataset];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SAS Historical Data";
  const data = workbook.addWorksheet("Data");
  const instructions = workbook.addWorksheet("Instructions");
  const example = workbook.addWorksheet("Example");
  const headers = columnIds(dataset);

  data.addRow(headers);
  data.getRow(1).font = { bold: true };
  data.views = [{ state: "frozen", ySplit: 1 }];
  data.autoFilter = { from: "A1", to: `${columnLetter(headers.length - 1)}1` };

  schema.columns.forEach((column, index) => {
    const letter = columnLetter(index);
    data.getColumn(index + 1).width = Math.max(18, column.id.length + 2);
    if (column.type === "date") data.getColumn(index + 1).numFmt = "yyyy-mm-dd";
    if (column.type === "time") data.getColumn(index + 1).numFmt = "hh:mm";
    if (column.type === "integer") data.getColumn(index + 1).numFmt = "0";
    if (column.type === "number") data.getColumn(index + 1).numFmt = "0.0";
    if (column.values) {
      data.dataValidations.add(`${letter}2:${letter}2000`, {
        type: "list",
        allowBlank: !column.required,
        formulae: [`"${column.values.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Check this value",
        error: `Use one of: ${column.values.join(", ")}`,
      });
    }
  });

  instructions.addRow(["How to fill this workbook"]);
  instructions.getRow(1).font = { bold: true };
  instructions.addRow([GENERAL_INSTRUCTIONS.join(" ")]);
  instructions.addRow([]);
  instructions.addRow(["Column", "Required", "Type", "Format", "Units", "Allowed values", "Description"]);
  instructions.getRow(4).font = { bold: true };
  for (const column of schema.columns) {
    instructions.addRow([
      column.id,
      column.required ? "required" : "optional",
      column.type,
      column.format || "",
      column.units || "",
      column.values ? column.values.join(", ") : "",
      column.description,
    ]);
  }
  instructions.getColumn(1).width = 28;
  instructions.getColumn(7).width = 80;

  example.addRow(headers);
  example.getRow(1).font = { bold: true };
  for (const row of exampleRows(dataset)) {
    example.addRow(headers.map((id) => (row[id] == null ? "" : row[id])));
  }
  headers.forEach((id, index) => {
    example.getColumn(index + 1).width = Math.max(18, id.length + 2);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function templateFilename(dataset, format) {
  if (format === "xlsx") return `${dataset}-template.xlsx`;
  if (format === "example-csv") return `${dataset}-example.csv`;
  return `${dataset}-template.csv`;
}
