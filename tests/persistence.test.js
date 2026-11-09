import { describe, it, expect, beforeEach, vi } from "vitest";

function makeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

let P;
beforeEach(async () => {
  vi.resetModules();
  globalThis.localStorage = makeStorage();
  P = await import("../src/persistence.js");
});

describe("validateWorkspace", () => {
  it("accepts a workspace-shaped object", () => {
    expect(() => P.validateWorkspace({ version: 6, aircraft: [], settings: {} })).not.toThrow();
  });
  it.each([
    [null], [[]], ["x"], [{}], [{ aircraft: {} }], [{ settings: [] }], [{ version: "6", aircraft: [] }], [{ version: 999, aircraft: [] }],
  ])("rejects %j", (bad) => { expect(() => P.validateWorkspace(bad)).toThrow(); });
  it("explains newer-version files", () => {
    expect(() => P.validateWorkspace({ version: 999, aircraft: [] })).toThrow(/newer/);
  });
});

describe("loadState", () => {
  it("returns null when nothing is stored", async () => { expect(await P.loadState()).toBeNull(); });
  it("returns the stored workspace", async () => {
    localStorage.setItem(P.STORE_KEY, JSON.stringify({ version: 6, aircraft: [] }));
    expect(await P.loadState()).toEqual({ version: 6, aircraft: [] });
  });
  it("throws on corrupt JSON and leaves it untouched", async () => {
    localStorage.setItem(P.STORE_KEY, "{not json");
    await expect(P.loadState()).rejects.toThrow();
    expect(localStorage.getItem(P.STORE_KEY)).toBe("{not json");
  });
});

describe("saveState + backups", () => {
  it("saves and reports status", async () => {
    const seen = [];
    P.subscribeSaveStatus(v => seen.push(v.status));
    await P.saveState({ version: 6, n: 1 });
    expect(JSON.parse(localStorage.getItem(P.STORE_KEY)).n).toBe(1);
    expect(seen).toEqual(["saving", "saved"]);
  });
  it("snapshots the previous copy and rate-limits backups", async () => {
    await P.saveState({ n: 1 });
    await P.saveState({ n: 2 });             // backs up n:1
    await P.saveState({ n: 3 });             // within 5 min → no new backup
    const b = P.listBackups();
    expect(b).toHaveLength(1);
    expect(P.readBackup(b[0].key).n).toBe(1);
  });
  it("keeps only MAX_BACKUPS, newest first", () => {
    for (let i = 1; i <= P.MAX_BACKUPS + 3; i++) P.snapshotBackup(JSON.stringify({ i }), i * 1000, true);
    const b = P.listBackups();
    expect(b).toHaveLength(P.MAX_BACKUPS);
    expect(P.readBackup(b[0].key).i).toBe(P.MAX_BACKUPS + 3);
  });
  it("reports a quota error distinctly and does not throw", async () => {
    const err = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    localStorage.setItem = () => { throw err; };
    let last;
    P.subscribeSaveStatus(v => { last = v; });
    await P.saveState({ n: 1 });
    expect(last).toMatchObject({ status: "error", detail: "quota" });
  });
  it("a failed backup never blocks the main save", async () => {
    await P.saveState({ n: 1 });
    const real = localStorage.setItem;
    localStorage.setItem = (k, v) => { if (k.startsWith(P.BACKUP_PREFIX)) throw new Error("quota"); real(k, v); };
    await P.saveState({ n: 2 });
    expect(JSON.parse(localStorage.getItem(P.STORE_KEY)).n).toBe(2);
  });
});

describe("first save of a session", () => {
  it("backs up the copy that was on disk when the app loaded", async () => {
    localStorage.setItem(P.STORE_KEY, JSON.stringify({ version: 6, orig: true }));
    await P.loadState();
    await P.saveState({ version: 6, orig: false });
    const b = P.listBackups();
    expect(b).toHaveLength(1);
    expect(P.readBackup(b[0].key).orig).toBe(true);
  });
});

describe("backupUnreadableState", () => {
  it("keeps the raw unreadable text before it is replaced", async () => {
    localStorage.setItem(P.STORE_KEY, "{corrupt");
    await P.backupUnreadableState();
    expect(P.getUnreadableCopy()).toBe("{corrupt");
  });
  it("ignores empty state", async () => {
    await P.backupUnreadableState();
    expect(P.getUnreadableCopy()).toBe("");
  });
});

describe("clearState", () => {
  it("keeps a recoverable backup of what it wipes", async () => {
    localStorage.setItem(P.STORE_KEY, JSON.stringify({ n: 7 }));
    await P.clearState();
    expect(localStorage.getItem(P.STORE_KEY)).toBeNull();
    expect(P.readBackup(P.listBackups()[0].key).n).toBe(7);
  });
});
