import { Drop, Flask, Thermometer, Waves } from "phosphor-react-native";
import React from "react";
import { Text, View } from "react-native";

import { formatSafeRange, formatUnsafeRule, formatValue } from "@/src/logic/status";
import { PARAMETERS } from "@/src/models/parameters";
import { ParameterKey, ParameterThreshold, StatusKind } from "@/src/models/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

import { StatusChip, statusColors } from "./StatusChip";

export const PARAM_ICON: Record<ParameterKey, typeof Drop> = {
  ph: Flask,
  temperature: Thermometer,
  dissolvedOxygen: Waves,
};

interface Props {
  param: ParameterKey;
  value: number | null;
  status: StatusKind;
  threshold: ParameterThreshold | null;
  thresholdLabel: string;
  stale: boolean;
}

export function SensorCard({ param, value, status, threshold, thresholdLabel, stale }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const meta = PARAMETERS[param];
  const Icon = PARAM_ICON[param];
  const accent = statusColors(colors, status).fg;
  const id = `sensor-card-${param}`;
  return (
    <View testID={id} style={styles.card}>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.inner}>
        <View style={styles.top}>
          <View style={styles.labelRow}>
            <View style={styles.iconBox}>
              <Icon size={20} color={colors.brand} weight="bold" />
            </View>
            <Text style={styles.label}>{meta.label}</Text>
          </View>
          <View style={styles.chips}>
            {stale ? (
              <View testID={`${id}-stale`} style={styles.staleTag}>
                <Text style={styles.staleText}>STALE</Text>
              </View>
            ) : null}
            <StatusChip status={status} testID={`${id}-status`} />
          </View>
        </View>

        <View style={styles.valueRow}>
          <Text testID={`${id}-value`} style={[styles.value, value === null && styles.valueMissing]}>
            {formatValue(param, value)}
          </Text>
          <Text style={styles.unit}>{meta.unit}</Text>
        </View>
        {value === null ? <Text style={styles.missing}>No value in the latest record</Text> : null}

        <View style={styles.footer}>
          <View style={styles.footItem}>
            <Text style={styles.footLabel}>SAFE RANGE</Text>
            <Text testID={`${id}-safe-range`} style={styles.footValue}>
              {formatSafeRange(param, threshold)} {threshold ? meta.unit : ""}
            </Text>
          </View>
          <View style={styles.footItem}>
            <Text style={styles.footLabel}>UNSAFE</Text>
            <Text style={styles.footValue}>
              {formatUnsafeRule(param, threshold)} {threshold ? meta.unit : ""}
            </Text>
          </View>
        </View>
        <Text style={styles.thresholdSource}>{thresholdLabel}</Text>
      </View>
    </View>
  );
}

export function SensorCardSkeleton() {
  const styles = useStyles();
  return (
    <View testID="sensor-card-skeleton" style={[styles.card, styles.skeleton]}>
      <View style={styles.inner}>
        <View style={[styles.skelLine, { width: "45%" }]} />
        <View style={[styles.skelBlock]} />
        <View style={[styles.skelLine, { width: "70%" }]} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    flexDirection: "row",
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  accent: { width: 5 },
  inner: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontFamily: fonts.textSemi, fontSize: 16, color: c.onSurface, flexShrink: 1 },
  valueRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  value: {
    fontFamily: fonts.displayBold,
    fontSize: 64,
    lineHeight: 70,
    color: c.onSurface,
    fontVariant: ["tabular-nums"],
  },
  valueMissing: { color: c.muted },
  unit: { fontFamily: fonts.display, fontSize: 22, color: c.onSurfaceTertiary, marginBottom: 10 },
  chips: { flexDirection: "row", alignItems: "center", gap: 6 },
  staleTag: {
    paddingHorizontal: 8,
    height: 30,
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: c.warningSoft,
    borderWidth: 1,
    borderColor: c.warning,
  },
  staleText: { fontFamily: fonts.textSemi, fontSize: 11, color: c.warning, letterSpacing: 0.8 },
  missing: { fontFamily: fonts.text, fontSize: 13, color: c.muted, marginTop: -4 },
  footer: {
    flexDirection: "row",
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: c.divider,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  footItem: { flex: 1, gap: 2 },
  footLabel: { fontFamily: fonts.textSemi, fontSize: 10, letterSpacing: 1.2, color: c.muted },
  footValue: { fontFamily: fonts.display, fontSize: 17, color: c.onSurfaceSecondary, fontVariant: ["tabular-nums"] },
  thresholdSource: { fontFamily: fonts.textMedium, fontSize: 11, color: c.warning, letterSpacing: 0.3 },
  skeleton: { height: 220 },
  skelLine: { height: 14, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary },
  skelBlock: { height: 64, width: "55%", borderRadius: radius.md, backgroundColor: c.surfaceTertiary, marginVertical: spacing.md },
}));
