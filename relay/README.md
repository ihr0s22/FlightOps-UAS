# FlightOps relay

A small server that fixes two CORS dead ends in the FlightOps app:

- `opendata.adsb.fi` (live traffic) and `aviationweather.gov` (METAR) both answer requests fine,
  but neither sends an `Access-Control-Allow-Origin` header, so the browser refuses to read the
  response when the app calls them directly. This relay calls them server-to-server (no CORS rules
  apply) and re-serves the data with CORS enabled for your app.
- It also gives the app's "Sync to relay" button somewhere to write snapshots and scheduled-report
  lists to, so syncs are auditable on disk.

## Run it locally

```bash
cd relay
npm install
npm start
```

Listens on `http://localhost:8787` by default (override with `PORT`).

## Point the app at it

In the app: **Settings → Relay & delivery** → paste the relay's URL (e.g. `http://localhost:8787`,
or your deployed HTTPS URL) → **Save** → **Test** (should say "Reachable").

Once that's set, **Airspace → ADS-B** and the **METAR** weather source will route through this relay
automatically — no other app changes needed.

## Deploying it so it works from anywhere (not just your LAN)

Any small Node host works. Render's free tier is the path of least resistance:

1. Push this `relay/` folder to a git repo (or its own repo).
2. On [Render](https://render.com): New → Web Service → point at the repo → root directory `relay`,
   build command `npm install`, start command `npm start`.
3. Render gives you an HTTPS URL like `https://your-relay.onrender.com` — use that in the app's
   Relay settings.

Fly.io and Railway work the same way if you'd rather use those.

## Locking it down

By default the relay accepts requests from any origin (`ALLOWED_ORIGIN=*`). If you deploy it
publicly, set the `ALLOWED_ORIGIN` environment variable to your app's actual origin, e.g.:

```bash
ALLOWED_ORIGIN=https://your-flightops-deployment.example.com npm start
```

## Endpoints

| Method | Path            | Purpose                                              |
|--------|-----------------|-------------------------------------------------------|
| GET    | `/health`       | Reachability check used by the app's "Test" button   |
| GET    | `/api/adsb`     | `?lat=&lon=&dist=` → proxies opendata.adsb.fi          |
| GET    | `/api/metar`    | `?ids=KIAD` → proxies aviationweather.gov              |
| POST   | `/api/snapshot` | Stores the full workspace JSON to `data/snapshot.json` |
| GET    | `/api/snapshot` | Returns the last synced snapshot + timestamp           |
| POST   | `/api/schedules`| Stores scheduled-report list to `data/schedules.json`  |
