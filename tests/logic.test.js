// Run in a US timezone on purpose: the date bugs below only show up west of UTC / across DST changes.
process.env.TZ = "America/New_York";

import { describe, it, expect } from "vitest";
import { daysUntil, addDays, applyFlight, planeIconRotation } from "../src/logic.js";
import { uid } from "../src/schema.js";

describe("addDays", () => {
  it("adds calendar days without drifting across the spring-forward DST change", () => {
    expect(addDays("2026-01-01", 90)).toBe("2026-04-01");
  });
  it("adds calendar days across the fall-back DST change", () => {
    expect(addDays("2026-10-01", 90)).toBe("2026-12-30");
  });
  it("handles month/year rollover and negative offsets", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("is correct for every day over a year (no off-by-one anywhere)", () => {
    let d = "2026-01-01";
    for (let i = 0; i < 400; i++) {
      const next = addDays(d, 1);
      expect((Date.parse(next) - Date.parse(d)) / 86400000).toBe(1);
      d = next;
    }
  });
});

describe("daysUntil", () => {
  it("returns null for empty input", () => { expect(daysUntil("")).toBeNull(); expect(daysUntil(undefined)).toBeNull(); });
  it("does not treat a document as expired until its expiry DATE has fully passed", () => {
    // 8:00 pm local on the day BEFORE expiry, and 9:00 am on the expiry day itself: still valid
    expect(daysUntil("2026-06-30", new Date(2026, 5, 29, 20, 0))).toBeGreaterThan(0);
    expect(daysUntil("2026-06-30", new Date(2026, 5, 30, 9, 0))).toBeGreaterThanOrEqual(0);
    expect(daysUntil("2026-06-30", new Date(2026, 5, 30, 23, 0))).toBeGreaterThanOrEqual(0);
  });
  it("is expired the day after", () => {
    expect(daysUntil("2026-06-30", new Date(2026, 6, 1, 0, 30))).toBeLessThan(0);
  });
  it("still accepts full ISO timestamps", () => {
    expect(daysUntil("2026-06-30T12:00:00Z", new Date("2026-06-29T12:00:00Z"))).toBeCloseTo(1, 5);
  });
});

describe("applyFlight", () => {
  const base = () => ({
    flights: [],
    aircraft: [{ id: "a1", hours: 10, cycles: 5 }],
    batteries: [{ id: "b1", cycles: 3, health: 100, cycleLimit: 200 }],
  });
  it("accumulates short flights without systematic rounding loss", () => {
    let d = base();
    for (let i = 0; i < 30; i++) d = applyFlight(d, { aircraft: "a1", batteries: ["b1"], dur: 7 }, `F${i}`);
    // 30 flights x 7 min = 210 min = 3.5 h exactly
    expect(d.aircraft[0].hours).toBeCloseTo(13.5, 1);
    expect(d.aircraft[0].cycles).toBe(35);
    expect(d.batteries[0].cycles).toBe(33);
  });
  it("editing a flight applies only the difference", () => {
    let d = applyFlight(base(), { aircraft: "a1", batteries: ["b1"], dur: 60 }, "F1");
    d = applyFlight(d, { id: "F1", aircraft: "a1", batteries: ["b1"], dur: 90 }, "x");
    expect(d.aircraft[0].hours).toBeCloseTo(11.5, 2);
    expect(d.aircraft[0].cycles).toBe(6);
    expect(d.batteries[0].cycles).toBe(4);
  });
  it("reassigning a flight moves usage between aircraft", () => {
    const b = base(); b.aircraft.push({ id: "a2", hours: 0, cycles: 0 });
    let d = applyFlight(b, { aircraft: "a1", dur: 60 }, "F1");
    d = applyFlight(d, { id: "F1", aircraft: "a2", dur: 60 }, "x");
    expect(d.aircraft.find(a => a.id === "a1")).toMatchObject({ hours: 10, cycles: 5 });
    expect(d.aircraft.find(a => a.id === "a2")).toMatchObject({ hours: 1, cycles: 1 });
  });
  it("never drives totals negative", () => {
    let d = applyFlight(base(), { aircraft: "a1", dur: 600 }, "F1");
    const f = { ...d.flights[0], dur: 0 };
    d = applyFlight({ ...d, aircraft: [{ id: "a1", hours: 0, cycles: 0 }] }, f, "x");
    expect(d.aircraft[0].hours).toBeGreaterThanOrEqual(0);
    expect(d.aircraft[0].cycles).toBeGreaterThanOrEqual(0);
  });
});

describe("uid", () => {
  it("does not collide across many generated ids", () => {
    const seen = new Set();
    for (let i = 0; i < 50000; i++) seen.add(uid("FLT"));
    expect(seen.size).toBe(50000);
  });
  it("keeps the PREFIX-suffix format", () => { expect(uid("AC")).toMatch(/^AC-[a-z0-9]+$/); });
});

describe("planeIconRotation", () => {
  it("offsets the icon's built-in 45 degree nose so the nose points along the heading", () => {
    expect(planeIconRotation(45)).toBe(0);      // icon already points north-east
    expect(planeIconRotation(90)).toBe(45);     // east
    expect(planeIconRotation(180)).toBe(135);   // south
    expect(planeIconRotation(270)).toBe(225);   // west
  });
  it("wraps into 0-360", () => {
    expect(planeIconRotation(0)).toBe(315);     // north
    expect(planeIconRotation(360)).toBe(315);
    expect(planeIconRotation(-90)).toBe(225);
    expect(planeIconRotation(725)).toBe(320);   // 725 deg == 5 deg
  });
  it("returns null when the heading is unknown or invalid", () => {
    for (const bad of [null, undefined, "", "abc", NaN, Infinity]) expect(planeIconRotation(bad)).toBeNull();
  });
  it("accepts numeric strings", () => { expect(planeIconRotation("90")).toBe(45); });
});
