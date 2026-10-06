import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AUTO_REFRESH_MS } from "@/src/config";
import { createDataSource } from "@/src/api/dataSource";
import { useAuth } from "@/src/auth/AuthContext";
import { useSettings } from "@/src/settings/SettingsContext";

function useSource() {
  const { mode, baseUrl, demoScenario, loaded } = useSettings();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const source = useMemo(
    () => createDataSource({ mode, baseUrl, scenario: demoScenario, token }),
    [mode, baseUrl, demoScenario, token],
  );
  // Mode/URL/scenario are part of every key so demo data never shows under real mode.
  return { source, key: [mode, baseUrl, demoScenario] as const, loaded, mode };
}

export function useLatestReading() {
  const { source, key, loaded } = useSource();
  return useQuery({
    queryKey: ["latest", ...key],
    queryFn: () => source.getLatest(),
    enabled: loaded,
    refetchInterval: AUTO_REFRESH_MS,
    retry: 0,
  });
}

export function useThresholds() {
  const { source, key, loaded } = useSource();
  return useQuery({
    queryKey: ["thresholds", ...key],
    queryFn: () => source.getThresholds(),
    enabled: loaded,
    retry: 0,
  });
}

export function useReadingHistory() {
  const { source, key, loaded } = useSource();
  return useQuery({ queryKey: ["history", ...key], queryFn: () => source.getHistory(), enabled: loaded, retry: 0 });
}

export function useAlertHistory() {
  const { source, key, loaded } = useSource();
  return useQuery({ queryKey: ["alerts", ...key], queryFn: () => source.getAlerts(), enabled: loaded, retry: 0 });
}
