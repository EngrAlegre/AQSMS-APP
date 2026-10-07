import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AUTO_REFRESH_MS } from "@/src/config";
import { createDataSource, PondDataSource } from "@/src/api/dataSource";
import { ApiError } from "@/src/api/errors";
import { useAuth } from "@/src/auth/AuthContext";
import { useSettings } from "@/src/settings/SettingsContext";

function useSource() {
  const { baseUrl, piConfigured, loaded } = useSettings();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const source = useMemo(
    () => createDataSource({ baseUrl, token }),
    [baseUrl, token],
  );
  return { source, key: [baseUrl] as const, loaded, piConfigured };
}

function usePiQuery<T>(name: string, fetcher: (s: PondDataSource) => Promise<T>, refetchInterval?: number) {
  const { source, key, loaded, piConfigured } = useSource();
  const q = useQuery({
    queryKey: [name, ...key],
    queryFn: async (): Promise<T> => fetcher(source),
    enabled: loaded && piConfigured,
    retry: 0,
    refetchInterval,
  });

  // When the Pi is not configured, surface a clear error so the UI can show
  // "Pi not configured" instead of a blank loading state.
  const notConfiguredError = !piConfigured
    ? new ApiError("invalid_config", "Pi not configured", "Enter the Raspberry Pi address in Settings to connect.")
    : null;

  return {
    data: q.data,
    error: notConfiguredError ?? q.error,
    isLoading: piConfigured ? q.isLoading : false,
    isFetching: q.isFetching,
    dataUpdatedAt: q.dataUpdatedAt,
    refetch: q.refetch,
  };
}

export const useLatestReading = () => usePiQuery("latest", (s) => s.getLatest(), AUTO_REFRESH_MS);
export const useThresholds = () => usePiQuery("thresholds", (s) => s.getThresholds());
export const useReadingHistory = () => usePiQuery("history", (s) => s.getHistory());
export const useAlertHistory = () => usePiQuery("alerts", (s) => s.getAlerts());
