import path from "path";
import { createApp } from "./app.js";

const PORT = process.env.PORT || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, "data");

let app;
try { app = await createApp({ dataDir: DATA_DIR }); }
catch (err) { console.error(`FlightOps relay: ${err.message}`); process.exit(1); }

if (!process.env.RELAY_TOKEN) console.warn("FlightOps relay: RELAY_TOKEN is not set, so /api endpoints are open to anyone who can reach this server.");

const server = app.listen(PORT, () => console.log(`FlightOps relay listening on :${PORT}`));

// Graceful shutdown: stop accepting connections, let in-flight writes finish, then exit.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
  console.log(`${sig} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
