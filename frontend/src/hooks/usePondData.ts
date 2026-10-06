import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AUTO_REFRESH_MS } from "@/src/config";
import { createDataSource, PondDataSource } from "@/src/api/dataSource";
import { useAuth } from "@/src/auth/AuthContext";
import { DataMode } from "@/src/models/types";
import { useSettings } from "@/src/settings/SettingsContext";

function useSource() {
  const { mode, baseUrl, demoScenario, loaded } = useSettings();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const source = useMemo(
    () => createDataSource({ mode, baseUrl, scenario: demoScenario, token }),
    [mode, baseUrl, demoScenario, token],
  );
  return { source, key: [mode, baseUrl, demoScenario] as const, loaded, mode };
}

/**
 * Every result is stamped with the mode that produced it. If the stamp does
 * not match the current mode, the data is dropped: demo/mock values can never
 * be shown while Real Pi mode is active (and vice versa).
 */
function useModeQuery<T>(name: string, fetcher: (s: PondDataSource) => Promise<T>, refetchInterval?: number) {
  const { source, key, loaded, mode } = useSource();
  const q = useQuery({
    queryKey: [name, ...key],
    queryFn: async (): Promise<{ origin: DataMode; value: T }> => ({ origin: mode, value: await fetcher(source) }),
    enabled: loaded,
    retry: 0,
    refetchInterval,
  });
  const matches = q.data?.origin === mode;
  return {
    data: matches ? q.data!.value : undefined,
    error: q.error,
    isLoading: q.isLoading || (q.data !== undefined && !matches),
    isFetching: q.isFetching,
    dataUpdatedAt: q.dataUpdatedAt,
    refetch: q.refetch,
  };
}

export const useLatestReading = () => useModeQuery("latest", (s) => s.getLatest(), AUTO_REFRESH_MS);
export const useThresholds = () => useModeQuery("thresholds", (s) => s.getThresholds());
export const useReadingHistory = () => useModeQuery("history", (s) => s.getHistory());
export const useAlertHistory = () => useModeQuery("alerts", (s) => s.getAlerts());
