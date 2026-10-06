import { REQUEST_TIMEOUT_MS } from "@/src/config";

import { ApiError } from "./errors";

export interface NormalizedBaseUrl {
  url: string;
  host: string;
  port: string | null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export function isPrivateIPv4(host: string): boolean {
  const m = host.match(IPV4);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * Validates what the farmer typed (e.g. "192.168.1.50:8000" or
 * "http://aquapi.local:8000/api") and returns a clean base URL. Only LAN
 * addresses are accepted: the app never talks to the public internet.
 */
export function normalizeBaseUrl(input: string): NormalizedBaseUrl {
  const raw = input.trim().replace(/\/+$/, "");
  if (!raw) {
    throw new ApiError("invalid_config", "Pi address not set", "Enter the Raspberry Pi address in Settings (e.g. 192.168.1.50:8000).");
  }
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const m = withScheme.match(/^(https?):\/\/([^/:\s?#]+)(?::(\d{1,5}))?(\/[^\s]*)?$/i);
  if (!m) {
    throw new ApiError("invalid_config", "Invalid address", "Use the format 192.168.1.50:8000 or http://hostname:port.");
  }
  const [, scheme, host, port, path] = m;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.startsWith("127.") || lower === "0.0.0.0") {
    throw new ApiError(
      "invalid_config",
      "Localhost is the phone itself",
      "On a phone, 'localhost' means the phone, not the Pi. Enter the Pi's local IP address (e.g. 192.168.1.50).",
    );
  }
  const ipv4 = lower.match(IPV4);
  if (ipv4) {
    if (ipv4.slice(1).some((o) => Number(o) > 255)) {
      throw new ApiError("invalid_config", "Invalid IP address", `"${host}" is not a valid IPv4 address.`);
    }
    if (!isPrivateIPv4(lower)) {
      throw new ApiError(
        "invalid_config",
        "Not a local address",
        "This app only connects to the Pi on the pond's local Wi-Fi (10.x, 172.16–31.x or 192.168.x addresses).",
      );
    }
  } else if (!HOSTNAME.test(host)) {
    throw new ApiError("invalid_config", "Invalid hostname", `"${host}" is not a valid hostname.`);
  }
  if (port && (Number(port) < 1 || Number(port) > 65535)) {
    throw new ApiError("invalid_config", "Invalid port", "Port must be between 1 and 65535.");
  }
  return {
    url: `${scheme.toLowerCase()}://${host}${port ? `:${port}` : ""}${path ?? ""}`,
    host,
    port: port ?? null,
  };
}

export interface JsonResponse {
  status: number;
  json: unknown;
  latencyMs: number;
}

/** GET/POST JSON with a timeout, classifying failures into ApiError kinds. */
export async function requestJson(
  baseUrl: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {},
): Promise<JsonResponse> {
  const { url } = normalizeBaseUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: options.method ?? "GET",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw aborted
      ? new ApiError(
          "timeout",
          "Pi did not respond",
          `No response within ${REQUEST_TIMEOUT_MS / 1000} s. The phone may be on a different Wi-Fi, or the Pi / API service is off.`,
        )
      : new ApiError(
          "unreachable",
          "Can't reach the Pi",
          "Check that this phone is connected to the pond's local Wi-Fi and that the Raspberry Pi is powered on.",
        );
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(
      "http",
      `Pi responded with HTTP ${res.status}`,
      res.status === 404
        ? `Path "${path}" was not found. The endpoint paths in src/api/piApiContract.ts may not match the Pi API yet.`
        : res.status === 401 || res.status === 403
          ? "The Pi refused the request (not authorised)."
          : `The Pi API returned an error (HTTP ${res.status}).`,
      res.status,
    );
  }
  if (!text.trim()) return { status: res.status, json: null, latencyMs };
  try {
    return { status: res.status, json: JSON.parse(text), latencyMs };
  } catch {
    throw new ApiError("malformed", "Unrecognised data from Pi", "The Pi responded, but not with valid JSON.");
  }
}
