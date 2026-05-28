// Unit conversion helpers. Internal canonical units are SI:
//   distance: meters | speed: m/s | temp: C | voltage: V | current: A
// UI converts at the display layer using user setting (metric|imperial).

export function fmtDistance(meters, system = "metric", digits = 0) {
  if (meters == null || isNaN(meters)) return "—";
  if (system === "imperial") {
    const ft = meters * 3.28084;
    if (Math.abs(ft) >= 5280) return (ft / 5280).toFixed(2) + " mi";
    return ft.toFixed(digits) + " ft";
  }
  if (Math.abs(meters) >= 1000) return (meters / 1000).toFixed(2) + " km";
  return meters.toFixed(digits) + " m";
}

export function fmtSpeed(mps, system = "metric", digits = 1) {
  if (mps == null || isNaN(mps)) return "—";
  if (system === "imperial") return (mps * 2.23694).toFixed(digits) + " mph";
  return (mps * 3.6).toFixed(digits) + " km/h";
}

export function fmtAltitude(meters, system = "metric") {
  if (meters == null || isNaN(meters)) return "—";
  if (system === "imperial") return (meters * 3.28084).toFixed(0) + " ft";
  return meters.toFixed(1) + " m";
}

export function fmtVoltage(v, digits = 2) {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(digits) + " V";
}

export function fmtCurrent(a, digits = 2) {
  if (a == null || isNaN(a)) return "—";
  return a.toFixed(digits) + " A";
}

export function fmtPercent(p, digits = 0) {
  if (p == null || isNaN(p)) return "—";
  return p.toFixed(digits) + "%";
}

export function fmtAngle(deg, digits = 0) {
  if (deg == null || isNaN(deg)) return "—";
  return deg.toFixed(digits) + "°";
}

export function fmtSeconds(s) {
  if (s == null || isNaN(s)) return "00:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
