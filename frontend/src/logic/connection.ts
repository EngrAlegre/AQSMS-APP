import { ApiError } from "@/src/api/errors";

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
