import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  CheckCircle,
  Eye,
  EyeSlash,
  Lock,
  Plug,
  User,
  UserPlus,
  WarningOctagon,
  WifiHigh,
} from "phosphor-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { normalizeBaseUrl } from "@/src/api/httpClient";
import { fetchRegistrationOpen, testPiConnection } from "@/src/api/realSource";
import { useAuth } from "@/src/auth/AuthContext";
import { validatePassword, validateUsername } from "@/src/auth/credentials";
import { consumeSessionNotice } from "@/src/auth/session-events";
import { APP_NAME } from "@/src/config";
import { ConnectionTestResult } from "@/src/models/types";
import { useSettings } from "@/src/settings/SettingsContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Mode = "sign-in" | "create-account";

export default function SignIn() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, register } = useAuth();
  const { baseUrl, setBaseUrl, piConfigured } = useSettings();

  const [mode, setMode] = useState<Mode>("sign-in");
  // Read once, so a forced sign-out explains itself on the way back here.
  const [notice] = useState(() => consumeSessionNotice());

  // Pi address setup
  const [draft, setDraft] = useState(baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  /** The address that last passed a connection test. */
  const [testedUrl, setTestedUrl] = useState<string | null>(null);
  /**
   * What the Pi said about public caretaker registration: true, false, or null
   * for "not asked / could not ask". Only an explicit false withdraws the
   * registration option -- an unreachable Pi must not be read as "closed".
   */
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);

  // Credential fields (shared by sign-in and account creation)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreating = mode === "create-account";
  // Account creation is only offered against an address that is both saved and
  // proven reachable -- the account has to be written to the Pi this phone has
  // actually talked to, not merely to whatever is typed in the box. It is also
  // withheld when the Pi itself reports that registration is closed.
  const canCreate = piConfigured && testedUrl !== null && testedUrl === baseUrl && registrationOpen !== false;
  /** Only an explicit "false" from the Pi hides the registration option. */
  const registrationClosed = registrationOpen === false;

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
    // Saving a different address invalidates an earlier successful test, and
    // with it whatever the previous Pi said about registration.
    if (testedUrl !== n.url) {
      setTestedUrl(null);
      setRegistrationOpen(null);
    }
  };

  const test = async () => {
    const n = validate();
    if (!n) return;
    setTesting(true);
    setResult(null);
    const [r, open] = await Promise.all([testPiConnection(n.url), fetchRegistrationOpen(n.url)]);
    setResult(r);
    setTestedUrl(r.ok ? n.url : null);
    setRegistrationOpen(r.ok ? open : null);
    setTesting(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  };

  const submit = async () => {
    if (!piConfigured) {
      setError("Configure the Pi address above before signing in.");
      return;
    }

    if (isCreating) {
      if (!canCreate) {
        setError("Save the Pi address and run Test connection first.");
        return;
      }
      const usernameError = validateUsername(username);
      if (usernameError) {
        setError(usernameError);
        return;
      }
      const passwordError = validatePassword(password, confirm);
      if (passwordError) {
        setError(passwordError);
        return;
      }
    }

    setError(null);
    setBusy(true);
    try {
      if (isCreating) {
        await register(username, password, confirm);
      } else {
        await signIn(username, password);
      }
      router.replace("/(tabs)");
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "registration_closed") {
        // The Pi is not accepting new accounts. Send the operator to sign in
        // rather than leaving them on a form that can never succeed.
        switchMode("sign-in");
        setError("This AQSMS is not accepting new accounts. Sign in with an existing account.");
      } else if (err.code === "username_taken") {
        setError("That username is already taken on this Pi. Choose another.");
      } else {
        // Prefer the Pi's own wording: it distinguishes a validation problem
        // from a wrong password far better than a generic message.
        setError(err.serverMessage ?? err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = isCreating ? "Create account" : "Sign in";

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
          <Text style={styles.subtitle}>
            Owner/Admin and Caretaker access to pond water quality: pH, temperature and dissolved oxygen.
          </Text>
        </View>

        {notice ? (
          <View testID="session-notice" style={styles.notice}>
            <WarningOctagon size={20} color={colors.warning} weight="fill" />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

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
            {`${baseUrl ? `Saved: ${baseUrl}.` : "No address saved yet."} Enter the Pi's local IP and port. "http://" is added automatically.`}
          </Text>
          {baseUrl.toLowerCase().startsWith("http://") ? (
            <View testID="cleartext-warning" style={styles.warnRow}>
              <WarningOctagon size={18} color={colors.warning} weight="fill" />
              <Text style={styles.warnRowText}>
                This is a plain HTTP address. Your password and session token cross the Wi-Fi unencrypted, and anyone
                on the network can read them. Use an https:// address once the Pi&apos;s certificate is installed.
              </Text>
            </View>
          ) : null}
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

        {/* Sign in / create account */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isCreating ? "REGISTER AS CARETAKER" : "SIGN IN"}</Text>

          {isCreating ? (
            <Text style={styles.help}>
              Creates a caretaker account on this Raspberry Pi. It is stored on the Pi itself — not on this phone, and not
              online. The Owner/Admin account already exists and cannot be created from here.
            </Text>
          ) : null}

          {!piConfigured ? (
            <Text style={styles.warnText}>Configure the Pi address above first.</Text>
          ) : null}

          <Text style={styles.fieldLabel}>USERNAME</Text>
          <View style={styles.inputRow}>
            <User size={20} color={colors.onSurfaceTertiary} />
            <TextInput
              testID={isCreating ? "create-account-username-input" : "sign-in-username-input"}
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
              testID={isCreating ? "create-account-password-input" : "sign-in-password-input"}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.muted}
              secureTextEntry={!show}
              autoCapitalize="none"
              returnKeyType={isCreating ? "next" : "go"}
              onSubmitEditing={isCreating ? undefined : submit}
              style={styles.inputInner}
            />
            <Pressable
              testID="sign-in-toggle-password"
              onPress={() => setShow((s) => !s)}
              hitSlop={12}
              style={styles.eye}
            >
              {show ? <EyeSlash size={20} color={colors.onSurfaceTertiary} /> : <Eye size={20} color={colors.onSurfaceTertiary} />}
            </Pressable>
          </View>

          {isCreating ? (
            <>
              <Text style={styles.fieldLabel}>CONFIRM PASSWORD</Text>
              <View style={styles.inputRow}>
                <Lock size={20} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="create-account-password-confirm-input"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Repeat password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!show}
                  autoCapitalize="none"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  style={styles.inputInner}
                />
              </View>
            </>
          ) : null}

          {isCreating && !canCreate ? (
            <Text testID="create-account-blocked-hint" style={styles.warnText}>
              Save the Pi address and run Test connection before creating an account.
            </Text>
          ) : null}

          {error ? (
            <Text testID={isCreating ? "create-account-error" : "sign-in-error"} style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            testID={isCreating ? "create-account-submit-button" : "sign-in-submit-button"}
            onPress={submit}
            disabled={busy || !piConfigured || (isCreating && !canCreate)}
            style={({ pressed }) => [
              styles.button,
              (pressed || busy || !piConfigured || (isCreating && !canCreate)) && { opacity: 0.7 },
            ]}
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
          </Pressable>

          {isCreating || !registrationClosed ? (
            <Pressable
              testID={isCreating ? "create-account-cancel-link" : "login-create-account-link"}
              onPress={() => switchMode(isCreating ? "sign-in" : "create-account")}
              hitSlop={8}
              style={styles.linkRow}
            >
              {isCreating ? null : <UserPlus size={18} color={colors.brandPrimary} weight="bold" />}
              <Text style={styles.linkText}>{isCreating ? "Back to sign in" : "Register as Caretaker"}</Text>
            </Pressable>
          ) : (
            <Text testID="registration-closed-note" style={styles.warnText}>
              This AQSMS is not accepting new accounts. Ask the Owner/Admin, or sign in with an account that already exists.
            </Text>
          )}

          <Text style={styles.note}>
            {isCreating
              ? "Registration always creates a Caretaker. There is exactly one Owner/Admin account, and it is provisioned on the Pi itself."
              : "Sign in with your account on the Raspberry Pi — the Owner/Admin, or a Caretaker. If this Pi is new, register as a caretaker."}
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
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.warning,
    backgroundColor: c.warningSoft,
  },
  noticeText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18, color: c.onSurface },
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
  warnRow: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.warning,
    backgroundColor: c.warningSoft,
    alignItems: "flex-start",
  },
  warnRowText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 12, lineHeight: 17, color: c.onSurface },
  button: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  buttonText: { fontFamily: fonts.textSemi, fontSize: 16, color: c.onBrandPrimary },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  linkText: { fontFamily: fonts.textSemi, fontSize: 14, color: c.brandPrimary },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: spacing.xs },
}));
