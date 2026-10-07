import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { CheckCircle, Lock, Plug, SignOut, WarningOctagon, WifiHigh } from "phosphor-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { normalizeBaseUrl } from "@/src/api/httpClient";
import { CONTRACT_STATUS } from "@/src/api/piApiContract";
import { testPiConnection } from "@/src/api/realSource";
import { useAuth } from "@/src/auth/AuthContext";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Segmented } from "@/src/components/Segmented";
import { STALE_AFTER_MINUTES } from "@/src/config";
import { useThresholds } from "@/src/hooks/usePondData";
import { formatSafeRange, formatUnsafeRule } from "@/src/logic/status";
import { PARAMETERS, PARAMETER_ORDER } from "@/src/models/parameters";
import { ConnectionTestResult, DataMode } from "@/src/models/types";
import { usesNativeTabs } from "@/src/navigation";
import { checkLocalNetwork } from "@/src/network/networkCheck";
import { useSettings } from "@/src/settings/SettingsContext";
import { DEMO_SCENARIOS, DEMO_SCENARIO_LABEL } from "@/src/settings/scenarios";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const MODE_OPTIONS: { value: DataMode; label: string }[] = [
  { value: "demo", label: "Demo Mode" },
  { value: "real", label: "Real Pi API" },
];

export default function Settings() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const qc = useQueryClient();
  const router = useRouter();
  const { mode, setMode, baseUrl, setBaseUrl, demoScenario, setDemoScenario } = useSettings();
  const { session, signOut } = useAuth();
  const thresholds = useThresholds();

  const [draft, setDraft] = useState(baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<(ConnectionTestResult & { hint: string | null; phoneIp: string | null }) | null>(null);


  const validate = () => {
    try {
      const n = normalizeBaseUrl(draft);
      setUrlError(null);
      return n;
    } catch (e) {
      setUrlError(toApiError(e).message);
      return null;
    }
  };

  const save = () => {
    const n = validate();
    if (!n) return;
    setBaseUrl(n.url);
    setDraft(n.url);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const test = async () => {
    const n = validate();
    if (!n) return;
    setTesting(true);
    setResult(null);
    const [r, net] = await Promise.all([testPiConnection(n.url), checkLocalNetwork(n.host)]);
    setResult({ ...r, hint: r.ok ? null : net.warning, phoneIp: net.phoneIp });
    setTesting(false);
  };

  const changeMode = (m: DataMode) => {
    // Query keys include the mode, and results are stamped with their origin
    // (see usePondData), so no cache juggling is needed here.
    setMode(m);
  };

  return (
    <View testID="settings-screen" style={styles.root}>
      <ScreenHeader eyebrow="CONFIGURATION" title="Settings" testID="settings-header" />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + bottomChrome }]}
      >
        {/* Data source */}
        <Text style={styles.section}>DATA SOURCE</Text>
        <View style={styles.card}>
          <Segmented testID="data-mode-selector" options={MODE_OPTIONS} value={mode} onChange={changeMode} />
          <Text style={styles.body}>
            {mode === "demo"
              ? "Demo Mode shows clearly marked sample readings and alerts. No network calls are made for data."
              : "Real Pi API mode reads data from the Raspberry Pi at the address below, over the pond's local Wi-Fi only."}
          </Text>
        </View>

        {/* Connection */}
        <Text style={styles.section}>RASPBERRY PI CONNECTION</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>LOCAL API BASE ADDRESS</Text>
          <TextInput
            testID="pi-base-url-input"
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setUrlError(null);
            }}
            placeholder="e.g. 192.168.1.50:8000"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={save}
            style={[styles.input, urlError && { borderColor: colors.error }]}
          />
          {urlError ? (
            <Text testID="pi-base-url-error" style={styles.error}>
              {urlError}
            </Text>
          ) : null}
          <Text style={styles.help}>
            {`${baseUrl ? `Saved: ${baseUrl}.` : "No address saved yet."} Use the Pi's local IP (or local hostname) and port. "http://" is added automatically.`}
          </Text>
          <View style={styles.btnRow}>
            <Pressable testID="save-base-url-button" onPress={save} style={({ pressed }) => [styles.btnSecondary, pressed && { opacity: 0.8 }]}>
              <Text style={styles.btnSecondaryText}>{saved ? "Saved ✓" : "Save address"}</Text>
            </Pressable>
            <Pressable
              testID="test-connection-button"
              onPress={test}
              disabled={testing}
              style={({ pressed }) => [styles.btnPrimary, (pressed || testing) && { opacity: 0.8 }]}
            >
              {testing ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Plug size={18} color={colors.onBrandPrimary} weight="bold" />}
              <Text style={styles.btnPrimaryText}>{testing ? "Testing…" : "Test connection"}</Text>
            </Pressable>
          </View>

          {result ? (
            <View
              testID="connection-test-result"
              style={[
                styles.result,
                { borderColor: result.ok ? colors.success : colors.error, backgroundColor: result.ok ? colors.successSoft : colors.errorSoft },
              ]}
            >
              <View style={styles.resultHead}>
                {result.ok ? (
                  <CheckCircle size={20} color={colors.success} weight="fill" />
                ) : (
                  <WarningOctagon size={20} color={colors.error} weight="fill" />
                )}
                <Text testID="connection-test-title" style={[styles.resultTitle, { color: result.ok ? colors.success : colors.error }]}>
                  {result.title}
                </Text>
              </View>
              <Text style={styles.body}>{result.detail}</Text>
              {result.hint ? <Text style={[styles.body, { color: colors.warning }]}>{result.hint}</Text> : null}
              {result.phoneIp ? <Text style={styles.help}>{`This phone's IP: ${result.phoneIp}`}</Text> : null}
            </View>
          ) : null}

          <View style={styles.wifiNote}>
            <WifiHigh size={20} color={colors.brand} weight="bold" />
            <Text style={styles.wifiText}>
              The phone must be connected to the <Text style={styles.strong}>same local Wi-Fi network as the Raspberry Pi</Text>
              {`. The app does not connect over mobile data or the internet. "Test connection" always calls the address above, even in Demo Mode.`}
            </Text>
          </View>
          {Platform.OS === "web" ? (
            <Text testID="web-preview-note" style={styles.help}>
              Web preview note: a browser preview served over HTTPS cannot reach a local http:// Pi address. Test on the Android phone.
            </Text>
          ) : null}
        </View>

        {/* Demo scenarios */}
        {mode === "demo" ? (
          <>
            <Text style={styles.section}>DEMO SCENARIO</Text>
            <View style={[styles.card, { gap: 0, paddingVertical: spacing.xs }]}>
              {DEMO_SCENARIOS.map((s, i) => {
                const active = s === demoScenario;
                return (
                  <Pressable
                    key={s}
                    testID={`demo-scenario-${s}`}
                    onPress={() => setDemoScenario(s)}
                    style={[styles.radioRow, i > 0 && styles.radioDivider]}
                  >
                    <View style={[styles.radio, active && { borderColor: colors.brand }]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text style={[styles.radioText, active && { color: colors.onSurface }]}>{DEMO_SCENARIO_LABEL[s]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Thresholds */}
        <Text style={styles.section}>THRESHOLDS · READ-ONLY</Text>
        <View testID="thresholds-card" style={styles.card}>
          <View style={styles.thBadgeRow}>
            <Lock size={16} color={colors.warning} weight="bold" />
            <Text testID="thresholds-source-label" style={styles.thBadge}>
              {thresholds.data?.sourceLabel ?? (thresholds.error ? "Not available from Pi" : "Loading…")}
            </Text>
          </View>
          {thresholds.data
            ? PARAMETER_ORDER.map((k) => {
                const t = thresholds.data!.values[k];
                const unit = PARAMETERS[k].unit;
                return (
                  <View key={k} testID={`threshold-row-${k}`} style={styles.thRow}>
                    <Text style={styles.thName}>{PARAMETERS[k].label}</Text>
                    <View style={styles.thCols}>
                      <View style={styles.thCol}>
                        <Text style={styles.thLabel}>SAFE</Text>
                        <Text style={styles.thValue}>
                          {formatSafeRange(k, t)} {unit}
                        </Text>
                      </View>
                      <View style={styles.thCol}>
                        <Text style={styles.thLabel}>UNSAFE</Text>
                        <Text style={styles.thValue}>
                          {formatUnsafeRule(k, t)} {unit}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })
            : null}
          <Text style={styles.help}>
            Values between safe and unsafe limits show as Warning. Species and limits are not confirmed. Final thresholds will be entered after
            written approval and are not editable in the app. A reading older than {STALE_AFTER_MINUTES} minutes is marked Stale.
          </Text>
        </View>

        {/* Account */}
        <Text style={styles.section}>ACCOUNT</Text>
        <View style={styles.card}>
          <Text testID="signed-in-user" style={styles.body}>
            Signed in as <Text style={styles.strong}>{session?.displayName}</Text> ({session?.username}) ·{" "}
            {session?.provider === "mock" ? "demo sign-in" : "Pi sign-in"}
          </Text>
          <Pressable
            testID="sign-out-button"
            onPress={async () => {
              await signOut();
              qc.removeQueries();
              router.replace("/sign-in");
            }}
            style={({ pressed }) => [styles.btnDanger, pressed && { opacity: 0.8 }]}
          >
            <SignOut size={18} color={colors.error} weight="bold" />
            <Text style={styles.btnDangerText}>Sign out</Text>
          </Pressable>
        </View>

        <Text testID="api-contract-status" style={[styles.help, { textAlign: "center" }]}>
          Pi API contract: {CONTRACT_STATUS}
        </Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: spacing.lg, gap: spacing.sm },
  section: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.4, color: c.muted, marginTop: spacing.md },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  strong: { fontFamily: fonts.textSemi, color: c.onSurface },
  help: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
  fieldLabel: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.2, color: c.muted },
  input: {
    height: 52,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderStrong,
    fontFamily: fonts.textMedium,
    fontSize: 16,
    color: c.onSurface,
  },
  error: { fontFamily: fonts.textMedium, fontSize: 13, color: c.error, marginTop: -4 },
  btnRow: { flexDirection: "row", gap: spacing.sm },
  btnSecondary: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondaryText: { fontFamily: fonts.textSemi, fontSize: 15, color: c.brandPrimary },
  btnPrimary: {
    flex: 1.3,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { fontFamily: fonts.textSemi, fontSize: 15, color: c.onBrandPrimary },
  result: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  resultHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  resultTitle: { fontFamily: fonts.textSemi, fontSize: 15, flex: 1 },
  wifiNote: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.surfaceTertiary,
  },
  wifiText: { flex: 1, fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  radioRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  radioDivider: { borderTopWidth: 1, borderTopColor: c.divider },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand },
  radioText: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurfaceTertiary, flex: 1 },
  thBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.warning,
    backgroundColor: c.warningSoft,
  },
  thBadge: { fontFamily: fonts.textSemi, fontSize: 12, color: c.warning },
  thRow: { gap: spacing.xs, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  thName: { fontFamily: fonts.textSemi, fontSize: 14, color: c.onSurface },
  thCols: { flexDirection: "row", gap: spacing.lg },
  thCol: { flex: 1, gap: 2 },
  thLabel: { fontFamily: fonts.textSemi, fontSize: 10, letterSpacing: 1.2, color: c.muted },
  thValue: { fontFamily: fonts.display, fontSize: 17, color: c.onSurfaceSecondary, fontVariant: ["tabular-nums"] },
  btnDanger: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.error,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDangerText: { fontFamily: fonts.textSemi, fontSize: 15, color: c.error },
}));
