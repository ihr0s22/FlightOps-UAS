// FlightOps relay app factory. Separated from server.js so it can be tested without binding a fixed port.
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { mkdir, writeFile, readFile, rename } from "fs/promises";
import { timingSafeEqual } from "crypto";
import path from "path";

const UPSTREAM_TIMEOUT_MS = 8000;
const ICAO_LIST = /^[A-Za-z0-9]{3,4}(,[A-Za-z0-9]{3,4}){0,9}$/;

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// Atomic write: temp file + rename, so a crash mid-write can never leave a truncated JSON file.
async function writeJsonAtomic(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2));
  await rename(tmp, file);
}

function tokenOk(header, token) {
  const m = /^Bearer (.+)$/.exec(header || "");
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createApp({
  dataDir,
  allowedOrigin = process.env.ALLOWED_ORIGIN,
  token = process.env.RELAY_TOKEN,
  rateLimitPerMin = Number(process.env.RATE_LIMIT_PER_MIN) || 120,
  fetchImpl = fetch,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
} = {}) {
  if (!allowedOrigin) throw new Error("ALLOWED_ORIGIN is required (e.g. https://your-app.example.com). Use * only for local experiments.");
  await mkdir(dataDir, { recursive: true });

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    origin: allowedOrigin === "*" ? "*" : allowedOrigin.split(",").map(s => s.trim()),
    allowedHeaders: ["Content-Type", "Authorization"],
  }));
  app.use(express.json({ limit: "5mb" }));

  // Unauthenticated and unlimited: used by the app's "Test" button and container healthchecks.
  app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use("/api", rateLimit({
    windowMs: 60_000, limit: rateLimitPerMin, standardHeaders: true, legacyHeaders: false,
    message: { error: "rate limit exceeded" },
  }));
  if (token) app.use("/api", (req, res, next) => {
    if (req.method === "OPTIONS" || tokenOk(req.headers.authorization, token)) return next();
    res.status(401).json({ error: "missing or invalid relay token" });
  });

  const proxy = async (res, url, label) => {
    try {
      const upstream = await fetchImpl(url, { signal: AbortSignal.timeout(upstreamTimeoutMs) });
      const body = await upstream.json();
      res.status(upstream.status).json(body);
    } catch (err) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      res.status(timedOut ? 504 : 502).json({ error: timedOut ? `${label} timed out` : `${label} unreachable` });
    }
  };

  // ADS-B traffic: opendata.adsb.fi sends no Access-Control-Allow-Origin header, so browsers can't call it directly.
  app.get("/api/adsb", (req, res) => {
    const lat = num(req.query.lat, -90, 90), lon = num(req.query.lon, -180, 180), dist = num(req.query.dist ?? 25, 1, 250);
    if (lat === null || lon === null || dist === null)
      return res.status(400).json({ error: "lat (-90..90), lon (-180..180) and optional dist (1..250) must be numbers" });
    proxy(res, `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`, "adsb.fi");
  });

  // METAR: aviationweather.gov, same CORS situation.
  app.get("/api/metar", (req, res) => {
    const ids = String(req.query.ids || "");
    if (!ICAO_LIST.test(ids)) return res.status(400).json({ error: "ids must be 1-10 comma-separated station codes (3-4 letters/digits)" });
    proxy(res, `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`, "aviationweather.gov");
  });

  app.post("/api/snapshot", async (req, res) => {
    const b = req.body;
    if (b === null || typeof b !== "object" || Array.isArray(b)) return res.status(400).json({ error: "snapshot must be a JSON object" });
    try {
      await writeJsonAtomic(path.join(dataDir, "snapshot.json"), b);
      await writeJsonAtomic(path.join(dataDir, "snapshot.meta.json"), { syncedAt: new Date().toISOString() });
      res.json({ ok: true });
    } catch { res.status(500).json({ error: "couldn't write snapshot" }); }
  });

  app.post("/api/schedules", async (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "schedules must be a JSON array" });
    try { await writeJsonAtomic(path.join(dataDir, "schedules.json"), req.body); res.json({ ok: true }); }
    catch { res.status(500).json({ error: "couldn't write schedules" }); }
  });

  app.get("/api/snapshot", async (_req, res) => {
    try {
      const [snapshot, meta] = await Promise.all([
        readFile(path.join(dataDir, "snapshot.json"), "utf8").catch(() => null),
        readFile(path.join(dataDir, "snapshot.meta.json"), "utf8").catch(() => null),
      ]);
      if (!snapshot) return res.status(404).json({ error: "no snapshot synced yet" });
      res.json({ ...JSON.parse(meta || "{}"), data: JSON.parse(snapshot) });
    } catch { res.status(500).json({ error: "couldn't read snapshot" }); }
  });

  // Malformed JSON bodies, oversized payloads, etc.: clean JSON error, no stack traces.
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 413 ? "payload too large" : status === 400 ? "invalid JSON body" : "internal error" });
  });
  return app;
}
