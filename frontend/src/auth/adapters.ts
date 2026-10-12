/**
 * Authentication adapter for the Raspberry Pi local API.
 *
 * Both sign-in and account creation call the Pi itself; the endpoint paths and
 * response mappings live in src/api/piApiContract.ts.
 *
 * There is no mock adapter and no local account. The account exists only in the
 * Pi's SQLite database, so a phone that cannot reach the Pi cannot sign in and
 * cannot register.
 *
 * The role always comes from the Pi's response and is validated there. Nothing
 * in this file decides what role a caller has.
 */
import { requestJson } from "@/src/api/httpClient";
import {
  ENDPOINTS,
  mapLoginResponse,
  mapMeResponse,
  mapRegisterResponse,
} from "@/src/api/piApiContract";
import { ManagedUser, Session } from "@/src/models/types";

import { normalizeUsername } from "./credentials";

export interface RegisterInput {
  username: string;
  password: string;
  confirmPassword: string;
}

export interface AuthAdapter {
  id: "pi";
  label: string;
  signIn(username: string, password: string, ctx: { baseUrl: string }): Promise<Session>;
  register(input: RegisterInput, ctx: { baseUrl: string }): Promise<Session>;
  /** Re-read the current identity and role for a token the phone already holds. */
  me(ctx: { baseUrl: string; token: string }): Promise<ManagedUser>;
}

export const piAuthAdapter: AuthAdapter = {
  id: "pi",
  label: "Raspberry Pi local sign-in",

  async signIn(username, password, { baseUrl }) {
    const res = await requestJson(baseUrl, ENDPOINTS.login, { method: "POST", body: { username, password } });
    const { token, displayName, role, status } = mapLoginResponse(res.json);
    // The Pi lower-cases usernames, so store the normalised form to keep the
    // session consistent with what the database actually holds.
    const name = normalizeUsername(username);
    return { username: name, displayName: displayName ?? name, provider: "pi", token, role, status };
  },

  async register({ username, password, confirmPassword }, { baseUrl }) {
    const res = await requestJson(baseUrl, ENDPOINTS.register, {
      method: "POST",
      body: { username, password, confirm_password: confirmPassword },
    });
    const { token, displayName, role, status } = mapRegisterResponse(res.json);
    const name = normalizeUsername(username);
    return { username: name, displayName: displayName ?? name, provider: "pi", token, role, status };
  },

  async me({ baseUrl, token }) {
    const res = await requestJson(baseUrl, ENDPOINTS.me, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return mapMeResponse(res.json);
  },
};

export const authAdapter: AuthAdapter = piAuthAdapter;
