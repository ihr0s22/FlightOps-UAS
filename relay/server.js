import express from "express";
import cors from "cors";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";

const PORT = process.env.PORT || 8787;
// Lock this down to your app's actual origin in production, e.g. ALLOWED_ORIGIN=https://yourdomain.com
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const DATA_DIR = path.join(import.meta.dirname, "data");

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "5mb" }));

await mkdir(DATA_DIR, { recursive: true });

app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ADS-B traffic — proxies opendata.adsb.fi, which works fine server-to-server but sends no
// Access-Control-Allow-Origin header, so a direct browser fetch is always blocked by CORS.
app.get("/api/adsb", async (req, res) => {
  const { lat, lon, dist = "25" } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: "lat and lon are required" });
  try {
    const upstream = await fetch(`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`);
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: "adsb.fi unreachable", detail: String(err) });
  }
});

// METAR — proxies aviationweather.gov, same CORS situation as adsb.fi above.
app.get("/api/metar", async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.status(400).json({ error: "ids (ICAO station code) is required" });
  try {
    const upstream = await fetch(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`);
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: "aviationweather.gov unreachable", detail: String(err) });
  }
});

// "Sync to relay" in Settings → Relay & delivery — stores the latest full workspace snapshot
// and scheduled-report list on disk, timestamped, so a sync is auditable after the fact.
app.post("/api/snapshot", async (req, res) => {
  try {
    await writeFile(path.join(DATA_DIR, "snapshot.json"), JSON.stringify(req.body, null, 2));
    await writeFile(path.join(DATA_DIR, "snapshot.meta.json"), JSON.stringify({ syncedAt: new Date().toISOString() }, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "couldn't write snapshot", detail: String(err) });
  }
});

app.post("/api/schedules", async (req, res) => {
  try {
    await writeFile(path.join(DATA_DIR, "schedules.json"), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "couldn't write schedules", detail: String(err) });
  }
});

// Lets you sanity-check what was last synced, e.g. GET /api/snapshot
app.get("/api/snapshot", async (_req, res) => {
  try {
    const [snapshot, meta] = await Promise.all([
      readFile(path.join(DATA_DIR, "snapshot.json"), "utf8").catch(() => null),
      readFile(path.join(DATA_DIR, "snapshot.meta.json"), "utf8").catch(() => null),
    ]);
    if (!snapshot) return res.status(404).json({ error: "no snapshot synced yet" });
    res.json({ ...JSON.parse(meta || "{}"), data: JSON.parse(snapshot) });
  } catch (err) {
    res.status(500).json({ error: "couldn't read snapshot", detail: String(err) });
  }
});

app.listen(PORT, () => console.log(`FlightOps relay listening on :${PORT}`));
