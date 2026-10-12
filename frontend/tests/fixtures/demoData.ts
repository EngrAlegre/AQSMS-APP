/**
 * TEST FIXTURES ONLY. Not shipped in the app bundle and not reachable from any
 * screen — the runtime app has exactly one data source, the Raspberry Pi.
 *
 * Threshold numbers below are placeholders invented for test assertions. Sue
 * has not approved any species limits, so the real Pi serves NULL limits with
 * approved = 0 (see pi-server/db.py).
 *
 * Fixture payloads are produced in the same raw JSON shape the Pi returns and
 * are passed through the real mappers in src/api/piApiContract.ts, so the
 * mapping and validation code is exercised too.
 */
import { ThresholdSet } from "../../src/models/types";

/** Which edge case a generated history should contain. */
export type FixtureScenario = "normal" | "stale" | "missing";

const PLACEHOLDER_LIMITS: ThresholdSet["values"] = {
  ph: { safeMin: 6.5, safeMax: 8.5, warnMin: 6.0, warnMax: 9.0 },
  temperature: { safeMin: 26, safeMax: 30, warnMin: 24, warnMax: 32 },
  dissolvedOxygen: { safeMin: 5, safeMax: null, warnMin: 3, warnMax: null },
};

/** Mirrors what the real Pi serves today: limits present but NOT approved. */
export const FIXTURE_THRESHOLDS_UNAPPROVED: ThresholdSet = {
  approved: false,
  sourceLabel: "Test fixture · not approved",
  values: PLACEHOLDER_LIMITS,
};

/**
 * Only for exercising the safe/warning/unsafe banding. Reaching this state in
 * production requires Sue's written approval being recorded on the Pi.
 */
export const FIXTURE_THRESHOLDS_APPROVED: ThresholdSet = {
  approved: true,
  sourceLabel: "Test fixture · approved",
  values: PLACEHOLDER_LIMITS,
};

const STEP_MS = 5 * 60 * 1000;
const COUNT = 288; // 24 h at 5-minute intervals
const DAY = 24 * 3600 * 1000;

// Deterministic pseudo-noise from a timestamp so values are stable between runs.
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

export interface RawReading {
  timestamp: string;
  ph: number | null;
  temperature_c: number | null;
  dissolved_oxygen_mg_l: number | null;
}

/** Raw reading rows in the Pi's wire format, newest first. */
export function buildRawReadings(scenario: FixtureScenario, now = Date.now()): RawReading[] {
  const shift = scenario === "stale" ? 47 * 60 * 1000 : 0;
  const latest = Math.floor((now - 60 * 1000) / STEP_MS) * STEP_MS - shift;
  const out: RawReading[] = [];
  for (let i = 0; i < COUNT; i++) {
    const t = latest - i * STEP_MS;
    let ph = 7.45 + 0.55 * wave(t, 9) + noise(t, 1) * 0.12;
    const temp = 28 + 2.3 * wave(t, 8) + noise(t, 2) * 0.3;
    let dox = 6.1 + 1.9 * wave(t, 6) + noise(t, 3) * 0.25;
    // Aeration failure ~5 h back, to produce an Unsafe dissolved-oxygen event.
    if (i >= 58 && i <= 64) dox = 2.7 + Math.abs(61 - i) * 0.25;
    // pH spike ~14 h back, to produce a Warning event.
    if (i >= 166 && i <= 170) ph = 8.75 + noise(t, 4) * 0.1;
    const r: RawReading = {
      timestamp: new Date(t).toISOString(),
      ph: round(ph, 2),
      temperature_c: round(temp, 1),
      dissolved_oxygen_mg_l: round(dox, 2),
    };
    // Occasional sensor dropouts so missing-value handling is covered.
    if (i === 23 || i === 120) r.ph = null;
    if (i === 77) r.dissolved_oxygen_mg_l = null;
    if (scenario === "missing" && i === 0) {
      // Newest record: pH and DO missing, temperature present.
      r.ph = null;
      r.dissolved_oxygen_mg_l = null;
    }
    if (scenario === "missing" && i === 1) r.temperature_c = null;
    out.push(r);
  }
  return out;
}
