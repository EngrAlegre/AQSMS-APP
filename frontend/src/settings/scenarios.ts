import { DemoScenario } from "@/src/models/types";

export const DEMO_SCENARIO_LABEL: Record<DemoScenario, string> = {
  normal: "Normal readings",
  stale: "Stale reading (~50 min old)",
  missing: "Missing sensor values",
  unreachable: "Pi unreachable / wrong Wi-Fi",
  malformed: "Malformed Pi response",
  no_alerts: "Empty alert history",
};

export const DEMO_SCENARIOS = Object.keys(DEMO_SCENARIO_LABEL) as DemoScenario[];
