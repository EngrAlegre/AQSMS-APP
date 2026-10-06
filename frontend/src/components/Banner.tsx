import { Info, WarningOctagon, Warning, Flask } from "phosphor-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Tone = "demo" | "info" | "warning" | "error";

interface Props {
  tone: Tone;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

/** Inline banner for demo labelling, stale/cached notices and errors. */
export function Banner({ tone, title, message, actionLabel, onAction, testID }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = {
    demo: { fg: colors.info, bg: colors.infoSoft, Icon: Flask },
    info: { fg: colors.brandPrimary, bg: colors.surfaceTertiary, Icon: Info },
    warning: { fg: colors.warning, bg: colors.warningSoft, Icon: Warning },
    error: { fg: colors.error, bg: colors.errorSoft, Icon: WarningOctagon },
  }[tone];
  return (
    <View testID={testID} style={[styles.wrap, { backgroundColor: t.bg, borderColor: t.fg }]}>
      <t.Icon size={20} color={t.fg} weight="bold" />
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.fg }]}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {actionLabel && onAction ? (
          <Pressable
            testID={testID ? `${testID}-action` : undefined}
            onPress={onAction}
            style={({ pressed }) => [styles.action, { borderColor: t.fg, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.actionText, { color: t.fg }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.textSemi, fontSize: 14 },
  message: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  action: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
  },
  actionText: { fontFamily: fonts.textSemi, fontSize: 13 },
}));
