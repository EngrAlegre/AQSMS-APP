import { AlertRecord, ConnectionTestResult, LatestReadingResult, Reading, ThresholdSet } from "@/src/models/types";

import { createRealSource } from "./realSource";

/** Everything the screens need — always backed by the real Pi API. */
export interface PondDataSource {
  getLatest(): Promise<LatestReadingResult>;
  getHistory(): Promise<Reading[]>;
  getAlerts(): Promise<AlertRecord[]>;
  getThresholds(): Promise<ThresholdSet>;
}

export function createDataSource(opts: {
  baseUrl: string;
  token: string | null;
}): PondDataSource {
  return createRealSource(opts.baseUrl, opts.token);
}

export type { ConnectionTestResult };
