// Design tokens for Aqua Smart Monitoring System (dark-first aquatic palette).
// Keys match the "color" block of /app/design_guidelines.json.
// Plain key = background, `on` partner = text/icon on top of it.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const aquatic = {
  surface: "#050B14",
  onSurface: "#E2E8F0",
  surfaceSecondary: "#0A1428",
  onSurfaceSecondary: "#CBD5E1",
  surfaceTertiary: "#112240",
  onSurfaceTertiary: "#94A3B8",
  surfaceInverse: "#F8FAFC",
  onSurfaceInverse: "#050B14",
  muted: "#7C8BA1",

  brand: "#00E5FF",
  onBrand: "#001B24",
  brandPrimary: "#00B4D8",
  onBrandPrimary: "#001A24",
  brandSecondary: "#0077B6",
  onBrandSecondary: "#E0F7FA",
  brandTertiary: "#004771",
  onBrandTertiary: "#80DEEA",

  success: "#26A69A",
  onSuccess: "#00211D",
  successSoft: "rgba(38,166,154,0.14)",
  warning: "#FFCA28",
  onWarning: "#332600",
  warningSoft: "rgba(255,202,40,0.13)",
  error: "#FF7043",
  onError: "#4A1000",
  errorSoft: "rgba(255,112,67,0.14)",
  info: "#29B6F6",
  onInfo: "#00253B",
  infoSoft: "rgba(41,182,246,0.13)",
  mutedSoft: "rgba(124,139,161,0.14)",

  border: "#1A2844",
  borderStrong: "#2A3D63",
  divider: "#121C33",
  scrim: "rgba(5,11,20,0.94)",
  scrimClear: "rgba(5,11,20,0)",
  waveFill: "rgba(0,180,216,0.07)",
  waveFillStrong: "rgba(0,229,255,0.10)",
};

export type ThemeColors = typeof aquatic;

export const defaultScheme = "dark" satisfies ColorScheme;

// The app is intentionally dark-only (readability outdoors / at the pond).
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: aquatic, dark: aquatic };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  useColorScheme(); // keeps consumers subscribed; the app is dark-only
  return { scheme: defaultScheme, colors: aquatic };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const fonts = {
  displayMedium: "Rajdhani-Medium",
  display: "Rajdhani-SemiBold",
  displayBold: "Rajdhani-Bold",
  text: "IBMPlexSans-Regular",
  textMedium: "IBMPlexSans-Medium",
  textSemi: "IBMPlexSans-SemiBold",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
