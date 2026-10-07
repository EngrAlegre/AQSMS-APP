// App-wide constants for the single-pond prototype. No secrets or URLs live here.

export const APP_NAME = "Aqua Smart Monitoring System";

/** Fallback pond name when the Pi does not provide one. */
export const POND_NAME = "Test Pond 1";

/** A reading older than this is labelled STALE (agreed: 10 minutes). */
export const STALE_AFTER_MINUTES = 10;

/** Per-request timeout for calls to the Raspberry Pi on the LAN. */
export const REQUEST_TIMEOUT_MS = 6000;

/** Dashboard auto-refresh interval while the screen is open. */
export const AUTO_REFRESH_MS = 30_000;

/** How many history records to request (24 h at 5-min intervals). */
export const HISTORY_LIMIT = 288;

/** How many alert records to request. */
export const ALERTS_LIMIT = 100;
