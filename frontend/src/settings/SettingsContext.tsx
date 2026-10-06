import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { DataMode, DemoScenario } from "@/src/models/types";
import { storage } from "@/src/utils/storage";

const K_MODE = "aqua.mode";
const K_URL = "aqua.baseUrl";
const K_SCENARIO = "aqua.demoScenario";

interface SettingsValue {
  loaded: boolean;
  mode: DataMode;
  baseUrl: string;
  demoScenario: DemoScenario;
  setMode(m: DataMode): void;
  setBaseUrl(url: string): void;
  setDemoScenario(s: DemoScenario): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [mode, setModeState] = useState<DataMode>("demo");
  const [baseUrl, setUrlState] = useState("");
  const [demoScenario, setScenarioState] = useState<DemoScenario>("normal");

  useEffect(() => {
    (async () => {
      setModeState(((await storage.getItem(K_MODE, "demo")) as DataMode) ?? "demo");
      setUrlState((await storage.getItem(K_URL, "")) ?? "");
      setScenarioState(((await storage.getItem(K_SCENARIO, "normal")) as DemoScenario) ?? "normal");
      setLoaded(true);
    })();
  }, []);

  const setMode = useCallback((m: DataMode) => {
    setModeState(m);
    storage.setItem(K_MODE, m);
  }, []);
  const setBaseUrl = useCallback((u: string) => {
    setUrlState(u);
    storage.setItem(K_URL, u);
  }, []);
  const setDemoScenario = useCallback((s: DemoScenario) => {
    setScenarioState(s);
    storage.setItem(K_SCENARIO, s);
  }, []);

  const value = useMemo(
    () => ({ loaded, mode, baseUrl, demoScenario, setMode, setBaseUrl, setDemoScenario }),
    [loaded, mode, baseUrl, demoScenario, setMode, setBaseUrl, setDemoScenario],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
