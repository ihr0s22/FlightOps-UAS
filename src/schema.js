// Workspace schema: seed data, stepwise migrations, and normalisation of saved blobs.
// Kept free of React/DOM so it can be unit-tested.
export const SCHEMA_VERSION = 6;
// 40 random bits per id: 5 base36 chars (the old scheme) collided after only a few thousand records.
export const uid = (p) => {
  const c = globalThis.crypto;
  const r = c?.randomUUID ? c.randomUUID().replace(/-/g, "").slice(0, 10) : Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${p}-${r}`;
};

/* ============================ seed ============================ */
export function seed() {
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
    equipment: [
      { id: uid("EQ"), name: "Zenmuse H20T", category: "Camera", serial: "ZH20T-0091", status: "In use", aircraftId: a1, missionId: "", notes: "Thermal + zoom payload, gimbal-mounted." },
      { id: uid("EQ"), name: "RTK ground station", category: "Ground Station", serial: "RTK-2240", status: "Available", aircraftId: "", missionId: m2, notes: "Base station for centimeter-level positioning." },
      { id: uid("EQ"), name: "Spare TX16S controller", category: "Controller", serial: "TX16S-0512", status: "Storage", aircraftId: "", missionId: "", notes: "Backup transmitter, charged quarterly." },
    ],
    users: [
      { id: u1, name: "Ava Reyes", role: "Remote PIC", cert: "Part 107", certExp: "2027-03-14", status: "Active" },
      { id: u2, name: "Daniel Okafor", role: "Visual Observer", cert: "Part 107", certExp: "2026-08-01", status: "Active" },
      { id: u3, name: "Priya Nair", role: "Remote PIC", cert: "Part 107", certExp: "2026-08-20", status: "Active" },
    ],
    missions: [
      { id: m1, name: "Corridor Survey — Sector 4", date: "2026-06-25", location: "Rural corridor, grid R4", objective: "30 km cargo delivery validation run", status: "Planned", operators: [u1, u2], aircraft: [a1], laanc: "Not required (Class G)", risk: "Moderate", lat: 39.02, lon: -77.48,
        geofence: [{ lat: 39.03, lon: -77.50 }, { lat: 39.04, lon: -77.46 }, { lat: 39.00, lon: -77.44 }, { lat: 38.99, lon: -77.49 }] },
      { id: m2, name: "Coastal Inspection", date: "2026-06-23", location: "Pier 9 waterfront", objective: "Infrastructure imaging", status: "Active", operators: [u3], aircraft: [a2], laanc: "Approved", risk: "Low", lat: 38.90, lon: -77.40, geofence: [] },
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
    riskAssessments: [{ id: uid("RA"), missionId: m1, name: "30 km rural corridor", date: "2026-06-20", level: "Moderate", hazards: "Loss of GNSS over corridor; bird activity.", mitigations: "VIO + baro fallback; pre-survey corridor." }],
    checklists: [{ id: cl1, name: "Pre-flight — L-class", items: ["Visual airframe inspection", "Prop security & condition", "Battery health > 90%", "GNSS lock + RTH set", "Payload secured & balanced", "Airspace / LAANC confirmed"].map(t => ({ t, done: false })) }],
    checklistRuns: [{ id: uid("CR"), flightId: f2, missionId: m1, checklistId: cl1, name: "Pre-flight — L-class", date: "2026-06-15", by: u1, complete: true,
      items: ["Visual airframe inspection", "Prop security & condition", "Battery health > 90%", "GNSS lock + RTH set", "Payload secured & balanced", "Airspace / LAANC confirmed"].map(t => ({ t, done: true })) }],
    workflows: [{ id: uid("WF"), name: "Cargo delivery sortie", steps: ["File mission", "Assign RPIC + VO", "Pre-assign aircraft & batteries", "Run pre-flight checklist", "Confirm airspace", "Execute flight", "Log flight data", "Post-flight debrief"] }],
    scheduledReports: [{ id: uid("SR"), name: "Weekly flight log", entity: "flights", range: "last7", freq: "Weekly", format: "PDF", recipients: "ops@yourdomain.com", lastRun: "" }],
    settings: {
      theme: "dark",
      org: { name: "Your UAS Ops", part107: "On file", units: "metric", accent: "#1776bb", logo: "" },
      airspace: { basemap: "street", lat: 38.95, lon: -77.45, zoom: 9, trafficSource: "api", localUrl: "", wxSource: "open-meteo", station: "KIAD", stations: ["KIAD", "KRIC", "KORF", "KDCA"], trafficDist: 25 },
      ops: { type: "mp4", url: "" },
      telemetry: { source: "sim", wsUrl: "", mqttUrl: "", mqttTopic: "uas/+/telemetry" },
      relay: { url: "" },
      maps: { streetUrl: "", aerialUrl: "" },   // custom tile templates ({z}/{x}/{y}); "" = built-in OpenStreetMap / Esri
      geocoder: { url: "" },                    // custom Nominatim-compatible base URL; "" = nominatim.openstreetmap.org
      columns: {},   // per-view list of hidden column ids, e.g. { flights: ["dist"] } — absent/empty = all shown
      rolePermissions: {},   // per-role overrides merged over DEFAULT_ROLE_PERMISSIONS
      currentUserId: "",     // "" = no one signed in -> unrestricted (full access); preserves prior behavior
    },
    version: SCHEMA_VERSION,
  };
}

// A clean slate: the same shape as the seed, but with no demo records (used by first-run "empty workspace").
export function emptyWorkspace() {
  const base = seed();
  const blank = {};
  ["aircraft", "batteries", "equipment", "users", "missions", "flights", "laanc", "waivers", "documents",
    "maintenance", "incidents", "riskAssessments", "checklists", "checklistRuns", "workflows", "scheduledReports"]
    .forEach(k => { blank[k] = []; });
  return { ...base, ...blank, version: SCHEMA_VERSION };
}

/* Stepwise migration of older saved blobs. Each step bumps the version so future schema
   changes can be layered without corrupting data that's already on disk. */
export function migrate(s) {
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
  if (from < 6) {
    // v5 → v6: payload/equipment inventory, plus mission geofences for flight planning.
    if (!Array.isArray(out.equipment)) out.equipment = [];
    out.missions = (out.missions || []).map(m => ({ geofence: [], ...m }));
  }
  out.version = SCHEMA_VERSION;
  return out;
}
export function ensure(s) {
  const base = seed();
  const src = s ? migrate(s) : {};
  const out = { ...base, ...src };
  out.checklistRuns = Array.isArray(src.checklistRuns) ? src.checklistRuns : (s ? [] : base.checklistRuns);
  out.waivers = Array.isArray(src.waivers) ? src.waivers : (s ? [] : base.waivers);
  out.documents = Array.isArray(src.documents) ? src.documents : (s ? [] : base.documents);
  out.equipment = Array.isArray(src.equipment) ? src.equipment : (s ? [] : base.equipment);
  out.scheduledReports = src.scheduledReports || base.scheduledReports;
  out.settings = { ...base.settings, ...(src.settings || {}) };
  out.settings.org = { ...base.settings.org, ...(src.settings?.org || {}) };
  out.settings.airspace = { ...base.settings.airspace, ...(src.settings?.airspace || {}) };
  if (!Array.isArray(out.settings.airspace.stations)) out.settings.airspace.stations = base.settings.airspace.stations;
  out.settings.ops = { ...base.settings.ops, ...(src.settings?.ops || {}) };
  out.settings.telemetry = { ...base.settings.telemetry, ...(src.settings?.telemetry || {}) };
  out.settings.relay = { ...base.settings.relay, ...(src.settings?.relay || {}) };
  out.settings.maps = { ...base.settings.maps, ...(src.settings?.maps || {}) };
  out.settings.geocoder = { ...base.settings.geocoder, ...(src.settings?.geocoder || {}) };
  out.settings.columns = { ...base.settings.columns, ...(src.settings?.columns || {}) };
  out.settings.rolePermissions = { ...base.settings.rolePermissions, ...(src.settings?.rolePermissions || {}) };
  out.version = SCHEMA_VERSION;
  return out;
}

