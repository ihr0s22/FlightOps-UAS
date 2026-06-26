import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plane, Battery, Users, ClipboardCheck, ShieldAlert, Wrench, AlertTriangle,
  Map, Radio, Workflow, ListChecks, Plus, X, Search, Trash2, Pencil,
  Gauge, Clock, MapPin, ChevronRight, Activity, CircleDot, Layers, Signal,
  LayoutDashboard, Radar, Video, FileBarChart, Settings as SettingsIcon,
  Wind, TrendingUp, Download, BatteryCharging, Crosshair, CircleAlert,
  ArrowUpRight, Eye, Wifi, Sun, Moon, RefreshCw, Plus as PlusIcon, Minus, Link2,
  Server, Play, Square, Satellite, Plug, HardDrive, Upload,
  Calendar, CalendarDays, BadgeCheck, ChevronLeft,
  FileText, Paperclip, ExternalLink, Sparkles
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

/* ============================ persistence ============================ */
const STORE_KEY = "droneops:v2";
const SCHEMA_VERSION = 5;
const hasArtifactStore = typeof window !== "undefined" && window.storage && window.storage.get;
const fsSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

// tiny IndexedDB used only to remember the external-drive folder handle
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open("flightdeck", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
async function idbDel(k) { const db = await idb(); return new Promise((res) => { db.transaction("kv", "readwrite").objectStore("kv").delete(k); res(); }); }

async function verifyPerm(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}
async function getDriveHandle() { try { const h = await idbGet("driveHandle"); if (h && await verifyPerm(h)) return h; } catch {} return null; }
async function driveRead(handle) { const fh = await handle.getFileHandle("flightdeck.json", { create: true }); const text = await (await fh.getFile()).text(); return text ? JSON.parse(text) : null; }
async function driveWrite(handle, state) { const fh = await handle.getFileHandle("flightdeck.json", { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(state)); await w.close(); }

async function loadState() {
  try { const h = await getDriveHandle(); if (h) { const d = await driveRead(h); if (d) return d; } } catch {}          // external drive wins when connected
  if (hasArtifactStore) { try { const r = await window.storage.get(STORE_KEY); return r ? JSON.parse(r.value) : null; } catch {} }
  try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch {}                            // self-hosted fallback
  return null;
}
// Save-status broadcaster — lets the UI surface Saving…/Saved/Syncing…/Sync failed without prop-drilling.
// A monotonic `seq` rides along so the UI re-reacts even when consecutive saves land on the same status
// (e.g. saved → saved), which React's batching would otherwise coalesce into a no-op update.
let saveStatus = "idle";
let saveSeq = 0;
const saveStatusSubs = new Set();
function setSaveStatus(s) { saveStatus = s; saveSeq++; const v = { status: s, seq: saveSeq }; saveStatusSubs.forEach(fn => fn(v)); }
function subscribeSaveStatus(fn) { saveStatusSubs.add(fn); return () => saveStatusSubs.delete(fn); }

let driveTimer = null;
async function saveState(state) {
  setSaveStatus("saving");
  try {
    if (hasArtifactStore) await window.storage.set(STORE_KEY, JSON.stringify(state));
    else localStorage.setItem(STORE_KEY, JSON.stringify(state));
    setSaveStatus("saved");
  } catch { setSaveStatus("error"); }
  // Debounced mirror to the external drive (when connected) reports its own sync status.
  if (fsSupported) { clearTimeout(driveTimer); driveTimer = setTimeout(async () => {
    try { const h = await getDriveHandle(); if (h) { setSaveStatus("syncing"); await driveWrite(h, state); setSaveStatus("saved"); } }
    catch { setSaveStatus("error"); }
  }, 800); }
}
async function connectDrive(state) { const handle = await window.showDirectoryPicker({ id: "flightdeck", mode: "readwrite" }); await idbSet("driveHandle", handle); await driveWrite(handle, state); return handle.name; }
async function disconnectDrive() { await idbDel("driveHandle"); }
// Wipe saved state everywhere so the next load falls back to the first-run prompt.
async function clearState() {
  if (hasArtifactStore) { try { await window.storage.set(STORE_KEY, "null"); } catch {} }
  try { localStorage.removeItem(STORE_KEY); } catch {}
  if (fsSupported) { try { const h = await getDriveHandle(); if (h) await driveWrite(h, null); } catch {} }
}

function exportData(state) { try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })); a.download = "flightdeck.json"; a.click(); } catch { alert("Couldn't export the data file. Please try again, or use a different browser."); } }
function importData(onLoad) { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json"; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { onLoad(JSON.parse(await f.text())); } catch { alert("Couldn't read that file — is it a valid flightdeck.json?"); } }; inp.click(); }

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const daysUntil = (dateStr, now = new Date()) => (dateStr ? (new Date(dateStr) - now) / 86400000 : null);
// Pick readable ink (near-black vs white) for text/icons sitting on a given hex accent.
function inkFor(hex) {
  try {
    const h = hex.replace("#", "");
    const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0f172a" : "#ffffff";
  } catch { return "#ffffff"; }
}
const addDays = (dateStr, days) => { const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;
// Health fade per charge cycle, scaled so a pack loses ~40 points across its rated cycle life.
const healthPerCycle = (b) => 40 / (b.cycleLimit || 500);

/* Computed maintenance "due" status for an aircraft, across hours / cycles / calendar intervals.
   Returns the most-urgent item per metric plus an overall tone, or null when no intervals are set. */
function mxDue(a, now = new Date()) {
  const items = [];
  const push = (metric, remaining, due, unit) => {
    const overdue = remaining <= 0;
    const soon = !overdue && remaining <= unit.warn;
    if (overdue || soon) items.push({ metric, remaining, due, overdue, unit: unit.label });
  };
  if (a.mxIntervalHours > 0) {
    const due = (a.mxAtHours ?? a.hours ?? 0) + a.mxIntervalHours;
    push("hours", due - (a.hours || 0), +due.toFixed(1), { warn: Math.max(2, a.mxIntervalHours * 0.1), label: "h" });
  }
  if (a.mxIntervalCycles > 0) {
    const due = (a.mxAtCycles ?? a.cycles ?? 0) + a.mxIntervalCycles;
    push("cycles", due - (a.cycles || 0), due, { warn: Math.max(5, a.mxIntervalCycles * 0.1), label: "cyc" });
  }
  if (a.mxIntervalDays > 0 && a.lastMx) {
    const dueDate = addDays(a.lastMx, a.mxIntervalDays);
    push("calendar", daysUntil(dueDate, now), dueDate, { warn: 14, label: "d" });
  }
  if (!items.length) return null;
  items.sort((x, y) => x.remaining - y.remaining);
  return { items, tone: items.some(i => i.overdue) ? "rose" : "amber" };
}

/* ============================ theme ============================ */
const THEME_CSS = `
[data-theme="dark"]{--bg:#070d15;--surface:#0e1726;--surface-2:#0b1320;--rail:#091018;--modal:#111c2b;--input:#0b1320;--bd:#1e293b;--t1:#f1f5f9;--t2:#cbd5e1;--t3:#94a3b8;--t4:#64748b;--hover:#16202e;--accent:#1776bb;--accent-ink:#ffffff;}
[data-theme="light"]{--bg:#eef2f7;--surface:#ffffff;--surface-2:#f8fafc;--rail:#ffffff;--modal:#ffffff;--input:#ffffff;--bd:#e2e8f0;--t1:#0f172a;--t2:#334155;--t3:#64748b;--t4:#94a3b8;--hover:#f1f5f9;--accent:#1776bb;--accent-ink:#ffffff;}
.t1{color:var(--t1)}.t2{color:var(--t2)}.t3{color:var(--t3)}.t4{color:var(--t4)}.acc{color:var(--accent)}
.sf{background:var(--surface)}.sf2{background:var(--surface-2)}.rail{background:var(--rail)}
.bd{border-color:var(--bd)!important}
.ipt{width:100%;border-radius:6px;background:var(--input);border:1px solid var(--bd);color:var(--t1);padding:8px 12px;font-size:14px;outline:none}
.ipt:focus{border-color:var(--accent)}.ipt::placeholder{color:var(--t4)}
.hov:hover{background:var(--hover)}
.accbg{background:var(--accent);color:var(--accent-ink)}
.accsoft{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.hl-row{background:color-mix(in srgb,var(--accent) 14%,transparent)!important}
.hl-row td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
.hl-card{box-shadow:0 0 0 2px var(--accent)}
`;

/* ============================ seed ============================ */
function seed() {
  const a1 = uid("AC"), a2 = uid("AC"), a3 = uid("AC");
  const b1 = uid("BAT"), b2 = uid("BAT"), b3 = uid("BAT");
  const u1 = uid("OP"), u2 = uid("OP"), u3 = uid("OP");
  const m1 = uid("MSN"), m2 = uid("MSN");
  const f1 = uid("FLT"), f2 = uid("FLT");
  const cl1 = uid("CL");
  return {
    aircraft: [
      { id: a1, tail: "N7TANGO", model: "L-class Heavy Quad", serial: "LQ-0042", type: "Multirotor", status: "Available", hours: 38.4, cycles: 112, lastMx: "2026-05-30",
        faaReg: "FA3X9K2LMN", regExp: "2027-05-30", remoteId: "RID-LQ0042-7781",
        mxIntervalHours: 50, mxIntervalCycles: 200, mxIntervalDays: 180, mxAtHours: 30, mxAtCycles: 100 },
      { id: a2, tail: "N7MIKE", model: "M-class Quad", serial: "MQ-0117", type: "Multirotor", status: "Available", hours: 91.2, cycles: 340, lastMx: "2026-06-10",
        faaReg: "FA7H4P8QRS", regExp: "2026-07-30", remoteId: "RID-MQ0117-2043",
        mxIntervalHours: 50, mxIntervalCycles: 200, mxIntervalDays: 180, mxAtHours: 50, mxAtCycles: 200 },
      { id: a3, tail: "N7SIERRA", model: "S-class Quad", serial: "SQ-0205", type: "Multirotor", status: "Grounded", hours: 12.0, cycles: 44, lastMx: "2026-04-02",
        faaReg: "FA1B6N5TUV", regExp: "2026-06-01", remoteId: "RID-SQ0205-9112",
        mxIntervalHours: 50, mxIntervalCycles: 200, mxIntervalDays: 90, mxAtHours: 4, mxAtCycles: 30 },
    ],
    batteries: [
      { id: b1, label: "PK-12S-01", chem: "Li-ion 12S", capacity: 500, cycles: 64, health: 96, status: "Charged", cycleLimit: 800 },
      { id: b2, label: "PK-12S-02", chem: "Li-ion 12S", capacity: 500, cycles: 88, health: 92, status: "Charged", cycleLimit: 800 },
      { id: b3, label: "PK-6S-07", chem: "LiPo 6S", capacity: 220, cycles: 210, health: 78, status: "Storage", cycleLimit: 200 },
    ],
    users: [
      { id: u1, name: "Ava Reyes", role: "Remote PIC", cert: "Part 107", certExp: "2027-03-14", status: "Active" },
      { id: u2, name: "Daniel Okafor", role: "Visual Observer", cert: "Part 107", certExp: "2026-08-01", status: "Active" },
      { id: u3, name: "Priya Nair", role: "Remote PIC", cert: "Part 107", certExp: "2026-08-20", status: "Active" },
    ],
    missions: [
      { id: m1, name: "Corridor Survey — Sector 4", date: "2026-06-25", location: "Rural corridor, grid R4", objective: "30 km cargo delivery validation run", status: "Planned", operators: [u1, u2], aircraft: [a1], laanc: "Not required (Class G)", risk: "Moderate" },
      { id: m2, name: "Coastal Inspection", date: "2026-06-23", location: "Pier 9 waterfront", objective: "Infrastructure imaging", status: "Active", operators: [u3], aircraft: [a2], laanc: "Approved", risk: "Low" },
    ],
    flights: [
      { id: f1, missionId: m2, date: "2026-06-23", operator: u3, aircraft: a2, batteries: [b1], dur: 18, maxAlt: 120, dist: 4.2, location: "Pier 9", status: "Completed", notes: "Clean run, light crosswind." },
      { id: f2, missionId: m1, date: "2026-06-15", operator: u1, aircraft: a1, batteries: [b2], dur: 34, maxAlt: 95, dist: 11.4, location: "Grid R4", status: "Completed", notes: "Corridor test." },
    ],
    laanc: [{ id: uid("LA"), missionId: m2, airspace: "KXYZ Class D", ceiling: 200, status: "Approved", start: "2026-06-23T09:00", end: "2026-06-23T12:00", conf: "LA-8841273" }],
    waivers: [
      { id: uid("WV"), name: "Night operations", type: "Part 107 Waiver", scope: "§107.29 — civil twilight & night ops", number: "107W-2024-118822", issued: "2024-09-01", expiry: "2026-09-01", status: "Active" },
      { id: uid("WV"), name: "BVLOS — Sector 4 corridor", type: "COA", scope: "BVLOS along grid R4 cargo corridor, ≤400 ft AGL", number: "2025-WSA-9921-COA", issued: "2025-06-15", expiry: "2026-07-10", status: "Active" },
      { id: uid("WV"), name: "Operations over people", type: "Part 107 Waiver", scope: "§107.39 — OOP, Category 2 aircraft", number: "107W-2023-044120", issued: "2023-02-20", expiry: "2026-06-15", status: "Active" },
    ],
    documents: [
      { id: uid("DOC"), name: "Liability insurance — 2026", category: "Insurance", linkedType: "", linkedId: "", issueDate: "2026-01-01", expiry: "2026-07-30", notes: "$2M aggregate hull & liability; certificate on file.", refUrl: "", fileName: "", fileData: "" },
      { id: uid("DOC"), name: "N7TANGO registration certificate", category: "Registration", linkedType: "aircraft", linkedId: a1, issueDate: "2022-05-30", expiry: "2027-05-30", notes: "FAA Certificate of Aircraft Registration.", refUrl: "", fileName: "", fileData: "" },
      { id: uid("DOC"), name: "Operations manual v3", category: "Manual", linkedType: "", linkedId: "", issueDate: "2025-11-01", expiry: "", notes: "Current SOP revision; supersedes v2.", refUrl: "https://docs.example.com/ops-manual-v3.pdf", fileName: "", fileData: "" },
    ],
    maintenance: [{ id: uid("MX"), aircraft: a3, date: "2026-04-02", type: "Inspection", desc: "Arm vibration check — replaced motor mount.", tech: "Daniel Okafor" }],
    incidents: [{ id: uid("INC"), date: "2026-05-12", aircraft: a3, severity: "Minor", desc: "Hard landing during gust.", resolution: "Inspected, grounded pending mount replacement." }],
    riskAssessments: [{ id: uid("RA"), name: "30 km rural corridor", date: "2026-06-20", level: "Moderate", hazards: "Loss of GNSS over corridor; bird activity.", mitigations: "VIO + baro fallback; pre-survey corridor." }],
    checklists: [{ id: cl1, name: "Pre-flight — L-class", items: ["Visual airframe inspection", "Prop security & condition", "Battery health > 90%", "GNSS lock + RTH set", "Payload secured & balanced", "Airspace / LAANC confirmed"].map(t => ({ t, done: false })) }],
    checklistRuns: [{ id: uid("CR"), flightId: f2, missionId: m1, checklistId: cl1, name: "Pre-flight — L-class", date: "2026-06-15", by: u1, complete: true,
      items: ["Visual airframe inspection", "Prop security & condition", "Battery health > 90%", "GNSS lock + RTH set", "Payload secured & balanced", "Airspace / LAANC confirmed"].map(t => ({ t, done: true })) }],
    workflows: [{ id: uid("WF"), name: "Cargo delivery sortie", steps: ["File mission", "Assign RPIC + VO", "Pre-assign aircraft & batteries", "Run pre-flight checklist", "Confirm airspace", "Execute flight", "Log flight data", "Post-flight debrief"] }],
    scheduledReports: [{ id: uid("SR"), name: "Weekly flight log", entity: "flights", range: "last7", freq: "Weekly", format: "PDF", recipients: "ops@yourdomain.com", lastRun: "" }],
    settings: {
      theme: "dark",
      org: { name: "Your UAS Ops", part107: "On file", units: "metric", accent: "#1776bb", logo: "" },
      airspace: { basemap: "sectional", lat: 38.95, lon: -77.45, zoom: 9, trafficSource: "api", localUrl: "", wxSource: "open-meteo", station: "KIAD", stations: ["KIAD", "KRIC", "KORF", "KDCA"] },
      ops: { type: "mp4", url: "" },
      telemetry: { source: "sim", wsUrl: "", mqttUrl: "", mqttTopic: "uas/+/telemetry" },
      relay: { url: "" },
    },
    version: SCHEMA_VERSION,
  };
}

// A clean slate: the same shape as the seed, but with no demo records (used by first-run "empty workspace").
function emptyWorkspace() {
  const base = seed();
  const blank = {};
  ["aircraft", "batteries", "users", "missions", "flights", "laanc", "waivers", "documents",
    "maintenance", "incidents", "riskAssessments", "checklists", "checklistRuns", "workflows", "scheduledReports"]
    .forEach(k => { blank[k] = []; });
  return { ...base, ...blank, version: SCHEMA_VERSION };
}

/* Stepwise migration of older saved blobs. Each step bumps the version so future schema
   changes can be layered without corrupting data that's already on disk. */
function migrate(s) {
  const out = { ...s };
  const from = out.version || 1;
  if (from < 2) {
    // v1 → v2: aircraft gained registration + Remote ID + maintenance-interval fields.
    out.aircraft = (out.aircraft || []).map(a => ({
      faaReg: "", regExp: "", remoteId: "",
      mxIntervalHours: 0, mxIntervalCycles: 0, mxIntervalDays: 0,
      mxAtHours: a.hours || 0, mxAtCycles: a.cycles || 0,
      ...a,
    }));
  }
  if (from < 3) {
    // v2 → v3: auditable checklist runs + per-battery rated cycle life.
    if (!Array.isArray(out.checklistRuns)) out.checklistRuns = [];
    out.batteries = (out.batteries || []).map(b => ({
      cycleLimit: /li-ion|lion|li ion/i.test(b.chem || "") ? 800 : 200,
      ...b,
    }));
  }
  if (from < 4) {
    // v3 → v4: waivers / COAs as first-class compliance records.
    if (!Array.isArray(out.waivers)) out.waivers = [];
  }
  if (from < 5) {
    // v4 → v5: centralized document vault (uploaded files or external references).
    if (!Array.isArray(out.documents)) out.documents = [];
  }
  out.version = SCHEMA_VERSION;
  return out;
}
function ensure(s) {
  const base = seed();
  const src = s ? migrate(s) : {};
  const out = { ...base, ...src };
  out.checklistRuns = Array.isArray(src.checklistRuns) ? src.checklistRuns : (s ? [] : base.checklistRuns);
  out.waivers = Array.isArray(src.waivers) ? src.waivers : (s ? [] : base.waivers);
  out.documents = Array.isArray(src.documents) ? src.documents : (s ? [] : base.documents);
  out.scheduledReports = src.scheduledReports || base.scheduledReports;
  out.settings = { ...base.settings, ...(src.settings || {}) };
  out.settings.org = { ...base.settings.org, ...(src.settings?.org || {}) };
  out.settings.airspace = { ...base.settings.airspace, ...(src.settings?.airspace || {}) };
  if (!Array.isArray(out.settings.airspace.stations)) out.settings.airspace.stations = base.settings.airspace.stations;
  out.settings.ops = { ...base.settings.ops, ...(src.settings?.ops || {}) };
  out.settings.telemetry = { ...base.settings.telemetry, ...(src.settings?.telemetry || {}) };
  out.settings.relay = { ...base.settings.relay, ...(src.settings?.relay || {}) };
  out.version = SCHEMA_VERSION;
  return out;
}

/* ============================ nav ============================ */
const NAV = [
  { group: "Operations", items: [{ key: "missions", label: "Missions", icon: Map }] },
  { group: "Logs", items: [
    { key: "flights", label: "Flights", icon: Plane }, { key: "laanc", label: "LAANC Authorizations", icon: Radio },
    { key: "checklists", label: "Checklists", icon: ListChecks }, { key: "risk", label: "Risk Assessments", icon: ShieldAlert },
    { key: "maintenance", label: "Maintenance", icon: Wrench }, { key: "incidents", label: "Incidents", icon: AlertTriangle },
  ]},
  { group: "Compliance", items: [{ key: "waivers", label: "Waivers & COAs", icon: BadgeCheck }, { key: "documents", label: "Document Vault", icon: FileText }] },
  { group: "Assets", items: [{ key: "aircraft", label: "Aircraft", icon: Plane }, { key: "batteries", label: "Batteries", icon: Battery }] },
  { group: "Procedures", items: [
    { key: "workflows", label: "Workflows", icon: Workflow }, { key: "proc-checklists", label: "Checklists", icon: ClipboardCheck }, { key: "proc-risk", label: "Risk Assessments", icon: ShieldAlert },
  ]},
  { group: "Admin", items: [{ key: "users", label: "Users", icon: Users }] },
];
const RAIL = [
  { key: "home", label: "Home", icon: LayoutDashboard }, { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "airspace", label: "Airspace", icon: Radar },
  { key: "ops", label: "OPS Center", icon: Video }, { key: "manage", label: "Manage", icon: Layers },
  { key: "reporting", label: "Reporting", icon: FileBarChart }, { key: "settings", label: "Settings", icon: SettingsIcon },
];

/* ============================ status / primitives ============================ */
const BASE = {
  Planned: "#64748b", Active: "#f59e0b", Completed: "#1776bb", Cancelled: "#f43f5e",
  Available: "#1776bb", Grounded: "#f43f5e", Charged: "#1776bb", Storage: "#64748b",
  "In use": "#f59e0b", Approved: "#1776bb", Pending: "#f59e0b", Expired: "#f43f5e",
};
function Badge({ value }) {
  const c = BASE[value] || "#64748b";
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
    style={{ background: c + "26", color: c }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{value}</span>;
}
function Btn({ children, onClick, variant = "ghost", className = "", type = "button", disabled = false }) {
  const base = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors";
  const dis = disabled ? "opacity-40 pointer-events-none" : "";
  if (variant === "primary") return <button type={type} disabled={disabled} onClick={onClick} className={`${base} accbg font-semibold ${dis} ${className}`}>{children}</button>;
  if (variant === "danger") return <button type={type} disabled={disabled} onClick={onClick} className={`${base} border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 ${dis} ${className}`}>{children}</button>;
  return <button type={type} disabled={disabled} onClick={onClick} className={`${base} sf2 bd border t2 hov ${dis} ${className}`}>{children}</button>;
}
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wider t3">{label}</span>{children}</label>;
}
const TextInput = (p) => <input {...p} className="ipt" />;
const Select = ({ children, ...p }) => <select {...p} className="ipt">{children}</select>;
const TextArea = (p) => <textarea {...p} className="ipt" style={{ minHeight: 80, resize: "vertical" }} />;

function Modal({ title, onClose, children, onSave, saveLabel = "Save" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="my-auto w-full max-w-lg rounded-xl border bd shadow-2xl" style={{ background: "var(--modal)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b bd px-5 py-3.5">
          <h3 className="text-sm font-semibold t1">{title}</h3>
          <button onClick={onClose} className="t3 hover:opacity-70"><X size={18} /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t bd px-5 py-3"><Btn onClick={onClose}>Cancel</Btn>{onSave && <Btn variant="primary" onClick={onSave}>{saveLabel}</Btn>}</div>
      </div>
    </div>
  );
}
// Finds records that reference an aircraft/user id, so a delete can warn + detach instead of orphaning IDs.
function collectRefs(data, coll, id) {
  if (!data || (coll !== "aircraft" && coll !== "users")) return [];
  const groups = [];
  const push = (label, items) => { if (items.length) groups.push({ label, items }); };
  if (coll === "aircraft") {
    push("Missions", data.missions.filter(m => (m.aircraft || []).includes(id)).map(m => m.name));
    push("Flights", data.flights.filter(f => f.aircraft === id).map(f => f.date));
    push("Maintenance", data.maintenance.filter(m => m.aircraft === id).map(m => `${m.type} · ${m.date}`));
    push("Incidents", data.incidents.filter(i => i.aircraft === id).map(i => `${i.severity} · ${i.date}`));
    push("Documents", (data.documents || []).filter(dn => dn.linkedType === "aircraft" && dn.linkedId === id).map(dn => dn.name));
  } else {
    push("Missions", data.missions.filter(m => (m.operators || []).includes(id)).map(m => m.name));
    push("Flights", data.flights.filter(f => f.operator === id).map(f => f.date));
    push("Checklist runs", (data.checklistRuns || []).filter(r => r.by === id).map(r => `${r.name} · ${r.date}`));
  }
  return groups;
}
function ConfirmDialog({ data, confirm, onCancel, onConfirm }) {
  const item = data?.[confirm.coll]?.find(x => x.id === confirm.id);
  const label = item?.name || item?.tail || item?.label || item?.conf
    || (item?.date ? `${item.type || item.severity || "record"} · ${item.date}` : "this record");
  const refs = collectRefs(data, confirm.coll, confirm.id);
  const refCount = refs.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border bd shadow-2xl" style={{ background: "var(--modal)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b bd px-5 py-3.5"><AlertTriangle size={16} className="text-rose-400" /><h3 className="text-sm font-semibold t1">Delete?</h3></div>
        <div className="px-5 py-4 text-sm t2">
          Delete <span className="font-medium t1">{label}</span>?{refCount === 0 && " This can't be undone."}
          {refCount > 0 && <>
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-500"><AlertTriangle size={12} />Referenced by {refCount} record{refCount > 1 ? "s" : ""}</div>
              <ul className="space-y-1">{refs.map(g => <li key={g.label} className="t3">
                <span className="t2 font-medium">{g.label} ({g.items.length}):</span> {g.items.slice(0, 4).join(", ")}{g.items.length > 4 ? `, +${g.items.length - 4} more` : ""}</li>)}</ul>
            </div>
            <p className="mt-2 text-xs t3">Deleting detaches {confirm.coll === "aircraft" ? "this aircraft" : "this crew member"} from those records so none are left with a broken reference.</p>
          </>}
        </div>
        <div className="flex justify-end gap-2 border-t bd px-5 py-3"><Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm}><Trash2 size={14} />{refCount ? "Detach & delete" : "Delete"}</Btn></div>
      </div>
    </div>
  );
}
function MultiPick({ options, value, onChange, labelFn }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  return <div className="flex flex-wrap gap-1.5">
    {options.length === 0 && <span className="text-xs t4">None available</span>}
    {options.map(o => { const on = value.includes(o.id);
      return <button key={o.id} type="button" onClick={() => toggle(o.id)}
        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${on ? "accsoft" : "sf2 bd t2 hov"}`}
        style={on ? { borderColor: "var(--accent)" } : {}}>{labelFn(o)}</button>; })}
  </div>;
}
function PageHeader({ title, subtitle, action }) {
  return <div className="mb-5 flex items-end justify-between gap-4">
    <div><h1 className="text-xl font-bold tracking-tight t1">{title}</h1>{subtitle && <p className="mt-0.5 text-sm t3">{subtitle}</p>}</div>{action}</div>;
}
function Empty({ icon: Icon, label, hint }) {
  return <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bd py-16 text-center">
    <Icon size={28} className="t4" /><p className="mt-3 text-sm font-medium t2">{label}</p>{hint && <p className="mt-1 text-xs t4">{hint}</p>}</div>;
}
function Table({ cols, children }) {
  return <div className="overflow-x-auto rounded-xl border bd"><table className="w-full border-collapse text-sm"><thead>
    <tr className="border-b bd sf2">{cols.map((c, i) => <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider t4">{c}</th>)}</tr>
  </thead><tbody>{children}</tbody></table></div>;
}
const Td = ({ children, mono }) => <td className={`px-4 py-3 align-middle t2 ${mono ? "font-mono text-xs t3" : ""}`}>{children}</td>;
const Row = ({ children, hl, innerRef }) => <tr ref={innerRef} className={`border-b bd last:border-0 hov ${hl ? "hl-row" : ""}`}>{children}</tr>;
// Scrolls the flashed search result into view; used by table/card views that accept a `highlight`.
function useHighlightScroll(highlight) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [highlight]);
  return ref;
}
function RowActions({ onEdit, onDelete }) {
  return <div className="flex justify-end gap-1">
    {onEdit && <button onClick={onEdit} className="rounded p-1.5 t4 hov hover:opacity-90"><Pencil size={14} /></button>}
    {onDelete && <button onClick={onDelete} className="rounded p-1.5 t4 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 size={14} /></button>}</div>;
}
function Panel({ title, icon: Icon, children, right }) {
  return <div className="rounded-xl border bd sf"><div className="flex items-center justify-between border-b bd px-4 py-3">
    <span className="flex items-center gap-2 text-sm font-semibold t1"><Icon size={15} className="acc" />{title}</span>{right}</div>
    <div className="px-4 py-3">{children}</div></div>;
}
const Kv = ({ k, v }) => <div className="flex justify-between py-1 text-sm"><span className="t3">{k}</span><span className="font-mono t2">{v}</span></div>;
function Stat({ icon: Icon, label, value, sub, tone = "teal" }) {
  const c = { teal: "#1776bb", amber: "#f59e0b", rose: "#f43f5e", slate: "var(--t2)" }[tone];
  return <div className="rounded-xl border bd sf p-4"><div className="flex items-center justify-between">
    <span className="text-xs font-medium uppercase tracking-wider t4">{label}</span><Icon size={16} style={{ color: c }} /></div>
    <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: c }}>{value}</div>{sub && <div className="mt-0.5 text-xs t4">{sub}</div>}</div>;
}
function useSaveStatus() {
  const [v, setV] = useState({ status: saveStatus, seq: saveSeq });
  useEffect(() => subscribeSaveStatus(setV), []);
  return v;
}
// Floating pill that reflects local persistence + Drive/Relay sync. "Saved" auto-fades; errors persist.
function SaveIndicator() {
  const { status, seq } = useSaveStatus();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === "idle") { setShow(false); return; }
    setShow(true);
    if (status === "saved") { const t = setTimeout(() => setShow(false), 1500); return () => clearTimeout(t); }
  }, [status, seq]);
  if (!show) return null;
  const map = {
    saving: { t: "Saving…", c: "#f59e0b", Icon: RefreshCw, spin: true },
    saved: { t: "Saved", c: "#1776bb", Icon: CircleDot },
    syncing: { t: "Syncing…", c: "#f59e0b", Icon: RefreshCw, spin: true },
    error: { t: "Sync failed", c: "#f43f5e", Icon: CircleAlert },
  };
  const s = map[status]; if (!s) return null;
  return <div className="fixed bottom-3 right-3 z-[70] flex items-center gap-1.5 rounded-full border bd px-3 py-1.5 text-[11px] font-medium shadow-lg"
    style={{ background: "var(--modal)", color: s.c }}>
    <s.Icon size={12} className={s.spin ? "animate-spin" : ""} />{s.t}</div>;
}

/* ============================ app ============================ */
function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("home");
  const [view, setView] = useState("missions");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [firstRun, setFirstRun] = useState(false);   // no saved data → show the empty/demo chooser
  const [highlight, setHighlight] = useState(null);   // { coll, id } from global search — navigated record to flash
  const [loadError, setLoadError] = useState(false);  // saved blob unreadable/incompatible → recoverable error screen

  // First launch (no saved blob) shows the chooser instead of auto-seeding demo data.
  // A corrupt/incompatible blob (ensure/migrate throwing) surfaces a retryable error instead of hanging on "Loading…".
  const bootstrap = useCallback(() => {
    setLoadError(false);
    loadState().then(s => { if (s) setData(ensure(s)); else setFirstRun(true); }).catch(() => setLoadError(true));
  }, []);
  useEffect(() => { bootstrap(); }, [bootstrap]);
  useEffect(() => { if (data) saveState(data); }, [data]);
  useEffect(() => { if (!highlight) return; const t = setTimeout(() => setHighlight(null), 3200); return () => clearTimeout(t); }, [highlight]);

  const update = useCallback((key, fn) => setData(d => ({ ...d, [key]: fn(d[key]) })), []);
  const setSetting = useCallback((path, val) => setData(d => {
    const s = { ...d.settings };
    if (path.length === 1) s[path[0]] = val;
    else { s[path[0]] = { ...s[path[0]], [path[1]]: val }; }
    return { ...d, settings: s };
  }), []);
  const upsert = (key, item) => update(key, list => { const i = list.findIndex(x => x.id === item.id); if (i === -1) return [item, ...list]; const c = [...list]; c[i] = item; return c; });
  const doRemove = (key, id) => update(key, list => list.filter(x => x.id !== id));
  // Aircraft/user deletes scrub their id from every referencing record so nothing is orphaned.
  const cascadeDelete = useCallback((coll, id) => setData(d => {
    const out = { ...d, [coll]: (d[coll] || []).filter(x => x.id !== id) };
    if (coll === "aircraft") {
      out.missions = d.missions.map(m => ({ ...m, aircraft: (m.aircraft || []).filter(x => x !== id) }));
      out.flights = d.flights.map(f => f.aircraft === id ? { ...f, aircraft: "" } : f);
      out.maintenance = d.maintenance.map(m => m.aircraft === id ? { ...m, aircraft: "" } : m);
      out.incidents = d.incidents.map(i => i.aircraft === id ? { ...i, aircraft: "" } : i);
      out.documents = (d.documents || []).map(dn => dn.linkedType === "aircraft" && dn.linkedId === id ? { ...dn, linkedType: "", linkedId: "" } : dn);
    } else if (coll === "users") {
      out.missions = d.missions.map(m => ({ ...m, operators: (m.operators || []).filter(x => x !== id) }));
      out.flights = d.flights.map(f => f.operator === id ? { ...f, operator: "" } : f);
      out.checklistRuns = (d.checklistRuns || []).map(r => r.by === id ? { ...r, by: "" } : r);
    }
    return out;
  }), []);
  // Deletes route through a confirmation dialog (no undo otherwise); call sites keep using `remove`.
  const remove = useCallback((key, id) => setConfirmDel({ coll: key, id }), []);

  // Saving a flight rolls its usage up into the fleet: aircraft hours (+dur/60) & cycles (+1),
  // and each used battery's cycles (+1). On edit we apply the delta vs. the prior version so
  // re-saving (or reassigning aircraft/batteries) never double-counts.
  const saveFlight = useCallback((flight) => setData(d => {
    const id = flight.id || uid("FLT");
    const saved = { ...flight, id };
    const prev = flight.id ? d.flights.find(f => f.id === id) : null;
    const flights = prev ? d.flights.map(f => (f.id === id ? saved : f)) : [saved, ...d.flights];

    const hoursD = {}, cyclesD = {}, batD = {};
    const bump = (ac, dur, bats, sign) => {
      if (ac) { hoursD[ac] = (hoursD[ac] || 0) + sign * (dur || 0) / 60; cyclesD[ac] = (cyclesD[ac] || 0) + sign; }
      (bats || []).forEach(b => { batD[b] = (batD[b] || 0) + sign; });
    };
    if (prev) bump(prev.aircraft, prev.dur, prev.batteries, -1);
    bump(saved.aircraft, saved.dur, saved.batteries, +1);

    const aircraft = d.aircraft.map(a => (hoursD[a.id] == null && cyclesD[a.id] == null) ? a
      : { ...a, hours: +Math.max(0, (a.hours || 0) + (hoursD[a.id] || 0)).toFixed(1), cycles: Math.max(0, (a.cycles || 0) + (cyclesD[a.id] || 0)) });
    const batteries = d.batteries.map(b => {
      const dc = batD[b.id];
      if (dc == null) return b;
      return { ...b, cycles: Math.max(0, (b.cycles || 0) + dc), health: clamp(round2((b.health ?? 100) - dc * healthPerCycle(b)), 0, 100) };
    });
    return { ...d, flights, aircraft, batteries };
  }), []);

  // Logging maintenance resets the aircraft's service baseline so "next due" recomputes from now.
  const saveMaintenance = useCallback((rec) => setData(d => {
    const id = rec.id || uid("MX");
    const saved = { ...rec, id };
    const exists = d.maintenance.some(m => m.id === id);
    const maintenance = exists ? d.maintenance.map(m => (m.id === id ? saved : m)) : [saved, ...d.maintenance];
    const aircraft = d.aircraft.map(a => a.id === saved.aircraft
      ? { ...a, lastMx: saved.date, mxAtHours: a.hours || 0, mxAtCycles: a.cycles || 0 } : a);
    return { ...d, maintenance, aircraft };
  }), []);
  const nameOf = useCallback((coll, id) => (data?.[coll]?.find(x => x.id === id)?.[coll === "users" ? "name" : coll === "aircraft" ? "tail" : "label"]) || "—", [data]);

  // First-run choices + reset (reset wipes storage and returns to the chooser).
  const startEmpty = useCallback(() => { setData(emptyWorkspace()); setFirstRun(false); }, []);
  const loadDemo = useCallback(() => { setData(seed()); setFirstRun(false); }, []);
  const resetWorkspace = useCallback(async () => { await clearState(); setHighlight(null); setData(null); setFirstRun(true); }, []);
  // Global search → jump to the record's manage view and flash it.
  const goSearch = useCallback((coll, id) => {
    const v = { missions: "missions", flights: "flights", aircraft: "aircraft", users: "users" }[coll] || "missions";
    setTab("manage"); setView(v); setSearch(""); setHighlight({ coll, id });
  }, []);

  if (!data) {
    if (loadError) return <LoadError onRetry={bootstrap} onFresh={startEmpty} />;
    return firstRun
      ? <FirstRun onEmpty={startEmpty} onDemo={loadDemo} />
      : <div className="flex h-screen items-center justify-center text-slate-500" style={{ background: "#070d15" }}>Loading flight ops…</div>;
  }

  const theme = data.settings.theme;
  const accent = data.settings.org?.accent || "#1776bb";
  const accentInk = inkFor(accent);   // black or white text, whichever reads on the chosen accent
  const logo = data.settings.org?.logo || "";
  const closeModal = () => setModal(null);
  const goManage = (v) => { setTab("manage"); setView(v); };

  return (
    <div data-theme={theme} className="flex min-h-screen w-full" style={{ background: "var(--bg)", color: "var(--t2)", fontFamily: "'Inter',system-ui,-apple-system,sans-serif", "--accent": accent, "--accent-ink": accentInk }}>
      <style>{THEME_CSS}</style>

      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r bd rail py-3">
        <div className="mb-2 h-9 w-9 overflow-hidden rounded-md" title="Brand emblem">
          {logo
            ? <img src={logo} alt="Company logo" className="h-full w-full object-cover" />
            : <div className="grid h-full w-full place-items-center accbg"><Plane size={18} /></div>}
        </div>
        {RAIL.map(r => { const active = tab === r.key; const Icon = r.icon;
          return <button key={r.key} onClick={() => setTab(r.key)} title={r.label}
            className={`relative flex h-11 w-11 flex-col items-center justify-center rounded-lg transition-colors ${active ? "accsoft" : "t4 hov"}`}>
            {active && <span className="absolute left-0 h-6 w-0.5 -translate-x-2 rounded-full" style={{ background: "var(--accent)" }} />}
            <Icon size={19} /><span className="mt-0.5 text-[8px] font-medium uppercase tracking-wide">{r.label.split(" ")[0]}</span></button>; })}
      </nav>

      {tab === "manage" && (
        <aside className="hidden w-56 shrink-0 flex-col border-r bd sf2 md:flex">
          <div className="px-5 py-4"><div className="text-sm font-bold t1">Manage</div><div className="text-[10px] uppercase tracking-widest t4">Fleet & operations</div></div>
          <div className="flex-1 overflow-y-auto px-3 pb-6">{NAV.map(grp => (
            <div key={grp.group} className="mb-1"><div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-widest t4">{grp.group}</div>
              {grp.items.map(it => { const active = view === it.key; const Icon = it.icon;
                return <button key={it.key} onClick={() => { setView(it.key); setSearch(""); }}
                  className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${active ? "accsoft font-medium" : "t3 hov"}`}>
                  <Icon size={16} className={active ? "acc" : "t4"} />{it.label}</button>; })}
            </div>))}</div>
        </aside>)}

      <main className="flex-1 overflow-x-hidden">
        {tab === "manage" && <div className="flex items-center gap-2 overflow-x-auto border-b bd sf2 px-3 py-2 md:hidden">
          {NAV.flatMap(g => g.items).map(it => <button key={it.key} onClick={() => setView(it.key)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${view === it.key ? "accsoft" : "t3"}`}>{it.label}</button>)}</div>}

        <div className="mx-auto max-w-6xl px-5 py-6">
          {tab === "home" && <Home {...{ data, nameOf, goManage, setSetting }} />}
          {tab === "schedule" && <Schedule {...{ data, nameOf, setModal, goManage }} />}
          {tab === "airspace" && <Airspace {...{ data, setSetting }} />}
          {tab === "ops" && <OpsCenter {...{ data, nameOf, setSetting }} />}
          {tab === "reporting" && <Reporting {...{ data, nameOf, update }} />}
          {tab === "settings" && <Settings {...{ data, setData, setSetting, onReset: resetWorkspace }} />}
          {tab === "manage" && <>
            <div className="mb-5"><GlobalSearch data={data} nameOf={nameOf} onPick={goSearch} /></div>
            {view === "missions" && <Missions {...{ data, setModal, remove, nameOf, highlight }} />}
            {view === "flights" && <Flights {...{ data, setModal, remove, nameOf, highlight }} />}
            {view === "laanc" && <Laanc {...{ data, setModal, remove }} />}
            {view === "waivers" && <Waivers {...{ data, setModal, remove }} />}
            {view === "documents" && <Documents {...{ data, setModal, remove }} />}
            {(view === "checklists" || view === "proc-checklists") && <Checklists {...{ data, setModal, remove, update }} />}
            {(view === "risk" || view === "proc-risk") && <RiskList {...{ data, setModal, remove }} />}
            {view === "maintenance" && <Maintenance {...{ data, setModal, remove, nameOf }} />}
            {view === "incidents" && <Incidents {...{ data, setModal, remove, nameOf }} />}
            {view === "aircraft" && <Aircraft {...{ data, setModal, remove, highlight }} />}
            {view === "batteries" && <Batteries {...{ data, setModal, remove }} />}
            {view === "workflows" && <Workflows {...{ data, setModal, remove }} />}
            {view === "users" && <UsersView {...{ data, setModal, remove, highlight }} />}
          </>}
        </div>
      </main>
      {modal && <ModalRouter {...{ modal, data, upsert, saveFlight, saveMaintenance, closeModal }} />}
      {confirmDel && <ConfirmDialog data={data} confirm={confirmDel} onCancel={() => setConfirmDel(null)}
        onConfirm={() => { const { coll, id } = confirmDel;
          if (coll === "aircraft" || coll === "users") cascadeDelete(coll, id); else doRemove(coll, id);
          setConfirmDel(null); }} />}
      <SaveIndicator />
    </div>
  );
}

// Catches render crashes (e.g. malformed-but-accepted saved data) and shows the recoverable LoadError
// screen instead of unmounting to a blank page. Retry re-renders; Start fresh wipes storage and reloads.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: false }; }
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch() { /* error surfaced via the LoadError screen; nothing else to do */ }
  render() {
    if (this.state.error) return <LoadError
      onRetry={() => this.setState({ error: false })}
      onFresh={async () => { try { await clearState(); } catch {} location.reload(); }} />;
    return this.props.children;
  }
}
export default function Root() { return <ErrorBoundary><App /></ErrorBoundary>; }

/* ============================ theme toggle ============================ */
function ThemeToggle({ theme, onChange }) {
  return <div className="flex items-center gap-0.5 rounded-lg border bd sf2 p-0.5">
    {[["light", "Day", Sun], ["dark", "Night", Moon]].map(([k, l, Icon]) => (
      <button key={k} onClick={() => onChange(k)}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${theme === k ? "accbg" : "t3"}`}>
        <Icon size={13} />{l}</button>))}</div>;
}

/* ============================ home ============================ */
function Home({ data, nameOf, goManage, setSetting }) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10), monthStr = todayStr.slice(0, 7);
  const activeMissions = data.missions.filter(m => m.status === "Active");
  const plannedToday = data.missions.filter(m => m.date === todayStr && m.status === "Planned");
  const inFlight = data.flights.filter(f => f.status === "Active");
  const acAvail = data.aircraft.filter(a => a.status === "Available").length;
  const acGrounded = data.aircraft.filter(a => a.status === "Grounded").length;
  const batReady = data.batteries.filter(b => b.status === "Charged").length;
  const flightsMonth = data.flights.filter(f => (f.date || "").startsWith(monthStr));
  const hoursMonth = (flightsMonth.reduce((s, f) => s + (f.dur || 0), 0) / 60).toFixed(1);

  const alerts = [];
  data.users.forEach(u => { const d = (new Date(u.certExp) - now) / 86400000;
    if (d < 0) alerts.push({ tone: "rose", t: `${u.name} — ${u.cert} expired`, sub: u.certExp });
    else if (d < 60) alerts.push({ tone: "amber", t: `${u.name} — ${u.cert} expires soon`, sub: u.certExp }); });
  data.aircraft.filter(a => a.status === "Grounded").forEach(a => alerts.push({ tone: "rose", t: `${a.tail} grounded`, sub: a.model }));
  data.aircraft.forEach(a => { const d = daysUntil(a.regExp, now);
    if (d == null) return;
    if (d < 0) alerts.push({ tone: "rose", t: `${a.tail} — FAA registration expired`, sub: `${a.faaReg || "reg"} · ${a.regExp}` });
    else if (d < 60) alerts.push({ tone: "amber", t: `${a.tail} — registration expires soon`, sub: `${a.faaReg || "reg"} · ${a.regExp}` }); });
  data.aircraft.forEach(a => { const mx = mxDue(a, now);
    if (!mx) return;
    const top = mx.items[0];
    const detail = mx.items.map(i => i.overdue
      ? `${i.metric} overdue by ${Math.abs(Math.round(i.remaining))} ${i.unit}`
      : `${i.metric} in ${Math.max(0, Math.round(i.remaining))} ${i.unit}`).join(" · ");
    alerts.push({ tone: mx.tone, t: `${a.tail} — maintenance ${top.overdue ? "overdue" : "due soon"}`, sub: detail }); });
  data.batteries.filter(b => b.health < 80).forEach(b => alerts.push({ tone: "amber", t: `${b.label} health ${Math.round(b.health)}%`, sub: `${b.cycles} cycles` }));
  data.batteries.forEach(b => { const lim = b.cycleLimit; if (!lim) return;
    if (b.cycles >= lim) alerts.push({ tone: "rose", t: `${b.label} past rated cycle life`, sub: `${b.cycles}/${lim} cycles` });
    else if (b.cycles >= lim * 0.9) alerts.push({ tone: "amber", t: `${b.label} nearing cycle limit`, sub: `${b.cycles}/${lim} cycles` }); });
  (data.waivers || []).forEach(w => { const d = daysUntil(w.expiry, now); if (d == null) return;
    if (d < 0) alerts.push({ tone: "rose", t: `${w.name} (${w.type}) expired`, sub: `${w.number || "waiver"} · ${w.expiry}` });
    else if (d < 60) alerts.push({ tone: "amber", t: `${w.name} (${w.type}) expires soon`, sub: `${w.number || "waiver"} · ${w.expiry}` }); });
  (data.documents || []).forEach(dn => { const d = daysUntil(dn.expiry, now); if (d == null) return;
    if (d < 0) alerts.push({ tone: "rose", t: `${dn.name} (${dn.category}) expired`, sub: `Document · ${dn.expiry}` });
    else if (d < 60) alerts.push({ tone: "amber", t: `${dn.name} (${dn.category}) expires soon`, sub: `Document · ${dn.expiry}` }); });
  const recent = [...data.flights].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);

  return (<>
    <PageHeader title="Home"
      subtitle={now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      action={<ThemeToggle theme={data.settings.theme} onChange={v => setSetting(["theme"], v)} />} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={Activity} label="Active missions" value={activeMissions.length} sub={`${plannedToday.length} planned today`} tone="amber" />
      <Stat icon={Plane} label="Fleet ready" value={`${acAvail}/${data.aircraft.length}`} sub={acGrounded ? `${acGrounded} grounded` : "all clear"} tone={acGrounded ? "rose" : "teal"} />
      <Stat icon={BatteryCharging} label="Batteries charged" value={`${batReady}/${data.batteries.length}`} sub="packs ready" tone="teal" />
      <Stat icon={TrendingUp} label="Hours this month" value={hoursMonth} sub={`${flightsMonth.length} flights`} tone="slate" />
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border bd sf">
        <div className="flex items-center justify-between border-b bd px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold t1"><Signal size={15} className="acc" />Active operations</h3>
          <button onClick={() => goManage("missions")} className="text-xs acc hover:opacity-80">Manage →</button></div>
        <div className="divide-y bd" style={{ borderColor: "var(--bd)" }}>
          {activeMissions.length === 0 && <div className="px-4 py-8 text-center text-sm t4">No active operations right now.</div>}
          {activeMissions.map(m => <div key={m.id} className="flex items-center justify-between border-b bd px-4 py-3 last:border-0">
            <div><div className="flex items-center gap-2 text-sm font-medium t1">
              <span className="relative flex h-2 w-2"><span className="absolute h-2 w-2 animate-ping rounded-full bg-amber-400/70" /><span className="h-2 w-2 rounded-full bg-amber-400" /></span>{m.name}</div>
              <div className="mt-0.5 text-xs t4">{m.operators.map(id => nameOf("users", id)).join(", ")} · {m.aircraft.map(id => nameOf("aircraft", id)).join(", ")}</div></div>
            <span className="font-mono text-xs t3">{m.location}</span></div>)}
          {inFlight.map(f => <div key={f.id} className="flex items-center justify-between border-b bd px-4 py-3 last:border-0">
            <div className="flex items-center gap-2 text-sm t2"><Plane size={14} className="text-amber-400" />In flight: {nameOf("aircraft", f.aircraft)}</div>
            <span className="font-mono text-xs t3">{f.maxAlt} m · {f.dist} km</span></div>)}</div>
      </div>
      <div className="rounded-xl border bd sf">
        <div className="border-b bd px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold t1"><CircleAlert size={15} className="text-amber-400" />Alerts {alerts.length > 0 && <span className="rounded-full bg-amber-400/15 px-1.5 text-xs text-amber-500">{alerts.length}</span>}</h3></div>
        <div className="max-h-72 overflow-y-auto p-3">
          {alerts.length === 0 && <div className="py-6 text-center text-sm t4">Nothing needs attention.</div>}
          {alerts.map((a, i) => <div key={i} className="mb-1.5 flex items-start gap-2 rounded-lg border bd sf2 px-3 py-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.tone === "rose" ? "#f43f5e" : "#f59e0b" }} />
            <div><div className="text-xs font-medium t2">{a.t}</div><div className="font-mono text-[11px] t4">{a.sub}</div></div></div>)}</div>
      </div>
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border bd sf">
        <div className="flex items-center justify-between border-b bd px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold t1"><Clock size={15} className="acc" />Recent flights</h3>
          <button onClick={() => goManage("flights")} className="text-xs acc hover:opacity-80">View log →</button></div>
        <div>{recent.length === 0 && <div className="px-4 py-8 text-center text-sm t4">No flights logged yet.</div>}
          {recent.map(f => <div key={f.id} className="flex items-center justify-between border-b bd px-4 py-2.5 text-sm last:border-0">
            <div className="flex items-center gap-3"><span className="font-mono text-xs t4">{f.date}</span><span className="t2">{nameOf("aircraft", f.aircraft)}</span><span className="t4">·</span><span className="t3">{nameOf("users", f.operator)}</span></div>
            <div className="flex items-center gap-3 font-mono text-xs t3"><span>{f.dur}m</span><span>{f.maxAlt}m</span><Badge value={f.status} /></div></div>)}</div>
      </div>
      <div className="rounded-xl border bd sf p-4"><h3 className="mb-3 text-sm font-semibold t1">Quick actions</h3><div className="grid gap-2">
        {[{ l: "New mission", v: "missions", i: Map }, { l: "Log a flight", v: "flights", i: Plane }, { l: "Run a checklist", v: "checklists", i: ListChecks }, { l: "Report an incident", v: "incidents", i: AlertTriangle }].map(q => (
          <button key={q.v} onClick={() => goManage(q.v)} className="flex items-center gap-2.5 rounded-lg border bd sf2 px-3 py-2.5 text-sm t2 hov" >
            <q.i size={15} className="t4" />{q.l}<ArrowUpRight size={13} className="ml-auto t4" /></button>))}</div>
      </div>
    </div>
  </>);
}

/* ============================ schedule ============================ */
function Schedule({ data, nameOf, setModal, goManage }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const todayIso = now.toISOString().slice(0, 10);
  const monthKey = iso(cursor.y, cursor.m, 1).slice(0, 7);

  const byDate = useMemo(() => { const map = {}; data.missions.forEach(mn => { (map[mn.date] = map[mn.date] || []).push(mn); }); return map; }, [data.missions]);

  // Crew double-booking: the same operator (RPIC/VO) assigned to >1 mission on a date.
  const conflicts = useMemo(() => {
    const out = {};
    Object.entries(byDate).forEach(([date, ms]) => {
      const opMap = {};
      ms.forEach(mn => (mn.operators || []).forEach(o => (opMap[o] = opMap[o] || []).push(mn)));
      const dayConf = Object.entries(opMap).filter(([, list]) => list.length > 1).map(([op, list]) => ({ op, list }));
      if (dayConf.length) out[date] = dayConf;
    });
    return out;
  }, [byDate]);

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const firstDow = new Date(cursor.y, cursor.m, 1).getDay();
  const daysIn = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const shift = (delta) => setCursor(c => { const dt = new Date(c.y, c.m + delta, 1); return { y: dt.getFullYear(), m: dt.getMonth() }; });
  const sc = (s) => BASE[s] || "#64748b";
  const monthConflicts = Object.entries(conflicts).filter(([date]) => date.startsWith(monthKey));
  const monthMissions = Object.entries(byDate).filter(([dt]) => dt.startsWith(monthKey)).reduce((s, [, ms]) => s + ms.length, 0);

  return (<>
    <PageHeader title="Schedule" subtitle="Missions by date, with crew double-booking detection."
      action={<div className="flex items-center gap-2">
        <Btn onClick={() => shift(-1)}><ChevronLeft size={15} /></Btn>
        <span className="min-w-[132px] text-center text-sm font-semibold t1">{monthLabel}</span>
        <Btn onClick={() => shift(1)}><ChevronRight size={15} /></Btn>
        <Btn onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Today</Btn>
        <Btn variant="primary" onClick={() => setModal({ type: "mission" })}><Plus size={15} />New mission</Btn>
      </div>} />
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="lg:col-span-3 rounded-xl border bd sf p-3">
        <div className="grid grid-cols-7 gap-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d} className="px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wider t4">{d}</div>)}
          {cells.map((d, i) => {
            if (d == null) return <div key={i} className="min-h-[84px] rounded-lg" />;
            const date = iso(cursor.y, cursor.m, d);
            const ms = byDate[date] || [];
            const conf = conflicts[date];
            const isToday = date === todayIso;
            return <div key={i} className={`min-h-[84px] rounded-lg border p-1 ${conf ? "border-rose-500/50" : "bd"} ${isToday ? "sf2" : ""}`} style={conf ? { background: "#f43f5e10" } : {}}>
              <div className="flex items-center justify-between px-0.5">
                <span className={`text-[11px] font-medium ${isToday ? "acc" : "t3"}`}>{d}</span>
                {conf && <span title="Crew double-booked"><AlertTriangle size={11} className="text-rose-400" /></span>}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {ms.slice(0, 3).map(mn => { const opConf = conf?.some(c => mn.operators?.includes(c.op));
                  return <button key={mn.id} onClick={() => setModal({ type: "mission", item: mn })}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] t2"
                    style={{ background: sc(mn.status) + "22", borderLeft: `2px solid ${opConf ? "#f43f5e" : sc(mn.status)}` }}
                    title={`${mn.name} — ${(mn.operators || []).map(o => nameOf("users", o)).join(", ") || "unassigned"}`}>{mn.name}</button>; })}
                {ms.length > 3 && <button onClick={() => goManage("missions")} className="px-1 text-[10px] t4">+{ms.length - 3} more</button>}
              </div>
            </div>;
          })}
        </div>
      </div>
      <div className="space-y-4">
        <Panel title="Double-booking" icon={AlertTriangle}>
          {monthConflicts.length === 0 ? <p className="py-2 text-sm t4">No crew conflicts this month.</p>
            : <div className="space-y-2">{monthConflicts.map(([date, list]) => list.map((c, i) => (
              <div key={date + i} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
                <div className="text-xs font-medium text-rose-400">{nameOf("users", c.op)} double-booked</div>
                <div className="font-mono text-[11px] t3">{date}</div>
                <div className="mt-1 text-[11px] t2">{c.list.map(mn => mn.name).join(" · ")}</div>
              </div>)))}</div>}
        </Panel>
        <Panel title="This month" icon={CalendarDays}>
          <Kv k="Missions" v={monthMissions} /><Kv k="Crew conflicts" v={monthConflicts.reduce((s, [, l]) => s + l.length, 0)} />
        </Panel>
      </div>
    </div>
  </>);
}

/* ============================ airspace ============================ */
const TILE = {
  street: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, label: "Street" },
  aerial: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, label: "Aerial" },
  sectional: { url: (z, x, y) => `https://wms.chartbundle.com/tms/1.0.0/sec/${z}/${x}/${y}.png?origin=nw`, label: "Sectional" },
};
const lon2t = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2t = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
const t2lon = (x, z) => x / 2 ** z * 360 - 180;
const t2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

function TileMap({ basemap, center, zoom, markers, onPan }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const drag = useRef(null);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  const z = zoom;
  const cx = lon2t(center.lon, z), cy = lat2t(center.lat, z);
  const cols = Math.ceil(size.w / 256) + 2, rows = Math.ceil(size.h / 256) + 2;
  const tiles = [];
  for (let dx = -Math.ceil(cols / 2); dx <= Math.ceil(cols / 2); dx++)
    for (let dy = -Math.ceil(rows / 2); dy <= Math.ceil(rows / 2); dy++) {
      const tx = Math.floor(cx) + dx, ty = Math.floor(cy) + dy, max = 2 ** z;
      if (tx < 0 || ty < 0 || tx >= max || ty >= max) continue;
      const px = (tx - cx) * 256 + size.w / 2, py = (ty - cy) * 256 + size.h / 2;
      tiles.push({ tx, ty, px, py });
    }
  const proj = (lat, lon) => ({ left: (lon2t(lon, z) - cx) * 256 + size.w / 2, top: (lat2t(lat, z) - cy) * 256 + size.h / 2 });
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, cx, cy }; };
  const onMove = (e) => { if (!drag.current) return; const ndx = (e.clientX - drag.current.x) / 256, ndy = (e.clientY - drag.current.y) / 256;
    onPan({ lat: t2lat(drag.current.cy - ndy, z), lon: t2lon(drag.current.cx - ndx, z) }); };
  const onUp = () => { drag.current = null; };
  return <div ref={ref} className="relative h-full w-full overflow-hidden select-none" style={{ cursor: "grab", background: "#0b1320" }}
    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
    {tiles.map(t => <img key={`${t.tx}-${t.ty}`} alt="" draggable={false} src={TILE[basemap].url(z, t.tx, t.ty)}
      onError={e => { e.currentTarget.style.visibility = "hidden"; }}
      style={{ position: "absolute", left: t.px, top: t.py, width: 256, height: 256, pointerEvents: "none" }} />)}
    {markers.map((m, i) => { const p = proj(m.lat, m.lon); if (p.left < -40 || p.left > size.w + 40 || p.top < -40 || p.top > size.h + 40) return null;
      return <div key={i} className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: p.left, top: p.top }}>
        <Plane size={14} style={{ color: "#f59e0b", transform: `rotate(${m.hdg || 0}deg)` }} />
        <span className="mt-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-amber-200">{m.cs} · {m.alt}ft</span></div>; })}
  </div>;
}

function Airspace({ data, setSetting }) {
  const as = data.settings.airspace;
  const [traffic, setTraffic] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trafficMsg, setTrafficMsg] = useState("");
  const [wx, setWx] = useState(null);
  const [wxMsg, setWxMsg] = useState("");
  const [wxLoading, setWxLoading] = useState(false);

  const sample = useMemo(() => ([
    { cs: "N512QR", alt: 1200, hdg: 70, lat: as.lat + 0.04, lon: as.lon + 0.06 },
    { cs: "SKW44", alt: 3400, hdg: 200, lat: as.lat - 0.05, lon: as.lon - 0.03 },
    { cs: "N88PA", alt: 800, hdg: 310, lat: as.lat + 0.02, lon: as.lon - 0.05 },
  ]), [as.lat, as.lon]);

  const fetchTraffic = async () => {
    setLoading(true); setTrafficMsg("");
    try {
      const url = as.trafficSource === "local" && as.localUrl
        ? as.localUrl
        : `https://opendata.adsb.fi/api/v2/lat/${as.lat}/lon/${as.lon}/dist/25`;
      const r = await fetch(url); const j = await r.json();
      const ac = (j.aircraft || j.ac || []).filter(a => a.lat && a.lon).map(a => ({ cs: (a.flight || a.hex || "—").trim(), alt: a.alt_baro || a.alt_geom || 0, hdg: a.track || 0, lat: a.lat, lon: a.lon }));
      setTraffic(ac.length ? ac : sample);
    } catch { setTraffic(sample); setTrafficMsg("Couldn't reach the traffic feed (CORS or offline) — showing sample contacts."); }
    finally { setLoading(false); }
  };
  useEffect(() => { setTraffic(sample); }, [sample]);

  const fetchWx = async () => {
    setWxMsg(""); setWxLoading(true);
    try {
      if (as.wxSource === "open-meteo") {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${as.lat}&longitude=${as.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,visibility,cloud_cover&wind_speed_unit=kn&temperature_unit=fahrenheit`);
        const j = await r.json(); const c = j.current;
        setWx({ wind: `${Math.round(c.wind_direction_10m)}° @ ${Math.round(c.wind_speed_10m)} kt`, temp: `${Math.round(c.temperature_2m)}°F`, vis: `${(c.visibility / 1609).toFixed(1)} sm`, cloud: `${c.cloud_cover}%`, src: "Open-Meteo" });
      } else {
        const relay = (data.settings.relay?.url || "").replace(/\/$/, "");
        const u = relay ? `${relay}/api/metar?ids=${as.station}` : `https://aviationweather.gov/api/data/metar?ids=${as.station}&format=json`;
        const r = await fetch(u); const j = await r.json(); const m = Array.isArray(j) ? j[0] : j;
        if (!m) throw new Error();
        setWx({ wind: m.wdir != null ? `${m.wdir}° @ ${m.wspd} kt` : "—", temp: m.temp != null ? `${m.temp}°C` : "—", vis: m.visib != null ? `${m.visib} sm` : "—", cloud: (m.clouds || []).map(c => c.cover).join(" ") || "—", raw: m.rawOb, src: `METAR ${as.station}` });
      }
    } catch { setWxMsg("Couldn't reach that source from the browser (CORS or offline). Open-Meteo works without a proxy; METAR may need a small backend relay."); }
    finally { setWxLoading(false); }
  };

  return (<>
    <PageHeader title="Airspace" subtitle="Situational awareness for your operating area." />
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 overflow-hidden rounded-xl border bd sf">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bd px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold t1"><Radar size={15} className="acc" />Live airspace</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border bd sf2 p-0.5">{Object.entries(TILE).map(([k, v]) => (
              <button key={k} onClick={() => setSetting(["airspace", "basemap"], k)} className={`rounded px-2 py-0.5 text-xs ${as.basemap === k ? "accbg" : "t3"}`}>{v.label}</button>))}</div>
            <Btn onClick={fetchTraffic}><RefreshCw size={13} className={loading ? "animate-spin" : ""} />ADS-B</Btn>
          </div>
        </div>
        <div className="relative h-80">
          <TileMap basemap={as.basemap} center={{ lat: as.lat, lon: as.lon }} zoom={as.zoom} markers={traffic}
            onPan={(c) => { setSetting(["airspace", "lat"], +c.lat.toFixed(4)); setSetting(["airspace", "lon"], +c.lon.toFixed(4)); }} />
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button onClick={() => setSetting(["airspace", "zoom"], Math.min(15, as.zoom + 1))} className="grid h-7 w-7 place-items-center rounded bg-black/60 text-white"><PlusIcon size={14} /></button>
            <button onClick={() => setSetting(["airspace", "zoom"], Math.max(5, as.zoom - 1))} className="grid h-7 w-7 place-items-center rounded bg-black/60 text-white"><Minus size={14} /></button>
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-slate-200">
            {as.lat.toFixed(3)}, {as.lon.toFixed(3)} · z{as.zoom} · {traffic.length} contacts {as.trafficSource === "local" ? "(local)" : "(adsb.fi)"}
          </div>
        </div>
        {trafficMsg && <p className="border-t bd px-4 py-1.5 text-[11px] text-amber-500">{trafficMsg}</p>}
      </div>
      <div className="space-y-4">
        <Panel title="Traffic source" icon={Signal}>
          <Field label="Source"><Select value={as.trafficSource} onChange={e => setSetting(["airspace", "trafficSource"], e.target.value)}>
            <option value="api">API — adsb.fi (primary)</option><option value="local">Local receiver (fallback)</option></Select></Field>
          {as.trafficSource === "local" && <div className="mt-2"><Field label="Local feed URL"><TextInput value={as.localUrl} onChange={e => setSetting(["airspace", "localUrl"], e.target.value)} placeholder="http://piaware.local/data/aircraft.json" /></Field></div>}
          <p className="pt-2 text-[11px] t4">API is primary; switch to local for your dump1090/PiAware tar1090 JSON when on-network.</p>
        </Panel>
        <Panel title="Weather" icon={Wind} right={<Btn onClick={fetchWx}><RefreshCw size={12} className={wxLoading ? "animate-spin" : ""} />Fetch</Btn>}>
          <Field label="Source"><Select value={as.wxSource} onChange={e => setSetting(["airspace", "wxSource"], e.target.value)}>
            <option value="open-meteo">Online — Open-Meteo (coords)</option><option value="metar">Airport METAR (ICAO)</option></Select></Field>
          {as.wxSource === "metar" && <div className="mt-2">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider t4">Stations</span>
            <div className="flex flex-wrap gap-1">
              {(as.stations || []).map(s => (
                <span key={s} className={`group inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${as.station === s ? "accbg" : "bd t3"}`}>
                  <button onClick={() => setSetting(["airspace", "station"], s)}>{s}</button>
                  <button onClick={() => { const next = (as.stations || []).filter(x => x !== s); setSetting(["airspace", "stations"], next); if (as.station === s && next[0]) setSetting(["airspace", "station"], next[0]); }}
                    className="opacity-50 hover:opacity-100"><X size={11} /></button>
                </span>))}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input className="ipt" placeholder="Add ICAO (e.g. KORF)" onKeyDown={e => {
                if (e.key !== "Enter") return; const v = e.target.value.trim().toUpperCase();
                if (v && !(as.stations || []).includes(v)) { setSetting(["airspace", "stations"], [...(as.stations || []), v]); setSetting(["airspace", "station"], v); }
                e.target.value = "";
              }} />
            </div>
            <p className="pt-1 text-[11px] t4">Active: <span className="acc font-mono">{as.station}</span> · click a tag to switch, Enter to add.</p>
          </div>}
          <div className="mt-3 space-y-0.5">
            <Kv k="Wind" v={wx?.wind || "—"} /><Kv k="Temp" v={wx?.temp || "—"} /><Kv k="Visibility" v={wx?.vis || "—"} /><Kv k="Cloud" v={wx?.cloud || "—"} />
            {wx?.src && <p className="pt-1 text-[11px] acc">{wx.src}</p>}
            {wx?.raw && <p className="pt-1 font-mono text-[10px] t4">{wx.raw}</p>}
            {wxMsg && <p className="pt-1 text-[11px] text-amber-500">{wxMsg}</p>}
          </div>
        </Panel>
        <Panel title="Operating area" icon={MapPin}>
          <Kv k="Class" v="G (uncontrolled)" /><Kv k="Floor / ceiling" v="SFC – 400 ft AGL" />
          <Kv k="Active LAANC" v={data.laanc.filter(l => l.status === "Approved").length + " approved"} /><Kv k="TFRs" v="None on file" />
        </Panel>
      </div>
    </div>
  </>);
}

/* ============================ ops center ============================ */
const STREAM_TYPES = {
  mp4: "Direct video (MP4/WebM)", hls: "HLS (.m3u8)", mjpeg: "MJPEG stream",
  embed: "Embed / YouTube (iframe)", webrtc: "WebRTC (gateway)", rtsp: "RTSP (needs gateway)",
};
function StreamPlayer({ type, url }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (type !== "hls" || !url) return;
    const v = videoRef.current; if (!v) return;
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = url; return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";
    s.onload = () => { if (window.Hls && window.Hls.isSupported()) { const h = new window.Hls(); h.loadSource(url); h.attachMedia(v); } };
    document.body.appendChild(s);
    return () => { try { document.body.removeChild(s); } catch {} };
  }, [type, url]);

  if (!url) return <Placeholder label="No stream connected" hint="Add a stream URL above" />;
  if (type === "mp4" || type === "hls") return <video ref={videoRef} src={type === "mp4" ? url : undefined} controls autoPlay muted playsInline className="h-full w-full bg-black" />;
  if (type === "mjpeg") return <img src={url} alt="stream" className="h-full w-full object-contain bg-black" />;
  if (type === "embed") return <iframe src={url} className="h-full w-full bg-black" allow="autoplay; encrypted-media" allowFullScreen title="stream" />;
  return <Placeholder label={`${STREAM_TYPES[type]}`} hint="Browsers can't play this directly — point it at a WebRTC/HLS gateway (e.g. MediaMTX) and use that URL." />;
}
function Placeholder({ label, hint }) {
  return <div className="grid h-full w-full place-items-center" style={{ background: "repeating-linear-gradient(45deg,#0a0f16,#0a0f16 10px,#0c121b 10px,#0c121b 20px)" }}>
    <div className="text-center"><Eye size={26} className="mx-auto text-slate-600" /><p className="mt-2 text-sm text-slate-400">{label}</p><p className="px-6 text-xs text-slate-500">{hint}</p></div></div>;
}
/* normalized telemetry client: simulator | raw WebSocket | MQTT-over-WS */
function useTelemetry({ source, wsUrl, mqttUrl, mqttTopic }) {
  const [frame, setFrame] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [running, setRunning] = useState(false);

  const norm = (m) => ({
    alt: pick(m, ["alt", "altitude", "alt_msl", "relative_alt"]),
    spd: pick(m, ["spd", "groundspeed", "ground_speed", "gs"]),
    hdg: pick(m, ["hdg", "heading", "yaw"]),
    dist: pick(m, ["dist", "dist_home", "distance_home"]),
    sats: pick(m, ["sats", "satellites", "satellites_visible"]),
    mode: pick(m, ["mode", "flight_mode"]),
    batt: pick(m, ["batt", "battery", "battery_pct", "battery_remaining"]),
    volt: pick(m, ["volt", "voltage", "battery_voltage"]),
    rc: pick(m, ["rc", "rc_link", "rssi"]),
    vid: pick(m, ["vid", "vid_link", "video_link"]),
    lat: pick(m, ["lat", "latitude"]), lon: pick(m, ["lon", "longitude", "lng"]),
    ts: Date.now(),
  });

  useEffect(() => {
    if (!running) { setStatus("idle"); return; }
    let cleanup = () => {};
    if (source === "sim") {
      setStatus("live");
      const st = { alt: 80, spd: 11, hdg: 90, dist: 0, batt: 98, lat: 38.95, lon: -77.45 }; let t = 0;
      const id = setInterval(() => {
        t++; st.hdg = (st.hdg + 2) % 360; st.alt = 80 + 40 * Math.sin(t / 12); st.spd = 10 + 3 * Math.sin(t / 7);
        st.dist = Math.min(950, st.dist + st.spd); st.batt = Math.max(18, st.batt - 0.05);
        setFrame(norm({ ...st, sats: 14, mode: "AUTO", volt: (st.batt / 100 * 4.2 * 6).toFixed(1), rc: -62 - (Math.random() * 6 | 0), vid: -70 - (Math.random() * 8 | 0) }));
      }, 500);
      cleanup = () => clearInterval(id);
    } else if (source === "ws") {
      if (!wsUrl) { setStatus("error"); return; }
      setStatus("connecting");
      try { const ws = new WebSocket(wsUrl);
        ws.onopen = () => setStatus("live");
        ws.onmessage = (e) => { try { setFrame(norm(JSON.parse(e.data))); } catch {} };
        ws.onerror = () => setStatus("error");
        ws.onclose = () => setStatus(s => (s === "live" ? "idle" : "error"));
        cleanup = () => ws.close();
      } catch { setStatus("error"); }
    } else if (source === "mqtt") {
      if (!mqttUrl) { setStatus("error"); return; }
      setStatus("connecting");
      const connect = () => {
        try { const c = window.mqtt.connect(mqttUrl);
          c.on("connect", () => { setStatus("live"); c.subscribe(mqttTopic || "#"); });
          c.on("message", (_t, payload) => { try { setFrame(norm(JSON.parse(payload.toString()))); } catch {} });
          c.on("error", () => setStatus("error"));
          cleanup = () => { try { c.end(true); } catch {} };
        } catch { setStatus("error"); }
      };
      if (window.mqtt) connect();
      else { const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/mqtt/5.10.1/mqtt.min.js";
        s.onload = connect; s.onerror = () => setStatus("error"); document.body.appendChild(s);
        cleanup = () => { try { document.body.removeChild(s); } catch {} };
      }
    }
    return () => cleanup();
  }, [running, source, wsUrl, mqttUrl, mqttTopic]);

  return { frame, status, running, start: () => setRunning(true), stop: () => { setRunning(false); setFrame(null); } };
}
function pick(o, keys) { for (const k of keys) if (o[k] != null) return o[k]; return null; }
const TEL_SOURCES = { sim: "Simulator (demo)", ws: "WebSocket (JSON frames)", mqtt: "MQTT over WebSocket" };

function OpsCenter({ data, nameOf, setSetting }) {
  const ops = data.settings.ops, tel = data.settings.telemetry;
  const [draft, setDraft] = useState(ops.url);
  const t = useTelemetry(tel);
  const f = t.frame;
  const live = data.flights.find(fl => fl.status === "Active") || data.flights[0];
  const ac = live ? nameOf("aircraft", live.aircraft) : "—";
  const v = (x, u = "", d = 0) => (x == null ? "—" : `${(+x).toFixed(d)}${u}`);
  const statusColor = { idle: "#64748b", connecting: "#f59e0b", live: "#1776bb", error: "#f43f5e" }[t.status];
  const statusLabel = { idle: "Idle", connecting: "Connecting…", live: "Live", error: "No signal" }[t.status];

  return (<>
    <PageHeader title="OPS Center" subtitle="Live video and telemetry from active aircraft." />

    {/* video source */}
    <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border bd sf p-4">
      <div className="w-52"><Field label="Video type"><Select value={ops.type} onChange={e => setSetting(["ops", "type"], e.target.value)}>
        {Object.entries(STREAM_TYPES).map(([k, vv]) => <option key={k} value={k}>{vv}</option>)}</Select></Field></div>
      <div className="min-w-[240px] flex-1"><Field label="Stream URL"><div className="flex items-center gap-2">
        <Link2 size={15} className="t4" /><TextInput value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://…/stream.m3u8" /></div></Field></div>
      <Btn variant="primary" onClick={() => setSetting(["ops", "url"], draft)}>Connect video</Btn>
      {ops.url && <Btn onClick={() => { setSetting(["ops", "url"], ""); setDraft(""); }}>Clear</Btn>}
    </div>

    {/* telemetry source */}
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bd sf p-4">
      <div className="w-52"><Field label="Telemetry source"><Select value={tel.source} onChange={e => setSetting(["telemetry", "source"], e.target.value)}>
        {Object.entries(TEL_SOURCES).map(([k, vv]) => <option key={k} value={k}>{vv}</option>)}</Select></Field></div>
      {tel.source === "ws" && <div className="min-w-[240px] flex-1"><Field label="WebSocket URL"><TextInput value={tel.wsUrl} onChange={e => setSetting(["telemetry", "wsUrl"], e.target.value)} placeholder="wss://relay.yourdomain.com/telemetry" /></Field></div>}
      {tel.source === "mqtt" && <>
        <div className="min-w-[200px] flex-1"><Field label="Broker (ws/wss)"><TextInput value={tel.mqttUrl} onChange={e => setSetting(["telemetry", "mqttUrl"], e.target.value)} placeholder="wss://broker:8083/mqtt" /></Field></div>
        <div className="w-48"><Field label="Topic"><TextInput value={tel.mqttTopic} onChange={e => setSetting(["telemetry", "mqttTopic"], e.target.value)} placeholder="uas/+/telemetry" /></Field></div></>}
      <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: statusColor + "22", color: statusColor }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />{statusLabel}</span>
      {t.running ? <Btn onClick={t.stop}><Square size={13} />Stop</Btn> : <Btn variant="primary" onClick={t.start}><Play size={13} />Connect telemetry</Btn>}
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 overflow-hidden rounded-xl border bd sf">
        <div className="flex items-center justify-between border-b bd px-4 py-2.5"><h3 className="flex items-center gap-2 text-sm font-semibold t1"><Video size={15} className="acc" />Live video — {ac}</h3>
          <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ background: ops.url ? "#1776bb26" : "#f43f5e26", color: ops.url ? "#1776bb" : "#f43f5e" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ops.url ? "#1776bb" : "#f43f5e" }} />{ops.url ? "Connected" : "Offline"}</span></div>
        <div className="relative aspect-video bg-black"><StreamPlayer type={ops.type} url={ops.url} />
          <div className="pointer-events-none absolute inset-0 p-3 font-mono text-[11px]" style={{ color: "#7cc3eecc", textShadow: "0 1px 3px rgba(0,0,0,.8)" }}>
            <div className="flex justify-between"><span>ALT {v(f?.alt, " m")}</span><span>SPD {v(f?.spd, " m/s", 1)}</span><span>HDG {v(f?.hdg, "°")}</span></div>
            <div className="absolute bottom-3 left-3">BAT {v(f?.batt, "%")}</div><div className="absolute bottom-3 right-3">LINK {v(f?.rc, " dBm")}</div></div></div>
      </div>
      <div className="space-y-4">
        <Panel title="Telemetry" icon={Gauge} right={<span className="text-[10px] uppercase tracking-wide" style={{ color: statusColor }}>{statusLabel}</span>}>
          <Kv k="Altitude" v={v(f?.alt, " m", 1)} /><Kv k="Ground speed" v={v(f?.spd, " m/s", 1)} /><Kv k="Heading" v={v(f?.hdg, " °")} />
          <Kv k="Distance home" v={v(f?.dist, " m")} /><Kv k="Satellites" v={f?.sats ?? "—"} /><Kv k="Flight mode" v={f?.mode ?? "—"} /></Panel>
        <Panel title="Link & power" icon={Wifi}>
          <Kv k="RC link" v={v(f?.rc, " dBm")} /><Kv k="Video link" v={v(f?.vid, " dBm")} /><Kv k="Battery" v={v(f?.batt, " %")} /><Kv k="Voltage" v={v(f?.volt, " V", 1)} />
          <p className="pt-1 text-[11px] t4">Publishes a normalized JSON frame; companion (Pi) → MQTT/WS via the relay or broker.</p></Panel>
      </div>
    </div>
  </>);
}

/* ============================ reporting ============================ */
const RANGE_PRESETS = { last7: { label: "Last 7 days", days: 7 }, last30: { label: "Last 30 days", days: 30 }, month: { label: "This month", month: true }, quarter: { label: "This quarter", quarter: true }, custom: { label: "Custom range", custom: true } };
function resolveRange(preset, from, to) {
  const now = new Date(); const iso = d => d.toISOString().slice(0, 10);
  if (preset === "custom") return { from, to };
  if (preset === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (preset === "quarter") { const q = Math.floor(now.getMonth() / 3) * 3; return { from: iso(new Date(now.getFullYear(), q, 1)), to: iso(now) }; }
  const d = new Date(now); d.setDate(d.getDate() - (RANGE_PRESETS[preset].days - 1)); return { from: iso(d), to: iso(now) };
}
const ENTITIES = ["flights", "missions", "aircraft", "batteries", "maintenance", "incidents", "waivers", "procedures"];

function Reporting({ data, nameOf, update }) {
  const [pane, setPane] = useState("builder");
  const [entity, setEntity] = useState("flights");
  const [preset, setPreset] = useState("last30");
  const [from, setFrom] = useState("2026-06-01");
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = preset === "custom" ? { from, to } : resolveRange(preset);

  const report = useMemo(() => buildReport(entity, data, range, nameOf), [entity, range.from, range.to, data]);
  const dateless = entity === "aircraft" || entity === "batteries" || entity === "waivers" || entity === "procedures";

  return (<>
    <PageHeader title="Reporting" subtitle="Build reports across entities and time spans, export, and schedule." />
    <div className="mb-5 flex gap-2 border-b bd">{[["builder", "Report builder"], ["scheduled", "Scheduled exports"]].map(([k, l]) => (
      <button key={k} onClick={() => setPane(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${pane === k ? "acc" : "t3"}`} style={{ borderColor: pane === k ? "var(--accent)" : "transparent" }}>{l}</button>))}</div>

    {pane === "builder" ? <>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bd sf p-4">
        <div className="w-44"><Field label="Report"><Select value={entity} onChange={e => setEntity(e.target.value)}>{ENTITIES.map(x => <option key={x} value={x}>{cap(x)}</option>)}</Select></Field></div>
        <div className="w-44"><Field label="Time span"><Select value={preset} onChange={e => setPreset(e.target.value)} disabled={dateless}>{Object.entries(RANGE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field></div>
        {preset === "custom" && !dateless && <><div className="w-40"><Field label="From"><TextInput type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field></div>
          <div className="w-40"><Field label="To"><TextInput type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div></>}
        <div className="ml-auto flex gap-2"><Btn onClick={() => exportCsv(report)}><Download size={14} />CSV</Btn>
          <Btn variant="primary" onClick={() => exportPdf(report, range)}><FileBarChart size={14} />PDF</Btn></div>
      </div>
      {dateless && <p className="-mt-2 mb-3 text-xs t4">{cap(entity)} reports summarize current state; the time span filters related activity (e.g. flights in range).</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{report.kpis.map(k => <Stat key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} />)}</div>
      {report.chart.data.length > 0 && <div className="mb-4 rounded-xl border bd sf p-4"><h3 className="mb-3 text-sm font-semibold t1">{report.chart.title}</h3>
        <div style={{ width: "100%", height: 220 }}><ResponsiveContainer><BarChart data={report.chart.data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" vertical={false} /><XAxis dataKey="name" tick={{ fill: "var(--t4)", fontSize: 11 }} axisLine={{ stroke: "var(--bd)" }} tickLine={false} />
          <YAxis tick={{ fill: "var(--t4)", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--bd)", borderRadius: 8, color: "var(--t1)", fontSize: 12 }} cursor={{ fill: "#88888818" }} />
          <Bar dataKey="value" fill="#1776bb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>}
      {report.rows.length === 0 ? <Empty icon={FileBarChart} label="No records in range" hint="Adjust the report or time span." />
        : <Table cols={report.cols}>{report.rows.map((r, i) => <Row key={i}>{r.map((c, j) => <Td key={j} mono={typeof c === "object" ? false : j === 0}>{c}</Td>)}</Row>)}</Table>}
    </> : <Scheduled {...{ data, nameOf, update }} />}
  </>);
}

function buildReport(entity, data, range, nameOf) {
  const inRange = d => d >= range.from && d <= range.to;
  const tally = (arr, keyFn) => { const m = {}; arr.forEach(r => { const k = keyFn(r) || "—"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).map(([name, value]) => ({ name, value })); };

  if (entity === "flights") {
    const rows = data.flights.filter(f => inRange(f.date || "")); const min = rows.reduce((s, f) => s + (f.dur || 0), 0);
    const cm = {}; rows.forEach(f => { const k = nameOf("aircraft", f.aircraft); cm[k] = (cm[k] || 0) + (f.dur || 0); });
    return { entity, cols: ["Date", "Aircraft", "RPIC", "Dur (min)", "Max alt", "Status"], rows: rows.map(r => [r.date, nameOf("aircraft", r.aircraft), nameOf("users", r.operator), r.dur, r.maxAlt, <Badge value={r.status} />]),
      raw: rows.map(r => [r.date, nameOf("aircraft", r.aircraft), nameOf("users", r.operator), r.dur, r.maxAlt, r.status]),
      kpis: [{ label: "Flights", value: rows.length, icon: Plane, tone: "teal" }, { label: "Flight hours", value: (min / 60).toFixed(1), icon: Clock, tone: "slate" }, { label: "Aircraft used", value: new Set(rows.map(r => r.aircraft)).size, icon: Layers, tone: "amber" }, { label: "Avg duration", value: rows.length ? Math.round(min / rows.length) + "m" : "0m", icon: TrendingUp, tone: "slate" }],
      chart: { title: "Flight minutes by aircraft", data: Object.entries(cm).map(([name, value]) => ({ name, value })) } };
  }
  if (entity === "missions") {
    const rows = data.missions.filter(m => inRange(m.date || ""));
    return { entity, cols: ["Date", "Name", "Location", "Status", "Risk"], rows: rows.map(r => [r.date, r.name, r.location, <Badge value={r.status} />, r.risk]),
      raw: rows.map(r => [r.date, r.name, r.location, r.status, r.risk]),
      kpis: [{ label: "Missions", value: rows.length, icon: Map, tone: "teal" }, { label: "Completed", value: rows.filter(r => r.status === "Completed").length, icon: Activity, tone: "teal" }, { label: "Active", value: rows.filter(r => r.status === "Active").length, icon: Signal, tone: "amber" }, { label: "High risk", value: rows.filter(r => r.risk === "High").length, icon: ShieldAlert, tone: "rose" }],
      chart: { title: "Missions by status", data: tally(rows, r => r.status) } };
  }
  if (entity === "aircraft") {
    const rows = data.aircraft.map(a => { const fl = data.flights.filter(f => f.aircraft === a.id && inRange(f.date || "")); const min = fl.reduce((s, f) => s + (f.dur || 0), 0);
      return { a, flights: fl.length, min }; });
    return { entity, cols: ["Tail", "Model", "Total hrs", "Cycles", "Flights (range)", "Min (range)", "Status"], rows: rows.map(({ a, flights, min }) => [a.tail, a.model, a.hours, a.cycles, flights, min, <Badge value={a.status} />]),
      raw: rows.map(({ a, flights, min }) => [a.tail, a.model, a.hours, a.cycles, flights, min, a.status]),
      kpis: [{ label: "Aircraft", value: data.aircraft.length, icon: Plane, tone: "teal" }, { label: "Available", value: data.aircraft.filter(a => a.status === "Available").length, icon: Activity, tone: "teal" }, { label: "Grounded", value: data.aircraft.filter(a => a.status === "Grounded").length, icon: AlertTriangle, tone: "rose" }, { label: "Fleet hours", value: data.aircraft.reduce((s, a) => s + (a.hours || 0), 0).toFixed(0), icon: Clock, tone: "slate" }],
      chart: { title: "Total hours by aircraft", data: data.aircraft.map(a => ({ name: a.tail, value: a.hours })) } };
  }
  if (entity === "batteries") {
    const use = {}; data.flights.filter(f => inRange(f.date || "")).forEach(f => (f.batteries || []).forEach(b => { use[b] = (use[b] || 0) + 1; }));
    return { entity, cols: ["Label", "Chemistry", "Capacity (Wh)", "Cycles", "Health %", "Uses (range)", "Status"], rows: data.batteries.map(b => [b.label, b.chem, b.capacity, b.cycles, b.health, use[b.id] || 0, <Badge value={b.status} />]),
      raw: data.batteries.map(b => [b.label, b.chem, b.capacity, b.cycles, b.health, use[b.id] || 0, b.status]),
      kpis: [{ label: "Batteries", value: data.batteries.length, icon: Battery, tone: "teal" }, { label: "Charged", value: data.batteries.filter(b => b.status === "Charged").length, icon: BatteryCharging, tone: "teal" }, { label: "Below 80%", value: data.batteries.filter(b => b.health < 80).length, icon: AlertTriangle, tone: "rose" }, { label: "Avg health", value: Math.round(data.batteries.reduce((s, b) => s + b.health, 0) / (data.batteries.length || 1)) + "%", icon: TrendingUp, tone: "slate" }],
      chart: { title: "Health % by battery", data: data.batteries.map(b => ({ name: b.label, value: b.health })) } };
  }
  if (entity === "maintenance") {
    const rows = data.maintenance.filter(m => inRange(m.date || ""));
    return { entity, cols: ["Date", "Aircraft", "Type", "Technician"], rows: rows.map(r => [r.date, nameOf("aircraft", r.aircraft), r.type, r.tech]),
      raw: rows.map(r => [r.date, nameOf("aircraft", r.aircraft), r.type, r.tech]),
      kpis: [{ label: "Records", value: rows.length, icon: Wrench, tone: "teal" }, { label: "Repairs", value: rows.filter(r => r.type === "Repair").length, icon: Wrench, tone: "amber" }, { label: "Inspections", value: rows.filter(r => r.type === "Inspection").length, icon: ClipboardCheck, tone: "slate" }, { label: "Aircraft serviced", value: new Set(rows.map(r => r.aircraft)).size, icon: Plane, tone: "slate" }],
      chart: { title: "Maintenance by type", data: tally(rows, r => r.type) } };
  }
  if (entity === "incidents") {
    const rows = data.incidents.filter(i => inRange(i.date || ""));
    return { entity, cols: ["Date", "Aircraft", "Severity", "Description"], rows: rows.map(r => [r.date, nameOf("aircraft", r.aircraft), r.severity, r.desc]),
      raw: rows.map(r => [r.date, nameOf("aircraft", r.aircraft), r.severity, r.desc]),
      kpis: [{ label: "Incidents", value: rows.length, icon: AlertTriangle, tone: "rose" }, { label: "Major", value: rows.filter(r => r.severity === "Major").length, icon: CircleAlert, tone: "rose" }, { label: "Moderate", value: rows.filter(r => r.severity === "Moderate").length, icon: AlertTriangle, tone: "amber" }, { label: "Minor", value: rows.filter(r => r.severity === "Minor").length, icon: CircleDot, tone: "slate" }],
      chart: { title: "Incidents by severity", data: tally(rows, r => r.severity) } };
  }
  if (entity === "waivers") {
    const now = new Date(); const list = data.waivers || [];
    const expired = list.filter(w => { const d = daysUntil(w.expiry, now); return d != null && d < 0; });
    const soon = list.filter(w => { const d = daysUntil(w.expiry, now); return d != null && d >= 0 && d < 60; });
    return { entity, cols: ["Name", "Type", "Scope", "Number", "Expiry", "Status"], rows: list.map(w => [w.name, w.type, w.scope, w.number, w.expiry, <Badge value={daysUntil(w.expiry, now) < 0 ? "Expired" : w.status} />]),
      raw: list.map(w => [w.name, w.type, w.scope, w.number, w.expiry, w.status]),
      kpis: [{ label: "Waivers / COAs", value: list.length, icon: BadgeCheck, tone: "teal" }, { label: "Active", value: list.filter(w => w.status === "Active").length, icon: Activity, tone: "teal" }, { label: "Expiring < 60d", value: soon.length, icon: Clock, tone: "amber" }, { label: "Expired", value: expired.length, icon: AlertTriangle, tone: "rose" }],
      chart: { title: "Waivers by type", data: tally(list, w => w.type) } };
  }
  // procedures
  const procRows = [
    ...data.workflows.map(w => ["Workflow", w.name, `${w.steps.length} steps`]),
    ...data.checklists.map(c => ["Checklist", c.name, `${c.items.length} items`]),
    ...data.riskAssessments.map(r => ["Risk assessment", r.name, r.level]),
  ];
  return { entity, cols: ["Kind", "Name", "Detail"], rows: procRows, raw: procRows,
    kpis: [{ label: "Procedures", value: procRows.length, icon: ClipboardCheck, tone: "teal" }, { label: "Workflows", value: data.workflows.length, icon: Workflow, tone: "amber" }, { label: "Checklists", value: data.checklists.length, icon: ListChecks, tone: "slate" }, { label: "Risk assessments", value: data.riskAssessments.length, icon: ShieldAlert, tone: "rose" }],
    chart: { title: "Procedures by kind", data: [{ name: "Workflows", value: data.workflows.length }, { name: "Checklists", value: data.checklists.length }, { name: "Risk", value: data.riskAssessments.length }] } };
}

function Scheduled({ data, nameOf, update }) {
  const blank = { name: "", entity: "flights", range: "last7", freq: "Weekly", format: "PDF", recipients: "" };
  const [form, setForm] = useState(blank); const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const list = data.scheduledReports || [];
  const add = () => { if (!form.name.trim()) return; update("scheduledReports", l => [{ ...form, id: uid("SR"), lastRun: "" }, ...(l || [])]); setForm(blank); };
  const del = id => update("scheduledReports", l => l.filter(s => s.id !== id));
  const runNow = s => {
    try {
      const r = resolveRange(s.range); const rep = buildReport(s.entity, data, r, nameOf);
      if (s.format === "CSV") exportCsv(rep); else exportPdf(rep, r);
      update("scheduledReports", l => l.map(x => x.id === s.id ? { ...x, lastRun: new Date().toLocaleString() } : x));
    } catch { alert("Couldn't generate that report. Please try again."); }
  };
  const relay = (data.settings.relay?.url || "").replace(/\/$/, "");
  const sendRelay = async s => {
    try { const res = await fetch(`${relay}/api/reports/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      update("scheduledReports", l => l.map(x => x.id === s.id ? { ...x, lastRun: new Date().toLocaleString() + " · relay" } : x));
      alert(res.ok ? "Queued on relay for delivery." : "Relay returned an error.");
    } catch { alert("Couldn't reach the relay — set its URL in Settings."); }
  };
  return (<>
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bd sf p-4">
      <div className="w-48"><Field label="Report name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} placeholder="Weekly flight log" /></Field></div>
      <div className="w-36"><Field label="Report"><Select value={form.entity} onChange={e => set("entity", e.target.value)}>{ENTITIES.map(x => <option key={x} value={x}>{cap(x)}</option>)}</Select></Field></div>
      <div className="w-36"><Field label="Span"><Select value={form.range} onChange={e => set("range", e.target.value)}>{Object.entries(RANGE_PRESETS).filter(([k]) => k !== "custom").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field></div>
      <div className="w-32"><Field label="Frequency"><Select value={form.freq} onChange={e => set("freq", e.target.value)}>{["Daily", "Weekly", "Monthly"].map(x => <option key={x}>{x}</option>)}</Select></Field></div>
      <div className="w-28"><Field label="Format"><Select value={form.format} onChange={e => set("format", e.target.value)}>{["PDF", "CSV"].map(x => <option key={x}>{x}</option>)}</Select></Field></div>
      <div className="min-w-[180px] flex-1"><Field label="Recipients"><TextInput value={form.recipients} onChange={e => set("recipients", e.target.value)} placeholder="ops@yourdomain.com" /></Field></div>
      <Btn variant="primary" onClick={add}><Plus size={14} />Add schedule</Btn>
    </div>
    <p className="mb-3 flex items-center gap-1.5 text-xs t4"><CircleAlert size={13} />Schedules persist here; unattended delivery runs once a backend job + email/storage is connected in Settings. "Run now" generates immediately.</p>
    {list.length === 0 ? <Empty icon={Clock} label="No scheduled reports" hint="Add one above to define recurring exports." />
      : <Table cols={["Name", "Report", "Span", "Frequency", "Format", "Recipients", "Last run", ""]}>{list.map(s => <Row key={s.id}>
        <Td>{s.name}</Td><Td>{cap(s.entity)}</Td><Td>{RANGE_PRESETS[s.range]?.label}</Td><Td>{s.freq}</Td><Td mono>{s.format}</Td><Td mono>{s.recipients || "—"}</Td><Td mono>{s.lastRun || "never"}</Td>
        <Td><div className="flex justify-end gap-1"><Btn onClick={() => runNow(s)}>Run now</Btn>{relay && <Btn onClick={() => sendRelay(s)}><Server size={13} />Send</Btn>}<button onClick={() => del(s.id)} className="rounded p-1.5 t4 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 size={14} /></button></div></Td></Row>)}</Table>}
  </>);
}

function exportCsv(report) {
  try {
    const csv = [report.cols, ...report.raw].map(row => row.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${report.entity}-report.csv`; a.click();
  } catch { alert("Couldn't generate the CSV export. Please try again."); }
}
function exportPdf(report, range) {
  const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const maxV = Math.max(1, ...report.chart.data.map(d => d.value));
  const kpis = report.kpis.map(k => `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div></div>`).join("");
  const bars = report.chart.data.map(d => `<div class="br"><span class="bl">${esc(d.name)}</span><span class="bt"><span class="bf" style="width:${(d.value / maxV) * 100}%"></span></span><span class="bv">${esc(d.value)}</span></div>`).join("");
  const rows = report.raw.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cap(report.entity))} report</title><style>
    *{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:40px;font-size:12px}
    .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #125a8a;padding-bottom:12px;margin-bottom:18px}
    .brand{font-size:18px;font-weight:800}.brand small{display:block;font-size:10px;letter-spacing:2px;color:#125a8a;font-weight:600;text-transform:uppercase}
    .meta{text-align:right;color:#64748b;font-size:11px;line-height:1.5}h1{font-size:15px;margin:0 0 4px}.sub{color:#64748b;margin:0 0 18px;font-size:11px}
    .kpis{display:flex;gap:10px;margin-bottom:18px}.kpi{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:10px}.kl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8}.kv{font-size:20px;font-weight:700;margin-top:2px}
    .chart{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:18px}.chart h3{margin:0 0 10px;font-size:12px}.br{display:flex;align-items:center;gap:8px;margin:5px 0}.bl{width:130px;font-size:11px;color:#475569}.bt{flex:1;background:#f1f5f9;border-radius:4px;height:14px}.bf{display:block;height:14px;background:#1776bb;border-radius:4px}.bv{width:40px;text-align:right;font-size:11px}
    table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;background:#f8fafc;border-bottom:2px solid #e2e8f0;padding:6px 8px;text-transform:uppercase;font-size:9px;color:#64748b}td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
    .foot{margin-top:24px;color:#94a3b8;font-size:10px;text-align:center}@media print{body{margin:18mm}}</style></head><body>
    <div class="head"><div class="brand">FlightDeck<small>UAS Ops Console</small></div><div class="meta">Generated ${esc(new Date().toLocaleString())}<br>Range: ${esc(range.from)} → ${esc(range.to)}<br>${report.raw.length} records</div></div>
    <h1>${esc(cap(report.entity))} report</h1><p class="sub">Operational summary for the selected period.</p>
    <div class="kpis">${kpis}</div><div class="chart"><h3>${esc(report.chart.title)}</h3>${bars || '<em style="color:#94a3b8">No data</em>'}</div>
    <table><thead><tr>${report.cols.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">Generated by FlightDeck — verify against source logs before official filing.</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`;
  const w = window.open("", "_blank"); if (!w) { alert("Allow pop-ups to export PDF (print dialog → Save as PDF)."); return; }
  w.document.write(html); w.document.close();
}

function StoragePanel({ data, setData }) {
  const [drive, setDrive] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { getDriveHandle().then(h => setDrive(h ? h.name : null)).catch(() => {}); }, []);
  const connect = async () => {
    setMsg("");
    try { setSaveStatus("syncing"); const name = await connectDrive(data); setDrive(name); setSaveStatus("saved"); setMsg("Auto-saving flightdeck.json to this folder."); }
    catch { setSaveStatus("idle"); setMsg(fsSupported ? "Folder access was cancelled or blocked (the preview sandbox blocks it — self-host in Chrome)." : "This browser can't pick folders — use Export/Import, or Chrome/Edge."); }
  };
  const disconnect = async () => { await disconnectDrive(); setDrive(null); setMsg("Back to in-browser storage."); };
  return (
    <Panel title="Storage" icon={HardDrive}>
      <Kv k="Mode" v={drive ? "External drive" : (hasArtifactStore ? "Browser (this app)" : "Browser (local)")} />
      {drive && <Kv k="Folder" v={drive} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {drive ? <Btn onClick={disconnect}>Disconnect drive</Btn>
          : <Btn variant="primary" onClick={connect} disabled={!fsSupported}><HardDrive size={13} />Connect drive folder</Btn>}
        <Btn onClick={() => exportData(data)}><Download size={13} />Export file</Btn>
        <Btn onClick={() => importData(d => setData(ensure(d)))}><Upload size={13} />Import file</Btn>
      </div>
      {msg && <p className="pt-2 text-[11px] acc">{msg}</p>}
      <p className="pt-1 text-[11px] t4">{fsSupported
        ? "Connect a folder on your external drive — the app writes flightdeck.json there on every change and reads it on launch. Chrome/Edge, self-hosted (not this preview)."
        : "Folder auto-save needs Chrome or Edge. Export/Import works in any browser — save flightdeck.json onto your drive and load it back."}</p>
    </Panel>
  );
}
/* ============================ settings ============================ */
function RelayPanel({ data, setSetting }) {
  const url = data.settings.relay?.url || "";
  const [draft, setDraft] = useState(url);
  const [health, setHealth] = useState("");
  const [sync, setSync] = useState("");
  const base = () => (data.settings.relay?.url || draft).replace(/\/$/, "");
  const check = async () => {
    setHealth("checking");
    try { const r = await fetch(`${base()}/health`); setHealth(r.ok ? "ok" : "fail"); }
    catch { setHealth("fail"); }
  };
  const syncNow = async () => {
    setSync("syncing"); setSaveStatus("syncing");
    try {
      const r = await fetch(`${base()}/api/snapshot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error();
      await fetch(`${base()}/api/schedules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.scheduledReports || []) }).catch(() => {});
      setSync("ok"); setSaveStatus("saved"); setTimeout(() => setSync(""), 3000);
    } catch { setSync("fail"); setSaveStatus("error"); }
  };
  return (
    <Panel title="Relay & delivery" icon={Server}>
      <Field label="Relay base URL"><div className="flex gap-1.5">
        <TextInput value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://relay.yourdomain.com" />
      </div></Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={() => { setSetting(["relay", "url"], draft.trim()); check(); }}>Save</Btn>
        <Btn onClick={check}><Plug size={13} />Test</Btn>
        <Btn onClick={syncNow}><RefreshCw size={13} className={sync === "syncing" ? "animate-spin" : ""} />Sync to relay</Btn>
        {health === "ok" && <span className="text-xs acc">Reachable</span>}
        {health === "fail" && <span className="text-xs text-rose-400">No response</span>}
        {health === "checking" && <span className="text-xs t4">Checking…</span>}
        {sync === "ok" && <span className="text-xs acc">Synced to database</span>}
        {sync === "fail" && <span className="text-xs text-rose-400">Sync failed</span>}
      </div>
      <p className="pt-2 text-[11px] t4">Save the URL, Test reachability, then Sync to push records into the relay's database (audited). Powers METAR, scheduled delivery, and the telemetry bridge.</p>
    </Panel>
  );
}
function Settings({ data, setData, setSetting, onReset }) {
  const reset = () => { if (confirm("Reset workspace? This clears your records and returns to the start screen.")) onReset(); };
  const org = data.settings.org;
  const pickLogo = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => { const f = inp.files?.[0]; if (!f) return;
      if (f.size > 1024 * 1024) { alert("Please pick an image under 1 MB."); return; }
      const r = new FileReader(); r.onload = () => setSetting(["org", "logo"], r.result); r.readAsDataURL(f); };
    inp.click();
  };
  const relaySet = !!(data.settings.relay?.url);
  const intRows = [["ADS-B feed (Airspace)", data.settings.airspace.trafficSource === "local" && data.settings.airspace.localUrl ? "Local set" : "adsb.fi"],
    ["Weather", data.settings.airspace.wxSource === "open-meteo" ? "Open-Meteo" : `METAR ${data.settings.airspace.station}`],
    ["Live video (OPS)", data.settings.ops.url ? cap(data.settings.ops.type) : "Not connected"],
    ["Telemetry stream", TEL_SOURCES[data.settings.telemetry?.source] || "Not connected"],
    ["Report delivery (relay)", relaySet ? "Relay set" : "Not connected"]];
  return (<>
    <PageHeader title="Settings" subtitle="Organization, integrations, and data." action={<ThemeToggle theme={data.settings.theme} onChange={v => setSetting(["theme"], v)} />} />
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Organization" icon={SettingsIcon}><div className="space-y-3">
        <Field label="Operator name"><TextInput value={org.name} onChange={e => setSetting(["org", "name"], e.target.value)} placeholder="Your UAS Ops" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Part 107 / 44807"><Select value={org.part107} onChange={e => setSetting(["org", "part107"], e.target.value)}>{["On file", "Pending", "Expired", "Not filed"].map(s => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Default units"><Select value={org.units} onChange={e => setSetting(["org", "units"], e.target.value)}><option value="metric">Metric (m, m/s)</option><option value="imperial">Imperial (ft, mph)</option></Select></Field>
        </div>
        <Field label="Brand accent color">
          <div className="flex items-center gap-2">
            <input type="color" value={org.accent || "#1776bb"} onChange={e => setSetting(["org", "accent"], e.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded border bd bg-transparent p-0.5" title="Pick accent color" />
            <TextInput value={org.accent || "#1776bb"} onChange={e => setSetting(["org", "accent"], e.target.value)} placeholder="#1776bb" />
            {org.accent && org.accent.toLowerCase() !== "#1776bb" && <Btn onClick={() => setSetting(["org", "accent"], "#1776bb")}>Reset</Btn>}
          </div>
        </Field>
        <Field label="Company logo / emblem">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border bd sf2">
              {org.logo ? <img src={org.logo} alt="logo" className="h-full w-full object-cover" /> : <Plane size={20} className="acc" />}
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={pickLogo}><Upload size={13} />{org.logo ? "Replace" : "Upload logo"}</Btn>
              {org.logo && <Btn variant="danger" onClick={() => setSetting(["org", "logo"], "")}><Trash2 size={13} />Remove</Btn>}
            </div>
          </div>
          <p className="pt-1.5 text-[11px] t4">Shown in the side rail in place of the default plane emblem. PNG/SVG/JPG under 1 MB.</p>
        </Field>
        <Kv k="Theme" v={cap(data.settings.theme)} /></div></Panel>
      <RelayPanel data={data} setSetting={setSetting} />
      <StoragePanel data={data} setData={setData} />
      <Panel title="Integrations" icon={Wifi}>{intRows.map(([l, v]) => <div key={l} className="flex items-center justify-between py-1.5"><span className="text-sm t2">{l}</span>
        <span className="rounded-full border bd px-2 py-0.5 text-[10px] uppercase tracking-wide t3">{v}</span></div>)}</Panel>
      <Panel title="Roles & access" icon={Users}><Kv k="Ops managers" v={data.users.filter(u => u.role === "Ops Manager").length} /><Kv k="Remote PICs" v={data.users.filter(u => u.role === "Remote PIC").length} /><p className="pt-1 text-[11px] t4">Granular permissions wire in here.</p></Panel>
      <Panel title="Data" icon={Layers}><Kv k="Aircraft" v={data.aircraft.length} /><Kv k="Flights logged" v={data.flights.length} /><Kv k="Missions" v={data.missions.length} />
        <div className="pt-2"><Btn variant="danger" onClick={reset}><Trash2 size={14} />Reset to defaults</Btn></div></Panel>
    </div>
  </>);
}

/* ============================ manage views ============================ */
const Cell = ({ children, mono }) => <Td mono={mono}>{children}</Td>;
function Missions({ data, setModal, remove, nameOf, highlight }) {
  const list = data.missions;
  const hlRef = useHighlightScroll(highlight);
  return (<>
    <PageHeader title="Missions" subtitle="Plan operations and pre-assign crew and aircraft." action={<Btn variant="primary" onClick={() => setModal({ type: "mission" })}><Plus size={15} />New mission</Btn>} />
    {list.length === 0 ? <Empty icon={Map} label="No missions yet" hint="Create a mission to assign operators and aircraft." />
      : <div className="grid gap-3 sm:grid-cols-2">{list.map(m => { const hl = highlight?.coll === "missions" && highlight.id === m.id;
        return <div key={m.id} ref={hl ? hlRef : null} className={`rounded-xl border bd sf p-4 ${hl ? "hl-card" : ""}`}>
        <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold t1">{m.name}</h3><p className="mt-0.5 flex items-center gap-1 text-xs t3"><MapPin size={12} />{m.location}</p></div><Badge value={m.status} /></div>
        <p className="mt-3 text-sm t3">{m.objective}</p>
        <div className="mt-3 space-y-1.5 text-xs"><L k="Date" v={m.date} mono /><L k="Operators" v={m.operators.map(id => nameOf("users", id)).join(", ") || "Unassigned"} /><L k="Aircraft" v={m.aircraft.map(id => nameOf("aircraft", id)).join(", ") || "Unassigned"} mono /><L k="LAANC" v={m.laanc} /><L k="Risk" v={m.risk} /></div>
        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t bd pt-3"><Btn onClick={() => setModal({ type: "flight", item: { missionId: m.id } })}><Plane size={14} />Log flight</Btn><Btn onClick={() => setModal({ type: "checklistRun", item: { missionId: m.id } })}><ClipboardCheck size={14} />Checklist</Btn><Btn onClick={() => setModal({ type: "mission", item: m })}><Pencil size={14} />Edit</Btn><Btn variant="danger" onClick={() => remove("missions", m.id)}><Trash2 size={14} /></Btn></div></div>; })}</div>}
  </>);
}
const L = ({ k, v, mono }) => <div className="flex justify-between gap-3"><span className="t4">{k}</span><span className={`text-right t2 ${mono ? "font-mono" : ""}`}>{v}</span></div>;

function Flights({ data, setModal, remove, nameOf, highlight }) {
  const hlRef = useHighlightScroll(highlight);
  return (<><PageHeader title="Flights" subtitle="Logged sorties and telemetry." action={<Btn variant="primary" onClick={() => setModal({ type: "flight" })}><Plus size={15} />Log flight</Btn>} />
    {data.flights.length === 0 ? <Empty icon={Plane} label="No flights logged" hint="Log a flight from here or from a mission." />
      : <Table cols={["Date", "Mission", "RPIC", "Aircraft", "Dur (min)", "Max alt (m)", "Dist (km)", "Status", "Pre-flight", ""]}>{data.flights.map(f => {
        const runs = (data.checklistRuns || []).filter(r => r.flightId === f.id);
        const run = runs.find(r => r.complete) || runs[0];
        const hl = highlight?.coll === "flights" && highlight.id === f.id;
        return <Row key={f.id} hl={hl} innerRef={hl ? hlRef : null}>
        <Cell mono>{f.date}</Cell><Cell>{data.missions.find(m => m.id === f.missionId)?.name || "—"}</Cell><Cell>{nameOf("users", f.operator)}</Cell><Cell mono>{nameOf("aircraft", f.aircraft)}</Cell><Cell mono>{f.dur}</Cell><Cell mono>{f.maxAlt}</Cell><Cell mono>{f.dist}</Cell><Td><Badge value={f.status} /></Td>
        <Td>{run
          ? <button onClick={() => setModal({ type: "checklistRun", item: run })} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: run.complete ? "#10b981" : "#f59e0b" }}><ClipboardCheck size={13} />{run.complete ? "Complete" : "Partial"}</button>
          : <button onClick={() => setModal({ type: "checklistRun", item: { flightId: f.id, missionId: f.missionId } })} className="inline-flex items-center gap-1 text-xs t3 hover:acc"><ClipboardCheck size={13} />Run</button>}</Td>
        <Td><RowActions onEdit={() => setModal({ type: "flight", item: f })} onDelete={() => remove("flights", f.id)} /></Td></Row>; })}</Table>}</>);
}
function Laanc({ data, setModal, remove }) {
  return (<><PageHeader title="LAANC Authorizations" subtitle="Airspace authorizations on file." action={<Btn variant="primary" onClick={() => setModal({ type: "laanc" })}><Plus size={15} />New authorization</Btn>} />
    {data.laanc.length === 0 ? <Empty icon={Radio} label="No authorizations" hint="Record LAANC approvals tied to a mission." />
      : <Table cols={["Confirmation", "Mission", "Airspace", "Ceiling (ft)", "Window", "Status", ""]}>{data.laanc.map(l => <Row key={l.id}>
        <Cell mono>{l.conf}</Cell><Cell>{data.missions.find(m => m.id === l.missionId)?.name || "—"}</Cell><Cell>{l.airspace}</Cell><Cell mono>{l.ceiling}</Cell><Cell mono>{(l.start || "").replace("T", " ")}</Cell><Td><Badge value={l.status} /></Td>
        <Td><RowActions onEdit={() => setModal({ type: "laanc", item: l })} onDelete={() => remove("laanc", l.id)} /></Td></Row>)}</Table>}</>);
}
function Waivers({ data, setModal, remove }) {
  const now = new Date();
  const list = data.waivers || [];
  return (<><PageHeader title="Waivers & COAs" subtitle="Part 107 waivers, COAs, and exemptions on file." action={<Btn variant="primary" onClick={() => setModal({ type: "waiver" })}><Plus size={15} />New waiver / COA</Btn>} />
    {list.length === 0 ? <Empty icon={BadgeCheck} label="No waivers or COAs" hint="Track waivers, COAs, and exemptions with their scope and expiry." />
      : <Table cols={["Name", "Type", "Scope", "Number", "Expiry", "Status", ""]}>{list.map(w => { const d = daysUntil(w.expiry, now);
        const cls = d == null ? "t3" : d < 0 ? "text-rose-400" : d < 60 ? "text-amber-400" : "t3";
        return <Row key={w.id}>
        <Cell>{w.name}</Cell><Cell>{w.type}</Cell><Td><span className="t2">{w.scope}</span></Td><Cell mono>{w.number || "—"}</Cell>
        <Td><span className={`font-mono text-xs ${cls}`}>{w.expiry || "—"}{d != null && d >= 0 && d < 60 ? ` · ${Math.round(d)}d` : ""}</span></Td>
        <Td><Badge value={d != null && d < 0 ? "Expired" : w.status} /></Td>
        <Td><RowActions onEdit={() => setModal({ type: "waiver", item: w })} onDelete={() => remove("waivers", w.id)} /></Td></Row>; })}</Table>}</>);
}
// Reads a chosen file into a data-URL kept on the document record (small files only; use a reference link for large ones).
function pickDocFile(setForm) {
  const inp = document.createElement("input"); inp.type = "file";
  inp.onchange = () => { const f = inp.files?.[0]; if (!f) return;
    if (f.size > 3 * 1024 * 1024) { alert("Please pick a file under 3 MB, or add an external link for larger files."); return; }
    const r = new FileReader(); r.onload = () => setForm(s => ({ ...s, fileData: r.result, fileName: f.name, refUrl: "" })); r.readAsDataURL(f); };
  inp.click();
}
function Documents({ data, setModal, remove }) {
  const now = new Date();
  const list = data.documents || [];
  const linkLabel = (t, id) => {
    if (!t || !id) return "—";
    const coll = t === "aircraft" ? data.aircraft : t === "mission" ? data.missions : t === "waiver" ? (data.waivers || []) : [];
    const r = coll.find(x => x.id === id);
    return r ? (r.tail || r.name || "—") : "—";
  };
  return (<><PageHeader title="Document Vault" subtitle="Compliance and operational documents — uploaded files or external references." action={<Btn variant="primary" onClick={() => setModal({ type: "document" })}><Plus size={15} />New document</Btn>} />
    {list.length === 0 ? <Empty icon={FileText} label="No documents" hint="Upload a file or add a reference for insurance, registrations, manuals, waivers, and more." />
      : <Table cols={["Name", "Category", "Linked to", "Issued", "Expiry", "File / reference", ""]}>{list.map(dn => { const d = daysUntil(dn.expiry, now);
        const cls = d == null ? "t3" : d < 0 ? "text-rose-400" : d < 60 ? "text-amber-400" : "t3";
        return <Row key={dn.id}>
        <Cell>{dn.name}</Cell><Cell>{dn.category}</Cell><Cell>{linkLabel(dn.linkedType, dn.linkedId)}</Cell><Cell mono>{dn.issueDate || "—"}</Cell>
        <Td><span className={`font-mono text-xs ${cls}`}>{dn.expiry || "—"}{d != null && d >= 0 && d < 60 ? ` · ${Math.round(d)}d` : d != null && d < 0 ? " · expired" : ""}</span></Td>
        <Td>{dn.fileData
          ? <a href={dn.fileData} download={dn.fileName || dn.name} className="inline-flex items-center gap-1 text-xs acc hover:opacity-80"><Paperclip size={12} />{dn.fileName || "file"}</a>
          : dn.refUrl
            ? <a href={dn.refUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs acc hover:opacity-80"><ExternalLink size={12} />Link</a>
            : <span className="text-xs t4">—</span>}</Td>
        <Td><RowActions onEdit={() => setModal({ type: "document", item: dn })} onDelete={() => remove("documents", dn.id)} /></Td></Row>; })}</Table>}</>);
}
function GlobalSearch({ data, nameOf, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const hit = (...vals) => vals.some(v => String(v ?? "").toLowerCase().includes(s));
    const out = [];
    const missions = data.missions.filter(m => hit(m.name, m.location, m.date, m.status, m.objective, m.risk)).slice(0, 6)
      .map(m => ({ id: m.id, title: m.name, sub: `${m.date} · ${m.location} · ${m.status}` }));
    if (missions.length) out.push({ coll: "missions", label: "Missions", icon: Map, items: missions });
    const flights = data.flights.filter(f => hit(f.date, f.location, f.status, f.notes, nameOf("aircraft", f.aircraft), nameOf("users", f.operator))).slice(0, 6)
      .map(f => ({ id: f.id, title: `${nameOf("aircraft", f.aircraft)} · ${f.date}`, sub: `${nameOf("users", f.operator)} · ${f.status}` }));
    if (flights.length) out.push({ coll: "flights", label: "Flights", icon: Plane, items: flights });
    const aircraft = data.aircraft.filter(a => hit(a.tail, a.model, a.serial, a.status, a.faaReg, a.remoteId)).slice(0, 6)
      .map(a => ({ id: a.id, title: a.tail, sub: `${a.model} · ${a.status}` }));
    if (aircraft.length) out.push({ coll: "aircraft", label: "Aircraft", icon: Plane, items: aircraft });
    const users = data.users.filter(u => hit(u.name, u.role, u.cert, u.status)).slice(0, 6)
      .map(u => ({ id: u.id, title: u.name, sub: `${u.role} · ${u.status}` }));
    if (users.length) out.push({ coll: "users", label: "Users", icon: Users, items: users });
    return out;
  }, [q, data, nameOf]);
  const pick = (coll, id) => { onPick(coll, id); setQ(""); setOpen(false); };
  return <div ref={ref} className="relative">
    <div className="flex items-center gap-2 rounded-md border bd sf px-3 py-2">
      <Search size={15} className="t4" />
      <input value={q} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }}
        placeholder="Search missions, flights, aircraft, users…" className="w-full bg-transparent text-sm t2 outline-none" />
      {q && <button onClick={() => setQ("")} className="t4 hover:opacity-70"><X size={14} /></button>}
    </div>
    {open && q.trim() && <div className="absolute z-40 mt-1.5 max-h-96 w-full overflow-y-auto rounded-xl border bd shadow-2xl" style={{ background: "var(--modal)" }}>
      {groups.length === 0 ? <div className="px-4 py-6 text-center text-sm t4">No matches for “{q}”.</div>
        : groups.map(g => <div key={g.coll} className="py-1">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest t4"><g.icon size={12} />{g.label}</div>
          {g.items.map(it => <button key={it.id} onClick={() => pick(g.coll, it.id)} className="flex w-full flex-col items-start px-3 py-1.5 text-left hov">
            <span className="text-sm t1">{it.title}</span><span className="font-mono text-[11px] t4">{it.sub}</span></button>)}
        </div>)}
    </div>}
  </div>;
}
function FirstRun({ onEmpty, onDemo }) {
  return <div data-theme="dark" className="flex min-h-screen w-full items-center justify-center p-6"
    style={{ background: "var(--bg)", color: "var(--t2)", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
    <style>{THEME_CSS}</style>
    <div className="w-full max-w-md rounded-2xl border bd sf p-7 text-center shadow-2xl">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl accbg"><Plane size={22} /></div>
      <h1 className="text-lg font-bold t1">Welcome to FlightDeck</h1>
      <p className="mt-1 text-sm t3">How would you like to start? You can switch later by resetting in Settings.</p>
      <div className="mt-6 grid gap-3 text-left">
        <button onClick={onEmpty} className="rounded-xl border bd sf2 p-4 hov">
          <div className="flex items-center gap-2 text-sm font-semibold t1"><Layers size={16} className="acc" />Start with an empty workspace</div>
          <p className="mt-1 text-xs t4">A clean slate — add your own aircraft, missions, and records.</p></button>
        <button onClick={onDemo} className="rounded-xl border bd sf2 p-4 hov">
          <div className="flex items-center gap-2 text-sm font-semibold t1"><Sparkles size={16} className="acc" />Load demo data</div>
          <p className="mt-1 text-xs t4">Explore a fully populated sample fleet and operations.</p></button>
      </div>
    </div>
  </div>;
}
// Recoverable screen when a saved workspace can't be read (corrupt/incompatible). Stored file is left untouched.
function LoadError({ onRetry, onFresh }) {
  return <div data-theme="dark" className="flex min-h-screen w-full items-center justify-center p-6"
    style={{ background: "var(--bg)", color: "var(--t2)", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
    <style>{THEME_CSS}</style>
    <div className="w-full max-w-md rounded-2xl border bd sf p-7 text-center shadow-2xl">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl" style={{ background: "#f43f5e22" }}><AlertTriangle size={22} className="text-rose-400" /></div>
      <h1 className="text-lg font-bold t1">Couldn't load your data</h1>
      <p className="mt-1 text-sm t3">The saved workspace couldn't be read — it may be corrupted or from an incompatible version. Your stored file was left untouched.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Btn variant="primary" onClick={onRetry}><RefreshCw size={14} />Retry</Btn>
        <Btn onClick={onFresh}>Start fresh</Btn>
      </div>
    </div>
  </div>;
}
function Checklists({ data, setModal, remove, update }) {
  const toggle = (id, i) => update("checklists", l => l.map(c => c.id === id ? { ...c, items: c.items.map((it, x) => x === i ? { ...it, done: !it.done } : it) } : c));
  const resetCl = id => update("checklists", l => l.map(c => c.id === id ? { ...c, items: c.items.map(it => ({ ...it, done: false })) } : c));
  return (<><PageHeader title="Checklists" subtitle="Run and track pre-flight and procedure checklists." action={<Btn variant="primary" onClick={() => setModal({ type: "checklist" })}><Plus size={15} />New checklist</Btn>} />
    {data.checklists.length === 0 ? <Empty icon={ListChecks} label="No checklists" hint="Create reusable checklists for crews to run." />
      : <div className="grid gap-3 sm:grid-cols-2">{data.checklists.map(c => { const done = c.items.filter(i => i.done).length;
        return <div key={c.id} className="rounded-xl border bd sf p-4"><div className="flex items-center justify-between"><h3 className="font-semibold t1">{c.name}</h3><span className="font-mono text-xs t4">{done}/{c.items.length}</span></div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded sf2"><div className="h-full" style={{ width: `${(done / c.items.length) * 100 || 0}%`, background: "var(--accent)" }} /></div>
          <ul className="mt-3 space-y-1.5">{c.items.map((it, i) => <li key={i}><button onClick={() => toggle(c.id, i)} className="flex w-full items-center gap-2 text-left text-sm">
            <span className={`grid h-4 w-4 place-items-center rounded border ${it.done ? "accbg" : "bd"}`}>{it.done && <ChevronRight size={11} />}</span>
            <span className={it.done ? "t4 line-through" : "t2"}>{it.t}</span></button></li>)}</ul>
          <div className="mt-3 flex justify-end gap-2 border-t bd pt-3"><Btn onClick={() => resetCl(c.id)}>Reset</Btn><Btn onClick={() => setModal({ type: "checklist", item: c })}><Pencil size={14} />Edit</Btn><Btn variant="danger" onClick={() => remove("checklists", c.id)}><Trash2 size={14} /></Btn></div></div>; })}</div>}</>);
}
function RiskList({ data, setModal, remove }) {
  return (<><PageHeader title="Risk Assessments" subtitle="Hazard analysis and mitigations per operation." action={<Btn variant="primary" onClick={() => setModal({ type: "risk" })}><Plus size={15} />New assessment</Btn>} />
    {data.riskAssessments.length === 0 ? <Empty icon={ShieldAlert} label="No assessments" />
      : <div className="space-y-3">{data.riskAssessments.map(r => <div key={r.id} className="rounded-xl border bd sf p-4">
        <div className="flex items-start justify-between"><div><h3 className="font-semibold t1">{r.name}</h3><span className="font-mono text-xs t4">{r.date}</span></div>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: (r.level === "High" ? "#f43f5e" : r.level === "Moderate" ? "#f59e0b" : "#1776bb") + "26", color: r.level === "High" ? "#f43f5e" : r.level === "Moderate" ? "#f59e0b" : "#1776bb" }}>{r.level}</span></div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><div className="text-xs uppercase tracking-wider t4">Hazards</div><p className="mt-1 t2">{r.hazards}</p></div><div><div className="text-xs uppercase tracking-wider t4">Mitigations</div><p className="mt-1 t2">{r.mitigations}</p></div></div>
        <div className="mt-3 flex justify-end gap-2 border-t bd pt-3"><Btn onClick={() => setModal({ type: "risk", item: r })}><Pencil size={14} />Edit</Btn><Btn variant="danger" onClick={() => remove("riskAssessments", r.id)}><Trash2 size={14} /></Btn></div></div>)}</div>}</>);
}
function Maintenance({ data, setModal, remove, nameOf }) {
  return (<><PageHeader title="Maintenance" subtitle="Service history per aircraft." action={<Btn variant="primary" onClick={() => setModal({ type: "maintenance" })}><Plus size={15} />Log service</Btn>} />
    {data.maintenance.length === 0 ? <Empty icon={Wrench} label="No maintenance records" />
      : <Table cols={["Date", "Aircraft", "Type", "Description", "Technician", ""]}>{data.maintenance.map(m => <Row key={m.id}>
        <Cell mono>{m.date}</Cell><Cell mono>{nameOf("aircraft", m.aircraft)}</Cell><Cell>{m.type}</Cell><Cell>{m.desc}</Cell><Cell>{m.tech}</Cell>
        <Td><RowActions onEdit={() => setModal({ type: "maintenance", item: m })} onDelete={() => remove("maintenance", m.id)} /></Td></Row>)}</Table>}</>);
}
function Incidents({ data, setModal, remove, nameOf }) {
  return (<><PageHeader title="Incidents" subtitle="Reportable events and resolutions." action={<Btn variant="primary" onClick={() => setModal({ type: "incident" })}><Plus size={15} />Report incident</Btn>} />
    {data.incidents.length === 0 ? <Empty icon={AlertTriangle} label="No incidents" hint="A clean record is a good record." />
      : <Table cols={["Date", "Aircraft", "Severity", "Description", "Resolution", ""]}>{data.incidents.map(i => <Row key={i.id}>
        <Cell mono>{i.date}</Cell><Cell mono>{nameOf("aircraft", i.aircraft)}</Cell><Td><span className="rounded-full px-2 py-0.5 text-xs" style={{ background: (i.severity === "Major" ? "#f43f5e" : i.severity === "Moderate" ? "#f59e0b" : "#64748b") + "26", color: i.severity === "Major" ? "#f43f5e" : i.severity === "Moderate" ? "#f59e0b" : "#94a3b8" }}>{i.severity}</span></Td><Cell>{i.desc}</Cell><Cell>{i.resolution}</Cell>
        <Td><RowActions onEdit={() => setModal({ type: "incident", item: i })} onDelete={() => remove("incidents", i.id)} /></Td></Row>)}</Table>}</>);
}
function Aircraft({ data, setModal, remove, highlight }) {
  const now = new Date();
  const hlRef = useHighlightScroll(highlight);
  return (<><PageHeader title="Aircraft" subtitle="Fleet register." action={<Btn variant="primary" onClick={() => setModal({ type: "aircraft" })}><Plus size={15} />Add aircraft</Btn>} />
    <Table cols={["Tail / ID", "Model", "Serial", "Hours", "Cycles", "FAA Reg", "Reg exp", "Next Mx", "Status", ""]}>{data.aircraft.map(a => {
      const mx = mxDue(a, now); const regD = daysUntil(a.regExp, now);
      const regCls = regD == null ? "t3" : regD < 0 ? "text-rose-400" : regD < 60 ? "text-amber-400" : "t3";
      const hl = highlight?.coll === "aircraft" && highlight.id === a.id;
      return <Row key={a.id} hl={hl} innerRef={hl ? hlRef : null}>
      <Cell mono>{a.tail}</Cell><Cell>{a.model}</Cell><Cell mono>{a.serial}</Cell><Cell mono>{a.hours}</Cell><Cell mono>{a.cycles}</Cell>
      <Cell mono>{a.faaReg || "—"}</Cell><Td><span className={`font-mono text-xs ${regCls}`}>{a.regExp || "—"}</span></Td>
      <Td>{mx ? <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: mx.tone === "rose" ? "#f43f5e" : "#f59e0b" }}>
        <Wrench size={12} />{mx.items[0].overdue ? "Overdue" : `${Math.max(0, Math.round(mx.items[0].remaining))} ${mx.items[0].unit}`}</span> : <span className="text-xs t4">OK</span>}</Td>
      <Td><Badge value={a.status} /></Td>
      <Td><RowActions onEdit={() => setModal({ type: "aircraft", item: a })} onDelete={() => remove("aircraft", a.id)} /></Td></Row>; })}</Table></>);
}
function Batteries({ data, setModal, remove }) {
  return (<><PageHeader title="Batteries" subtitle="Pack inventory and health." action={<Btn variant="primary" onClick={() => setModal({ type: "battery" })}><Plus size={15} />Add battery</Btn>} />
    <Table cols={["Label", "Chemistry", "Capacity (Wh)", "Cycles / limit", "Health", "Status", ""]}>{data.batteries.map(b => { const over = b.cycleLimit && b.cycles >= b.cycleLimit, near = b.cycleLimit && !over && b.cycles >= b.cycleLimit * 0.9; return <Row key={b.id}>
      <Cell mono>{b.label}</Cell><Cell>{b.chem}</Cell><Cell mono>{b.capacity}</Cell>
      <Td><span className="font-mono text-xs" style={{ color: over ? "#f43f5e" : near ? "#f59e0b" : "var(--t3)" }}>{b.cycles}{b.cycleLimit ? ` / ${b.cycleLimit}` : ""}</span></Td>
      <Td><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded sf2"><div className="h-full" style={{ width: `${b.health}%`, background: b.health > 85 ? "#1776bb" : b.health > 70 ? "#f59e0b" : "#f43f5e" }} /></div><span className="font-mono text-xs t3">{Math.round(b.health)}%</span></div></Td>
      <Td><Badge value={b.status} /></Td><Td><RowActions onEdit={() => setModal({ type: "battery", item: b })} onDelete={() => remove("batteries", b.id)} /></Td></Row>; })}</Table></>);
}
function Workflows({ data, setModal, remove }) {
  return (<><PageHeader title="Workflows" subtitle="Standard operating sequences." action={<Btn variant="primary" onClick={() => setModal({ type: "workflow" })}><Plus size={15} />New workflow</Btn>} />
    {data.workflows.length === 0 ? <Empty icon={Workflow} label="No workflows" />
      : <div className="space-y-3">{data.workflows.map(w => <div key={w.id} className="rounded-xl border bd sf p-4"><div className="flex items-center justify-between"><h3 className="font-semibold t1">{w.name}</h3><RowActions onEdit={() => setModal({ type: "workflow", item: w })} onDelete={() => remove("workflows", w.id)} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">{w.steps.map((s, i) => <React.Fragment key={i}>
          <span className="rounded-md border bd sf2 px-2.5 py-1 text-xs t2"><span className="mr-1.5 font-mono t4">{String(i + 1).padStart(2, "0")}</span>{s}</span>
          {i < w.steps.length - 1 && <ChevronRight size={13} className="t4" />}</React.Fragment>)}</div></div>)}</div>}</>);
}
function UsersView({ data, setModal, remove, highlight }) {
  const hlRef = useHighlightScroll(highlight);
  return (<><PageHeader title="Users" subtitle="Operators and crew." action={<Btn variant="primary" onClick={() => setModal({ type: "user" })}><Plus size={15} />Add user</Btn>} />
    <Table cols={["Name", "Role", "Certification", "Cert expiry", "Status", ""]}>{data.users.map(u => { const exp = new Date(u.certExp) < new Date();
      const hl = highlight?.coll === "users" && highlight.id === u.id;
      return <Row key={u.id} hl={hl} innerRef={hl ? hlRef : null}><Cell>{u.name}</Cell><Cell>{u.role}</Cell><Cell>{u.cert}</Cell><Td><span className={`font-mono text-xs ${exp ? "text-rose-400" : "t3"}`}>{u.certExp}</span></Td><Td><Badge value={u.status === "Active" ? "Available" : "Storage"} /></Td>
        <Td><RowActions onEdit={() => setModal({ type: "user", item: u })} onDelete={() => remove("users", u.id)} /></Td></Row>; })}</Table></>);
}

/* ============================ modal forms ============================ */
const CONFIG = {
  mission: { coll: "missions", prefix: "MSN", title: "mission" }, flight: { coll: "flights", prefix: "FLT", title: "flight" },
  laanc: { coll: "laanc", prefix: "LA", title: "LAANC authorization" }, checklist: { coll: "checklists", prefix: "CL", title: "checklist" },
  risk: { coll: "riskAssessments", prefix: "RA", title: "risk assessment" }, maintenance: { coll: "maintenance", prefix: "MX", title: "maintenance record" },
  incident: { coll: "incidents", prefix: "INC", title: "incident" }, aircraft: { coll: "aircraft", prefix: "AC", title: "aircraft" },
  battery: { coll: "batteries", prefix: "BAT", title: "battery" }, workflow: { coll: "workflows", prefix: "WF", title: "workflow" }, user: { coll: "users", prefix: "OP", title: "user" },
  checklistRun: { coll: "checklistRuns", prefix: "CR", title: "checklist run" },
  waiver: { coll: "waivers", prefix: "WV", title: "waiver / COA" },
  document: { coll: "documents", prefix: "DOC", title: "document" },
};
const today = () => new Date().toISOString().slice(0, 10);
function init(modal) {
  if (modal.item && modal.item.id) return { ...modal.item };
  const base = {
    mission: { name: "", date: today(), status: "Planned", location: "", objective: "", operators: [], aircraft: [], laanc: "Not required", risk: "Low" },
    flight: { missionId: modal.item?.missionId || "", date: today(), status: "Completed", operator: "", aircraft: "", batteries: [], dur: 0, maxAlt: 0, dist: 0, location: "", notes: "" },
    laanc: { missionId: "", airspace: "", ceiling: 400, status: "Pending", start: "", end: "", conf: "" },
    checklist: { name: "", items: [{ t: "", done: false }] }, risk: { name: "", date: today(), level: "Low", hazards: "", mitigations: "" },
    maintenance: { aircraft: "", date: today(), type: "Inspection", desc: "", tech: "" }, incident: { date: today(), severity: "Minor", aircraft: "", desc: "", resolution: "" },
    aircraft: { tail: "", model: "", serial: "", type: "Multirotor", status: "Available", hours: 0, cycles: 0, lastMx: today(),
      faaReg: "", regExp: "", remoteId: "", mxIntervalHours: 0, mxIntervalCycles: 0, mxIntervalDays: 0, mxAtHours: 0, mxAtCycles: 0 },
    battery: { label: "", chem: "", capacity: 0, cycles: 0, health: 100, status: "Charged", cycleLimit: 0 }, workflow: { name: "", steps: [""] },
    user: { name: "", role: "Remote PIC", cert: "Part 107", certExp: "", status: "Active" },
    checklistRun: { flightId: modal.item?.flightId || "", missionId: modal.item?.missionId || "", checklistId: "", name: "", date: today(), by: "", items: [], complete: false },
    waiver: { name: "", type: "Part 107 Waiver", scope: "", number: "", issued: today(), expiry: "", status: "Active" },
    document: { name: "", category: "Other", linkedType: "", linkedId: "", issueDate: today(), expiry: "", notes: "", refUrl: "", fileName: "", fileData: "" },
  };
  return base[modal.type];
}
// Required-field checks per record type. Returns a list of human-readable problems ([] = OK).
function validate(type, f) {
  const e = [];
  const txt = v => (v == null ? "" : String(v)).trim();
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  switch (type) {
    case "mission": need(txt(f.name), "Mission name is required."); break;
    case "flight": need(f.aircraft, "Select an aircraft."); need(f.operator, "Select a Remote PIC."); need((f.dur || 0) > 0, "Duration must be greater than 0 minutes."); break;
    case "laanc": need(txt(f.airspace), "Airspace is required."); break;
    case "checklist": need(txt(f.name), "Checklist name is required."); need((f.items || []).some(i => txt(i.t)), "Add at least one checklist item."); break;
    case "risk": need(txt(f.name), "Assessment name is required."); break;
    case "maintenance": need(f.aircraft, "Select an aircraft."); need(txt(f.desc), "Description is required."); break;
    case "incident": need(f.aircraft, "Select an aircraft."); need(txt(f.desc), "Description is required."); break;
    case "aircraft": need(txt(f.tail), "Tail / ID is required."); need(txt(f.model), "Model is required."); break;
    case "battery": need(txt(f.label), "Label is required."); need(txt(f.chem), "Chemistry is required."); break;
    case "workflow": need(txt(f.name), "Workflow name is required."); need((f.steps || []).some(s => txt(s)), "Add at least one step."); break;
    case "user": need(txt(f.name), "Name is required."); need(txt(f.certExp), "Certification expiry is required."); break;
    case "checklistRun": need(f.checklistId, "Pick a checklist to run."); need(f.flightId || f.missionId, "Attach the run to a flight or mission."); break;
    case "waiver": need(txt(f.name), "Name is required."); need(txt(f.expiry), "Expiry date is required."); break;
    case "document": need(txt(f.name), "Document name is required."); need(f.fileData || txt(f.refUrl), "Attach a file or add a reference link."); break;
    default: break;
  }
  return e;
}
function ModalRouter({ modal, data, upsert, saveFlight, saveMaintenance, closeModal }) {
  const [form, setForm] = useState(() => init(modal));
  const [errors, setErrors] = useState([]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = () => {
    const errs = validate(modal.type, form);
    if (errs.length) { setErrors(errs); return; }
    const c = CONFIG[modal.type];
    if (modal.type === "flight") saveFlight(form);                 // also rolls usage into aircraft/battery stats
    else if (modal.type === "maintenance") saveMaintenance(form);  // also resets the aircraft service baseline
    else upsert(c.coll, { ...form, id: form.id || uid(c.prefix) });
    closeModal();
  };
  const T = modal.type;
  return <Modal title={(form.id ? "Edit " : "New ") + CONFIG[T].title} onClose={closeModal} onSave={save}><div className="space-y-4">
    {errors.length > 0 && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
      <ul className="list-disc space-y-0.5 pl-4">{errors.map((er, i) => <li key={i}>{er}</li>)}</ul></div>}
    {T === "mission" && <><Field label="Mission name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Date"><TextInput type="date" value={form.date} onChange={e => set("date", e.target.value)} /></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Planned", "Active", "Completed", "Cancelled"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Location"><TextInput value={form.location} onChange={e => set("location", e.target.value)} /></Field><Field label="Objective"><TextArea value={form.objective} onChange={e => set("objective", e.target.value)} /></Field>
      <Field label="Assign operators"><MultiPick options={data.users} value={form.operators} onChange={v => set("operators", v)} labelFn={o => o.name} /></Field>
      {(() => {
        const clash = data.missions.filter(mn => mn.id !== form.id && mn.date === form.date && (mn.operators || []).some(o => (form.operators || []).includes(o)));
        if (!clash.length) return null;
        const who = [...new Set(clash.flatMap(mn => (mn.operators || []).filter(o => (form.operators || []).includes(o))))].map(o => data.users.find(u => u.id === o)?.name).filter(Boolean);
        return <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500"><AlertTriangle size={12} className="mr-1 inline" />{who.join(", ")} already assigned on {form.date} in: {clash.map(mn => mn.name).join(", ")}</p>;
      })()}
      <Field label="Pre-assign aircraft"><MultiPick options={data.aircraft} value={form.aircraft} onChange={v => set("aircraft", v)} labelFn={o => o.tail} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="LAANC"><TextInput value={form.laanc} onChange={e => set("laanc", e.target.value)} /></Field><Field label="Risk level"><Select value={form.risk} onChange={e => set("risk", e.target.value)}>{["Low", "Moderate", "High"].map(s => <option key={s}>{s}</option>)}</Select></Field></div></>}
    {T === "flight" && <><Field label="Mission"><Select value={form.missionId} onChange={e => set("missionId", e.target.value)}><option value="">— None —</option>{data.missions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Date"><TextInput type="date" value={form.date} onChange={e => set("date", e.target.value)} /></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Planned", "Active", "Completed", "Cancelled"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Remote PIC"><Select value={form.operator} onChange={e => set("operator", e.target.value)}><option value="">— Select —</option>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field><Field label="Aircraft"><Select value={form.aircraft} onChange={e => set("aircraft", e.target.value)}><option value="">— Select —</option>{data.aircraft.map(a => <option key={a.id} value={a.id}>{a.tail}</option>)}</Select></Field></div>
      <Field label="Batteries used"><MultiPick options={data.batteries} value={form.batteries} onChange={v => set("batteries", v)} labelFn={o => o.label} /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Duration (min)"><TextInput type="number" value={form.dur} onChange={e => set("dur", +e.target.value)} /></Field><Field label="Max alt (m)"><TextInput type="number" value={form.maxAlt} onChange={e => set("maxAlt", +e.target.value)} /></Field><Field label="Distance (km)"><TextInput type="number" value={form.dist} onChange={e => set("dist", +e.target.value)} /></Field></div>
      <Field label="Location"><TextInput value={form.location} onChange={e => set("location", e.target.value)} /></Field><Field label="Notes"><TextArea value={form.notes} onChange={e => set("notes", e.target.value)} /></Field></>}
    {T === "laanc" && <><Field label="Mission"><Select value={form.missionId} onChange={e => set("missionId", e.target.value)}><option value="">— None —</option>{data.missions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
      <Field label="Airspace"><TextInput value={form.airspace} onChange={e => set("airspace", e.target.value)} placeholder="KXYZ Class D" /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Ceiling (ft)"><TextInput type="number" value={form.ceiling} onChange={e => set("ceiling", +e.target.value)} /></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Pending", "Approved", "Cancelled"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Start"><TextInput type="datetime-local" value={form.start} onChange={e => set("start", e.target.value)} /></Field><Field label="End"><TextInput type="datetime-local" value={form.end} onChange={e => set("end", e.target.value)} /></Field></div>
      <Field label="Confirmation #"><TextInput value={form.conf} onChange={e => set("conf", e.target.value)} /></Field></>}
    {T === "checklist" && <ChecklistForm form={form} setForm={setForm} />}
    {T === "risk" && <><Field label="Name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Date"><TextInput type="date" value={form.date} onChange={e => set("date", e.target.value)} /></Field><Field label="Level"><Select value={form.level} onChange={e => set("level", e.target.value)}>{["Low", "Moderate", "High"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Hazards"><TextArea value={form.hazards} onChange={e => set("hazards", e.target.value)} /></Field><Field label="Mitigations"><TextArea value={form.mitigations} onChange={e => set("mitigations", e.target.value)} /></Field></>}
    {T === "maintenance" && <><Field label="Aircraft"><Select value={form.aircraft} onChange={e => set("aircraft", e.target.value)}><option value="">— Select —</option>{data.aircraft.map(a => <option key={a.id} value={a.id}>{a.tail}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Date"><TextInput type="date" value={form.date} onChange={e => set("date", e.target.value)} /></Field><Field label="Type"><Select value={form.type} onChange={e => set("type", e.target.value)}>{["Inspection", "Repair", "Component swap", "Firmware", "Calibration"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Description"><TextArea value={form.desc} onChange={e => set("desc", e.target.value)} /></Field><Field label="Technician"><TextInput value={form.tech} onChange={e => set("tech", e.target.value)} /></Field></>}
    {T === "incident" && <><div className="grid grid-cols-2 gap-3"><Field label="Date"><TextInput type="date" value={form.date} onChange={e => set("date", e.target.value)} /></Field><Field label="Severity"><Select value={form.severity} onChange={e => set("severity", e.target.value)}>{["Minor", "Moderate", "Major"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Aircraft"><Select value={form.aircraft} onChange={e => set("aircraft", e.target.value)}><option value="">— Select —</option>{data.aircraft.map(a => <option key={a.id} value={a.id}>{a.tail}</option>)}</Select></Field>
      <Field label="Description"><TextArea value={form.desc} onChange={e => set("desc", e.target.value)} /></Field><Field label="Resolution"><TextArea value={form.resolution} onChange={e => set("resolution", e.target.value)} /></Field></>}
    {T === "aircraft" && <><div className="grid grid-cols-2 gap-3"><Field label="Tail / ID"><TextInput value={form.tail} onChange={e => set("tail", e.target.value)} /></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Available", "In use", "Grounded"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Model"><TextInput value={form.model} onChange={e => set("model", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Serial"><TextInput value={form.serial} onChange={e => set("serial", e.target.value)} /></Field><Field label="Type"><TextInput value={form.type} onChange={e => set("type", e.target.value)} /></Field></div>
      <div className="grid grid-cols-3 gap-3"><Field label="Hours"><TextInput type="number" value={form.hours} onChange={e => set("hours", +e.target.value)} /></Field><Field label="Cycles"><TextInput type="number" value={form.cycles} onChange={e => set("cycles", +e.target.value)} /></Field><Field label="Last Mx"><TextInput type="date" value={form.lastMx} onChange={e => set("lastMx", e.target.value)} /></Field></div>
      <div className="border-t bd pt-1 text-[11px] font-semibold uppercase tracking-wider t4">Registration & Remote ID</div>
      <div className="grid grid-cols-2 gap-3"><Field label="FAA registration #"><TextInput value={form.faaReg || ""} onChange={e => set("faaReg", e.target.value)} placeholder="FA3X9K2LMN" /></Field><Field label="Registration expiry"><TextInput type="date" value={form.regExp || ""} onChange={e => set("regExp", e.target.value)} /></Field></div>
      <Field label="Remote ID module serial"><TextInput value={form.remoteId || ""} onChange={e => set("remoteId", e.target.value)} placeholder="Broadcast module S/N" /></Field>
      <div className="border-t bd pt-1 text-[11px] font-semibold uppercase tracking-wider t4">Maintenance intervals <span className="normal-case t4">(0 = off)</span></div>
      <div className="grid grid-cols-3 gap-3"><Field label="Every (hours)"><TextInput type="number" value={form.mxIntervalHours || 0} onChange={e => set("mxIntervalHours", +e.target.value)} /></Field><Field label="Every (cycles)"><TextInput type="number" value={form.mxIntervalCycles || 0} onChange={e => set("mxIntervalCycles", +e.target.value)} /></Field><Field label="Every (days)"><TextInput type="number" value={form.mxIntervalDays || 0} onChange={e => set("mxIntervalDays", +e.target.value)} /></Field></div>
      {(form.mxIntervalHours > 0 || form.mxIntervalCycles > 0) && <p className="text-[11px] t4">Next due is measured from the readings at the last service ({form.mxAtHours || 0} h / {form.mxAtCycles || 0} cyc). Logging a maintenance record resets this baseline.</p>}</>}
    {T === "battery" && <><div className="grid grid-cols-2 gap-3"><Field label="Label"><TextInput value={form.label} onChange={e => set("label", e.target.value)} /></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Charged", "In use", "Storage", "Grounded"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Chemistry"><TextInput value={form.chem} onChange={e => set("chem", e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Capacity (Wh)"><TextInput type="number" value={form.capacity} onChange={e => set("capacity", +e.target.value)} /></Field><Field label="Cycles"><TextInput type="number" value={form.cycles} onChange={e => set("cycles", +e.target.value)} /></Field><Field label="Health (%)"><TextInput type="number" value={form.health} onChange={e => set("health", +e.target.value)} /></Field></div>
      <Field label="Rated cycle life (0 = none)"><TextInput type="number" value={form.cycleLimit || 0} onChange={e => set("cycleLimit", +e.target.value)} /></Field>
      <p className="-mt-1 text-[11px] t4">Health fades automatically as logged flights add cycles; alerts fire near and past this limit.</p></>}
    {T === "workflow" && <WorkflowForm form={form} setForm={setForm} />}
    {T === "user" && <><Field label="Name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Role"><Select value={form.role} onChange={e => set("role", e.target.value)}>{["Remote PIC", "Visual Observer", "Payload Operator", "Maintenance Tech", "Ops Manager"].map(s => <option key={s}>{s}</option>)}</Select></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Active", "Inactive"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Certification"><TextInput value={form.cert} onChange={e => set("cert", e.target.value)} /></Field><Field label="Cert expiry"><TextInput type="date" value={form.certExp} onChange={e => set("certExp", e.target.value)} /></Field></div></>}
    {T === "checklistRun" && <ChecklistRunForm form={form} setForm={setForm} data={data} />}
    {T === "waiver" && <><div className="grid grid-cols-2 gap-3"><Field label="Name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} placeholder="Night operations" /></Field><Field label="Type"><Select value={form.type} onChange={e => set("type", e.target.value)}>{["Part 107 Waiver", "COA", "Exemption (44807)", "Authorization"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <Field label="Scope"><TextArea value={form.scope} onChange={e => set("scope", e.target.value)} placeholder="e.g. §107.29 — night ops; BVLOS corridor; operations over people" /></Field>
      <Field label="Reference / certificate #"><TextInput value={form.number} onChange={e => set("number", e.target.value)} placeholder="107W-2024-118822" /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Issued"><TextInput type="date" value={form.issued} onChange={e => set("issued", e.target.value)} /></Field><Field label="Expiry"><TextInput type="date" value={form.expiry} onChange={e => set("expiry", e.target.value)} /></Field><Field label="Status"><Select value={form.status} onChange={e => set("status", e.target.value)}>{["Active", "Pending", "Expired", "Cancelled"].map(s => <option key={s}>{s}</option>)}</Select></Field></div></>}
    {T === "document" && <><div className="grid grid-cols-2 gap-3"><Field label="Name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} placeholder="Liability insurance — 2026" /></Field><Field label="Category"><Select value={form.category} onChange={e => set("category", e.target.value)}>{["Insurance", "Registration", "Manual", "Waiver", "COA", "Other"].map(s => <option key={s}>{s}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Linked to"><Select value={form.linkedType} onChange={e => { set("linkedType", e.target.value); set("linkedId", ""); }}><option value="">— None —</option><option value="aircraft">Aircraft</option><option value="mission">Mission</option><option value="waiver">Waiver / COA</option></Select></Field>
        <Field label="Record"><Select value={form.linkedId} onChange={e => set("linkedId", e.target.value)} disabled={!form.linkedType}><option value="">{form.linkedType ? "— Select —" : "—"}</option>
          {form.linkedType === "aircraft" && data.aircraft.map(a => <option key={a.id} value={a.id}>{a.tail}</option>)}
          {form.linkedType === "mission" && data.missions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          {form.linkedType === "waiver" && (data.waivers || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Issue date"><TextInput type="date" value={form.issueDate} onChange={e => set("issueDate", e.target.value)} /></Field><Field label="Expiry"><TextInput type="date" value={form.expiry} onChange={e => set("expiry", e.target.value)} /></Field></div>
      <Field label="File or reference">
        <div className="flex flex-wrap items-center gap-2"><Btn onClick={() => pickDocFile(setForm)}><Upload size={13} />{form.fileName ? "Replace file" : "Upload file"}</Btn>
          {form.fileName && <span className="inline-flex items-center gap-1 text-xs t2"><Paperclip size={12} />{form.fileName}<button type="button" onClick={() => setForm(f => ({ ...f, fileName: "", fileData: "" }))} className="t4 hover:text-rose-400"><X size={12} /></button></span>}</div>
        <div className="mt-2"><TextInput value={form.refUrl} onChange={e => set("refUrl", e.target.value)} placeholder="…or paste an external link (Drive, SharePoint, URL)" disabled={!!form.fileName} /></div>
        <p className="pt-1 text-[11px] t4">Upload a small file (under 3 MB) or reference one stored elsewhere by link.</p></Field>
      <Field label="Notes"><TextArea value={form.notes} onChange={e => set("notes", e.target.value)} /></Field></>}
  </div></Modal>;
}
function ChecklistRunForm({ form, setForm, data }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const acTail = id => data.aircraft.find(a => a.id === id)?.tail || "—";
  const msnName = id => data.missions.find(m => m.id === id)?.name || "—";
  const pickFlight = id => { const fl = data.flights.find(x => x.id === id);
    setForm(f => ({ ...f, flightId: id, missionId: fl?.missionId || f.missionId, by: f.by || fl?.operator || "" })); };
  const pickTemplate = id => { const cl = data.checklists.find(c => c.id === id);
    setForm(f => ({ ...f, checklistId: id, name: cl?.name || "", items: (cl?.items || []).map(it => ({ t: it.t, done: false })), complete: false })); };
  const toggle = i => setForm(f => { const items = f.items.map((it, x) => x === i ? { ...it, done: !it.done } : it); return { ...f, items, complete: items.length > 0 && items.every(it => it.done) }; });
  const doneCount = form.items.filter(it => it.done).length;
  return <div className="space-y-4">
    <Field label="Flight"><Select value={form.flightId} onChange={e => pickFlight(e.target.value)}><option value="">— None —</option>
      {data.flights.map(fl => <option key={fl.id} value={fl.id}>{fl.date} · {acTail(fl.aircraft)} · {msnName(fl.missionId)}</option>)}</Select></Field>
    <Field label="Mission"><Select value={form.missionId} onChange={e => set("missionId", e.target.value)}><option value="">— None —</option>
      {data.missions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Checklist"><Select value={form.checklistId} onChange={e => pickTemplate(e.target.value)}><option value="">— Select —</option>
        {data.checklists.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Performed by"><Select value={form.by} onChange={e => set("by", e.target.value)}><option value="">— Select —</option>
        {data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
    </div>
    <Field label="Date"><TextInput type="date" value={form.date} onChange={e => set("date", e.target.value)} /></Field>
    {form.items.length > 0 ? <div>
      <div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wider t3">Items</span>
        <span className="font-mono text-xs" style={{ color: form.complete ? "#10b981" : "var(--t4)" }}>{doneCount}/{form.items.length}{form.complete ? " · complete" : ""}</span></div>
      <ul className="space-y-1.5">{form.items.map((it, i) => <li key={i}><button type="button" onClick={() => toggle(i)} className="flex w-full items-center gap-2 text-left text-sm">
        <span className={`grid h-4 w-4 place-items-center rounded border ${it.done ? "accbg" : "bd"}`}>{it.done && <ChevronRight size={11} />}</span>
        <span className={it.done ? "t4 line-through" : "t2"}>{it.t}</span></button></li>)}</ul>
    </div> : <p className="text-xs t4">Pick a checklist to load its items, then check each one off as you complete it. The run is stored against the selected flight/mission as an auditable record.</p>}
  </div>;
}
function ChecklistForm({ form, setForm }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v })); const setItem = (i, t) => set("items", form.items.map((it, x) => x === i ? { ...it, t } : it));
  return <div className="space-y-4"><Field label="Checklist name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} /></Field>
    <div><span className="mb-1 block text-xs font-medium uppercase tracking-wider t3">Items</span><div className="space-y-2">{form.items.map((it, i) => <div key={i} className="flex gap-2"><TextInput value={it.t} onChange={e => setItem(i, e.target.value)} /><button onClick={() => set("items", form.items.filter((_, x) => x !== i))} className="rounded p-2 t4 hover:text-rose-400"><X size={16} /></button></div>)}</div>
    <Btn className="mt-2" onClick={() => set("items", [...form.items, { t: "", done: false }])}><Plus size={14} />Add item</Btn></div></div>;
}
function WorkflowForm({ form, setForm }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v })); const setStep = (i, v) => set("steps", form.steps.map((s, x) => x === i ? v : s));
  return <div className="space-y-4"><Field label="Workflow name"><TextInput value={form.name} onChange={e => set("name", e.target.value)} /></Field>
    <div><span className="mb-1 block text-xs font-medium uppercase tracking-wider t3">Steps</span><div className="space-y-2">{form.steps.map((s, i) => <div key={i} className="flex items-center gap-2"><span className="font-mono text-xs t4">{String(i + 1).padStart(2, "0")}</span><TextInput value={s} onChange={e => setStep(i, e.target.value)} /><button onClick={() => set("steps", form.steps.filter((_, x) => x !== i))} className="rounded p-2 t4 hover:text-rose-400"><X size={16} /></button></div>)}</div>
    <Btn className="mt-2" onClick={() => set("steps", [...form.steps, ""])}><Plus size={14} />Add step</Btn></div></div>;
}
