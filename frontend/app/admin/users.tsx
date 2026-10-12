import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle,
  Plus,
  Prohibit,
  UserPlus,
  UsersThree,
  WarningOctagon,
} from "phosphor-react-native";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createCaretaker, fetchManagedUsers, setCaretakerStatus } from "@/src/api/adminApi";
import { toApiError } from "@/src/api/errors";
import { useAuth } from "@/src/auth/AuthContext";
import { validatePassword, validateUsername } from "@/src/auth/credentials";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { statusLabel } from "@/src/models/roles";
import { ManagedUser } from "@/src/models/types";
import { useSettings } from "@/src/settings/SettingsContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

/**
 * Owner/Admin screen for caretaker accounts.
 *
 * Reached from Settings, and only rendered for a verified owner. A caretaker
 * who reaches this route by any other means sees the refusal below, and the Pi
 * refuses the endpoints behind it regardless -- the two are independent.
 *
 * Deliberately absent: deleting an account, changing a role, editing a
 * caretaker's details, and anything to do with the Owner/Admin account itself.
 */
export default function AdminUsers() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, isOwner, loading } = useAuth();
  const { baseUrl } = useSettings();

  const ctx = useMemo(
    () => ({ baseUrl, token: session?.token ?? null }),
    [baseUrl, session?.token],
  );

  const users = useQuery({
    queryKey: ["admin-users", baseUrl, session?.token],
    queryFn: () => fetchManagedUsers(ctx),
    enabled: isOwner && !!session?.token,
    retry: 0,
  });

  // ---- create form ---------------------------------------------------------
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createCaretaker(ctx, { username, displayName, password, confirmPassword: confirm }),
    onSuccess: async (user) => {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setConfirm("");
      setFormError(null);
      setCreated(`Created caretaker “${user.username}”. They can sign in on the app now.`);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => {
      setCreated(null);
      // Prefer the Pi's wording: it distinguishes a duplicate name from a
      // password that is too short.
      const err = toApiError(e);
      setFormError(err.serverMessage ?? err.message);
    },
  });

  const toggle = useMutation({
    mutationFn: (vars: { username: string; status: "active" | "disabled" }) =>
      setCaretakerStatus(ctx, vars.username, vars.status),
    onSuccess: async () => {
      setRowError(null);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => setRowError(toApiError(e).serverMessage ?? toApiError(e).message),
  });

  const submit = () => {
    const usernameError = validateUsername(username);
    if (usernameError) {
      setCreated(null);
      setFormError(usernameError);
      return;
    }
    const passwordError = validatePassword(password, confirm);
    if (passwordError) {
      setCreated(null);
      setFormError(passwordError);
      return;
    }
    setFormError(null);
    create.mutate();
  };

  // ---- refusal for anyone who is not the verified owner --------------------
  // No session at all (a deep link, or a sign-out while this was open) goes
  // back to sign-in rather than to a screen whose only button does nothing.
  if (!loading && !session) return <Redirect href="/sign-in" />;

  if (!isOwner) {
    return (
      <View testID="admin-users-denied" style={styles.root}>
        <ScreenHeader eyebrow="OWNER/ADMIN ONLY" title="Caretaker accounts" testID="admin-users-header" />
        <View style={styles.content}>
          <View style={styles.card}>
            <View style={styles.rowHead}>
              <WarningOctagon size={20} color={colors.warning} weight="fill" />
              <Text style={styles.cardTitle}>Not available on this account</Text>
            </View>
            <Text style={styles.body}>
              Managing caretaker accounts is restricted to the Owner/Admin. This account is a
              {session ? ` ${session.role}` : "n account without a verified role"}, so the Pi would refuse these requests anyway.
            </Text>
            <Pressable
              testID="admin-users-back-button-denied"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.btnOutline, pressed && { opacity: 0.8 }]}
            >
              <ArrowLeft size={18} color={colors.brandPrimary} weight="bold" />
              <Text style={styles.btnOutlineText}>Go back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const renderRow = (u: ManagedUser) => {
    const disabled = u.status === "disabled";
    const busy = toggle.isPending && toggle.variables?.username === u.username;
    return (
      <View key={u.username} testID={`caretaker-row-${u.username}`} style={styles.userRow}>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{u.displayName}</Text>
          <Text style={styles.help}>{u.username}</Text>
          <Text
            testID={`caretaker-status-${u.username}`}
            style={[styles.statusBadge, disabled ? styles.statusDisabled : styles.statusActive]}
          >
            {statusLabel(u.status)}
          </Text>
        </View>
        <Pressable
          testID={`caretaker-toggle-${u.username}`}
          onPress={() => toggle.mutate({ username: u.username, status: disabled ? "active" : "disabled" })}
          disabled={toggle.isPending}
          style={({ pressed }) => [
            disabled ? styles.btnSmallPrimary : styles.btnSmallDanger,
            (pressed || busy) && { opacity: 0.7 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={disabled ? colors.onBrandPrimary : colors.error} />
          ) : (
            <>
              {disabled ? (
                <CheckCircle size={16} color={colors.onBrandPrimary} weight="bold" />
              ) : (
                <Prohibit size={16} color={colors.error} weight="bold" />
              )}
              <Text style={disabled ? styles.btnSmallPrimaryText : styles.btnSmallDangerText}>
                {disabled ? "Re-enable" : "Disable"}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <View testID="admin-users-screen" style={styles.root}>
      <ScreenHeader
        eyebrow="OWNER/ADMIN"
        title="Caretaker accounts"
        testID="admin-users-header"
        right={
          <Pressable testID="admin-users-back-button" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <ArrowLeft size={22} color={colors.brandPrimary} weight="bold" />
          </Pressable>
        }
      />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        {/* Create */}
        <Text style={styles.section}>ADD A CARETAKER</Text>
        <View style={styles.card}>
          <View style={styles.rowHead}>
            <UserPlus size={20} color={colors.brandPrimary} weight="bold" />
            <Text style={styles.cardTitle}>New caretaker account</Text>
          </View>
          <Text style={styles.body}>
            Created here or registered from the app, a caretaker is a caretaker. Neither path can
            create another Owner/Admin, and no account can be promoted.
          </Text>

          <Text style={styles.fieldLabel}>USERNAME</Text>
          <TextInput
            testID="new-caretaker-username"
            value={username}
            onChangeText={(t) => {
              setUsername(t);
              setFormError(null);
            }}
            placeholder="e.g. pond-helper"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>DISPLAY NAME (OPTIONAL)</Text>
          <TextInput
            testID="new-caretaker-display-name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Shown in the app"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>PASSWORD</Text>
          <TextInput
            testID="new-caretaker-password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setFormError(null);
            }}
            placeholder="At least 8 characters"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>CONFIRM PASSWORD</Text>
          <TextInput
            testID="new-caretaker-password-confirm"
            value={confirm}
            onChangeText={(t) => {
              setConfirm(t);
              setFormError(null);
            }}
            placeholder="Repeat password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={submit}
            style={styles.input}
          />

          {formError ? (
            <Text testID="new-caretaker-error" style={styles.error}>
              {formError}
            </Text>
          ) : null}
          {created ? (
            <Text testID="new-caretaker-created" style={styles.ok}>
              {created}
            </Text>
          ) : null}

          <Pressable
            testID="new-caretaker-submit"
            onPress={submit}
            disabled={create.isPending}
            style={({ pressed }) => [styles.btnPrimary, (pressed || create.isPending) && { opacity: 0.7 }]}
          >
            {create.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Plus size={18} color={colors.onBrandPrimary} weight="bold" />
                <Text style={styles.btnPrimaryText}>Create caretaker</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.help}>
            The password is shown to nobody here and cannot be read back — tell the caretaker what you
            set, and they can change it on the Pi with reset_password.py.
          </Text>
        </View>

        {/* List */}
        <Text style={styles.section}>CARETAKERS</Text>
        <View style={styles.card}>
          <View style={styles.rowHead}>
            <UsersThree size={20} color={colors.brandPrimary} weight="bold" />
            <Text style={styles.cardTitle}>
              {users.data ? `${users.data.length} account${users.data.length === 1 ? "" : "s"}` : "Accounts"}
            </Text>
          </View>

          {rowError ? (
            <Text testID="caretaker-row-error" style={styles.error}>
              {rowError}
            </Text>
          ) : null}

          {users.isLoading ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : users.error ? (
            <Text testID="caretaker-list-error" style={styles.error}>
              {toApiError(users.error).serverMessage ?? toApiError(users.error).message}
            </Text>
          ) : users.data && users.data.length > 0 ? (
            users.data.map(renderRow)
          ) : (
            <Text testID="caretaker-list-empty" style={styles.body}>
              No caretaker accounts yet. Create one above, or let someone register from the app.
            </Text>
          )}

          <Text style={styles.help}>
            Disabling an account blocks it immediately — sign-in and any token it already holds stop
            working. Nothing is deleted, and the account can be re-enabled.
          </Text>
        </View>
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
    gap: spacing.sm,
  },
  cardTitle: { fontFamily: fonts.textSemi, fontSize: 15, color: c.onSurface, flex: 1 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  help: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
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
  error: { fontFamily: fonts.textMedium, fontSize: 13, color: c.error },
  ok: { fontFamily: fonts.textMedium, fontSize: 13, color: c.success },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontFamily: fonts.textSemi, fontSize: 15, color: c.onSurface },
  statusBadge: {
    alignSelf: "flex-start",
    fontFamily: fonts.textSemi,
    fontSize: 11,
    letterSpacing: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 2,
  },
  statusActive: { color: c.success, borderColor: c.success },
  statusDisabled: { color: c.error, borderColor: c.error },
  btnPrimary: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  btnPrimaryText: { fontFamily: fonts.textSemi, fontSize: 15, color: c.onBrandPrimary },
  btnOutline: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.brandPrimary,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutlineText: { fontFamily: fonts.textSemi, fontSize: 15, color: c.brandPrimary },
  btnSmallPrimary: {
    minWidth: 110,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  btnSmallPrimaryText: { fontFamily: fonts.textSemi, fontSize: 13, color: c.onBrandPrimary },
  btnSmallDanger: {
    minWidth: 110,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.error,
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  btnSmallDangerText: { fontFamily: fonts.textSemi, fontSize: 13, color: c.error },
}));
