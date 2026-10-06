/**
 * Authentication adapters. The UI only talks to the `AuthAdapter` interface.
 *
 * - mockAuthAdapter: DEMO ONLY. Checks a clearly labelled demo account on the
 *   phone. Not a real credential and not a secret.
 * - piAuthAdapter:  for later — signs in against the Raspberry Pi local API
 *   (endpoint + response mapping live in src/api/piApiContract.ts).
 *
 * To switch, set AUTH_PROVIDER = "pi" in piApiContract.ts once the Pi provides sign-in.
 */
import { ApiError } from "@/src/api/errors";
import { requestJson } from "@/src/api/httpClient";
import { AUTH_PROVIDER, ENDPOINTS, mapLoginResponse } from "@/src/api/piApiContract";
import { Session } from "@/src/models/types";

export interface AuthAdapter {
  id: "mock" | "pi";
  label: string;
  signIn(username: string, password: string, ctx: { baseUrl: string }): Promise<Session>;
}

/** Demo account shown on the sign-in screen. For UI review only. */
export const DEMO_ACCOUNT = { username: "farmer", password: "demo1234" };

export const mockAuthAdapter: AuthAdapter = {
  id: "mock",
  label: "Demo sign-in (on this phone only)",
  async signIn(username, password) {
    await new Promise((r) => setTimeout(r, 500));
    if (username.trim().toLowerCase() !== DEMO_ACCOUNT.username || password !== DEMO_ACCOUNT.password) {
      throw new ApiError("invalid_config", "Sign-in failed", "Username or password is incorrect. Use the demo account shown below.");
    }
    return { username: DEMO_ACCOUNT.username, displayName: "Pond Farmer (demo)", provider: "mock", token: null };
  },
};

export const piAuthAdapter: AuthAdapter = {
  id: "pi",
  label: "Raspberry Pi local sign-in",
  async signIn(username, password, { baseUrl }) {
    const res = await requestJson(baseUrl, ENDPOINTS.login, { method: "POST", body: { username, password } });
    const { token, displayName } = mapLoginResponse(res.json);
    return { username, displayName: displayName ?? username, provider: "pi", token };
  },
};

export const authAdapter: AuthAdapter = AUTH_PROVIDER === "pi" ? piAuthAdapter : mockAuthAdapter;
