export type ApiErrorKind = "invalid_config" | "unreachable" | "timeout" | "http" | "malformed";

export class ApiError extends Error {
  kind: ApiErrorKind;
  title: string;
  status?: number;
  /** The Pi's own {"error": "..."} text, when it sent one. */
  serverMessage?: string;
  /** The Pi's machine-readable {"code": "..."}, e.g. "registration_closed". */
  code?: string;

  constructor(
    kind: ApiErrorKind,
    title: string,
    message: string,
    status?: number,
    serverMessage?: string,
    code?: string,
  ) {
    super(message);
    this.kind = kind;
    this.title = title;
    this.status = status;
    this.serverMessage = serverMessage;
    this.code = code;
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError("unreachable", "Unexpected error", e instanceof Error ? e.message : String(e));
}

export class MalformedResponseError extends ApiError {
  constructor(detail: string) {
    super(
      "malformed",
      "Unrecognised data from Pi",
      `The Pi responded, but the data format was not recognised: ${detail}. ` +
        "Check the response mapping in src/api/piApiContract.ts.",
    );
  }
}
