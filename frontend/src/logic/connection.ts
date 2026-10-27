import { ApiError } from "@/src/api/errors";
import { formatAge } from "@/src/logic/status";

export type ConnectionState =
  | "connecting"
  | "live"
  | "stale"
  | "cached"
  | "unreachable"
  | "not_configured"
  | "no_data"
  | "bad_data";

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  stale: "Stale",
  cached: "Not live",
  unreachable: "Unreachable",
  not_configured: "Not set up",
  no_data: "No data",
  bad_data: "Bad data",
};

interface Input {
  /** True only when a real sensor reading exists — not merely an HTTP 200. */
  hasData: boolean;
  isLoading: boolean;
  error: unknown;
  stale: boolean;
}

/**
 * Never returns "live" for cached data after a failed refresh, and never for a
 * response that carried no reading (e.g. an empty Pi database).
 */
export function deriveConnection({ hasData, isLoading, error, stale }: Input): ConnectionState {
  if (error) {
    const kind = error instanceof ApiError ? error.kind : "unreachable";
    if (kind === "invalid_config") return "not_configured";
    if (hasData) return "cached";
    if (kind === "malformed") return "bad_data";
    return "unreachable";
  }
  if (isLoading && !hasData) return "connecting";
  // The Pi answered but has no reading to show. Not a live measurement.
  if (!hasData) return "no_data";
  if (stale) return "stale";
  return "live";
}

/**
 * The dashboard's one-line freshness lead.
 *
 * Deliberately leads with Live / Not live and a *duration* rather than a clock
 * time. The Pi has no reliable time source (it has no internet once it hosts its
 * own Wi-Fi), so a wall-clock time it stamped is not something a farmer should
 * be asked to reason about. "Not live · 3 h old" answers the only question that
 * matters, and cannot be fooled by a drifting clock.
 *
 * `ageSeconds` must be the single-clock age from logic/status.ts. It is null
 * when there is no reading, or when the Pi is too old to send an age.
 *
 * A negative age (the stored reading is ahead of the reference clock) renders as
 * a bare "Not live": we know it is not current, and we refuse to print a
 * reassuring "just now" next to it.
 */
export function freshnessHeadline(state: ConnectionState, ageSeconds: number | null): string {
  switch (state) {
    case "live": {
      if (ageSeconds === null || !Number.isFinite(ageSeconds) || ageSeconds < 60) return "Live · updated just now";
      return `Live · last reading ${formatAge(ageSeconds)}`;
    }
    case "connecting":
      return "Connecting…";
    case "no_data":
      return "No reading received yet";
    case "not_configured":
      return "Pi not set up";
    case "unreachable":
      return "Not live · Can't reach the Pi";
    case "bad_data":
      return "Not live · Unreadable data from the Pi";
    case "stale":
    case "cached":
      // Under a minute there is no duration worth printing: "Not live · just now"
      // contradicts itself. The banner below carries the detail.
      if (ageSeconds === null || !Number.isFinite(ageSeconds) || ageSeconds < 60) return "Not live";
      return `Not live · ${formatAge(ageSeconds)}`;
  }
}
