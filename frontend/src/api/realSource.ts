import { ALERTS_LIMIT, HISTORY_LIMIT } from "@/src/config";
import { ConnectionTestResult } from "@/src/models/types";

import type { PondDataSource } from "./dataSource";
import { toApiError } from "./errors";
import { requestJson } from "./httpClient";
import {
  buildAuthHeaders,
  ENDPOINTS,
  mapAlerts,
  mapHealthRegistrationOpen,
  mapLatestReading,
  mapReadingHistory,
  mapThresholds,
} from "./piApiContract";

/** REAL API MODE: calls the Raspberry Pi on the local Wi-Fi. */
export function createRealSource(baseUrl: string, token: string | null): PondDataSource {
  const headers = buildAuthHeaders(token);
  const get = async (path: string) => (await requestJson(baseUrl, path, { headers })).json;
  return {
    getLatest: async () => mapLatestReading(await get(ENDPOINTS.latestReading)),
    getHistory: async () => mapReadingHistory(await get(ENDPOINTS.readingHistory(HISTORY_LIMIT))),
    getAlerts: async () => mapAlerts(await get(ENDPOINTS.alerts(ALERTS_LIMIT))),
    getThresholds: async () => mapThresholds(await get(ENDPOINTS.thresholds)),
  };
}

/** Tests the address typed in Settings or on the sign-in screen. */
export async function testPiConnection(baseUrl: string): Promise<ConnectionTestResult> {
  try {
    const res = await requestJson(baseUrl, ENDPOINTS.health);
    return {
      reachable: true,
      ok: true,
      latencyMs: res.latencyMs,
      title: "Connected to Raspberry Pi",
      detail: `Health check answered in ${res.latencyMs} ms (HTTP ${res.status}).`,
    };
  } catch (e) {
    const err = toApiError(e);
    const reachable = err.kind === "http" || err.kind === "malformed";
    // React Native reports a certificate the phone does not trust in exactly the
    // same way as an unreachable host, so on an https:// address say so instead
    // of sending the farmer to check the Wi-Fi and the power.
    const tlsHint =
      err.kind === "unreachable" && baseUrl.trim().toLowerCase().startsWith("https://")
        ? " If the Pi is powered on and reachable, the phone may not trust its certificate. Install an APK built with the Pi's CA certificate, or use the http:// address until you have."
        : "";
    return { reachable, ok: false, latencyMs: null, title: err.title, detail: err.message + tlsHint };
  }
}

/**
 * Whether the Pi is currently accepting public caretaker registration.
 *
 * Returns null when the Pi could not be asked. null is deliberately distinct
 * from false: an unreachable Pi is not evidence that registration was closed,
 * and treating it as closed would hide a working "Register as Caretaker".
 */
export async function fetchRegistrationOpen(baseUrl: string): Promise<boolean | null> {
  try {
    const res = await requestJson(baseUrl, ENDPOINTS.health);
    return mapHealthRegistrationOpen(res.json);
  } catch {
    return null;
  }
}
