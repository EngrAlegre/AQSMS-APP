import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Eye, EyeSlash, Flask, Lock, User } from "phosphor-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/src/api/errors";
import { authAdapter, DEMO_ACCOUNT } from "@/src/auth/adapters";
import { useAuth } from "@/src/auth/AuthContext";
import { APP_NAME } from "@/src/config";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function SignIn() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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

  const fillDemo = () => {
    setUsername(DEMO_ACCOUNT.username);
    setPassword(DEMO_ACCOUNT.password);
    setError(null);
  };

  return (
    <View style={styles.root}>
      <Image source={require("../assets/images/signin-hero.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={[colors.scrimClear, colors.scrim, colors.surface]}
        locations={[0, 0.45, 0.75]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.brand}>
          <Text style={styles.eyebrow}>CAPSTONE PROTOTYPE · ONE POND</Text>
          <Text testID="app-title" style={styles.title}>
            {APP_NAME}
          </Text>
          <Text style={styles.subtitle}>Farmer view for pond water quality: pH, temperature and dissolved oxygen.</Text>
        </View>

        <View style={styles.card}>
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
              style={styles.input}
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
              style={styles.input}
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
            disabled={busy}
            style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.8 }]}
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>

          <View testID="demo-credentials-box" style={styles.demoBox}>
            <View style={styles.demoHead}>
              <Flask size={16} color={colors.info} weight="bold" />
              <Text style={styles.demoTitle}>DEMO ACCOUNT · MOCK SIGN-IN</Text>
            </View>
            <Text style={styles.demoCreds}>
              Username <Text style={styles.mono}>{DEMO_ACCOUNT.username}</Text> · Password{" "}
              <Text style={styles.mono}>{DEMO_ACCOUNT.password}</Text>
            </Text>
            <Pressable testID="fill-demo-credentials-button" onPress={fillDemo} style={styles.demoFill}>
              <Text style={styles.demoFillText}>Use demo credentials</Text>
            </Pressable>
          </View>
          <Text style={styles.note}>
            {authAdapter.label}. This is a placeholder and will be replaced by sign-in from the Raspberry Pi local API.
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: spacing.lg, gap: spacing.xl },
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
  fieldLabel: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.2, color: c.muted, marginTop: spacing.xs },
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
  input: { flex: 1, height: 50, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  eye: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  error: { fontFamily: fonts.textMedium, fontSize: 13, color: c.error, marginTop: spacing.xs },
  button: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  buttonText: { fontFamily: fonts.textSemi, fontSize: 16, color: c.onBrandPrimary },
  demoBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: c.info,
    backgroundColor: c.infoSoft,
    gap: spacing.xs,
  },
  demoHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  demoTitle: { fontFamily: fonts.textSemi, fontSize: 11, letterSpacing: 1.2, color: c.info },
  demoCreds: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary },
  mono: { fontFamily: fonts.textSemi, color: c.onSurface },
  demoFill: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center", marginTop: 2 },
  demoFillText: { fontFamily: fonts.textSemi, fontSize: 14, color: c.info, textDecorationLine: "underline" },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: spacing.xs },
}));
