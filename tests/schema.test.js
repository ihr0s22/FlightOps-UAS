import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, seed, emptyWorkspace, migrate, ensure } from "../src/schema.js";

describe("migrate", () => {
  it("upgrades a v1 blob to the current schema without losing records", () => {
    const v1 = { version: 1, aircraft: [{ id: "a", tail: "N1", hours: 10, cycles: 5 }], batteries: [{ id: "b", chem: "Li-Ion" }], missions: [{ id: "m" }] };
    const out = migrate(v1);
    expect(out.version).toBe(SCHEMA_VERSION);
    expect(out.aircraft[0]).toMatchObject({ id: "a", tail: "N1", mxAtHours: 10, mxAtCycles: 5, faaReg: "" });
    expect(out.batteries[0].cycleLimit).toBe(800);
    expect(out.missions[0].geofence).toEqual([]);
    for (const k of ["checklistRuns", "waivers", "documents", "equipment"]) expect(Array.isArray(out[k])).toBe(true);
  });
  it("does not overwrite existing fields", () => {
    const out = migrate({ version: 1, aircraft: [{ id: "a", faaReg: "FA123" }], batteries: [{ id: "b", cycleLimit: 42 }] });
    expect(out.aircraft[0].faaReg).toBe("FA123");
    expect(out.batteries[0].cycleLimit).toBe(42);
  });
  it("does not mutate its input", () => {
    const v = { version: 1, aircraft: [] };
    migrate(v);
    expect(v.version).toBe(1);
  });
  it("is stable when run on current data", () => {
    const s = ensure(seed());
    expect(migrate(s).version).toBe(SCHEMA_VERSION);
  });
});

describe("ensure", () => {
  it("fills missing settings from defaults but keeps saved ones", () => {
    const out = ensure({ version: SCHEMA_VERSION, settings: { org: { name: "Acme" } } });
    expect(out.settings.org.name).toBe("Acme");
    expect(out.settings.telemetry.mqttTopic).toBeTruthy();
    expect(Array.isArray(out.settings.airspace.stations)).toBe(true);
  });
  it("replaces non-array collections with arrays", () => {
    const out = ensure({ version: SCHEMA_VERSION, waivers: "oops", documents: null });
    expect(out.waivers).toEqual([]);
    expect(out.documents).toEqual([]);
  });
});

describe("emptyWorkspace", () => {
  it("has no records but a full settings tree", () => {
    const w = emptyWorkspace();
    expect(w.aircraft).toEqual([]);
    expect(w.flights).toEqual([]);
    expect(w.settings).toBeTruthy();
    expect(w.version).toBe(SCHEMA_VERSION);
  });
});
