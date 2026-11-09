import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../app.js";

let dir, server, base;
const calls = [];
const fakeFetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
const post = (url, body, raw = false) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body) });

async function start(opts = {}) {
  const app = await createApp({ dataDir: dir, allowedOrigin: "http://app.test", fetchImpl: fakeFetch, ...opts });
  const s = app.listen(0);
  await new Promise(r => s.once("listening", r));
  return { s, url: `http://127.0.0.1:${s.address().port}` };
}
before(async () => { dir = await mkdtemp(path.join(tmpdir(), "relay-")); ({ s: server, url: base } = await start()); });
after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

test("refuses to start without ALLOWED_ORIGIN", async () => {
  await assert.rejects(createApp({ dataDir: dir, allowedOrigin: "" }), /ALLOWED_ORIGIN/);
});

test("health is open and responses carry security headers", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("x-content-type-options"));
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("adsb validates numeric params and never forwards junk", async () => {
  calls.length = 0;
  for (const q of ["lat=abc&lon=1", "lat=1", "lat=91&lon=1", "lat=1&lon=1&dist=9999", "lat=1/../x&lon=2"])
    assert.equal((await fetch(`${base}/api/adsb?${q}`)).status, 400, q);
  assert.equal(calls.length, 0);
  assert.equal((await fetch(`${base}/api/adsb?lat=38.9&lon=-77.4`)).status, 200);
  assert.match(calls[0], /lat\/38\.9\/lon\/-77\.4\/dist\/25$/);
});

test("metar validates station codes", async () => {
  for (const q of ["", "ids=../../x", "ids=KIAD%26foo=1", "ids=TOOLONGCODE"])
    assert.equal((await fetch(`${base}/api/metar?${q}`)).status, 400, q);
  assert.equal((await fetch(`${base}/api/metar?ids=KIAD,KDCA`)).status, 200);
});

test("upstream timeout gives 504 and upstream failure gives 502", async () => {
  const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason)));
  const slow = await start({ fetchImpl: hang, upstreamTimeoutMs: 50 });
  const down = await start({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal((await fetch(`${slow.url}/api/metar?ids=KIAD`)).status, 504);
  assert.equal((await fetch(`${down.url}/api/metar?ids=KIAD`)).status, 502);
  slow.s.close(); down.s.close();
});

test("snapshot round-trip, validation, and no temp files left behind", async () => {
  assert.equal((await post(`${base}/api/snapshot`, [1])).status, 400);
  assert.equal((await post(`${base}/api/snapshot`, "{bad", true)).status, 400);
  assert.equal((await post(`${base}/api/snapshot`, { a: 1 })).status, 200);
  const got = await (await fetch(`${base}/api/snapshot`)).json();
  assert.deepEqual(got.data, { a: 1 });
  assert.ok(got.syncedAt);
  assert.ok(!(await readdir(dir)).some(f => f.endsWith(".tmp")));
});

test("schedules must be an array", async () => {
  assert.equal((await post(`${base}/api/schedules`, {})).status, 400);
  assert.equal((await post(`${base}/api/schedules`, [])).status, 200);
});

test("token is required on /api when set, while /health stays open", async () => {
  const t = await start({ token: "s3cret-token" });
  assert.equal((await fetch(`${t.url}/health`)).status, 200);
  assert.equal((await fetch(`${t.url}/api/snapshot`)).status, 401);
  assert.equal((await fetch(`${t.url}/api/snapshot`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.notEqual((await fetch(`${t.url}/api/snapshot`, { headers: { Authorization: "Bearer s3cret-token" } })).status, 401);
  t.s.close();
});

test("rate limit returns 429 past the cap", async () => {
  const t = await start({ rateLimitPerMin: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(`${t.url}/api/snapshot`)).status);
  assert.ok(codes.includes(429), codes.join());
  t.s.close();
});

test("CORS only allows the configured origin", async () => {
  const bad = await fetch(`${base}/health`, { headers: { Origin: "http://evil.test" } });
  assert.notEqual(bad.headers.get("access-control-allow-origin"), "http://evil.test");
  const ok = await fetch(`${base}/health`, { headers: { Origin: "http://app.test" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://app.test");
});
