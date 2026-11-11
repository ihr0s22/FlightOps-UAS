// Pure business logic (dates, fleet usage roll-ups). No React/DOM so it can be unit-tested.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round2 = (v) => Math.round(v * 100) / 100;
export const healthPerCycle = (b) => 40 / (b.cycleLimit || 500);

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Days from `now` until a date. A date-only string (an expiry like "2026-06-30") stays valid through
// the END of that local day, so nothing shows as expired the evening before. Full timestamps are exact.
export const daysUntil = (dateStr, now = new Date()) => {
  if (!dateStr) return null;
  const m = DATE_ONLY.exec(dateStr);
  const target = m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : new Date(dateStr);
  return (target - now) / 86400000;
};

// Calendar-day arithmetic on a YYYY-MM-DD string, done in UTC so DST changes can never shift the result.
export const addDays = (dateStr, days) => {
  const m = DATE_ONLY.exec(dateStr);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Saving a flight rolls its usage up into the fleet: aircraft hours (+dur/60) & cycles (+1),
// and each used battery's cycles (+1). Hours keep 3 decimals (not 1) so many short flights don't lose time to rounding;
// the UI rounds for display. On edit we apply the delta vs. the prior version so
// re-saving (or reassigning aircraft/batteries) never double-counts.
export function applyFlight(d, flight, newId) {
  const id = flight.id || newId;
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
    : { ...a, hours: +Math.max(0, (a.hours || 0) + (hoursD[a.id] || 0)).toFixed(3), cycles: Math.max(0, (a.cycles || 0) + (cyclesD[a.id] || 0)) });
  const batteries = d.batteries.map(b => {
    const dc = batD[b.id];
    if (dc == null) return b;
    return { ...b, cycles: Math.max(0, (b.cycles || 0) + dc), health: clamp(round2((b.health ?? 100) - dc * healthPerCycle(b)), 0, 100) };
  });
  return { ...d, flights, aircraft, batteries };
}

// lucide's Plane icon is drawn with its nose toward the UPPER RIGHT (45 degrees clockwise from north), so a CSS
// rotation of the raw track would point every aircraft 45 degrees too far clockwise. Returns the rotation (0-360)
// that makes the nose point along `hdg` (degrees clockwise from north), or null when the heading is unknown.
export const PLANE_ICON_NOSE_DEG = 45;
export function planeIconRotation(hdg) {
  if (hdg === null || hdg === undefined || hdg === "") return null;
  const n = Number(hdg);
  if (!Number.isFinite(n)) return null;
  return (((n - PLANE_ICON_NOSE_DEG) % 360) + 360) % 360;
}
