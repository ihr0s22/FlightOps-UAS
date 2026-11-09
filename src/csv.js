// CSV helpers (pure; unit-tested).

// A text cell that starts with = + - @ (or tab/CR) is run as a formula by Excel/Sheets ("CSV injection").
// Prefix such cells with an apostrophe so they stay text. Plain numbers (including negatives) are left alone.
const DANGEROUS = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
export const guardCell = (c) => {
  if (typeof c !== "string") return c;
  return DANGEROUS.test(c) && !PLAIN_NUMBER.test(c) ? `'${c}` : c;
};
// Undo guardCell when re-importing a file this app exported.
export const unguardCell = (s) => s.replace(/^'(?=[=+\-@\t\r])/, "");

// Same quoting rule everywhere: wrap every field, double up embedded quotes.
export const rowsToCsv = (cols, rows) =>
  [cols, ...rows].map(row => row.map(c => `"${String(guardCell(c ?? "")).replace(/"/g, '""')}"`).join(",")).join("\n");

// Minimal RFC4180-ish parser: quoted fields, embedded commas/quotes (""), CRLF/LF rows, and a leading UTF-8 BOM
// (Excel's "CSV UTF-8" adds one, which would otherwise glue itself onto the first header name).
export function parseCsvText(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
