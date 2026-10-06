import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Session } from "@/src/models/types";
import { useSettings } from "@/src/settings/SettingsContext";
import { storage } from "@/src/utils/storage";

import { authAdapter } from "./adapters";

const K_USER = "aqua.session.username";
const K_NAME = "aqua.session.displayName";
const K_PROVIDER = "aqua.session.provider";
const K_TOKEN = "aqua.session.token";

interface AuthValue {
  session: Session | null;
  loading: boolean;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl } = useSettings();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const username = await storage.secureGet(K_USER, "");
      if (username) {
        setSession({
          username,
          displayName: (await storage.secureGet(K_NAME, username)) ?? username,
          provider: ((await storage.secureGet(K_PROVIDER, "mock")) as Session["provider"]) ?? "mock",
          token: (await storage.secureGet(K_TOKEN, "")) || null,
        });
      }
      setLoading(false);
    })();
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const s = await authAdapter.signIn(username, password, { baseUrl });
      await storage.secureSet(K_USER, s.username);
      await storage.secureSet(K_NAME, s.displayName);
      await storage.secureSet(K_PROVIDER, s.provider);
      await storage.secureSet(K_TOKEN, s.token ?? "");
      setSession(s);
    },
    [baseUrl],
  );

  const signOut = useCallback(async () => {
    await Promise.all([K_USER, K_NAME, K_PROVIDER, K_TOKEN].map((k) => storage.secureRemove(k)));
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, loading, signIn, signOut }), [session, loading, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
