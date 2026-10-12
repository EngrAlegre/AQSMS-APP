import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { AccountStatus, Session, UserRole } from "@/src/models/types";
import { useSettings } from "@/src/settings/SettingsContext";
import { storage } from "@/src/utils/storage";

import { authAdapter } from "./adapters";
import { consumeSessionNotice, setSessionNotice, setUnauthorizedHandler } from "./session-events";

const K_USER = "aqua.session.username";
const K_NAME = "aqua.session.displayName";
const K_TOKEN = "aqua.session.token";
const K_ROLE = "aqua.session.role";
const K_STATUS = "aqua.session.status";

const STORED_KEYS = [K_USER, K_NAME, K_TOKEN, K_ROLE, K_STATUS];

/**
 * Narrow a stored string back to a role. A value that is not one of the two
 * known roles yields null, which the restore path treats as "no usable session"
 * rather than picking one.
 */
function asRole(value: string | null): UserRole | null {
  return value === "owner" || value === "caretaker" ? value : null;
}

function asStatus(value: string | null): AccountStatus | null {
  return value === "active" || value === "disabled" ? value : null;
}

interface AuthValue {
  session: Session | null;
  loading: boolean;
  /** True only for the fixed Owner/Admin. Drives which screens exist. */
  isOwner: boolean;
  signIn(username: string, password: string): Promise<void>;
  register(username: string, password: string, confirmPassword: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl } = useSettings();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  /** The (baseUrl, token) pair already checked against /auth/me this launch. */
  const revalidated = useRef<string | null>(null);

  const persist = useCallback(async (s: Session) => {
    await storage.secureSet(K_USER, s.username);
    await storage.secureSet(K_NAME, s.displayName);
    await storage.secureSet(K_TOKEN, s.token ?? "");
    await storage.secureSet(K_ROLE, s.role);
    await storage.secureSet(K_STATUS, s.status);
    setSession(s);
  }, []);

  const clearStored = useCallback(async () => {
    await Promise.all(STORED_KEYS.map((k) => storage.secureRemove(k)));
    setSession(null);
  }, []);

  useEffect(() => {
    (async () => {
      const username = await storage.secureGet(K_USER, "");
      const token = (await storage.secureGet(K_TOKEN, "")) || null;
      const role = asRole(await storage.secureGet(K_ROLE, ""));
      const status = asStatus(await storage.secureGet(K_STATUS, ""));

      if (username && token && role && status) {
        setSession({
          username,
          displayName: (await storage.secureGet(K_NAME, username)) ?? username,
          provider: "pi",
          token,
          role,
          status,
        });
      } else if (username || token) {
        // A session saved by a build that predates roles. Its role is unknown,
        // and guessing one is exactly what this design forbids, so it is
        // discarded and the operator signs in again. The next sign-in reads the
        // real role from the Pi.
        await clearStored();
      }
      setLoading(false);
    })();
  }, [clearStored]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      await persist(await authAdapter.signIn(username, password, { baseUrl }));
    },
    [baseUrl, persist],
  );

  const register = useCallback(
    async (username: string, password: string, confirmPassword: string) => {
      await persist(await authAdapter.register({ username, password, confirmPassword }, { baseUrl }));
    },
    [baseUrl, persist],
  );

  const signOut = useCallback(async () => {
    await clearStored();
  }, [clearStored]);

  /**
   * Validate a restored session against the Pi, once per launch.
   *
   * The stored role decides which screens are drawn, so it is checked rather
   * than trusted: if the Owner/Admin disabled this account, or its role changed
   * on the Pi, that must take effect here too.
   *
   * A failure is deliberately not fatal. A 401 or a disabled-account 403 has
   * already forced a sign-out through the unauthorized handler below; anything
   * else means the Pi could not be reached, and signing out because the Wi-Fi
   * blinked on launch would be worse than briefly trusting a stored role that
   * the Pi enforces anyway.
   */
  useEffect(() => {
    const token = session?.token;
    if (!token || !baseUrl) return;
    const key = `${baseUrl}|${token}`;
    if (revalidated.current === key) return;
    revalidated.current = key;

    (async () => {
      try {
        const account = await authAdapter.me({ baseUrl, token });
        setSession((prev) => {
          if (!prev || prev.token !== token) return prev;
          if (prev.role === account.role && prev.status === account.status && prev.displayName === account.displayName) {
            return prev;
          }
          const updated: Session = { ...prev, role: account.role, status: account.status, displayName: account.displayName };
          void persist(updated);
          return updated;
        });
      } catch {
        // Handled above; see the comment on this effect.
      }
    })();
  }, [session?.token, baseUrl, persist]);

  // The Pi refusing a token (expired, signing key changed, account deleted) or
  // refusing a disabled account drops the session here. The (tabs) layout
  // redirects to sign-in the moment `session` goes null, so nobody is left on a
  // dashboard whose data can never refresh.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // requestJson usually supplies the reason. Fall back only when it did not,
      // so a specific message ("this account has been disabled") is not
      // flattened into the generic one.
      if (consumeSessionNotice() === null) {
        setSessionNotice("Your sign-in is no longer valid. Please sign in again.");
      }
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo(
    () => ({ session, loading, isOwner: session?.role === "owner", signIn, register, signOut }),
    [session, loading, signIn, register, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
