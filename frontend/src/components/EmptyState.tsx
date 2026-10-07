import React from "react";
import { Text, View } from "react-native";

import { fonts, makeStyles, spacing } from "@/src/theme";

interface Props {
  icon: React.ReactNode;
  title: string;
  message: string;
  testID: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon, title, message, testID, children }: Props) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={styles.iconRing}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fonts.textSemi, fontSize: 17, color: c.onSurface, textAlign: "center" },
  message: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceTertiary, textAlign: "center" },
}));
