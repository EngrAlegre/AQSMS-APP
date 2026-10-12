/**
 * ============================================================================
 *  RASPBERRY PI LOCAL API CONTRACT  —  v1.1
 * ============================================================================
 *
 * This is the ONLY file that knows about the Pi's endpoint paths and JSON
 * shapes. The Pi server (pi-server/) implements the same contract.
 *
 * Endpoints (all JSON, UTC ISO-8601 timestamps, snake_case):
 *
 *  GET  {base}/health            -> { "status": "ok", "timestamp": "...",
 *                                     "registration_open": true }
 *  POST {base}/auth/login        -> { "token": "...", "display_name": "...",
 *                                     "role": "owner"|"caretaker",
 *                                     "status": "active"|"disabled" }
 *                                     (403 {"code":"account_disabled"} for a
 *                                      disabled account with the right password)
 *  POST {base}/auth/register     -> { "token": "...", "display_name": "...",
 *                                     "role": "caretaker", "status": "active" }
 *                                     (201; always creates a CARETAKER.
 *                                      409 {"code":"username_taken"})
 *  GET  {base}/auth/me           -> { "username": "...", "display_name": "...",
 *                                     "role": "...", "status": "...",
 *                                     "created_at": null|"..." }
 *  GET  {base}/readings/latest   -> { "pond_name": "Test Pond 1",
 *                                     "reading": { "timestamp": "...",
 *                                                  "ph": 7.2|null,
 *                                                  "temperature_c": 28.1|null,
 *                                                  "dissolved_oxygen_mg_l": 6.4|null }
 *                                     | null }
 *  GET  {base}/readings?limit=N  -> { "readings": [ <reading>, ... ] }
 *  GET  {base}/alerts?limit=N    -> { "alerts": [ { "id": "17",
 *                                     "timestamp": "...",
 *                                     "parameter": "ph"|"temperature"|"dissolved_oxygen",
 *                                     "value": 2.8|null,
 *                                     "threshold": "min 3.0 mg/L",
 *                                     "status": "warning"|"unsafe",
 *                                     "message": "..." } ] }
 *  GET  {base}/thresholds        -> { "approved": false,
 *                                     "ph": { "safe_min": null, ... },
 *                                     "temperature": { ... },
 *                                     "dissolved_oxygen": { ... } }
 *
 *  ---- Owner/Admin only. A caretaker token gets 403 everywhere below. ----
 *
 *  GET  {base}/admin/users                     -> { "users": [ <account>, ... ] }
 *                                                 Caretakers only; the fixed
 *                                                 Owner/Admin is never listed.
 *  POST {base}/admin/users                     -> { "user": <account> } (201)
 *  POST {base}/admin/users/{u}/disable         -> { "user": <account> }
 *  POST {base}/admin/users/{u}/enable          -> { "user": <account> }
 *
 *  <account> = { "username": "...", "display_name": "...",
 *                "role": "owner"|"caretaker", "status": "active"|"disabled",
 *                "created_at": null|"..." }
 *
 * There is deliberately no endpoint that changes a role, deletes an account,
 * reads or resets someone else's password, writes thresholds, or manages SMS
 * recipients. See pi-server/server.py.
 *
 * Every authenticated request re-reads the caller's role and status on the Pi.
 * The role is not carried in the token, so a role change or a disable takes
 * effect on the very next request.
 *
 * Units: pH (unitless), temperature (°C), dissolved_oxygen (mg/L).
 * Null sensor value = sensor not reporting. Never treated as Safe.
 * ============================================================================
 */
import { MalformedResponseError } from "./errors";
import {
  AccountStatus,
  AlertRecord,
  LatestReadingResult,
  ManagedUser,
  ParameterKey,
  ParameterThreshold,
  Reading,
  ThresholdSet,
  UserRole,
} from "@/src/models/types";

export const CONTRACT_STATUS = "v1.1 — Pi server contract defined (roles)";

export const ENDPOINTS = {
  health: "/health",
  latestReading: "/readings/latest",
  readingHistory: (limit: number) => `/readings?limit=${limit}`,
  alerts: (limit: number) => `/alerts?limit=${limit}`,
  thresholds: "/thresholds",
  login: "/auth/login",
  register: "/auth/register",
  me: "/auth/me",
  adminUsers: "/admin/users",
  adminUserDisable: (username: string) => `/admin/users/${encodeURIComponent(username)}/disable`,
  adminUserEnable: (username: string) => `/admin/users/${encodeURIComponent(username)}/enable`,
};


/** Authentication is always via the Raspberry Pi local API. */
export const AUTH_PROVIDER: "pi" = "pi";

export function buildAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
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

/** Only these status values are accepted from the Pi. Unknown values are rejected. */
const VALID_ALERT_STATUSES = new Set(["warning", "unsafe", "critical"]);

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
      // Reject unknown/malformed statuses instead of quietly mapping them.
      if (!VALID_ALERT_STATUSES.has(s)) {
        throw new MalformedResponseError(
          `alert #${i} has unknown status "${raw.status}" (expected "warning", "unsafe", or "critical")`,
        );
      }
      const status: "warning" | "unsafe" = s === "warning" ? "warning" : "unsafe";
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

// ---------------------------------------------------------------------------
// Roles and statuses
// ---------------------------------------------------------------------------
const ROLES = new Set<UserRole>(["owner", "caretaker"]);
const STATUSES = new Set<AccountStatus>(["active", "disabled"]);

/**
 * The role the Pi reported, or a hard failure.
 *
 * There is no fallback. Defaulting an unknown role to "caretaker" would hide a
 * genuine version mismatch, and defaulting it to "owner" would be far worse.
 * The diagram's rule for an unsupported role is to deny access, so an
 * unrecognised or absent role throws and the sign-in fails loudly.
 */
function readRole(v: unknown): UserRole {
  if (typeof v === "string" && ROLES.has(v as UserRole)) return v as UserRole;
  throw new MalformedResponseError(
    `the Pi did not report a usable account role (got ${JSON.stringify(v)}). ` +
      "This phone's app and the Pi server are probably different versions — " +
      "update the app and the Pi together.",
  );
}

function readStatus(v: unknown): AccountStatus {
  if (typeof v === "string" && STATUSES.has(v as AccountStatus)) return v as AccountStatus;
  throw new MalformedResponseError(
    `the Pi did not report a usable account status (got ${JSON.stringify(v)}). ` +
      "This phone's app and the Pi server are probably different versions.",
  );
}

export function mapLoginResponse(json: unknown): {
  token: string;
  displayName: string | null;
  role: UserRole;
  status: AccountStatus;
} {
  if (!isObj(json) || typeof json.token !== "string") throw new MalformedResponseError("login response has no token");
  return {
    token: json.token,
    displayName: typeof json.display_name === "string" ? json.display_name : null,
    // Both are required: a token without a verified role is not a usable session.
    role: readRole(json.role),
    status: readStatus(json.status),
  };
}

/** Registration returns the same shape as login, always with role "caretaker". */
export const mapRegisterResponse = mapLoginResponse;

/** One account row, as returned by /auth/me and the /admin/users endpoints. */
export function mapAccount(json: unknown, context: string): ManagedUser {
  if (!isObj(json)) throw new MalformedResponseError(`${context} is not an object`);
  if (typeof json.username !== "string" || !json.username) {
    throw new MalformedResponseError(`${context} has no username`);
  }
  return {
    username: json.username,
    displayName: typeof json.display_name === "string" && json.display_name ? json.display_name : json.username,
    role: readRole(json.role),
    status: readStatus(json.status),
    createdAt: typeof json.created_at === "string" ? json.created_at : null,
  };
}

/** /auth/me — the authenticated identity, freshly read from the Pi. */
export function mapMeResponse(json: unknown): ManagedUser {
  return mapAccount(json, "auth/me response");
}

/** /admin/users — the caretaker accounts. The Owner/Admin is never in this list. */
export function mapAdminUsers(json: unknown): ManagedUser[] {
  const raw = listFrom(json, "users");
  const users = raw.map((u, i) => mapAccount(u, `users[${i}]`));
  // Belt and braces: the Pi does not send an owner, but if one ever appeared
  // here the screen must not offer to disable it.
  return users.filter((u) => u.role === "caretaker").sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * /health reports whether the Pi is currently accepting public caretaker
 * registration, so the app can offer or withdraw "Register as Caretaker"
 * instead of assuming a policy.
 */
export function mapHealthRegistrationOpen(json: unknown): boolean {
  return isObj(json) && json.registration_open === true;
}

