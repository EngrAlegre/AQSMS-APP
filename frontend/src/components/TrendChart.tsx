import React, { useMemo, useState } from "react";
import { LayoutChangeEvent, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { ParameterThreshold } from "@/src/models/types";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { format } from "date-fns";

interface Point {
  t: number;
  v: number | null;
}

interface Props {
  points: Point[]; // chronological
  threshold: ParameterThreshold | null;
  decimals: number;
  height?: number;
}

const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

/** Simple static line chart: safe band shaded, gaps where values are missing. */
export function TrendChart({ points, threshold, decimals, height = 190 }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);

  const model = useMemo(() => {
    const vals = points.map((p) => p.v).filter((v): v is number => v !== null);
    if (!vals.length || width === 0 || points.length < 2) return null;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (threshold?.safeMin != null) lo = Math.min(lo, threshold.safeMin);
    if (threshold?.safeMax != null) hi = Math.max(hi, threshold.safeMax);
    const pad = (hi - lo || 1) * 0.12;
    lo -= pad;
    hi += pad;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const w = width - PAD_L - PAD_R;
    const h = height - PAD_T - PAD_B;
    const x = (t: number) => PAD_L + ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * h;
    let d = "";
    let pen = false;
    for (const p of points) {
      if (p.v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)} `;
      pen = true;
    }
    const bandTop = threshold?.safeMax != null ? y(threshold.safeMax) : PAD_T;
    const bandBottom = threshold?.safeMin != null ? y(threshold.safeMin) : PAD_T + h;
    const last = [...points].reverse().find((p) => p.v !== null)!;
    return { d, lo, hi, w, h, x, y, bandTop, bandBottom, t0, t1, last };
  }, [points, threshold, width, height]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View testID="trend-chart" onLayout={onLayout} style={{ height }}>
      {model ? (
        <>
          <Svg width={width} height={height}>
            {threshold ? (
              <Rect
                x={PAD_L}
                y={model.bandTop}
                width={model.w}
                height={Math.max(0, model.bandBottom - model.bandTop)}
                fill={colors.successSoft}
              />
            ) : null}
            {[0, 0.5, 1].map((f) => (
              <Line
                key={f}
                x1={PAD_L}
                x2={PAD_L + model.w}
                y1={PAD_T + f * model.h}
                y2={PAD_T + f * model.h}
                stroke={colors.divider}
                strokeWidth={1}
              />
            ))}
            <Path d={model.d} stroke={colors.brand} strokeWidth={2} fill="none" strokeLinejoin="round" />
            <Circle cx={model.x(model.last.t)} cy={model.y(model.last.v!)} r={4} fill={colors.brand} />
          </Svg>
          {[0, 0.5, 1].map((f) => (
            <Text key={f} style={[styles.yLabel, { top: PAD_T + f * model.h - 8 }]}>
              {(model.hi - f * (model.hi - model.lo)).toFixed(decimals === 2 ? 1 : decimals)}
            </Text>
          ))}
          <Text style={[styles.xLabel, { left: PAD_L }]}>{format(model.t0, "HH:mm")}</Text>
          <Text style={[styles.xLabel, { right: PAD_R }]}>{format(model.t1, "HH:mm")}</Text>
        </>
      ) : (
        <View style={styles.none}>
          <Text style={styles.noneText}>Not enough data for a trend</Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  yLabel: {
    position: "absolute",
    left: 0,
    width: PAD_L - 6,
    textAlign: "right",
    fontFamily: fonts.displayMedium,
    fontSize: 12,
    color: c.muted,
  },
  xLabel: { position: "absolute", bottom: 0, fontFamily: fonts.displayMedium, fontSize: 12, color: c.muted },
  none: { flex: 1, alignItems: "center", justifyContent: "center" },
  noneText: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
}));
