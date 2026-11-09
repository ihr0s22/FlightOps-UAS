// Persistence layer: browser storage, optional external-folder mirror, rolling backups,
// import/export, and a cross-tab guard. No React; safe to unit-test with injected storage.
import { SCHEMA_VERSION } from "./schema.js";

export const STORE_KEY = "droneops:v2";
export const BACKUP_PREFIX = "droneops:backup:";
export const MAX_BACKUPS = 5;
const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;   // at most one rolling backup every 5 minutes

export const hasArtifactStore = typeof window !== "undefined" && !!(window.storage && window.storage.get);
export const fsSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

/* ---------- save-status broadcaster ---------- */
// A monotonic `seq` rides along so the UI re-reacts even when consecutive saves land on the same status.
let saveStatus = "idle";
let saveSeq = 0;
const saveStatusSubs = new Set();
export function setSaveStatus(s, detail = "") {
  saveStatus = s; saveSeq++;
  const v = { status: s, seq: saveSeq, detail };
  saveStatusSubs.forEach(fn => fn(v));
}
export function subscribeSaveStatus(fn) { saveStatusSubs.add(fn); return () => saveStatusSubs.delete(fn); }
export const getSaveStatus = () => ({ status: saveStatus, seq: saveSeq, detail: "" });

/* ---------- IndexedDB (remembers the external-folder handle) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("flightdeck", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
async function idbDel(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").delete(k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }

async function verifyPerm(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}
export async function getDriveHandle() { try { const h = await idbGet("driveHandle"); if (h && await verifyPerm(h)) return h; } catch {} return null; }
async function driveRead(handle) {
  const fh = await handle.getFileHandle("flightdeck.json", { create: true });
  const text = await (await fh.getFile()).text();
  return text ? JSON.parse(text) : null;   // a corrupt file throws here — callers must NOT fall back silently
}
async function driveWrite(handle, state) {
  const fh = await handle.getFileHandle("flightdeck.json", { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(state));
  await w.close();
}

/* ---------- validation ---------- */
const COLLECTIONS = ["aircraft", "batteries", "equipment", "users", "missions", "flights", "laanc", "waivers",
  "documents", "maintenance", "incidents", "riskAssessments", "checklists", "checklistRuns", "workflows", "scheduledReports"];

// Returns the blob if it looks like a FlightOps workspace; throws a descriptive Error otherwise.
export function validateWorkspace(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("File isn't a FlightOps workspace (expected a JSON object).");
  if (d.version !== undefined && (typeof d.version !== "number" || d.version < 1)) throw new Error("Workspace has an invalid version number.");
  if (typeof d.version === "number" && d.version > SCHEMA_VERSION)
    throw new Error(`Workspace is from a newer FlightOps (schema v${d.version}; this build supports up to v${SCHEMA_VERSION}). Update the app before importing.`);
  for (const k of COLLECTIONS) {
    if (d[k] !== undefined && !Array.isArray(d[k])) throw new Error(`"${k}" should be a list.`);
  }
  if (d.settings !== undefined && (typeof d.settings !== "object" || d.settings === null || Array.isArray(d.settings)))
    throw new Error('"settings" should be an object.');
  if (!COLLECTIONS.some(k => Array.isArray(d[k])) && d.settings === undefined)
    throw new Error("File doesn't contain any FlightOps data.");
  return d;
}

/* ---------- raw storage helpers ---------- */
async function readLocal() {
  if (hasArtifactStore) { const r = await window.storage.get(STORE_KEY); return r ? JSON.parse(r.value) : null; }
  const s = localStorage.getItem(STORE_KEY);
  const parsed = s ? JSON.parse(s) : null;
  if (parsed) lastWrittenJson = s;   // so the first save of a session backs up the copy that was on disk at load
  return parsed;
}

// Rolling backups live in localStorage (self-hosted/browser mode). Best-effort: a failed backup never blocks a save.
function backupKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(BACKUP_PREFIX)) keys.push(k); }
  return keys.sort();   // keys embed a zero-padded timestamp → lexical == chronological
}
export function listBackups() {
  try { return backupKeys().map(k => ({ key: k, at: Number(k.slice(BACKUP_PREFIX.length)) })).reverse(); } catch { return []; }
}
export function readBackup(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
let lastBackupAt = 0;
export function snapshotBackup(json, now = Date.now(), force = false) {
  if (hasArtifactStore) return false;
  if (!force && now - lastBackupAt < BACKUP_MIN_INTERVAL_MS) return false;
  try {
    localStorage.setItem(BACKUP_PREFIX + String(now).padStart(15, "0"), json);
    lastBackupAt = now;
    backupKeys().slice(0, -MAX_BACKUPS).forEach(k => localStorage.removeItem(k));
    return true;
  } catch { return false; }   // quota: skip the backup, keep the main save
}

/* ---------- load ---------- */
// When a folder is connected it is the source of truth. If it exists but can't be read we THROW, so the
// UI shows the recovery screen instead of loading a stale browser copy and later overwriting the folder.
export async function loadState() {
  let handle = null;
  try { handle = await getDriveHandle(); } catch { handle = null; }   // no folder / permission denied → browser storage
  if (handle) {
    const d = await driveRead(handle);   // may throw → propagates to the caller
    if (d) return d;
  }
  return readLocal();   // may throw on corrupt JSON → recovery screen; the stored value is left untouched
}

/* ---------- save ---------- */
let driveTimer = null;
let lastWrittenJson = null;

function isQuotaError(e) {
  return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}

export async function saveState(state) {
  setSaveStatus("saving");
  const json = JSON.stringify(state);
  try {
    if (hasArtifactStore) await window.storage.set(STORE_KEY, json);
    else {
      if (lastWrittenJson && lastWrittenJson !== json) snapshotBackup(lastWrittenJson);   // back up the previous good copy
      localStorage.setItem(STORE_KEY, json);
    }
    lastWrittenJson = json;
    setSaveStatus("saved");
  } catch (e) {
    setSaveStatus("error", isQuotaError(e) ? "quota" : "write");
  }
  // Debounced mirror to the external folder (when connected) reports its own sync status.
  if (fsSupported) {
    clearTimeout(driveTimer);
    driveTimer = setTimeout(async () => {
      try { const h = await getDriveHandle(); if (h) { setSaveStatus("syncing"); await driveWrite(h, state); setSaveStatus("saved"); } }
      catch { setSaveStatus("error", "drive"); }
    }, 800);
  }
}

export async function requestPersistence() {
  try { return !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch { return false; }
}

export async function connectDrive(state) {
  const handle = await window.showDirectoryPicker({ id: "flightdeck", mode: "readwrite" });
  await idbSet("driveHandle", handle);
  await driveWrite(handle, state);
  return handle.name;
}
export async function disconnectDrive() { await idbDel("driveHandle"); }

// Wipe saved state everywhere so the next load falls back to the first-run prompt.
export async function clearState() {
  try { const raw = !hasArtifactStore && localStorage.getItem(STORE_KEY); if (raw && raw !== "null") snapshotBackup(raw, Date.now(), true); } catch {}   // keep a recoverable copy
  if (hasArtifactStore) { try { await window.storage.set(STORE_KEY, "null"); } catch {} }
  try { localStorage.removeItem(STORE_KEY); } catch {}
  lastWrittenJson = null;
  if (fsSupported) { try { const h = await getDriveHandle(); if (h) await driveWrite(h, null); } catch {} }
}

/* ---------- cross-tab guard ---------- */
// Calls onConflict() when another tab writes the workspace, so this tab can warn instead of clobbering it.
export function watchOtherTabs(onConflict) {
  if (typeof window === "undefined") return () => {};
  const fn = (e) => { if (e.key === STORE_KEY && e.newValue !== lastWrittenJson) onConflict(); };
  window.addEventListener("storage", fn);
  return () => window.removeEventListener("storage", fn);
}

/* ---------- export / import ---------- */
export function exportData(state) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
    a.download = "flightdeck.json";
    a.click();
  } catch { alert("Couldn't export the data file. Please try again, or use a different browser."); }
}

// Validates the file, and snapshots the current workspace first so a bad import is reversible.
export function importData(onLoad, current) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    let parsed;
    try { parsed = validateWorkspace(JSON.parse(await f.text())); }
    catch (e) { alert(e instanceof SyntaxError ? "Couldn't read that file — is it a valid flightdeck.json?" : e.message); return; }
    if (current) snapshotBackup(JSON.stringify(current), Date.now(), true);
    onLoad(parsed);
  };
  inp.click();
}

/* ---------- relay token ---------- */
// Kept OUT of the workspace blob on purpose, so it never ends up in exports, backups or relay snapshots.
const RELAY_TOKEN_KEY = "flightops:relay-token";
export function getRelayToken() { try { return localStorage.getItem(RELAY_TOKEN_KEY) || ""; } catch { return ""; } }
export function setRelayToken(t) { try { t ? localStorage.setItem(RELAY_TOKEN_KEY, t) : localStorage.removeItem(RELAY_TOKEN_KEY); } catch {} }
// Headers for a request to the relay (adds the bearer token when one is set). Never use for non-relay URLs.
export function relayHeaders(extra = {}) { const t = getRelayToken(); return t ? { ...extra, Authorization: `Bearer ${t}` } : extra; }

/* ---------- unreadable-data safety copy ---------- */
const UNREADABLE_KEY = "droneops:unreadable";
// Called before "Start fresh" replaces data that failed to load: keep the raw text so it can be recovered by hand.
export async function backupUnreadableState() {
  let raw = null;
  try { const h = await getDriveHandle(); if (h) { const fh = await h.getFileHandle("flightdeck.json"); raw = await (await fh.getFile()).text(); } } catch {}
  if (!raw) { try { raw = hasArtifactStore ? (await window.storage.get(STORE_KEY))?.value : localStorage.getItem(STORE_KEY); } catch {} }
  if (raw && raw !== "null") { try { localStorage.setItem(UNREADABLE_KEY, raw); } catch {} }
}
export function getUnreadableCopy() { try { return localStorage.getItem(UNREADABLE_KEY) || ""; } catch { return ""; } }
