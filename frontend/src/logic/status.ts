import { format, formatDistanceToNowStrict } from "date-fns";

import { STALE_AFTER_MINUTES } from "@/src/config";
import { PARAMETERS } from "@/src/models/parameters";
import { ParameterKey, ParameterThreshold, StatusKind, ThresholdSet } from "@/src/models/types";

export const STATUS_LABEL: Record<StatusKind, string> = {
  safe: "Safe",
  warning: "Warning",
  unsafe: "Unsafe",
  no_data: "No Data",
};

export function evaluateStatus(value: number | null, t: ParameterThreshold | null | undefined): StatusKind {
  // Missing value => "No Data". Never Safe.
  if (typeof value !== "number" || !Number.isFinite(value)) return "no_data";
  if (!t) return "no_data";
  const belowSafe = t.safeMin !== null && value < t.safeMin;
  const aboveSafe = t.safeMax !== null && value > t.safeMax;
  if (!belowSafe && !aboveSafe) return "safe";
  const belowWarn = t.warnMin !== null && value < t.warnMin;
  const aboveWarn = t.warnMax !== null && value > t.warnMax;
  return belowWarn || aboveWarn ? "unsafe" : "warning";
}

export function statusFor(key: ParameterKey, value: number | null, thresholds: ThresholdSet | null | undefined) {
  const raw = evaluateStatus(value, thresholds?.values[key]);
  // Unapproved or unavailable thresholds must never yield Safe.
  // The value is still displayed, but the status indicator shows No Data.
  if (raw === "safe" && thresholds && !thresholds.approved) return "no_data" as StatusKind;
  return raw;
}

export function formatValue(key: ParameterKey, value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toFixed(PARAMETERS[key].decimals);
}

function n(key: ParameterKey, v: number) {
  return v.toFixed(PARAMETERS[key].decimals === 2 ? 1 : PARAMETERS[key].decimals);
}

/** e.g. "6.5 – 8.5" or "≥ 5.0" */
export function formatSafeRange(key: ParameterKey, t: ParameterThreshold | null | undefined): string {
  if (!t) return "Not available";
  if (t.safeMin !== null && t.safeMax !== null) return `${n(key, t.safeMin)} – ${n(key, t.safeMax)}`;
  if (t.safeMin !== null) return `≥ ${n(key, t.safeMin)}`;
  if (t.safeMax !== null) return `≤ ${n(key, t.safeMax)}`;
  return "No limits";
}

/** e.g. "< 6.0 or > 9.0" */
export function formatUnsafeRule(key: ParameterKey, t: ParameterThreshold | null | undefined): string {
  if (!t) return "Not available";
  const parts: string[] = [];
  if (t.warnMin !== null) parts.push(`< ${n(key, t.warnMin)}`);
  if (t.warnMax !== null) parts.push(`> ${n(key, t.warnMax)}`);
  return parts.length ? parts.join(" or ") : "No limits";
}

/** The staleness threshold in seconds. Single source: STALE_AFTER_MINUTES. */
export const STALE_AFTER_SECONDS = STALE_AFTER_MINUTES * 60;

export function readingAgeMinutes(timestamp: string, now: number): number {
  return (now - new Date(timestamp).getTime()) / 60000;
}

export function isStale(timestamp: string, now: number): boolean {
  return readingAgeMinutes(timestamp, now) > STALE_AFTER_MINUTES;
}

/**
 * Everything needed to age a reading without ever subtracting two machines'
 * clocks.
 *
 * `ageSeconds` comes from the Pi and is measured entirely on the Pi's clock;
 * `ageAsOfMs` and `nowMs` are both the phone's clock, so the interval between
 * them is also single-clock. The one thing that must NEVER be done is to take
 * the reading's own timestamp and subtract the phone's clock from it — that is
 * two clocks, and on a Pi with no internet time source they drift apart.
 */
export interface ReadingAgeInput {
  /** ISO-8601 reading timestamp exactly as stored (Pi clock). */
  timestamp: string;
  /** `age_seconds` from GET /readings/latest; null when the Pi did not send one. */
  ageSeconds: number | null | undefined;
  /** Phone-clock ms when the response carrying ageSeconds arrived. */
  ageAsOfMs: number;
  /** Phone clock now. */
  nowMs: number;
}

/**
 * Signed age of the reading in seconds.
 *
 * Prefers the Pi's single-clock `age_seconds`, advanced by the time elapsed on
 * the *phone's* clock since that response arrived (a same-machine interval, so
 * drift over a 30 s poll is fractions of a millisecond). Falls back to the
 * legacy phone-clock difference only when the Pi sent no age at all, i.e. an
 * older Pi.
 *
 * The result stays signed. A negative value is a real signal — the stored
 * reading is ahead of the reference clock — and callers must not mask it.
 */
export function readingAgeSeconds({ timestamp, ageSeconds, ageAsOfMs, nowMs }: ReadingAgeInput): number {
  if (typeof ageSeconds === "number" && Number.isFinite(ageSeconds)) {
    return ageSeconds + Math.max(0, nowMs - ageAsOfMs) / 1000;
  }
  return readingAgeMinutes(timestamp, nowMs) * 60;
}

/**
 * true when the reading must not be shown as fresh.
 *
 * A negative age counts as stale, deliberately. That is the whole point: a Pi
 * clock that ran ahead, or a stored reading from the future, makes the naive
 * subtraction negative, and treating a negative age as "just now" is how a
 * board that stopped sending hours ago keeps a live-looking dashboard.
 */
export function isStaleAgeSeconds(ageSeconds: number): boolean {
  return !Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > STALE_AFTER_SECONDS;
}

/** Convenience: is the reading described by `input` stale? */
export function isStaleReading(input: ReadingAgeInput): boolean {
  return isStaleAgeSeconds(readingAgeSeconds(input));
}

/**
 * A display phrase for an age: "just now" | "5 min old" | "3 h old" | "2 d old".
 *
 * A negative or non-finite age yields "unknown age", never "just now". Printing
 * "just now" for a reading we know is *not* current is precisely the lie this
 * whole change exists to remove. Judge freshness with isStaleAgeSeconds, not
 * with this string.
 */
export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown age";
  const s = Math.floor(seconds);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min old`;
  if (s < 86400) return `${Math.floor(s / 3600)} h old`;
  return `${Math.floor(s / 86400)} d old`;
}

export function formatClock(ts: string | number): string {
  return format(new Date(ts), "HH:mm:ss");
}

export function formatDateTime(ts: string | number): string {
  return format(new Date(ts), "MMM d, yyyy · HH:mm");
}

export function formatShort(ts: string | number): string {
  return format(new Date(ts), "MMM d · HH:mm");
}

export function formatAgo(ts: string | number): string {
  const d = new Date(ts);
  if (d.getTime() > Date.now()) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}
