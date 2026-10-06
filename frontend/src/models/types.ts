// Typed data models used by the UI. The API layer maps raw Pi responses into
// these shapes (see src/api/piApiContract.ts); screens never read raw JSON.

export type ParameterKey = "ph" | "temperature" | "dissolvedOxygen";

export type StatusKind = "safe" | "warning" | "unsafe" | "no_data";

export type DataMode = "demo" | "real";

/** Demo-only scenarios used to review UI states before the Pi exists. */
export type DemoScenario =
  | "normal"
  | "stale"
  | "missing"
  | "unreachable"
  | "malformed"
  | "no_alerts";

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
  /** Threshold text exactly as reported (or built from demo thresholds). */
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

export interface Session {
  username: string;
  displayName: string;
  provider: "mock" | "pi";
  token: string | null;
}
