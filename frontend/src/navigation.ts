import { Platform } from "react-native";

// NativeTabs (liquid glass) only on iOS 26+. Android / web / older iOS use classic JS <Tabs>.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
