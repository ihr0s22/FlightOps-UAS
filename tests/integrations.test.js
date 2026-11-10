import { describe, it, expect } from "vitest";
import {
  validateUrl, validateHttpUrl, validateWsUrl, validateTileTemplate, validateNumberRange, validateStation, validateMqttTopic,
  tileUrl, geocoderBase, trafficDist, integrationsSummary, checkReachable, checkApi, checkWebSocket, checkImage,
  DEFAULT_TILES, DEFAULT_GEOCODER, parseCollapse, collapseReducer, emptyCollapse,
} from "../src/integrations.js";
import { seed, ensure } from "../src/schema.js";

describe("URL validation", () => {
  it("accepts http(s) and rejects other schemes, junk and missing hosts", () => {
    expect(validateHttpUrl("https://relay.example.com")).toBe("");
    expect(validateHttpUrl("http://192.168.1.5:8787/path")).toBe("");
    expect(validateHttpUrl("")).toBe("");                       // optional by default
    expect(validateHttpUrl("", { required: true })).toBe("Required.");
    expect(validateHttpUrl("relay.example.com")).toMatch(/valid URL/);
    expect(validateHttpUrl("ftp://x.com")).toMatch(/http/);
    expect(validateHttpUrl("javascript:alert(1)")).toMatch(/http/);
    expect(validateHttpUrl("http://")).not.toBe("");
  });
  it("websocket URLs must be ws:// or wss://", () => {
    expect(validateWsUrl("wss://broker:8083/mqtt")).toBe("");
    expect(validateWsUrl("ws://localhost:1880/telemetry")).toBe("");
    expect(validateWsUrl("https://x.com")).toMatch(/ws/);
  });
  it("custom protocols list is honoured", () => { expect(validateUrl("rtsp://cam", ["rtsp:"])).toBe(""); });
});

describe("tile templates", () => {
  it("requires {z}, {x} and {y}", () => {
    expect(validateTileTemplate("https://tiles.example.com/{z}/{x}/{y}.png")).toBe("");
    expect(validateTileTemplate("https://tiles.example.com/{z}/{y}/{x}")).toBe("");
    expect(validateTileTemplate("https://tiles.example.com/{z}/{x}.png")).toMatch(/\{y\}/);
    expect(validateTileTemplate("tiles.example.com/{z}/{x}/{y}")).toMatch(/valid URL/);
    expect(validateTileTemplate("")).toBe("");
  });
  it("tileUrl uses a valid custom template, else falls back to the default", () => {
    expect(tileUrl({}, "street", 3, 4, 5)).toBe("https://tile.openstreetmap.org/3/4/5.png");
    expect(tileUrl({ streetUrl: "https://t.example.com/{z}/{x}/{y}.png" }, "street", 3, 4, 5)).toBe("https://t.example.com/3/4/5.png");
    expect(tileUrl({ aerialUrl: "https://t.example.com/{z}/{y}/{x}" }, "aerial", 3, 4, 5)).toBe("https://t.example.com/3/5/4");
    expect(tileUrl({ streetUrl: "not a url" }, "street", 1, 2, 3)).toBe(DEFAULT_TILES.street.replace("{z}", 1).replace("{x}", 2).replace("{y}", 3));
    expect(tileUrl(undefined, "nope", 1, 2, 3)).toContain("openstreetmap");
  });
});

describe("other validators and derived values", () => {
  it("number range", () => {
    expect(validateNumberRange("38.9", -90, 90, "Latitude")).toBe("");
    expect(validateNumberRange("91", -90, 90, "Latitude")).toMatch(/between/);
    expect(validateNumberRange("", -90, 90, "Latitude")).toMatch(/number/);
    expect(validateNumberRange("abc", 0, 1)).toMatch(/number/);
  });
  it("station codes", () => {
    expect(validateStation("KIAD")).toBe("");
    expect(validateStation("kd")).not.toBe("");
    expect(validateStation("K/AD")).not.toBe("");
    expect(validateStation("TOOLONG")).not.toBe("");
  });
  it("mqtt topics", () => {
    expect(validateMqttTopic("uas/+/telemetry")).toBe("");
    expect(validateMqttTopic("uas/#")).toBe("");
    expect(validateMqttTopic("uas/#/x")).not.toBe("");
    expect(validateMqttTopic("a b")).not.toBe("");
    expect(validateMqttTopic("")).not.toBe("");
  });
  it("geocoderBase trims slashes and falls back when invalid", () => {
    expect(geocoderBase({ url: "https://geo.example.com/" })).toBe("https://geo.example.com");
    expect(geocoderBase({ url: "nonsense" })).toBe(DEFAULT_GEOCODER);
    expect(geocoderBase(undefined)).toBe(DEFAULT_GEOCODER);
  });
  it("trafficDist defaults and clamps invalid values", () => {
    expect(trafficDist({ trafficDist: 60 })).toBe(60);
    expect(trafficDist({})).toBe(25);
    expect(trafficDist({ trafficDist: 9999 })).toBe(25);
    expect(trafficDist({ trafficDist: "abc" })).toBe(25);
  });
});

describe("integrationsSummary", () => {
  const base = () => ensure(seed()).settings;
  const byId = (s, o) => Object.fromEntries(integrationsSummary(s, o).map(r => [r.id, r]));
  it("fresh defaults: relay off, built-ins ready, nothing incomplete", () => {
    const r = byId(base());
    expect(r.relay.state).toBe("off");
    expect(r.adsb.state).toBe("default");
    expect(r.weather.state).toBe("default");
    expect(r.telemetry.state).toBe("default");
    expect(Object.values(r).some(x => x.state === "incomplete")).toBe(false);
  });
  it("flags integrations that are selected but missing a value", () => {
    const s = base();
    s.airspace = { ...s.airspace, trafficSource: "local", localUrl: "" };
    s.telemetry = { ...s.telemetry, source: "ws", wsUrl: "" };
    const r = byId(s);
    expect(r.adsb.state).toBe("incomplete");
    expect(r.telemetry.state).toBe("incomplete");
  });
  it("reports connected state and relay token presence", () => {
    const s = base();
    s.relay = { url: "https://r.example.com" };
    expect(byId(s, { hasRelayToken: true }).relay.detail).toMatch(/token set/);
    expect(byId(s, { hasRelayToken: false }).relay.detail).toMatch(/no token/);
    expect(byId(s).relay.state).toBe("connected");
  });
});

describe("settings migration", () => {
  it("fills new integration settings on old workspaces", () => {
    const old = { version: 6, settings: { airspace: { lat: 1, lon: 2 } } };
    const s = ensure(old).settings;
    expect(s.maps).toEqual({ streetUrl: "", aerialUrl: "" });
    expect(s.geocoder).toEqual({ url: "" });
    expect(s.airspace.trafficDist).toBe(25);
    expect(s.airspace.lat).toBe(1);
  });
  it("keeps saved values", () => {
    const s = ensure({ version: 6, settings: { maps: { streetUrl: "https://t/{z}/{x}/{y}" }, geocoder: { url: "https://g" }, airspace: { trafficDist: 80 } } }).settings;
    expect(s.maps.streetUrl).toBe("https://t/{z}/{x}/{y}");
    expect(s.maps.aerialUrl).toBe("");
    expect(s.geocoder.url).toBe("https://g");
    expect(s.airspace.trafficDist).toBe(80);
  });
});

describe("connection tests", () => {
  it("checkReachable: ok on resolve, friendly error on reject, validates first", async () => {
    expect((await checkReachable("https://x.test", { fetchImpl: async () => ({}) })).ok).toBe(true);
    const down = await checkReachable("https://x.test", { fetchImpl: async () => { throw new TypeError("fail"); } });
    expect(down.ok).toBe(false);
    expect(down.message).toMatch(/Couldn't connect/);
    expect((await checkReachable("nope")).ok).toBe(false);
  });
  it("checkReachable reports timeouts", async () => {
    const r = await checkReachable("https://x.test", { fetchImpl: async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; } });
    expect(r.message).toMatch(/No response/);
  });
  it("checkApi distinguishes 2xx, 401 and other statuses", async () => {
    const mk = (status) => async () => ({ status, ok: status >= 200 && status < 300 });
    expect((await checkApi("https://x.test", { fetchImpl: mk(200) })).ok).toBe(true);
    expect((await checkApi("https://x.test", { fetchImpl: mk(401) })).message).toMatch(/token/);
    expect((await checkApi("https://x.test", { fetchImpl: mk(500) })).message).toMatch(/500/);
  });
  it("checkWebSocket resolves on open and on error, and rejects bad URLs", async () => {
    class Open { constructor() { setTimeout(() => this.onopen(), 0); } close() {} }
    class Fail { constructor() { setTimeout(() => this.onerror(), 0); } close() {} }
    expect((await checkWebSocket("wss://x.test", { WS: Open })).ok).toBe(true);
    expect((await checkWebSocket("wss://x.test", { WS: Fail })).ok).toBe(false);
    expect((await checkWebSocket("http://x.test", { WS: Open })).ok).toBe(false);
  });
  it("checkWebSocket times out when nothing happens and passes subprotocols", async () => {
    let seen;
    class Hang { constructor(u, p) { seen = p; } close() {} }
    const r = await checkWebSocket("wss://x.test", { WS: Hang, protocols: ["mqtt"], timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(seen).toEqual(["mqtt"]);
  });
  it("checkImage resolves on load and on error", async () => {
    class Good { set src(_) { setTimeout(() => this.onload(), 0); } }
    class Bad { set src(_) { setTimeout(() => this.onerror(), 0); } }
    expect((await checkImage("https://x.test/0/0/0.png", { ImageImpl: Good })).ok).toBe(true);
    expect((await checkImage("https://x.test/0/0/0.png", { ImageImpl: Bad })).ok).toBe(false);
  });
});

describe("hub collapse state", () => {
  it("parses stored values defensively", () => {
    expect(parseCollapse(null)).toEqual(emptyCollapse());
    expect(parseCollapse("not json")).toEqual(emptyCollapse());
    expect(parseCollapse("[1,2]")).toEqual(emptyCollapse());
    expect(parseCollapse('{"hub":true,"cards":{"adsb":true,"x":false,"y":"yes"}}')).toEqual({ hub: true, cards: { adsb: true } });
    expect(parseCollapse('{"hub":"true","cards":[1]}')).toEqual(emptyCollapse());
  });
  it("toggles the hub and individual cards independently", () => {
    let s = emptyCollapse();
    s = collapseReducer(s, { type: "toggleHub" });
    expect(s.hub).toBe(true);
    s = collapseReducer(s, { type: "toggleCard", id: "adsb" });
    expect(s.cards).toEqual({ adsb: true });
    s = collapseReducer(s, { type: "toggleCard", id: "adsb" });
    expect(s.cards).toEqual({});
    expect(s.hub).toBe(true);            // card toggles never change the hub
  });
  it("collapse all / expand all affect cards only", () => {
    let s = collapseReducer(emptyCollapse(), { type: "collapseAll", ids: ["relay", "adsb", "maps"] });
    expect(Object.keys(s.cards).sort()).toEqual(["adsb", "maps", "relay"]);
    expect(s.hub).toBe(false);
    s = collapseReducer(s, { type: "expandAll" });
    expect(s.cards).toEqual({});
  });
  it("reveal opens the hub and that card but leaves other cards as they were", () => {
    const s = collapseReducer({ hub: true, cards: { maps: true, adsb: true } }, { type: "reveal", id: "adsb" });
    expect(s).toEqual({ hub: false, cards: { maps: true } });
  });
  it("is pure and ignores unknown actions", () => {
    const a = { hub: false, cards: { x: true } };
    collapseReducer(a, { type: "toggleCard", id: "x" });
    expect(a).toEqual({ hub: false, cards: { x: true } });
    expect(collapseReducer(a, { type: "nope" })).toEqual(a);
  });
});
