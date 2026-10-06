/**
 * ============================================================================
 *  RASPBERRY PI LOCAL API CONTRACT  —  *** PLACEHOLDER, NOT FINAL ***
 * ============================================================================
 *
 * This is the ONLY file that knows about the Pi's endpoint paths and JSON
 * shapes. The real Pi API (local REST + SQLite) has not been defined yet.
 * Everything below is an assumed example. Once the Pi API is defined:
 *   1. Update ENDPOINTS with the real paths / query parameters.
 *   2. Update the map* functions so they turn the real JSON into the typed
 *      models in src/models/types.ts.
 *   3. If the Pi provides sign-in, set AUTH_PROVIDER = "pi" and update
 *      mapLoginResponse + buildAuthHeaders.
 * Screens, components and the demo data never need to change.
 *
 * Assumed example payloads (snake_case, ISO-8601 or epoch-seconds timestamps):
 *
 *  GET {base}/health            -> 2xx with any body, e.g. { "status": "ok" }
 *  GET {base}/readings/latest   -> { "pond_name": "Test Pond 1",
 *                                    "reading": { "timestamp": "2026-06-01T08:00:00Z",
 *                                                 "ph": 7.2, "temperature_c": 28.1,
 *                                                 "dissolved_oxygen_mg_l": 6.4 } }
 *  GET {base}/readings?limit=N  -> { "readings": [ <reading>, ... ] }   (or a bare array)
 *  GET {base}/alerts?limit=N    -> { "alerts": [ { "id": "17", "timestamp": "...",
 *                                    "parameter": "dissolved_oxygen", "value": 2.8,
 *                                    "threshold": "min 3.0 mg/L", "status": "unsafe",
 *                                    "message": "DO critically low" } ] }   (or a bare array)
 *  GET {base}/thresholds        -> { "approved": false,
 *                                    "ph": { "safe_min": 6.5, "safe_max": 8.5,
 *                                            "warn_min": 6.0, "warn_max": 9.0 },
 *                                    "temperature": {...}, "dissolved_oxygen": {...} }
 *  POST {base}/auth/login       -> { "token": "...", "display_name": "..." }  (only if AUTH_PROVIDER = "pi")
 * ============================================================================
 */
import { MalformedResponseError } from "./errors";
import {
  AlertRecord,
  LatestReadingResult,
  ParameterKey,
  ParameterThreshold,
  Reading,
  ThresholdSet,
} from "@/src/models/types";

export const CONTRACT_STATUS = "PLACEHOLDER — Pi API not defined yet";

export const ENDPOINTS = {
  health: "/health",
  latestReading: "/readings/latest",
  readingHistory: (limit: number) => `/readings?limit=${limit}`,
  alerts: (limit: number) => `/alerts?limit=${limit}`,
  thresholds: "/thresholds",
  login: "/auth/login",
};

/** "mock" = local demo account on the phone. Switch to "pi" when the Pi provides sign-in. */
export const AUTH_PROVIDER: "mock" | "pi" = "mock";

export function buildAuthHeaders(token: string | null): Record<string, string> {
  return AUTH_PROVIDER === "pi" && token ? { Authorization: `Bearer ${token}` } : {};
}

/** Raw parameter names used by the Pi -> app model keys. */
const PARAM_NAME_MAP: Record<string, ParameterKey> = {
  ph: "ph",
  temperature: "temperature",
  temperature_c: "temperature",
  dissolved_oxygen: "dissolvedOxygen",
  dissolved_oxygen_mg_l: "dissolvedOxygen",
  do: "dissolvedOxygen",
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numOrNull(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  throw new MalformedResponseError(`field "${field}" is not a number (got ${JSON.stringify(v)})`);
}

function parseTimestamp(v: unknown, field: string): string {
  let d: Date | null = null;
  if (typeof v === "number" && Number.isFinite(v)) d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === "string" && v.trim()) d = new Date(v);
  if (!d || Number.isNaN(d.getTime())) {
    throw new MalformedResponseError(`field "${field}" is not a valid timestamp`);
  }
  return d.toISOString();
}

function listFrom(json: unknown, key: string): unknown[] {
  if (Array.isArray(json)) return json;
  if (isObj(json) && Array.isArray(json[key])) return json[key] as unknown[];
  throw new MalformedResponseError(`expected a list or an object with "${key}"`);
}

// ---------------------------------------------------------------------------
// Mappers: raw Pi JSON -> typed app models
// ---------------------------------------------------------------------------
export function mapReading(raw: unknown): Reading {
  if (!isObj(raw)) throw new MalformedResponseError("reading is not an object");
  return {
    timestamp: parseTimestamp(raw.timestamp, "timestamp"),
    values: {
      ph: numOrNull(raw.ph, "ph"),
      temperature: numOrNull(raw.temperature_c, "temperature_c"),
      dissolvedOxygen: numOrNull(raw.dissolved_oxygen_mg_l, "dissolved_oxygen_mg_l"),
    },
  };
}

export function mapLatestReading(json: unknown): LatestReadingResult {
  if (!isObj(json)) throw new MalformedResponseError("latest-reading response is not an object");
  const pondName = typeof json.pond_name === "string" ? json.pond_name : null;
  // Accept either { reading: {...} } or the reading at the root.
  const raw = "reading" in json ? json.reading : json;
  return { pondName, reading: raw === null ? null : mapReading(raw) };
}

export function mapReadingHistory(json: unknown): Reading[] {
  return listFrom(json, "readings")
    .map(mapReading)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function mapAlerts(json: unknown): AlertRecord[] {
  return listFrom(json, "alerts")
    .map((raw, i): AlertRecord => {
      if (!isObj(raw)) throw new MalformedResponseError(`alert #${i} is not an object`);
      const parameter = PARAM_NAME_MAP[String(raw.parameter ?? "").toLowerCase()];
      if (!parameter) throw new MalformedResponseError(`alert #${i} has unknown parameter "${raw.parameter}"`);
      const s = String(raw.status ?? "").toLowerCase();
      const status = s === "unsafe" || s === "critical" ? "unsafe" : "warning";
      return {
        id: String(raw.id ?? i),
        timestamp: parseTimestamp(raw.timestamp, `alerts[${i}].timestamp`),
        parameter,
        value: numOrNull(raw.value, `alerts[${i}].value`),
        threshold: raw.threshold === undefined || raw.threshold === null ? "Not provided" : String(raw.threshold),
        status,
        message: typeof raw.message === "string" ? raw.message : "",
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function mapOneThreshold(raw: unknown, name: string): ParameterThreshold {
  if (!isObj(raw)) throw new MalformedResponseError(`threshold "${name}" missing`);
  return {
    safeMin: numOrNull(raw.safe_min, `${name}.safe_min`),
    safeMax: numOrNull(raw.safe_max, `${name}.safe_max`),
    warnMin: numOrNull(raw.warn_min, `${name}.warn_min`),
    warnMax: numOrNull(raw.warn_max, `${name}.warn_max`),
  };
}

export function mapThresholds(json: unknown): ThresholdSet {
  if (!isObj(json)) throw new MalformedResponseError("thresholds response is not an object");
  const approved = json.approved === true;
  return {
    approved,
    sourceLabel: approved ? "From Raspberry Pi · approved" : "From Raspberry Pi · not marked approved",
    values: {
      ph: mapOneThreshold(json.ph, "ph"),
      temperature: mapOneThreshold(json.temperature, "temperature"),
      dissolvedOxygen: mapOneThreshold(json.dissolved_oxygen, "dissolved_oxygen"),
    },
  };
}

export function mapLoginResponse(json: unknown): { token: string; displayName: string | null } {
  if (!isObj(json) || typeof json.token !== "string") throw new MalformedResponseError("login response has no token");
  return { token: json.token, displayName: typeof json.display_name === "string" ? json.display_name : null };
}
