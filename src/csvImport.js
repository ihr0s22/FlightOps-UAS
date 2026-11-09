// CSV import/export for FlightOps records (pure; unit-tested).
//
// A field spec looks like:
//   { key, label, alts?: [..], num?: true, date?: true, ref?: { coll, by: [..keys], multi?: true } }
// - Headers are matched case/punctuation-insensitively against label, key and alts ("Tail Number" == "tailnumber").
// - `ref` fields link to other records. People write names/tail numbers in spreadsheets, not internal ids, so the
//   value is looked up by id OR by the `by` keys. Unknown references are reported per row instead of saved as junk.
// - `date` fields accept ISO (2026-10-01) and spreadsheet styles (10/1/2026, 10/1/26) and are stored as ISO.
import { parseCsvText, rowsToCsv, unguardCell } from "./csv.js";

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const validYMD = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const pad = (n) => String(n).padStart(2, "0");

// Returns "YYYY-MM-DD" or null. US month-first for slash dates (the app is US/FAA oriented), like Excel's default.
export function parseDate(raw) {
  const s = String(raw ?? "").trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m && validYMD(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = +m[3]; if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    if (validYMD(y, +m[1], +m[2])) return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  return null;
}

// Excel in many locales saves "CSV" with semicolons (or tabs). Pick whichever appears most in the header line.
export function detectDelimiter(text) {
  const first = (text.replace(/^﻿/, "").split(/\r?\n/)[0]) || "";
  const counts = [[",", 0], [";", 0], ["\t", 0]].map(([d]) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

const eq = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

function lookup(list, by, value) {
  return (list || []).find(it => eq(it.id, value) || by.some(k => eq(it[k], value)));
}

export function importRecords({ fields, text, data = {}, defaults = {}, validate = () => [], makeId }) {
  const rows = parseCsvText(text, detectDelimiter(text));
  if (rows.length === 0) return { records: [], errors: [{ row: 1, msgs: ["The file is empty."] }], ignored: [], missing: [] };

  const header = rows[0].map(h => h.trim());
  const headerNorm = header.map(norm);
  const names = (f) => [f.label, f.key, ...(f.alts || [])].map(norm);
  const colFor = (f) => { for (const n of names(f)) { const i = headerNorm.indexOf(n); if (i !== -1) return i; } return -1; };

  const cols = fields.map(colFor);
  const known = new Set(fields.flatMap(names));
  const ignored = header.filter((h, i) => h && !known.has(headerNorm[i]));
  const missing = fields.filter((_, i) => cols[i] === -1).map(f => f.label);

  if (cols.every(c => c === -1))
    return { records: [], errors: [{ row: 1, msgs: [`None of the column headers were recognised. Expected columns like: ${fields.slice(0, 6).map(f => f.label).join(", ")}…`] }], ignored, missing };
  if (rows.length < 2) return { records: [], errors: [{ row: 1, msgs: ["No data rows found."] }], ignored, missing };

  const records = [], errors = [];
  rows.slice(1).forEach((cells, i) => {
    const rec = { ...defaults }; const errs = [];
    fields.forEach((f, fi) => {
      const ci = cols[fi]; if (ci === -1) return;
      const raw = unguardCell((cells[ci] ?? "").trim());
      if (f.num) {
        const n = raw === "" ? 0 : Number(raw.replace(/,/g, ""));
        if (Number.isFinite(n)) rec[f.key] = n; else errs.push(`${f.label} must be a number (got "${raw}").`);
      } else if (f.date) {
        if (raw === "") rec[f.key] = "";
        else { const d = parseDate(raw); if (d) rec[f.key] = d; else errs.push(`${f.label} "${raw}" isn't a valid date (use YYYY-MM-DD or MM/DD/YYYY).`); }
      } else if (f.ref) {
        const list = data[f.ref.coll] || [];
        const parts = f.ref.multi ? raw.split(/[;|]/).map(s => s.trim()).filter(Boolean) : (raw ? [raw] : []);
        const ids = [];
        for (const p of parts) {
          const hit = lookup(list, f.ref.by, p);
          if (hit) ids.push(hit.id); else errs.push(`${f.label} "${p}" not found.`);
        }
        rec[f.key] = f.ref.multi ? ids : (ids[0] || "");
      } else rec[f.key] = raw;
    });
    const all = [...errs, ...(errs.length ? [] : validate(rec))];
    if (all.length) errors.push({ row: i + 2, msgs: all });
    else records.push({ ...rec, id: makeId() });
  });
  return { records, errors, ignored, missing };
}

// Export: reference fields are written as readable names / tail numbers (not internal ids), so a file can be
// edited in a spreadsheet and imported back.
export function exportTable(fields, list, data = {}) {
  const show = (f, item) => {
    const v = item[f.key];
    if (!f.ref) return v;
    const src = data[f.ref.coll] || [];
    const name = (id) => { const hit = src.find(x => x.id === id); return hit ? hit[f.ref.by[0]] : ""; };
    return f.ref.multi ? (v || []).map(name).filter(Boolean).join("; ") : (v ? name(v) : "");
  };
  return { cols: fields.map(f => f.label), rows: list.map(item => fields.map(f => show(f, item))) };
}
export const exportCsvText = (fields, list, data) => { const t = exportTable(fields, list, data); return rowsToCsv(t.cols, t.rows); };
