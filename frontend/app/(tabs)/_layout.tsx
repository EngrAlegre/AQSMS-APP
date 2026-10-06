import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Bell, ChartLine, Gauge, Gear } from "phosphor-react-native";
import { Platform } from "react-native";

import { useAuth } from "@/src/auth/AuthContext";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/sign-in" />;

  if (usesNativeTabs) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="gauge.with.dots.needle.67percent" />
          <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="history">
          <NativeTabs.Trigger.Icon sf="chart.xyaxis.line" />
          <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="alerts">
          <NativeTabs.Trigger.Icon sf="bell.fill" />
          <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon sf="gearshape.fill" />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.textSemi, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarButtonTestID: "tab-dashboard",
          tabBarIcon: ({ color, focused }) => <Gauge size={24} color={String(color)} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarButtonTestID: "tab-history",
          tabBarIcon: ({ color, focused }) => <ChartLine size={24} color={String(color)} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarButtonTestID: "tab-alerts",
          tabBarIcon: ({ color, focused }) => <Bell size={24} color={String(color)} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarButtonTestID: "tab-settings",
          tabBarIcon: ({ color, focused }) => <Gear size={24} color={String(color)} weight={focused ? "fill" : "regular"} />,
        }}
      />
    </Tabs>
  );
}
