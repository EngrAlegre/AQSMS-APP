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
  if (value === null || value === undefined || Number.isNaN(value)) return "no_data";
  if (!t) return "no_data";
  const belowSafe = t.safeMin !== null && value < t.safeMin;
  const aboveSafe = t.safeMax !== null && value > t.safeMax;
  if (!belowSafe && !aboveSafe) return "safe";
  const belowWarn = t.warnMin !== null && value < t.warnMin;
  const aboveWarn = t.warnMax !== null && value > t.warnMax;
  return belowWarn || aboveWarn ? "unsafe" : "warning";
}

export function statusFor(key: ParameterKey, value: number | null, thresholds: ThresholdSet | null | undefined) {
  return evaluateStatus(value, thresholds?.values[key]);
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

export function readingAgeMinutes(timestamp: string, now: number): number {
  return (now - new Date(timestamp).getTime()) / 60000;
}

export function isStale(timestamp: string, now: number): boolean {
  return readingAgeMinutes(timestamp, now) > STALE_AFTER_MINUTES;
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
