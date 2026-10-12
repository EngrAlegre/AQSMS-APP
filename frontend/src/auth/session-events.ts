/**
 * A tiny event channel between the HTTP layer and the auth provider.
 *
 * requestJson() is the first to learn that the Pi has rejected a token, but it
 * sits outside React and cannot touch session state. Rather than thread a
 * callback through every data hook, the rejection is announced here and
 * AuthProvider subscribes once.
 */

type Handler = () => void;

let unauthorizedHandler: Handler | null = null;
let pendingNotice: string | null = null;

export function setUnauthorizedHandler(handler: Handler | null): void {
  unauthorizedHandler = handler;
}

/** Called when the Pi answers 401 to a request that carried a token. */
export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

/** Reason to display on the sign-in screen after a forced sign-out. */
export function setSessionNotice(message: string): void {
  pendingNotice = message;
}

/** Reads the notice and clears it, so it is shown exactly once. */
export function consumeSessionNotice(): string | null {
  const notice = pendingNotice;
  pendingNotice = null;
  return notice;
}
