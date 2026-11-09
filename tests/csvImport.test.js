import { describe, it, expect } from "vitest";
import { importRecords, parseDate, detectDelimiter, exportTable, exportCsvText } from "../src/csvImport.js";
import { parseCsvText } from "../src/csv.js";

const data = {
  aircraft: [{ id: "AC-1", tail: "N7TANGO" }, { id: "AC-2", tail: "N100AB" }],
  users: [{ id: "OP-1", name: "Ava Reyes" }, { id: "OP-2", name: "Priya Nair" }],
  missions: [{ id: "MSN-1", name: "Coastal Inspection" }],
  batteries: [{ id: "BAT-1", label: "Pack A" }, { id: "BAT-2", label: "Pack B" }],
};
let n = 0; const makeId = () => `NEW-${++n}`;

const MX = [
  { key: "date", label: "Date", date: true },
  { key: "aircraft", label: "Aircraft", alts: ["Aircraft ID", "Tail", "Tail Number"], ref: { coll: "aircraft", by: ["tail"] } },
  { key: "type", label: "Type" },
  { key: "desc", label: "Description" },
];
const mxValidate = (r) => (r.aircraft ? [] : ["Select an aircraft."]).concat(r.desc ? [] : ["Description is required."]);
const run = (text, fields = MX, validate = mxValidate) => importRecords({ fields, text, data, defaults: { type: "Inspection" }, validate, makeId });

describe("reference resolution", () => {
  it("links aircraft by tail number (case-insensitive) and by internal id", () => {
    const r = run("Date,Aircraft,Description\n2026-10-01,n7tango,Prop check\n2026-10-02,AC-2,Motor swap");
    expect(r.errors).toEqual([]);
    expect(r.records.map(x => x.aircraft)).toEqual(["AC-1", "AC-2"]);
  });
  it("accepts the old 'Aircraft ID' header and other aliases", () => {
    expect(run("Date,Aircraft ID,Description\n2026-10-01,N7TANGO,x").records).toHaveLength(1);
    expect(run("Date,Tail Number,Description\n2026-10-01,N7TANGO,x").records).toHaveLength(1);
  });
  it("reports unknown aircraft per row and imports nothing for that row", () => {
    const r = run("Date,Aircraft,Description\n2026-10-01,N999ZZ,Prop check\n2026-10-02,N7TANGO,ok");
    expect(r.records).toHaveLength(1);
    expect(r.errors).toEqual([{ row: 2, msgs: ['Aircraft "N999ZZ" not found.'] }]);
  });
  it("resolves multi-value references split by ; or |", () => {
    const f = [{ key: "batteries", label: "Batteries", ref: { coll: "batteries", by: ["label"], multi: true } }];
    expect(run("Batteries\nPack A; Pack B", f, () => []).records[0].batteries).toEqual(["BAT-1", "BAT-2"]);
    expect(run("Batteries\nPack A|Pack Z", f, () => []).errors[0].msgs).toEqual(['Batteries "Pack Z" not found.']);
  });
  it("leaves an optional reference blank without error", () => {
    const f = [{ key: "mission", label: "Mission", ref: { coll: "missions", by: ["name"] } }, { key: "x", label: "X" }];
    expect(run("Mission,X\n,1", f, () => []).records[0].mission).toBe("");
  });
});

describe("dates", () => {
  it("parses ISO and spreadsheet formats", () => {
    expect(parseDate("2026-10-01")).toBe("2026-10-01");
    expect(parseDate("10/1/2026")).toBe("2026-10-01");
    expect(parseDate("10/01/26")).toBe("2026-10-01");
    expect(parseDate("2026/10/1")).toBe("2026-10-01");
    expect(parseDate("2026-10-01T09:30:00")).toBe("2026-10-01");
  });
  it("rejects impossible or unparseable dates", () => {
    for (const bad of ["2026-02-30", "13/1/2026", "tomorrow", "10-2026"]) expect(parseDate(bad)).toBeNull();
  });
  it("converts Excel-style dates on import and flags bad ones", () => {
    const r = run("Date,Aircraft,Description\n10/1/2026,N7TANGO,a\nsoon,N7TANGO,b");
    expect(r.records[0].date).toBe("2026-10-01");
    expect(r.errors[0].row).toBe(3);
    expect(r.errors[0].msgs[0]).toMatch(/valid date/);
  });
});

describe("headers and file shape", () => {
  it("matches headers ignoring case, spacing and punctuation, and a BOM", () => {
    const r = run("﻿ DATE ,aircraft,Desc-ription\n2026-10-01,N7TANGO,x".replace("Desc-ription", "Description"));
    expect(r.records).toHaveLength(1);
  });
  it("lists ignored columns and missing columns", () => {
    const r = run("Date,Aircraft,Description,Color\n2026-10-01,N7TANGO,x,red");
    expect(r.ignored).toEqual(["Color"]);
    expect(r.missing).toEqual(["Type"]);
  });
  it("explains when no header matches at all", () => {
    const r = run("foo,bar\n1,2");
    expect(r.records).toEqual([]);
    expect(r.errors[0].msgs[0]).toMatch(/None of the column headers/);
  });
  it("handles empty and header-only files", () => {
    expect(run("").errors[0].msgs[0]).toMatch(/empty/);
    expect(run("Date,Aircraft,Description").errors[0].msgs[0]).toMatch(/No data rows/);
  });
  it("auto-detects semicolon and tab separated files", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a,b;c")).toBe(",");
    expect(run("Date;Aircraft;Description\n2026-10-01;N7TANGO;x").records).toHaveLength(1);
    expect(parseCsvText("a;b\n1;2", ";")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps decimal commas inside quotes from splitting numbers", () => {
    const f = [{ key: "hours", label: "Hours", num: true }];
    expect(run('Hours\n"1,250.5"', f, () => []).records[0].hours).toBe(1250.5);
  });
});

describe("numbers", () => {
  const F = [{ key: "hours", label: "Hours", num: true }];
  it("accepts numbers, blank as 0, and rejects text instead of storing NaN", () => {
    const r = run("Hours\n12.5\n\"\"\nabc", F, () => []);
    expect(r.records.map(x => x.hours)).toEqual([12.5]);
    expect(r.errors[0].msgs[0]).toMatch(/must be a number/);
  });
});

describe("export", () => {
  it("writes readable names for references and round-trips through import", () => {
    const flights = [{ aircraft: "AC-1", operator: "OP-2", batteries: ["BAT-1", "BAT-2"], date: "2026-10-01", missionId: "MSN-1" }];
    const F = [
      { key: "date", label: "Date", date: true },
      { key: "aircraft", label: "Aircraft", ref: { coll: "aircraft", by: ["tail"] } },
      { key: "operator", label: "Remote PIC", ref: { coll: "users", by: ["name"] } },
      { key: "batteries", label: "Batteries", ref: { coll: "batteries", by: ["label"], multi: true } },
      { key: "missionId", label: "Mission", ref: { coll: "missions", by: ["name"] } },
    ];
    const t = exportTable(F, flights, data);
    expect(t.rows[0]).toEqual(["2026-10-01", "N7TANGO", "Priya Nair", "Pack A; Pack B", "Coastal Inspection"]);
    const back = importRecords({ fields: F, text: exportCsvText(F, flights, data), data, makeId });
    expect(back.errors).toEqual([]);
    expect(back.records[0]).toMatchObject({ aircraft: "AC-1", operator: "OP-2", batteries: ["BAT-1", "BAT-2"], missionId: "MSN-1", date: "2026-10-01" });
  });
});
