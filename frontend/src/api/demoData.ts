/**
 * DEMO MODE sample data. Clearly NOT sensor data. Thresholds below are
 * placeholders for UI review only — species and limits are not confirmed.
 *
 * Demo payloads are produced in the same (placeholder) raw JSON shape the Pi
 * is assumed to return, then passed through the real mappers in
 * piApiContract.ts so the mapping/validation code is exercised too.
 */
import { evaluateStatus, formatSafeRange, formatUnsafeRule } from "@/src/logic/status";
import { PARAMETERS, PARAMETER_ORDER } from "@/src/models/parameters";
import { DemoScenario, Reading, ThresholdSet } from "@/src/models/types";

export const DEMO_THRESHOLDS: ThresholdSet = {
  approved: false,
  sourceLabel: "Demo thresholds – not approved",
  values: {
    ph: { safeMin: 6.5, safeMax: 8.5, warnMin: 6.0, warnMax: 9.0 },
    temperature: { safeMin: 26, safeMax: 30, warnMin: 24, warnMax: 32 },
    dissolvedOxygen: { safeMin: 5, safeMax: null, warnMin: 3, warnMax: null },
  },
};

const STEP_MS = 5 * 60 * 1000;
const COUNT = 288; // 24 h
const DAY = 24 * 3600 * 1000;

// Deterministic pseudo-noise from a timestamp so values are stable between refreshes.
function noise(t: number, salt: number) {
  const x = Math.sin((t / STEP_MS) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function wave(t: number, phaseHours: number) {
  return Math.sin((2 * Math.PI * (t - phaseHours * 3600 * 1000)) / DAY);
}

function round(v: number, d: number) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

interface RawReading {
  timestamp: string;
  ph: number | null;
  temperature_c: number | null;
  dissolved_oxygen_mg_l: number | null;
}

export function buildDemoRawReadings(scenario: DemoScenario, now = Date.now()): RawReading[] {
  const shift = scenario === "stale" ? 47 * 60 * 1000 : 0;
  const latest = Math.floor((now - 60 * 1000) / STEP_MS) * STEP_MS - shift;
  const out: RawReading[] = [];
  for (let i = 0; i < COUNT; i++) {
    const t = latest - i * STEP_MS;
    let ph = 7.45 + 0.55 * wave(t, 9) + noise(t, 1) * 0.12;
    let temp = 28 + 2.3 * wave(t, 8) + noise(t, 2) * 0.3;
    let dox = 6.1 + 1.9 * wave(t, 6) + noise(t, 3) * 0.25;
    // Scripted aeration failure ~5 h ago to produce an Unsafe event.
    if (i >= 58 && i <= 64) dox = 2.7 + (Math.abs(61 - i) * 0.25);
    // Scripted pH spike ~14 h ago.
    if (i >= 166 && i <= 170) ph = 8.75 + noise(t, 4) * 0.1;
    const r: RawReading = {
      timestamp: new Date(t).toISOString(),
      ph: round(ph, 2),
      temperature_c: round(temp, 1),
      dissolved_oxygen_mg_l: round(dox, 2),
    };
    // Occasional sensor dropouts so "missing value" handling is visible.
    if (i === 23 || i === 120) r.ph = null;
    if (i === 77) r.dissolved_oxygen_mg_l = null;
    if (scenario === "missing" && i === 0) {
      // Latest record: pH and DO missing, temperature present.
      r.ph = null;
      r.dissolved_oxygen_mg_l = null;
    }
    if (scenario === "missing" && i === 1) r.temperature_c = null;
    out.push(r);
  }
  return out;
}

/** Alert records derived from the demo history (one per transition into Warning/Unsafe). */
export function buildDemoRawAlerts(readings: Reading[]) {
  const chronological = [...readings].reverse();
  const alerts: Record<string, unknown>[] = [];
  for (const key of PARAMETER_ORDER) {
    const t = DEMO_THRESHOLDS.values[key];
    let prev = "safe";
    for (const r of chronological) {
      const v = r.values[key];
      const s = evaluateStatus(v, t);
      if (s === "no_data") continue;
      const rank = s === "unsafe" ? 2 : s === "warning" ? 1 : 0;
      const prevRank = prev === "unsafe" ? 2 : prev === "warning" ? 1 : 0;
      if (rank > prevRank) {
        const meta = PARAMETERS[key];
        const unit = key === "ph" ? "" : ` ${meta.unit}`;
        const dir = t.safeMin !== null && v !== null && v < t.safeMin ? "below" : "above";
        alerts.push({
          id: `demo-${key}-${r.timestamp}`,
          timestamp: r.timestamp,
          parameter: key === "dissolvedOxygen" ? "dissolved_oxygen" : key,
          value: v,
          threshold: `Demo safe ${formatSafeRange(key, t)}${unit} · unsafe ${formatUnsafeRule(key, t)}${unit}`,
          status: s,
          message:
            s === "unsafe"
              ? `${meta.label} ${dir} demo unsafe limit. Sample alert – SMS would be sent by the ESP32 unit, not this app.`
              : `${meta.label} ${dir} demo safe range.`,
        });
      }
      prev = s;
    }
  }
  return { alerts };
}
