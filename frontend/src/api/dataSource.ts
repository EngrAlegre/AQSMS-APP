import { AlertRecord, ConnectionTestResult, DataMode, DemoScenario, LatestReadingResult, Reading, ThresholdSet } from "@/src/models/types";

import { createDemoSource } from "./demoSource";
import { createRealSource } from "./realSource";

/** Everything the screens need. Demo and Real implementations share this interface. */
export interface PondDataSource {
  getLatest(): Promise<LatestReadingResult>;
  getHistory(): Promise<Reading[]>;
  getAlerts(): Promise<AlertRecord[]>;
  getThresholds(): Promise<ThresholdSet>;
}

export function createDataSource(opts: {
  mode: DataMode;
  baseUrl: string;
  scenario: DemoScenario;
  token: string | null;
}): PondDataSource {
  return opts.mode === "demo" ? createDemoSource(opts.scenario) : createRealSource(opts.baseUrl, opts.token);
}

export type { ConnectionTestResult };
