import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { DataMode, DemoScenario } from "@/src/models/types";
import { DEMO_SCENARIOS } from "@/src/settings/scenarios";
import { useTheme } from "@/src/theme";
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

/**
 * Settings are hydrated from storage BEFORE any screen renders, so a stored
 * value can never overwrite a choice the user just made (which previously
 * could silently flip Real mode back to Demo). Mode only changes when the
 * user taps the selector; nothing in the app switches it automatically.
 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [mode, setModeState] = useState<DataMode>("demo");
  const [baseUrl, setUrlState] = useState("");
  const [demoScenario, setScenarioState] = useState<DemoScenario>("normal");

  useEffect(() => {
    (async () => {
      const m = await storage.getItem(K_MODE, "demo" as string);
      const u = await storage.getItem(K_URL, "" as string);
      const s = await storage.getItem(K_SCENARIO, "normal" as string);
      setModeState(m === "real" ? "real" : "demo");
      setUrlState(typeof u === "string" ? u : "");
      setScenarioState(DEMO_SCENARIOS.includes(s as DemoScenario) ? (s as DemoScenario) : "normal");
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

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
