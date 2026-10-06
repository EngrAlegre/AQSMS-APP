import { StyleSheet, Text, View } from "react-native";

import { STATUS_LABEL } from "@/src/logic/status";
import { StatusKind } from "@/src/models/types";
import { fonts, radius, ThemeColors, useTheme } from "@/src/theme";

export function statusColors(colors: ThemeColors, s: StatusKind) {
  switch (s) {
    case "safe":
      return { fg: colors.success, bg: colors.successSoft };
    case "warning":
      return { fg: colors.warning, bg: colors.warningSoft };
    case "unsafe":
      return { fg: colors.error, bg: colors.errorSoft };
    default:
      return { fg: colors.onSurfaceTertiary, bg: colors.mutedSoft };
  }
}

export function StatusChip({ status, testID, compact }: { status: StatusKind; testID?: string; compact?: boolean }) {
  const { colors } = useTheme();
  const c = statusColors(colors, status);
  return (
    <View testID={testID} style={[styles.chip, compact && styles.compact, { backgroundColor: c.bg, borderColor: c.fg }]}>
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
      <Text style={[styles.text, compact && styles.textCompact, { color: c.fg }]}>{STATUS_LABEL[status].toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  compact: { height: 24, paddingHorizontal: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontFamily: fonts.textSemi, fontSize: 12, letterSpacing: 0.8 },
  textCompact: { fontSize: 11 },
});
