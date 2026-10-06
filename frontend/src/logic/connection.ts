import { ApiError } from "@/src/api/errors";
import { DataMode } from "@/src/models/types";

export type ConnectionState =
  | "connecting"
  | "live"
  | "simulated"
  | "stale"
  | "cached"
  | "unreachable"
  | "not_configured"
  | "bad_data";

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  simulated: "Demo data",
  stale: "Stale",
  cached: "Not live",
  unreachable: "Unreachable",
  not_configured: "Not set up",
  bad_data: "Bad data",
};

interface Input {
  mode: DataMode;
  hasData: boolean;
  isLoading: boolean;
  error: unknown;
  stale: boolean;
}

/** Never returns "live" for demo data or for cached data after a failed refresh. */
export function deriveConnection({ mode, hasData, isLoading, error, stale }: Input): ConnectionState {
  if (error) {
    const kind = error instanceof ApiError ? error.kind : "unreachable";
    if (kind === "invalid_config") return "not_configured";
    if (hasData) return "cached";
    if (kind === "malformed") return "bad_data";
    return "unreachable";
  }
  if (isLoading && !hasData) return "connecting";
  if (stale) return "stale";
  return mode === "demo" ? "simulated" : "live";
}
