export type ApiErrorKind = "invalid_config" | "unreachable" | "timeout" | "http" | "malformed";

export class ApiError extends Error {
  kind: ApiErrorKind;
  title: string;
  status?: number;

  constructor(kind: ApiErrorKind, title: string, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.title = title;
    this.status = status;
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
