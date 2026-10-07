import { ChartLine } from "phosphor-react-native";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { Banner } from "@/src/components/Banner";
import { EmptyState } from "@/src/components/EmptyState";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Segmented } from "@/src/components/Segmented";
import { statusColors } from "@/src/components/StatusChip";
import { TrendChart } from "@/src/components/TrendChart";
import { useReadingHistory, useThresholds } from "@/src/hooks/usePondData";
import { formatShort, formatValue, statusFor } from "@/src/logic/status";
import { PARAMETERS, PARAMETER_ORDER } from "@/src/models/parameters";
import { ParameterKey, Reading } from "@/src/models/types";
import { usesNativeTabs } from "@/src/navigation";
import { useSettings } from "@/src/settings/SettingsContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const OPTIONS: { value: ParameterKey; label: string }[] = PARAMETER_ORDER.map((k) => ({
  value: k,
  label: PARAMETERS[k].shortLabel,
}));

export default function History() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { mode } = useSettings();
  const [param, setParam] = useState<ParameterKey>("ph");
  const history = useReadingHistory();
  const thresholds = useThresholds();
  const readings = useMemo(() => history.data ?? [], [history.data]);
  const meta = PARAMETERS[param];

  const stats = useMemo(() => {
    const vals = readings.map((r) => r.values[param]).filter((v): v is number => v !== null);
    if (!vals.length) return null;
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      missing: readings.length - vals.length,
    };
  }, [readings, param]);

  const points = useMemo(
    () => [...readings].reverse().map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.values[param] })),
    [readings, param],
  );

  const err = history.error ? toApiError(history.error) : null;

  const header = (
    <View style={styles.headerBlock}>
      {mode === "demo" ? (
        <Banner testID="history-demo-banner" tone="demo" title="DEMO MODE · sample history" message="Simulated records for UI review, not sensor data." />
      ) : null}
      {err ? (
        <Banner
          testID="history-error-banner"
          tone={history.data ? "warning" : "error"}
          title={history.data ? "Not live · showing previously loaded history" : err.title}
          message={err.message}
          actionLabel="Retry"
          onAction={() => history.refetch()}
        />
      ) : null}
      {readings.length ? (
        <View testID="trend-card" style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>
              {meta.label} · last {readings.length} records
            </Text>
            <Text style={styles.unit}>{meta.unit}</Text>
          </View>
          <TrendChart points={points} threshold={thresholds.data?.values[param] ?? null} decimals={meta.decimals} />
          <View style={styles.legend}>
            <View style={styles.legendSwatch} />
            <Text style={styles.legendText}>
              Shaded band = safe range ({thresholds.data?.sourceLabel ?? "thresholds unavailable"})
            </Text>
          </View>
          {stats ? (
            <View testID="trend-stats" style={styles.stats}>
              {[
                ["MIN", formatValue(param, stats.min)],
                ["AVG", formatValue(param, stats.avg)],
                ["MAX", formatValue(param, stats.max)],
                ["MISSING", String(stats.missing)],
              ].map(([l, v]) => (
                <View key={l} style={styles.stat}>
                  <Text style={styles.statLabel}>{l}</Text>
                  <Text style={styles.statValue}>{v}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {readings.length ? <Text style={styles.sectionLabel}>RECORDS · NEWEST FIRST</Text> : null}
    </View>
  );

  const renderItem = ({ item }: { item: Reading }) => (
    <View testID="history-record-row" style={styles.row}>
      <Text style={styles.rowTime}>{formatShort(item.timestamp)}</Text>
      <View style={styles.rowValues}>
        {PARAMETER_ORDER.map((k) => {
          const v = item.values[k];
          const s = statusFor(k, v, thresholds.data);
          const active = k === param;
          return (
            <View key={k} style={styles.rowCell}>
              <Text style={[styles.cellLabel, active && { color: colors.brand }]}>{PARAMETERS[k].shortLabel}</Text>
              <Text style={[styles.cellValue, { color: v === null ? colors.muted : s === "safe" ? colors.onSurface : statusColors(colors, s).fg }]}>
                {formatValue(k, v)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <View testID="history-screen" style={styles.root}>
      <ScreenHeader eyebrow="READING HISTORY" title="Trends & Records" testID="history-header">
        <View style={styles.segment}>
          <Segmented<ParameterKey> testID="history-parameter-selector" options={OPTIONS} value={param} onChange={setParam} />
        </View>
      </ScreenHeader>
      {history.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator testID="history-loading" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          testID="history-list"
          data={readings}
          keyExtractor={(r) => r.timestamp}
          renderItem={renderItem}
          ListHeaderComponent={header}
          initialNumToRender={20}
          ListEmptyComponent={
            err ? null : (
              <EmptyState
                testID="history-empty-state"
                icon={<ChartLine size={32} color={colors.brand} />}
                title="No history yet"
                message="No readings have been returned for this pond."
              />
            )
          }
          contentContainerStyle={[styles.list, { paddingBottom: spacing.xl + bottomChrome }]}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => history.refetch()} tintColor={colors.brand} colors={[colors.brandPrimary]} />}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  segment: { marginTop: spacing.md },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.lg, gap: spacing.sm },
  headerBlock: { gap: spacing.md, marginBottom: spacing.xs },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontFamily: fonts.textSemi, fontSize: 15, color: c.onSurface, flex: 1 },
  unit: { fontFamily: fonts.display, fontSize: 16, color: c.onSurfaceTertiary },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legendSwatch: { width: 14, height: 10, borderRadius: 2, backgroundColor: c.successSoft, borderWidth: 1, borderColor: c.success },
  legendText: { fontFamily: fonts.text, fontSize: 12, color: c.muted, flex: 1 },
  stats: { flexDirection: "row", borderTopWidth: 1, borderTopColor: c.divider, paddingTop: spacing.md },
  stat: { flex: 1, gap: 2 },
  statLabel: { fontFamily: fonts.textSemi, fontSize: 10, letterSpacing: 1.2, color: c.muted },
  statValue: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, fontVariant: ["tabular-nums"] },
  sectionLabel: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.4, color: c.muted, marginTop: spacing.sm },
  row: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  rowTime: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceTertiary },
  rowValues: { flexDirection: "row" },
  rowCell: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  cellLabel: { fontFamily: fonts.textSemi, fontSize: 11, color: c.muted },
  cellValue: { fontFamily: fonts.displayBold, fontSize: 20, fontVariant: ["tabular-nums"] },
}));
