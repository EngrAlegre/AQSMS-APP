/**
 * Authentication adapter for the Raspberry Pi local API.
 * Signs in against the Pi's /auth/login endpoint.
 * The login endpoint and response mapping live in src/api/piApiContract.ts.
 */
import { requestJson } from "@/src/api/httpClient";
import { ENDPOINTS, mapLoginResponse } from "@/src/api/piApiContract";
import { Session } from "@/src/models/types";

export interface AuthAdapter {
  id: "pi";
  label: string;
  signIn(username: string, password: string, ctx: { baseUrl: string }): Promise<Session>;
}

export const piAuthAdapter: AuthAdapter = {
  id: "pi",
  label: "Raspberry Pi local sign-in",
  async signIn(username, password, { baseUrl }) {
    const res = await requestJson(baseUrl, ENDPOINTS.login, { method: "POST", body: { username, password } });
    const { token, displayName } = mapLoginResponse(res.json);
    return { username, displayName: displayName ?? username, provider: "pi", token };
  },
};

export const authAdapter: AuthAdapter = piAuthAdapter;
