import { CheckCircle, ChatText } from "phosphor-react-native";
import React from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { Banner } from "@/src/components/Banner";
import { EmptyState } from "@/src/components/EmptyState";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { PARAM_ICON } from "@/src/components/SensorCard";
import { StatusChip, statusColors } from "@/src/components/StatusChip";
import { useAlertHistory } from "@/src/hooks/usePondData";
import { formatDateTime, formatValue } from "@/src/logic/status";
import { PARAMETERS } from "@/src/models/parameters";
import { AlertRecord } from "@/src/models/types";
import { usesNativeTabs } from "@/src/navigation";
import { useSettings } from "@/src/settings/SettingsContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Alerts() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { mode } = useSettings();
  const alerts = useAlertHistory();
  const err = alerts.error ? toApiError(alerts.error) : null;
  const data = alerts.data ?? [];

  const header = (
    <View style={styles.headerBlock}>
      {mode === "demo" ? (
        <Banner testID="alerts-demo-banner" tone="demo" title="DEMO MODE · sample alerts" message="Alert records below are part of the demo data set." />
      ) : null}
      <View testID="sms-note" style={styles.note}>
        <ChatText size={18} color={colors.onSurfaceTertiary} />
        <Text style={styles.noteText}>
          {"This list shows only alert records reported by the Raspberry Pi. Critical SMS alerts are sent separately by the pond's ESP32 cellular module; this app does not send SMS."}
        </Text>
      </View>
      {err ? (
        <Banner
          testID="alerts-error-banner"
          tone={alerts.data ? "warning" : "error"}
          title={alerts.data ? "Not live · showing previously loaded alerts" : err.title}
          message={err.message}
          actionLabel="Retry"
          onAction={() => alerts.refetch()}
        />
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: AlertRecord }) => {
    const meta = PARAMETERS[item.parameter];
    const Icon = PARAM_ICON[item.parameter];
    const tone = statusColors(colors, item.status);
    return (
      <View testID={`alert-row-${item.id}`} style={styles.row}>
        <View style={[styles.rowAccent, { backgroundColor: tone.fg }]} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <View style={styles.paramRow}>
              <Icon size={18} color={tone.fg} weight="bold" />
              <Text style={styles.paramName}>{meta.label}</Text>
            </View>
            <StatusChip status={item.status} compact />
          </View>
          <View style={styles.valueRow}>
            <Text style={[styles.value, { color: tone.fg }]}>{formatValue(item.parameter, item.value)}</Text>
            <Text style={styles.unit}>{meta.unit}</Text>
          </View>
          <Text style={styles.threshold}>
            <Text style={styles.thresholdLabel}>THRESHOLD </Text>
            {item.threshold}
          </Text>
          {item.message ? <Text style={styles.message}>{item.message}</Text> : null}
          <Text style={styles.time}>{formatDateTime(item.timestamp)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View testID="alerts-screen" style={styles.root}>
      <ScreenHeader
        eyebrow="ALERT HISTORY"
        title="Alerts"
        testID="alerts-header"
        right={
          alerts.data ? (
            <View style={styles.count}>
              <Text testID="alerts-count" style={styles.countText}>
                {data.length} {data.length === 1 ? "record" : "records"}
              </Text>
            </View>
          ) : null
        }
      />
      {alerts.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator testID="alerts-loading" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          testID="alerts-list"
          data={data}
          keyExtractor={(a) => a.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            err ? null : (
              <EmptyState
                testID="alerts-empty-state"
                icon={<CheckCircle size={34} color={colors.success} weight="fill" />}
                title="No alerts recorded"
                message="No alert records have been returned for this pond."
              />
            )
          }
          contentContainerStyle={[styles.list, { paddingBottom: spacing.xl + bottomChrome }]}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => alerts.refetch()} tintColor={colors.brand} colors={[colors.brandPrimary]} />}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.lg, gap: spacing.md },
  headerBlock: { gap: spacing.md },
  note: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  noteText: { flex: 1, fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceTertiary },
  count: {
    paddingHorizontal: spacing.md,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    justifyContent: "center",
  },
  countText: { fontFamily: fonts.textSemi, fontSize: 12, color: c.onSurfaceSecondary },
  row: {
    flexDirection: "row",
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  rowAccent: { width: 4 },
  rowBody: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  paramRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  paramName: { fontFamily: fonts.textSemi, fontSize: 15, color: c.onSurface },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  value: { fontFamily: fonts.displayBold, fontSize: 36, fontVariant: ["tabular-nums"] },
  unit: { fontFamily: fonts.display, fontSize: 17, color: c.onSurfaceTertiary },
  threshold: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  thresholdLabel: { fontFamily: fonts.textSemi, fontSize: 10, letterSpacing: 1.2, color: c.muted },
  message: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceTertiary },
  time: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted, marginTop: spacing.xs },
}));
