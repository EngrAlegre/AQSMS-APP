import React from "react";
import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius } from "@/src/theme";

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange(v: T): void;
  testID: string;
}

/** Fixed-width segmented control (2–3 options). Selection changes color only. */
export function Segmented<T extends string>({ options, value, onChange, testID }: Props<T>) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.wrap}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`${testID}-${o.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.item, active && styles.itemActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: {
    flexDirection: "row",
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: 4,
    gap: 4,
  },
  item: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  itemActive: { backgroundColor: c.brandPrimary },
  label: { fontFamily: fonts.textSemi, fontSize: 14, color: c.onSurfaceTertiary },
  labelActive: { color: c.onBrandPrimary },
}));
