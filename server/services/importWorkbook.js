import ExcelJS from "exceljs";
import { parse as parseCSV } from "csv-parse/sync";
import { z } from "zod";
import { fail } from "../utils/http.js";
const aliases = {
  fullname: "fullName",
  name: "fullName",
  phone: "phone",
  phonenumber: "phone",
  email: "email",
  organization: "organization",
  company: "organization",
  address: "address",
  servicetype: "serviceType",
  servicenotes: "serviceNotes",
  campaign: "campaign",
  campaignid: "campaignId",
  leadstatus: "status",
  contactsource: "source",
  source: "source",
  priority: "priority",
  status: "status",
  assignedagentid: "assignedAgentId",
};

function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const name =
      aliases[key.trim().replace(/[ _-]/g, "").toLowerCase()] || key.trim();
    normalized[name] =
      ["assignedAgentId", "campaignId"].includes(name) && value === ""
        ? undefined
        : value;
  }
  return normalized;
}
function checkZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length)
    throw fail(400, "Choose a valid .xlsx workbook");
  const entries = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16),
    expanded = 0;
  if (entries > 200) throw fail(400, "Workbook contains too many parts");
  for (let index = 0; index < entries; index++) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    )
      throw fail(400, "Invalid Excel archive");
    const size = buffer.readUInt32LE(cursor + 24);
    expanded += size;
    if (
      size > 4000000 ||
      expanded > 8000000 ||
      buffer.readUInt16LE(cursor + 8) & 1
    )
      throw fail(400, "Workbook is too large or encrypted");
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
}
export async function readLeadImport(body) {
  if (typeof body.csv === "string") {
    const csv = z.string().max(300000).parse(body.csv);
    try {
      return parseCSV(csv, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true,
        max_record_size: 8000,
      }).map(normalizeRow);
    } catch {
      throw fail(400, "Invalid CSV format");
    }
  }
  const encoded = z
    .string()
    .max(400000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .parse(body.xlsxBase64);
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length > 300000)
    throw fail(400, "Import a workbook smaller than 300 KB");
  checkZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw fail(400, "This Excel workbook could not be read. Use .xlsx or CSV.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount > 501 || sheet.columnCount > 20)
    throw fail(400, "Use one sheet with a header and at most 500 lead rows");
  const headers = [];
  sheet.getRow(1).eachCell((cell, column) => {
    headers[column] =
      aliases[cell.text.trim().replace(/[ _-]/g, "").toLowerCase()] ||
      cell.text.trim();
  });
  const rows = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = { __rowNumber: number };
    let any = false;
    for (let column = 1; column < headers.length; column++)
      if (headers[column]) {
        const value = sheet.getRow(number).getCell(column).text.trim();
        if (value) any = true;
        row[headers[column]] = value;
      }
    if (any) rows.push(normalizeRow(row));
  }
  return rows;
}
