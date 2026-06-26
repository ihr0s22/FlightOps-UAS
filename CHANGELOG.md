# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows
[Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`, bumped MINOR for
additive features, PATCH for fixes, MAJOR for breaking changes to the saved-data
schema or relay API contract.

Note: `SCHEMA_VERSION` (in `FlightOps-UAS.jsx`) tracks saved-workspace migrations
independently of the package version, since it only changes when the data shape
changes, not on every release.

## [2.2.0] — 2026-06-26

### Added
- **Docker self-hosting** — `Dockerfile` + `nginx.conf` build and serve the static app,
  `relay/Dockerfile` containerizes the relay, and `docker-compose.yml` runs both
  together (app on `:8080`, relay on `:8787`, relay's synced data persisted in a named
  volume). `docker compose up -d --build` gets a fully private instance running with no
  public hosting involved. Documented in a new "Self-hosting (Docker)" section in
  `README.md`.

### Changed
- Fixed remaining stale "FlightDeck" branding and outdated copy in `README.md`
  (basemap names after the dead sectional source was removed, "Connect drive folder" →
  "Connect a folder" wording) and a stale comment in `vite.config.js`.

## [2.1.0] — 2026-06-26

### Added
- **List view for Missions** — a Cards/List toggle alongside the existing card layout,
  with the same edit/delete/log-flight/checklist actions available in table rows.
- **Configurable columns** on every table-based Manage section (Missions list, Flights,
  LAANC, Waivers, Document Vault, Maintenance, Incidents, Aircraft, Batteries, Users) —
  a "Columns" dropdown lets you show/hide columns, with a "Show all" reset. Preferences
  persist per view in `settings.columns` and survive reloads.
- **Draggable rail icon reordering** — the left-hand navigation rail icons (Home,
  Schedule, Airspace, OPS Center, Manage, Reporting, Settings) can now be dragged into
  a custom order, persisted in `settings.railOrder`.
- **Relay server** (`relay/`) — a small self-hostable Node/Express proxy that fixes two
  CORS dead ends: `opendata.adsb.fi` (live ADS-B traffic) and `aviationweather.gov`
  (METAR) both answer requests fine server-to-server but send no
  `Access-Control-Allow-Origin` header, so the browser blocks the response when the app
  calls them directly. The relay re-serves both with CORS enabled, and also gives
  "Sync to relay" somewhere to write workspace snapshots and scheduled-report lists to
  disk. See `relay/README.md` for local run and deploy instructions (Render/Fly/Railway).

### Fixed
- **Airspace map rendering nothing** — the default basemap, "Sectional," pointed at
  `wms.chartbundle.com`, a domain that no longer resolves (ChartBundle discontinued its
  free tile service). Removed the dead tile source, defaulted the basemap to "Street",
  and added a fallback so any previously-saved `"sectional"` setting won't break the map.
- **ADS-B traffic feed always falling back to sample data** — `opendata.adsb.fi` sends
  no CORS headers, so the browser silently failed every direct fetch. The traffic fetch
  now routes through the relay (when configured) and the fallback error message
  explains the CORS issue and what to do about it, instead of a vague
  "CORS or offline" string.
- **Storage panel implied external-drive-only** — wording said "External drive" /
  "Connect a folder on your external drive," but the underlying File System Access API
  already supports any folder, internal drives included. Copy and labels updated to
  "Local folder" / "Connect a folder" and now explicitly mention internal drives,
  external drives, and network shares.

### Changed
- Renamed remaining "FlightDeck" branding to "FlightOps" for consistency with the rest
  of the app: first-run welcome screen, PDF/report header and footer, `index.html`
  title/meta description, and the `package.json` name/description.

## [1.0.0] (relay) — 2026-06-26

### Added
- Initial release of the FlightOps relay (`relay/`): `/health`, `/api/adsb`,
  `/api/metar`, `/api/snapshot` (POST + GET), `/api/schedules`.
