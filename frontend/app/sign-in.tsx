import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { CheckCircle, Eye, EyeSlash, Lock, Plug, User, WarningOctagon, WifiHigh } from "phosphor-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { normalizeBaseUrl } from "@/src/api/httpClient";
import { testPiConnection } from "@/src/api/realSource";
import { useAuth } from "@/src/auth/AuthContext";
import { APP_NAME } from "@/src/config";
import { ConnectionTestResult } from "@/src/models/types";
import { useSettings } from "@/src/settings/SettingsContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function SignIn() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const { baseUrl, setBaseUrl, piConfigured } = useSettings();

  // Pi address setup
  const [draft, setDraft] = useState(baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  // Sign-in fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const r = await testPiConnection(n.url);
    setResult(r);
    setTesting(false);
  };

  const submit = async () => {
    if (!piConfigured) {
      setError("Configure the Pi address above before signing in.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn(username, password);
      router.replace("/(tabs)");
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image source={require("../assets/images/signin-hero.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={[colors.scrimClear, colors.scrim, colors.surface]}
        locations={[0, 0.35, 0.65]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.brand}>
          <Text style={styles.eyebrow}>POND MONITOR · ONE POND</Text>
          <Text testID="app-title" style={styles.title}>
            {APP_NAME}
          </Text>
          <Text style={styles.subtitle}>Farmer view for pond water quality: pH, temperature and dissolved oxygen.</Text>
        </View>

        {/* Pi address setup — accessible before sign-in */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>RASPBERRY PI CONNECTION</Text>
          <Text style={styles.fieldLabel}>LOCAL API ADDRESS</Text>
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
            {baseUrl ? `Saved: ${baseUrl}` : "No address saved yet."}{" "}
            Enter the Pi's local IP and port. "http://" is added automatically.
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
              <Text style={styles.help}>{result.detail}</Text>
            </View>
          ) : null}

          <View style={styles.wifiNote}>
            <WifiHigh size={18} color={colors.brand} weight="bold" />
            <Text style={styles.wifiText}>
              Connect your phone to the <Text style={styles.strong}>same local Wi-Fi as the Raspberry Pi</Text>.
            </Text>
          </View>
        </View>

        {/* Sign-in form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SIGN IN</Text>
          {!piConfigured ? (
            <Text style={styles.warnText}>Configure the Pi address above first.</Text>
          ) : null}
          <Text style={styles.fieldLabel}>USERNAME</Text>
          <View style={styles.inputRow}>
            <User size={20} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="sign-in-username-input"
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              style={styles.inputInner}
            />
          </View>
          <Text style={styles.fieldLabel}>PASSWORD</Text>
          <View style={styles.inputRow}>
            <Lock size={20} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="sign-in-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.muted}
              secureTextEntry={!show}
              autoCapitalize="none"
              returnKeyType="go"
              onSubmitEditing={submit}
              style={styles.inputInner}
            />
            <Pressable testID="sign-in-toggle-password" onPress={() => setShow((s) => !s)} hitSlop={12} style={styles.eye}>
              {show ? <EyeSlash size={20} color={colors.onSurfaceTertiary} /> : <Eye size={20} color={colors.onSurfaceTertiary} />}
            </Pressable>
          </View>

          {error ? (
            <Text testID="sign-in-error" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            testID="sign-in-submit-button"
            onPress={submit}
            disabled={busy || !piConfigured}
            style={({ pressed }) => [styles.button, (pressed || busy || !piConfigured) && { opacity: 0.7 }]}
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
          <Text style={styles.note}>
            Sign in with your account on the Raspberry Pi. Create an account on the Pi using setup_account.py.
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: spacing.lg, gap: spacing.lg },
  brand: { gap: spacing.sm },
  eyebrow: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.6, color: c.brand },
  title: { fontFamily: fonts.displayBold, fontSize: 38, lineHeight: 40, color: c.onSurface },
  subtitle: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.4, color: c.muted },
  fieldLabel: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.2, color: c.muted, marginTop: spacing.xs },
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  inputInner: { flex: 1, height: 50, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  eye: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  error: { fontFamily: fonts.textMedium, fontSize: 13, color: c.error, marginTop: spacing.xs },
  help: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
  strong: { fontFamily: fonts.textSemi, color: c.onSurface },
  warnText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.warning },
  btnRow: { flexDirection: "row", gap: spacing.sm },
  btnSecondary: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondaryText: { fontFamily: fonts.textSemi, fontSize: 14, color: c.brandPrimary },
  btnPrimary: {
    flex: 1.3,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { fontFamily: fonts.textSemi, fontSize: 14, color: c.onBrandPrimary },
  result: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  resultHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  resultTitle: { fontFamily: fonts.textSemi, fontSize: 15, flex: 1 },
  wifiNote: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
  },
  wifiText: { flex: 1, fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceTertiary },
  button: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  buttonText: { fontFamily: fonts.textSemi, fontSize: 16, color: c.onBrandPrimary },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: spacing.xs },
}));
