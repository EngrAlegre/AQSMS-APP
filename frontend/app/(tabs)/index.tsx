import { useRouter } from "expo-router";
import { ArrowClockwise, Clock, Database } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { normalizeBaseUrl } from "@/src/api/httpClient";
import { Banner } from "@/src/components/Banner";
import { ConnectionBadge } from "@/src/components/ConnectionBadge";
import { EmptyState } from "@/src/components/EmptyState";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SensorCard, SensorCardSkeleton } from "@/src/components/SensorCard";
import { POND_NAME, STALE_AFTER_MINUTES } from "@/src/config";
import { useNow } from "@/src/hooks/useNow";
import { useLatestReading, useThresholds } from "@/src/hooks/usePondData";
import { deriveConnection, freshnessHeadline } from "@/src/logic/connection";
import { formatAge, formatAgo, isStaleAgeSeconds, readingAgeSeconds, statusFor } from "@/src/logic/status";
import { PARAMETER_ORDER } from "@/src/models/parameters";
import { usesNativeTabs } from "@/src/navigation";
import { checkLocalNetwork } from "@/src/network/networkCheck";
import { useSettings } from "@/src/settings/SettingsContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Dashboard() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const { baseUrl } = useSettings();
  const latest = useLatestReading();
  const thresholds = useThresholds();
  const now = useNow();
  const [wifiHint, setWifiHint] = useState<string | null>(null);

  const reading = latest.data?.reading ?? null;
  // Age the reading from single-clock intervals only: the Pi's own age_seconds,
  // advanced by the phone's elapsed time since that response arrived. The one
  // thing we never do is subtract the phone's clock from the Pi's stored
  // timestamp -- they drift apart once the Pi has no internet time source.
  const ageSeconds = reading
    ? readingAgeSeconds({
        timestamp: reading.timestamp,
        ageSeconds: latest.data?.ageSeconds,
        ageAsOfMs: latest.dataUpdatedAt,
        nowMs: now,
      })
    : null;
  const stale = ageSeconds !== null && isStaleAgeSeconds(ageSeconds);
  const err = latest.error ? toApiError(latest.error) : null;
  const conn = deriveConnection({ hasData: !!reading, isLoading: latest.isLoading, error: latest.error, stale });
  const pondName = latest.data?.pondName ?? POND_NAME;

  useEffect(() => {
    let alive = true;
    if (err && (err.kind === "unreachable" || err.kind === "timeout")) {
      let host: string | null = null;
      try {
        host = normalizeBaseUrl(baseUrl).host;
      } catch {}
      checkLocalNetwork(host).then((h) => alive && setWifiHint(h.warning));
    }
    return () => {
      alive = false;
    };
  }, [baseUrl, err?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    latest.refetch();
    thresholds.refetch();
  };
  const refreshing = latest.isFetching || thresholds.isFetching;

  const thresholdLabel =
    thresholds.data?.sourceLabel ?? (thresholds.error ? "Thresholds unavailable" : "Loading thresholds…");

  return (
    <View testID="dashboard-screen" style={styles.root}>
      <ScreenHeader
        eyebrow="RASPBERRY PI · POND MONITOR"
        title={pondName}
        right={<ConnectionBadge state={conn} />}
        testID="dashboard-header"
      >
        <View style={styles.metaRow}>
          <Clock size={16} color={colors.onSurfaceTertiary} />
          <Text testID="last-updated-text" style={styles.metaText}>
            {freshnessHeadline(conn, ageSeconds)}
          </Text>
        </View>
      </ScreenHeader>

      <ScrollView
        testID="dashboard-scroll"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.brand} colors={[colors.brandPrimary]} />}
      >
        {err && !latest.data ? (
          <Banner
            testID="dashboard-error-banner"
            tone="error"
            title={err.title}
            message={err.message}
            actionLabel={err.kind === "invalid_config" ? "Open Settings" : "Retry"}
            onAction={err.kind === "invalid_config" ? () => router.push("/(tabs)/settings") : refresh}
          />
        ) : null}

        {err && latest.data ? (
          <Banner
            testID="dashboard-cached-banner"
            tone="warning"
            title={`Not live · showing data received ${formatAgo(latest.dataUpdatedAt)}`}
            message={`Latest refresh failed: ${err.message}`}
          />
        ) : null}

        {wifiHint && err ? <Banner testID="wifi-hint-banner" tone="warning" title="Possible wrong Wi-Fi" message={wifiHint} /> : null}

        {!err && stale && reading ? (
          <Banner
            testID="stale-reading-banner"
            tone="warning"
            title="Reading is stale"
            message={
              ageSeconds !== null && ageSeconds >= 0
                ? `The newest reading is ${formatAge(ageSeconds)}, past the ${STALE_AFTER_MINUTES}-minute limit. Sensors or the Pi may have stopped sending data.`
                : `The newest reading is timestamped ahead of the Pi's clock, so it cannot be trusted as current. Sensors or the Pi may have stopped sending data.`
            }
          />
        ) : null}

        {thresholds.error ? (
          <Banner
            testID="thresholds-error-banner"
            tone="info"
            title="Thresholds unavailable"
            message="The Pi did not return thresholds, so status shows No Data. Values are still shown."
          />
        ) : null}

        {latest.isLoading ? (
          PARAMETER_ORDER.map((k) => <SensorCardSkeleton key={k} />)
        ) : latest.data && !reading ? (
          <EmptyState
            testID="dashboard-empty-state"
            icon={<Database size={32} color={colors.brand} />}
            title="No readings yet"
            message="The Pi responded but has no stored readings for this pond."
          />
        ) : reading ? (
          PARAMETER_ORDER.map((k) => (
            <SensorCard
              key={k}
              param={k}
              value={reading.values[k]}
              status={statusFor(k, reading.values[k], thresholds.data)}
              threshold={thresholds.data?.values[k] ?? null}
              thresholdLabel={thresholdLabel}
              stale={stale || !!err}
            />
          ))
        ) : null}

        {reading ? (
          <Text style={styles.footnote}>
            Latest reading: {formatAge(ageSeconds ?? -1)}. Received by the app {formatAgo(latest.dataUpdatedAt)}. Auto-refresh every 30 s while open.
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomChrome + spacing.md }]}>
        <Pressable
          testID="dashboard-refresh-button"
          onPress={refresh}
          disabled={refreshing}
          style={({ pressed }) => [styles.refresh, (pressed || refreshing) && { opacity: 0.8 }]}
        >
          {refreshing ? <ActivityIndicator color={colors.onBrandPrimary} /> : <ArrowClockwise size={20} color={colors.onBrandPrimary} weight="bold" />}
          <Text style={styles.refreshText}>{refreshing ? "Refreshing…" : "Refresh readings"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  metaText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceTertiary },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  footnote: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: spacing.xs },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  refresh: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { fontFamily: fonts.textSemi, fontSize: 16, color: c.onBrandPrimary },
}));
