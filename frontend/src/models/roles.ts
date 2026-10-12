// Display names for the two roles. The wire values are "owner" and "caretaker"
// (see src/models/types.ts); these are what a person reads on screen.

import { AccountStatus, UserRole } from "./types";

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner/Admin",
  caretaker: "Caretaker",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: "Monitors the pond and manages caretaker accounts.",
  caretaker: "Monitors the pond: dashboard, readings and alerts.",
};

export const STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  disabled: "Disabled",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

export function statusLabel(status: AccountStatus): string {
  return STATUS_LABELS[status];
}
