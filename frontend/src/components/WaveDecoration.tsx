import Svg, { Path } from "react-native-svg";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/src/theme";

/** Subtle static water-wave shape for headers. Purely decorative, no animation. */
export function WaveDecoration({ height = 36 }: { height?: number }) {
  const { colors } = useTheme();
  return (
    <View pointerEvents="none" style={[styles.wrap, { height }]}>
      <Svg width="100%" height={height} viewBox="0 0 400 40" preserveAspectRatio="none">
        <Path d="M0 22 C 60 6, 120 34, 200 18 S 340 4, 400 20 L400 40 L0 40 Z" fill={colors.waveFill} />
        <Path d="M0 30 C 80 18, 150 40, 230 28 S 360 18, 400 30 L400 40 L0 40 Z" fill={colors.waveFillStrong} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
