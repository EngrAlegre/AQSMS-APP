import { StyleSheet, Text, View } from "react-native";

import { CONNECTION_LABEL, ConnectionState } from "@/src/logic/connection";
import { fonts, radius, ThemeColors, useTheme } from "@/src/theme";

function tone(colors: ThemeColors, s: ConnectionState) {
  switch (s) {
    case "live":
      return { fg: colors.success, bg: colors.successSoft };
    case "simulated":
      return { fg: colors.info, bg: colors.infoSoft };
    case "stale":
    case "cached":
      return { fg: colors.warning, bg: colors.warningSoft };
    case "unreachable":
    case "bad_data":
      return { fg: colors.error, bg: colors.errorSoft };
    default:
      return { fg: colors.onSurfaceTertiary, bg: colors.mutedSoft };
  }
}

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const { colors } = useTheme();
  const t = tone(colors, state);
  return (
    <View testID="connection-badge" style={[styles.badge, { backgroundColor: t.bg, borderColor: t.fg }]}>
      <View style={[styles.dot, { backgroundColor: t.fg }]} />
      <Text testID="connection-badge-label" style={[styles.text, { color: t.fg }]}>
        {CONNECTION_LABEL[state].toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 0.8 },
});
