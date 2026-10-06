import { POND_NAME } from "@/src/config";
import { DemoScenario } from "@/src/models/types";

import type { PondDataSource } from "./dataSource";
import { buildDemoRawAlerts, buildDemoRawReadings, DEMO_THRESHOLDS } from "./demoData";
import { ApiError } from "./errors";
import { mapAlerts, mapLatestReading, mapReadingHistory } from "./piApiContract";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DEMO MODE: realistic sample data, no network. Scenarios simulate failure states. */
export function createDemoSource(scenario: DemoScenario): PondDataSource {
  async function guard() {
    await delay(450);
    if (scenario === "unreachable") {
      throw new ApiError(
        "unreachable",
        "Can't reach the Pi (simulated)",
        "Demo scenario: the phone is not on the pond's Wi-Fi or the Pi is off. Check Wi-Fi and Pi power.",
      );
    }
  }
  return {
    async getLatest() {
      await guard();
      if (scenario === "malformed") {
        return mapLatestReading({ reading: { timestamp: new Date().toISOString(), ph: "7,2", temperature_c: 28 } });
      }
      const [latest] = buildDemoRawReadings(scenario);
      return mapLatestReading({ pond_name: POND_NAME, reading: latest });
    },
    async getHistory() {
      await guard();
      if (scenario === "malformed") return mapReadingHistory({ rows: [] });
      return mapReadingHistory({ readings: buildDemoRawReadings(scenario) });
    },
    async getAlerts() {
      await guard();
      if (scenario === "malformed") return mapAlerts({ alerts: [{ parameter: "salinity" }] });
      if (scenario === "no_alerts") return mapAlerts({ alerts: [] });
      const history = mapReadingHistory({ readings: buildDemoRawReadings(scenario) });
      return mapAlerts(buildDemoRawAlerts(history));
    },
    async getThresholds() {
      await delay(150);
      return DEMO_THRESHOLDS;
    },
  };
}
