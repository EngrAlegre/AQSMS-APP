import { ParameterKey } from "./types";

export interface ParameterMeta {
  key: ParameterKey;
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
}

export const PARAMETERS: Record<ParameterKey, ParameterMeta> = {
  ph: { key: "ph", label: "pH Level", shortLabel: "pH", unit: "pH", decimals: 2 },
  temperature: {
    key: "temperature",
    label: "Water Temperature",
    shortLabel: "Temp",
    unit: "°C",
    decimals: 1,
  },
  dissolvedOxygen: {
    key: "dissolvedOxygen",
    label: "Dissolved Oxygen",
    shortLabel: "DO",
    unit: "mg/L",
    decimals: 2,
  },
};

export const PARAMETER_ORDER: ParameterKey[] = ["ph", "temperature", "dissolvedOxygen"];
