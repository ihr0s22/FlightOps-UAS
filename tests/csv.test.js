import { describe, it, expect } from "vitest";
import { rowsToCsv, parseCsvText, guardCell, unguardCell } from "../src/csv.js";

describe("rowsToCsv", () => {
  it("neutralises spreadsheet formulas but leaves numbers alone", () => {
    const csv = rowsToCsv(["a", "b", "c", "d", "e"], [["=HYPERLINK(\"http://x\")", "+1 555", "-5", 42, "@SUM(A1)"]]);
    const [, row] = parseCsvText(csv).map(r => r);
    expect(row[0]).toBe("'=HYPERLINK(\"http://x\")");
    expect(row[1]).toBe("'+1 555");
    expect(row[2]).toBe("-5");          // plain negative number stays numeric
    expect(row[3]).toBe("42");
    expect(row[4]).toBe("'@SUM(A1)");
  });
  it("round-trips ordinary text, commas, quotes and newlines", () => {
    const rows = [["N7 TANGO", "a, b", 'say "hi"', "line1\nline2", ""]];
    const parsed = parseCsvText(rowsToCsv(["h1", "h2", "h3", "h4", "h5"], rows));
    expect(parsed[1]).toEqual(rows[0]);
  });
  it("null and undefined become empty cells", () => {
    expect(rowsToCsv(["a"], [[null], [undefined]])).toBe('"a"\n""\n""');
  });
});

describe("guard / unguard", () => {
  it("unguard reverses guard", () => {
    for (const s of ["=1+1", "+x", "-x", "@x", "plain"]) expect(unguardCell(guardCell(s))).toBe(s);
  });
  it("only strips an apostrophe that guards a dangerous character", () => {
    expect(unguardCell("'hello")).toBe("'hello");
  });
});

describe("parseCsvText", () => {
  it("strips a UTF-8 BOM so the first header still matches", () => {
    expect(parseCsvText(String.fromCharCode(0xFEFF) + "Tail,Model\nN1,Quad")[0][0]).toBe("Tail");
  });
  it("handles CRLF, blank lines and a missing trailing newline", () => {
    expect(parseCsvText("a,b\r\n\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps embedded quotes and commas inside quoted fields", () => {
    expect(parseCsvText('"a,""b""",c')).toEqual([['a,"b"', "c"]]);
  });
  it("returns no rows for empty input", () => { expect(parseCsvText("")).toEqual([]); });
});
