import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const K_URL = "aqua.baseUrl";

interface SettingsValue {
  loaded: boolean;
  baseUrl: string;
  /** true when a non-empty Pi base URL has been saved. */
  piConfigured: boolean;
  setBaseUrl(url: string): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [baseUrl, setUrlState] = useState("");

  useEffect(() => {
    (async () => {
      const u = await storage.getItem(K_URL, "" as string);
      setUrlState(typeof u === "string" ? u : "");
      setLoaded(true);
    })();
  }, []);

  const setBaseUrl = useCallback((u: string) => {
    setUrlState(u);
    storage.setItem(K_URL, u);
  }, []);

  const piConfigured = baseUrl.trim().length > 0;

  const value = useMemo(
    () => ({ loaded, baseUrl, piConfigured, setBaseUrl }),
    [loaded, baseUrl, piConfigured, setBaseUrl],
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
