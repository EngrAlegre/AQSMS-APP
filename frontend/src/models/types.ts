// Typed data models used by the UI. The API layer maps raw Pi responses into
// these shapes (see src/api/piApiContract.ts); screens never read raw JSON.

export type ParameterKey = "ph" | "temperature" | "dissolvedOxygen";

export type StatusKind = "safe" | "warning" | "unsafe" | "no_data";

export interface Reading {
  /** ISO-8601 timestamp of when the sensors took the reading. */
  timestamp: string;
  /** null = sensor value missing in the record. */
  values: Record<ParameterKey, number | null>;
}

export interface LatestReadingResult {
  pondName: string | null;
  reading: Reading | null;
}

/**
 * Range model: inside [safeMin, safeMax] = Safe. Outside safe but inside
 * [warnMin, warnMax] = Warning. Outside warn limits = Unsafe.
 * null = no limit on that side (e.g. dissolved oxygen has no upper limit).
 */
export interface ParameterThreshold {
  safeMin: number | null;
  safeMax: number | null;
  warnMin: number | null;
  warnMax: number | null;
}

export interface ThresholdSet {
  values: Record<ParameterKey, ParameterThreshold>;
  /** true only when the backend explicitly marks them as approved. */
  approved: boolean;
  sourceLabel: string;
}

export interface AlertRecord {
  id: string;
  timestamp: string;
  parameter: ParameterKey;
  value: number | null;
  /** Threshold text exactly as reported by the Pi. */
  threshold: string;
  status: "warning" | "unsafe";
  message: string;
}

export interface ConnectionTestResult {
  reachable: boolean;
  ok: boolean;
  latencyMs: number | null;
  title: string;
  detail: string;
}

/**
 * The two roles the Pi can return. There is exactly one `owner` account, fixed
 * and provisioned on the Pi; everything else is a `caretaker`.
 *
 * These are the only accepted values. Anything else -- a missing field, a typo,
 * a role a future server invents -- is refused at the API boundary rather than
 * defaulted, because defaulting is how a phone ends up showing owner screens to
 * a caretaker.
 */
export type UserRole = "owner" | "caretaker";

/** `disabled` accounts are refused by the Pi on every request. */
export type AccountStatus = "active" | "disabled";

export interface Session {
  username: string;
  displayName: string;
  provider: "pi";
  token: string | null;
  /**
   * Role and status as reported by the Pi at sign-in, or by /auth/me when a
   * saved session is restored. They drive which screens exist for this user.
   * They are never authoritative: the Pi enforces every permission itself, so
   * a tampered session can only change what is drawn, not what is allowed.
   */
  role: UserRole;
  status: AccountStatus;
}

/** A caretaker account as listed by the Owner/Admin screen. */
export interface ManagedUser {
  username: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string | null;
}

