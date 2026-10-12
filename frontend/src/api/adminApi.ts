/**
 * Owner/Admin account management, over the Pi's local API.
 *
 * Every call here hits an endpoint the Pi guards with role_required(owner), so
 * a caretaker token gets a 403 no matter how it arrived. Hiding the screen from
 * caretakers is a convenience, not the control.
 *
 * There is no function here for deleting an account, changing a role, or
 * reading/resetting someone else's password, because the Pi exposes none.
 */
import { ManagedUser } from "@/src/models/types";

import { requestJson } from "./httpClient";
import { buildAuthHeaders, ENDPOINTS, mapAccount, mapAdminUsers } from "./piApiContract";

export interface AdminContext {
  baseUrl: string;
  token: string | null;
}

/** The caretaker accounts. The fixed Owner/Admin is never in this list. */
export async function fetchManagedUsers(ctx: AdminContext): Promise<ManagedUser[]> {
  const res = await requestJson(ctx.baseUrl, ENDPOINTS.adminUsers, {
    headers: buildAuthHeaders(ctx.token),
  });
  return mapAdminUsers(res.json);
}

export interface NewCaretaker {
  username: string;
  displayName?: string;
  password: string;
  confirmPassword: string;
}

export async function createCaretaker(ctx: AdminContext, input: NewCaretaker): Promise<ManagedUser> {
  const res = await requestJson(ctx.baseUrl, ENDPOINTS.adminUsers, {
    method: "POST",
    headers: buildAuthHeaders(ctx.token),
    body: {
      username: input.username,
      display_name: input.displayName ?? input.username,
      password: input.password,
      confirm_password: input.confirmPassword,
    },
  });
  const created = mapAccount((res.json as { user?: unknown })?.user, "created user");
  if (created.role !== "caretaker") {
    // The Pi cannot return an owner here, and if it ever did, the screen must
    // not silently treat it as an ordinary row.
    throw new Error("The Pi created an account with an unexpected role.");
  }
  return created;
}

/** Disable or re-enable a caretaker. `status` is the state to move it to. */
export async function setCaretakerStatus(
  ctx: AdminContext,
  username: string,
  status: "active" | "disabled",
): Promise<ManagedUser> {
  const path = status === "disabled" ? ENDPOINTS.adminUserDisable(username) : ENDPOINTS.adminUserEnable(username);
  const res = await requestJson(ctx.baseUrl, path, {
    method: "POST",
    headers: buildAuthHeaders(ctx.token),
  });
  return mapAccount((res.json as { user?: unknown })?.user, "updated user");
}
