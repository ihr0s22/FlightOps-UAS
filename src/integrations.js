// Integration settings helpers: defaults, validation, status summary and connection tests.
// Pure (no React); network helpers take injectable implementations so they can be unit-tested.

export const DEFAULT_TILES = {
  street: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  aerial: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};
export const DEFAULT_GEOCODER = "https://nominatim.openstreetmap.org";
export const DEFAULT_TRAFFIC_DIST = 25;

/* ---------- validation: each returns "" when OK, otherwise a short human message ---------- */
const parseUrl = (v) => { try { return new URL(v); } catch { return null; } };

export function validateUrl(value, protocols = ["http:", "https:"], { required = false } = {}) {
  const v = String(value ?? "").trim();
  if (!v) return required ? "Required." : "";
  const u = parseUrl(v);
  if (!u) return "Not a valid URL (include https:// or http://).";
  if (!protocols.includes(u.protocol)) return `Must start with ${protocols.map(p => p.replace(":", "://")).join(" or ")}.`;
  if (!u.hostname) return "Missing host name.";
  return "";
}
export const validateHttpUrl = (v, o) => validateUrl(v, ["http:", "https:"], o);
export const validateWsUrl = (v, o) => validateUrl(v, ["ws:", "wss:"], o);

// Map tile template must contain {z}, {x} and {y}.
export function validateTileTemplate(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const probe = v.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0");
  const bad = validateHttpUrl(probe);
  if (bad) return bad;
  for (const k of ["{z}", "{x}", "{y}"]) if (!v.includes(k)) return `Template must include ${k}.`;
  return "";
}
export function validateNumberRange(value, lo, hi, label = "Value") {
  const n = Number(value);
  if (value === "" || value == null || !Number.isFinite(n)) return `${label} must be a number.`;
  return n < lo || n > hi ? `${label} must be between ${lo} and ${hi}.` : "";
}
export const validateStation = (v) => (/^[A-Za-z0-9]{3,4}$/.test(String(v ?? "").trim()) ? "" : "Use a 3-4 character ICAO/airport code (e.g. KIAD).");
export const validateMqttTopic = (v) => {
  const t = String(v ?? "").trim();
  if (!t) return "Topic is required.";
  if (/\s/.test(t)) return "Topic can't contain spaces.";
  if (t.includes("#") && !t.endsWith("#")) return "'#' is only allowed as the last character.";
  return "";
};

/* ---------- derived values ---------- */
export function tileUrl(maps, basemap, z, x, y) {
  const custom = (basemap === "aerial" ? maps?.aerialUrl : maps?.streetUrl) || "";
  const tpl = custom.trim() && !validateTileTemplate(custom) ? custom.trim() : (DEFAULT_TILES[basemap] || DEFAULT_TILES.street);
  return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}
export const geocoderBase = (g) => {
  const u = String(g?.url ?? "").trim().replace(/\/+$/, "");
  return u && !validateHttpUrl(u) ? u : DEFAULT_GEOCODER;
};
export const trafficDist = (as) => { const n = Number(as?.trafficDist); return Number.isFinite(n) && n >= 1 && n <= 250 ? n : DEFAULT_TRAFFIC_DIST; };

/* ---------- status summary for the hub header ---------- */
// state: "connected" (user-configured), "default" (works out of the box), "incomplete" (needs a value), "off".
export function integrationsSummary(settings, { hasRelayToken = false } = {}) {
  const as = settings.airspace || {}, ops = settings.ops || {}, tel = settings.telemetry || {}, relay = settings.relay || {};
  const maps = settings.maps || {}, geo = settings.geocoder || {};
  const out = [];
  out.push({ id: "relay", label: "Relay & delivery", state: relay.url ? "connected" : "off",
    detail: relay.url ? `${relay.url}${hasRelayToken ? " · token set" : " · no token"}` : "Not connected" });
  out.push(as.trafficSource === "local"
    ? { id: "adsb", label: "ADS-B traffic", state: as.localUrl ? "connected" : "incomplete", detail: as.localUrl ? "Local receiver" : "Local receiver: URL needed" }
    : { id: "adsb", label: "ADS-B traffic", state: "default", detail: `adsb.fi ${relay.url ? "via relay" : "(direct; may be blocked by CORS)"} · ${trafficDist(as)} nm` });
  out.push(as.wxSource === "metar"
    ? { id: "weather", label: "Weather", state: as.station ? "connected" : "incomplete", detail: `METAR ${as.station || "station needed"}` }
    : { id: "weather", label: "Weather", state: "default", detail: "Open-Meteo" });
  out.push({ id: "video", label: "Live video", state: ops.url ? "connected" : "off", detail: ops.url ? `${ops.type} stream` : "Not connected" });
  const telState = tel.source === "ws" ? (tel.wsUrl ? "connected" : "incomplete") : tel.source === "mqtt" ? (tel.mqttUrl ? "connected" : "incomplete") : "default";
  out.push({ id: "telemetry", label: "Telemetry", state: telState,
    detail: tel.source === "ws" ? (tel.wsUrl || "WebSocket: URL needed") : tel.source === "mqtt" ? (tel.mqttUrl ? `MQTT ${tel.mqttTopic || ""}` : "MQTT: broker needed") : "Simulator (demo)" });
  const customTiles = [maps.streetUrl, maps.aerialUrl].some(v => v && v.trim());
  out.push({ id: "maps", label: "Map tiles", state: customTiles ? "connected" : "default", detail: customTiles ? "Custom tile server" : "OpenStreetMap / Esri" });
  out.push({ id: "geocoder", label: "Geocoding", state: geo.url ? "connected" : "default", detail: geo.url ? geo.url : "Nominatim (OpenStreetMap)" });
  return out;
}

/* ---------- connection tests: resolve to { ok, message }, never throw ---------- */
// "Reachable" check that works across origins: a no-cors fetch resolves (opaque) when the server answered at all and
// rejects on DNS/connection/TLS failure. It cannot tell a 404 from a 200, so the message says "reachable", not "OK".
export async function checkReachable(url, { timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  const bad = validateHttpUrl(url, { required: true });
  if (bad) return { ok: false, message: bad };
  try {
    await fetchImpl(url, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, message: "Server is reachable." };
  } catch (e) {
    return { ok: false, message: e?.name === "TimeoutError" ? `No response within ${timeoutMs / 1000}s.` : "Couldn't connect (offline, wrong address, or blocked)." };
  }
}

// Same-origin-friendly JSON check (relay and CORS-enabled APIs): ok only when the response status is 2xx.
export async function checkApi(url, { headers, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const bad = validateHttpUrl(url, { required: true });
  if (bad) return { ok: false, message: bad };
  try {
    const r = await fetchImpl(url, { headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 401) return { ok: false, message: "Rejected the access token (401)." };
    if (!r.ok) return { ok: false, message: `Server answered ${r.status}.` };
    return { ok: true, message: "Responded OK." };
  } catch (e) {
    return { ok: false, message: e?.name === "TimeoutError" ? `No response within ${timeoutMs / 1000}s.` : "Couldn't reach it (offline, wrong address, or blocked by CORS)." };
  }
}

export function checkWebSocket(url, { protocols, timeoutMs = 6000, WS = globalThis.WebSocket } = {}) {
  const bad = validateWsUrl(url, { required: true });
  if (bad) return Promise.resolve({ ok: false, message: bad });
  return new Promise(resolve => {
    let done = false, ws;
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); try { ws && ws.close(); } catch {} resolve(r); };
    const t = setTimeout(() => finish({ ok: false, message: `No response within ${timeoutMs / 1000}s.` }), timeoutMs);
    try {
      ws = protocols ? new WS(url, protocols) : new WS(url);
      ws.onopen = () => finish({ ok: true, message: "Connection opened." });
      ws.onerror = () => finish({ ok: false, message: "Couldn't connect (wrong address, server down, or blocked)." });
    } catch { finish({ ok: false, message: "Couldn't start the connection." }); }
  });
}

export function checkImage(url, { timeoutMs = 8000, ImageImpl = globalThis.Image } = {}) {
  return new Promise(resolve => {
    let done = false;
    const img = new ImageImpl();
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => finish({ ok: false, message: `No response within ${timeoutMs / 1000}s.` }), timeoutMs);
    img.onload = () => finish({ ok: true, message: "Tile loaded." });
    img.onerror = () => finish({ ok: false, message: "Tile failed to load (wrong template, blocked, or server down)." });
    img.src = url;
  });
}
