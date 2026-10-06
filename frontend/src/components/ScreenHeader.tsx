import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, spacing } from "@/src/theme";

import { WaveDecoration } from "./WaveDecoration";

interface Props {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  testID?: string;
}

/** Sticky, safe-area-aware screen header with a subtle wave shape. */
export function ScreenHeader({ eyebrow, title, right, children, testID }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <WaveDecoration />
      <View style={styles.row}>
        <View style={styles.titles}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  header: {
    backgroundColor: c.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  titles: { flex: 1 },
  eyebrow: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.6, color: c.brandPrimary },
  title: { fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface, marginTop: 2 },
}));
