import { ALERTS_LIMIT, HISTORY_LIMIT } from "@/src/config";
import { ConnectionTestResult } from "@/src/models/types";

import type { PondDataSource } from "./dataSource";
import { toApiError } from "./errors";
import { requestJson } from "./httpClient";
import {
  buildAuthHeaders,
  ENDPOINTS,
  mapAlerts,
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

/** Tests the address typed in Settings (always a real network call, even in Demo Mode). */
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
    return { reachable, ok: false, latencyMs: null, title: err.title, detail: err.message };
  }
}
