/**
 * Pure-logic and mapper tests, plus Real-mode client tests against
 * tests/mock_pi_server.py.
 *
 * Run:  npx tsx tests/logic.test.ts
 *
 * The mock server implements the placeholder contract in
 * src/api/piApiContract.ts, so it verifies the app's own code path and mapping,
 * not the real Pi. For tests against the actual Flask + SQLite Pi server, see
 * tests/pi_server.test.ts.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";

import { ApiError } from "../src/api/errors";
import { isPrivateIPv4, normalizeBaseUrl } from "../src/api/httpClient";
import { mapAlerts, mapLatestReading, mapReadingHistory, mapThresholds } from "../src/api/piApiContract";
import { createRealSource, testPiConnection } from "../src/api/realSource";
import { deriveConnection, freshnessHeadline } from "../src/logic/connection";
import {
  evaluateStatus,
  formatAge,
  isStale,
  isStaleAgeSeconds,
  isStaleReading,
  readingAgeSeconds,
  statusFor,
} from "../src/logic/status";
import { PARAMETER_ORDER } from "../src/models/parameters";
import {
  buildRawReadings,
  FIXTURE_THRESHOLDS_APPROVED,
  FIXTURE_THRESHOLDS_UNAPPROVED,
} from "./fixtures/demoData";

let pass = 0;
let fail = 0;
async function t(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

const APPROVED = FIXTURE_THRESHOLDS_APPROVED;
const UNAPPROVED = FIXTURE_THRESHOLDS_UNAPPROVED;
const PYTHON = process.platform === "win32" ? "python" : "python3";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The app refuses loopback addresses, so bind tests to a real private LAN IP. */
function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal && isPrivateIPv4(ni.address)) return ni.address;
    }
  }
  return null;
}

async function withServer(port: number, mode: string, fn: () => Promise<void>) {
  const p = spawn(PYTHON, ["tests/mock_pi_server.py", String(port), mode], { stdio: "ignore" });
  await sleep(1200);
  try {
    await fn();
  } finally {
    p.kill();
  }
}

(async () => {
  // ---- Status rules --------------------------------------------------------
  await t("missing pH/temp/DO => No Data (never Safe)", () => {
    for (const k of PARAMETER_ORDER) {
      assert.equal(statusFor(k, null, APPROVED), "no_data");
      assert.equal(evaluateStatus(undefined as unknown as null, APPROVED.values[k]), "no_data");
      assert.equal(evaluateStatus(NaN, APPROVED.values[k]), "no_data");
      assert.equal(evaluateStatus(Infinity, APPROVED.values[k]), "no_data");
    }
  });

  await t("no thresholds at all => No Data", () => {
    assert.equal(statusFor("ph", 7.2, null), "no_data");
    assert.equal(statusFor("ph", 7.2, undefined), "no_data");
  });

  // P0: green "Safe" must be impossible until the limits are approved.
  await t("UNAPPROVED thresholds => never Safe, even for in-range values", () => {
    const midRange = { ph: 7.2, temperature: 28, dissolvedOxygen: 6.5 } as const;
    for (const k of PARAMETER_ORDER) {
      assert.equal(statusFor(k, midRange[k], UNAPPROVED), "no_data", `${k} must not be Safe`);
      assert.notEqual(statusFor(k, midRange[k], UNAPPROVED), "safe");
    }
  });

  await t("unapproved thresholds still report Warning and Unsafe", () => {
    // Out-of-range values stay actionable; only the Safe claim is withheld.
    assert.equal(statusFor("ph", 8.7, UNAPPROVED), "warning");
    assert.equal(statusFor("ph", 9.3, UNAPPROVED), "unsafe");
    assert.equal(statusFor("dissolvedOxygen", 2.5, UNAPPROVED), "unsafe");
  });

  await t("approved thresholds: safe / warning / unsafe bands", () => {
    assert.equal(statusFor("ph", 7.2, APPROVED), "safe");
    assert.equal(statusFor("ph", 8.7, APPROVED), "warning");
    assert.equal(statusFor("ph", 9.3, APPROVED), "unsafe");
    assert.equal(statusFor("temperature", 28, APPROVED), "safe");
    assert.equal(statusFor("dissolvedOxygen", 6.5, APPROVED), "safe");
    assert.equal(statusFor("dissolvedOxygen", 4.2, APPROVED), "warning");
    assert.equal(statusFor("dissolvedOxygen", 2.5, APPROVED), "unsafe");
  });

  await t("real Pi thresholds (NULL limits, approved=false) => No Data", () => {
    // Exactly what pi-server/db.py seeds: no limits recorded, not approved.
    const th = mapThresholds({
      approved: false,
      ph: { safe_min: null, safe_max: null, warn_min: null, warn_max: null },
      temperature: { safe_min: null, safe_max: null, warn_min: null, warn_max: null },
      dissolved_oxygen: { safe_min: null, safe_max: null, warn_min: null, warn_max: null },
    });
    assert.equal(th.approved, false);
    for (const k of PARAMETER_ORDER) assert.equal(statusFor(k, 7.2, th), "no_data");
  });

  await t("stale after 10 minutes", () => {
    const now = Date.now();
    assert.equal(isStale(new Date(now - 9 * 60000).toISOString(), now), false);
    assert.equal(isStale(new Date(now - 11 * 60000).toISOString(), now), true);
  });

  // ---- Reading age: one clock at a time ------------------------------------
  // The Pi has no internet time source once it hosts its own Wi-Fi, so its clock
  // drifts. Every case below is a combination of clocks that the old
  // "phoneNow - reading.timestamp" subtraction got wrong in one direction or
  // the other. The two that matter most are the false "live" and the false
  // "stale", because both send the farmer to the pond -- or fail to.
  await t("age: the Pi's own age_seconds is used, not the phone clock", () => {
    const now = Date.now();
    const ts = new Date(now - 30 * 60000).toISOString();
    assert.equal(readingAgeSeconds({ timestamp: ts, ageSeconds: 1800, ageAsOfMs: now, nowMs: now }), 1800);
    // 30 s later the phone has simply counted 30 more seconds of its own.
    assert.equal(readingAgeSeconds({ timestamp: ts, ageSeconds: 1800, ageAsOfMs: now, nowMs: now + 30_000 }), 1830);
  });

  await t("age: a Pi clock 6 h ahead cannot make a 45-min-old reading look live", () => {
    const now = Date.now();
    const ts = new Date(now + 6 * 3600_000 - 45 * 60000).toISOString();
    // The old two-clock subtraction goes negative here and formatAgo masked it
    // as "just now": a dead board showing a live dashboard.
    assert.equal(isStale(ts, now), false);
    // The Pi's own age is immune to that, and it is what we now act on.
    assert.equal(isStaleReading({ timestamp: ts, ageSeconds: 2700, ageAsOfMs: now, nowMs: now }), true);
  });

  await t("age: a Pi clock 30 min behind does not make a fresh reading look stale", () => {
    const now = Date.now();
    const ts = new Date(now - 30 * 60000).toISOString();
    // This is the false "Stale" a drifting Pi produced on a perfectly good reading.
    assert.equal(isStale(ts, now), true);
    assert.equal(isStaleReading({ timestamp: ts, ageSeconds: 0, ageAsOfMs: now, nowMs: now }), false);
  });

  await t("age: a negative age is never fresh", () => {
    assert.equal(isStaleAgeSeconds(-120), true);
    assert.equal(formatAge(-120), "unknown age");
    // Even with no age from the Pi at all, a timestamp in the future must not be
    // read as fresh -- the old code returned "just now" for exactly this.
    const now = Date.now();
    const future = new Date(now + 90 * 60000).toISOString();
    assert.equal(isStaleReading({ timestamp: future, ageSeconds: null, ageAsOfMs: now, nowMs: now }), true);
  });

  await t("age: falls back to the phone clock only when the Pi sends no age", () => {
    const now = Date.now();
    const mk = (min: number) => new Date(now - min * 60000).toISOString();
    assert.equal(isStaleReading({ timestamp: mk(9), ageSeconds: null, ageAsOfMs: now, nowMs: now }), false);
    assert.equal(isStaleReading({ timestamp: mk(11), ageSeconds: null, ageAsOfMs: now, nowMs: now }), true);
  });

  await t("age: 10-minute boundary, and a backward phone jump cannot freshen a reading", () => {
    assert.equal(isStaleAgeSeconds(599), false);
    assert.equal(isStaleAgeSeconds(600), false);
    assert.equal(isStaleAgeSeconds(601), true);
    const now = Date.now();
    // nowMs earlier than ageAsOfMs means the phone's clock moved backwards. The
    // elapsed term clamps at 0, so the reading is never younger than the Pi said.
    assert.equal(
      readingAgeSeconds({ timestamp: new Date(now).toISOString(), ageSeconds: 900, ageAsOfMs: now, nowMs: now - 60_000 }),
      900,
    );
  });

  await t("formatAge buckets", () => {
    assert.equal(formatAge(0), "just now");
    assert.equal(formatAge(59), "just now");
    assert.equal(formatAge(60), "1 min old");
    assert.equal(formatAge(900), "15 min old");
    assert.equal(formatAge(10800), "3 h old");
    assert.equal(formatAge(172800), "2 d old");
    assert.equal(formatAge(-1), "unknown age");
    assert.equal(formatAge(Number.NaN), "unknown age");
  });

  await t("freshnessHeadline leads with freshness, never a clock time", () => {
    assert.equal(freshnessHeadline("live", 5), "Live · updated just now");
    assert.equal(freshnessHeadline("live", 300), "Live · last reading 5 min old");
    assert.equal(freshnessHeadline("stale", 10800), "Not live · 3 h old");
    assert.equal(freshnessHeadline("cached", 120), "Not live · 2 min old");
    assert.equal(freshnessHeadline("no_data", null), "No reading received yet");
    assert.equal(freshnessHeadline("unreachable", null), "Not live · Can't reach the Pi");
    // No reassuring age is printed next to "Not live" when the age is nonsense...
    assert.equal(freshnessHeadline("stale", -60), "Not live");
    // ...or when it is so small that "Not live · just now" would contradict itself.
    assert.equal(freshnessHeadline("cached", 5), "Not live");
  });

  // ---- Connection state ----------------------------------------------------
  // P0: an HTTP 200 carrying "reading": null must never read as Live.
  await t("Pi answered with no reading => No data (never Live)", () => {
    assert.equal(deriveConnection({ hasData: false, isLoading: false, error: null, stale: false }), "no_data");
  });

  await t("Live only when a real reading exists and is fresh", () => {
    assert.equal(deriveConnection({ hasData: true, isLoading: false, error: null, stale: false }), "live");
    assert.equal(deriveConnection({ hasData: true, isLoading: false, error: null, stale: true }), "stale");
  });

  await t("failed refresh with an old reading => cached, not live", () => {
    const err = new ApiError("timeout", "x", "y");
    assert.equal(deriveConnection({ hasData: true, isLoading: false, error: err, stale: false }), "cached");
    assert.equal(deriveConnection({ hasData: false, isLoading: false, error: err, stale: false }), "unreachable");
  });

  await t("Pi not configured => not_configured badge", () => {
    const err = new ApiError("invalid_config", "Pi not configured", "Enter the address in Settings.");
    assert.equal(deriveConnection({ hasData: false, isLoading: false, error: err, stale: false }), "not_configured");
    assert.equal(deriveConnection({ hasData: true, isLoading: false, error: err, stale: false }), "not_configured");
  });

  await t("malformed payload => bad_data; first load => connecting", () => {
    const err = new ApiError("malformed", "x", "y");
    assert.equal(deriveConnection({ hasData: false, isLoading: false, error: err, stale: false }), "bad_data");
    assert.equal(deriveConnection({ hasData: false, isLoading: true, error: null, stale: false }), "connecting");
  });

  // ---- URL validation ------------------------------------------------------
  await t("URL validation accepts LAN, rejects loopback and public", () => {
    assert.equal(normalizeBaseUrl("192.168.1.50:8000").url, "http://192.168.1.50:8000");
    assert.equal(normalizeBaseUrl("10.0.0.5:8000").url, "http://10.0.0.5:8000");
    assert.equal(normalizeBaseUrl("172.16.4.9:8000").url, "http://172.16.4.9:8000");
    assert.equal(normalizeBaseUrl("aquapi.local:8000").host, "aquapi.local");
    assert.throws(() => normalizeBaseUrl(""), (e: ApiError) => e.kind === "invalid_config");
    assert.throws(() => normalizeBaseUrl("   "), (e: ApiError) => e.kind === "invalid_config");
    assert.throws(() => normalizeBaseUrl("localhost:8000"));
    assert.throws(() => normalizeBaseUrl("127.0.0.1"));
    assert.throws(() => normalizeBaseUrl("8.8.8.8"));
    assert.throws(() => normalizeBaseUrl("172.32.0.1")); // outside 172.16-31
    assert.throws(() => normalizeBaseUrl("192.168.1.999"));
  });

  // ---- Mappers -------------------------------------------------------------
  await t("empty Pi database maps to null reading and empty lists", () => {
    const latest = mapLatestReading({ pond_name: "Test Pond 1", reading: null });
    assert.equal(latest.reading, null);
    assert.equal(latest.pondName, "Test Pond 1");
    assert.deepEqual(mapReadingHistory({ readings: [] }), []);
    assert.deepEqual(mapAlerts({ alerts: [] }), []);
  });

  await t("missing sensor values map to null, not zero", () => {
    const latest = mapLatestReading({
      pond_name: "Test Pond 1",
      reading: { timestamp: new Date().toISOString(), ph: null, temperature_c: 27, dissolved_oxygen_mg_l: null },
    });
    assert.equal(latest.reading!.values.ph, null);
    assert.equal(latest.reading!.values.dissolvedOxygen, null);
    assert.equal(latest.reading!.values.temperature, 27);
  });

  await t("invalid alert status strings are rejected", () => {
    for (const bad of ["ok", "SAFE", "", "danger", "info", null]) {
      assert.throws(
        () =>
          mapAlerts({
            alerts: [{ id: "1", timestamp: new Date().toISOString(), parameter: "ph", value: 9.9, status: bad }],
          }),
        (e: ApiError) => e.kind === "malformed",
        `status ${JSON.stringify(bad)} should be rejected`,
      );
    }
    // Accepted values still map through.
    const ok = mapAlerts({
      alerts: [
        { id: "1", timestamp: new Date().toISOString(), parameter: "ph", value: 9.9, status: "unsafe", message: "high" },
        { id: "2", timestamp: new Date().toISOString(), parameter: "dissolved_oxygen", value: 4.1, status: "warning" },
      ],
    });
    assert.equal(ok.length, 2);
    assert.equal(ok.find((a) => a.id === "2")!.parameter, "dissolvedOxygen");
  });

  await t("unknown alert parameter and bad types are rejected", () => {
    const ts = new Date().toISOString();
    assert.throws(() => mapAlerts({ alerts: [{ id: "1", timestamp: ts, parameter: "salinity", status: "unsafe" }] }));
    assert.throws(() => mapAlerts({ alerts: [{ id: "1", timestamp: "not-a-date", parameter: "ph", status: "unsafe" }] }));
    assert.throws(() => mapLatestReading({ reading: { timestamp: ts, ph: "7,2" } }));
    assert.throws(() => mapReadingHistory({ rows: [] }));
    assert.throws(() => mapThresholds({ approved: true }));
  });

  await t("history is sorted newest first", () => {
    const raws = buildRawReadings("normal");
    const mapped = mapReadingHistory({ readings: [...raws].reverse() });
    assert.equal(mapped.length, raws.length);
    for (let i = 1; i < mapped.length; i++) {
      assert.ok(mapped[i - 1].timestamp >= mapped[i].timestamp, "not sorted at index " + i);
    }
  });

  // ---- Fixture edge cases --------------------------------------------------
  await t("fixture 'missing': newest pH & DO null, temperature present", () => {
    const r = mapLatestReading({ reading: buildRawReadings("missing")[0] }).reading!;
    assert.equal(r.values.ph, null);
    assert.equal(r.values.dissolvedOxygen, null);
    assert.equal(typeof r.values.temperature, "number");
    assert.equal(statusFor("ph", r.values.ph, APPROVED), "no_data");
  });

  await t("fixture 'stale': newest reading older than 10 min", () => {
    const r = mapLatestReading({ reading: buildRawReadings("stale")[0] }).reading!;
    assert.equal(isStale(r.timestamp, Date.now()), true);
  });

  await t("mapLatestReading carries age_seconds, and refuses a non-number", () => {
    const raw = buildRawReadings("normal")[0];
    assert.equal(mapLatestReading({ pond_name: "Test Pond 1", reading: raw, age_seconds: 42 }).ageSeconds, 42);
    // A Pi old enough not to send the field yields null, which the logic layer
    // reads as "fall back to the phone-clock estimate".
    assert.equal(mapLatestReading({ reading: raw }).ageSeconds, null);
    // No reading means no age, whichever way the Pi words it -- the app shows
    // No Data, never Live.
    assert.equal(mapLatestReading({ reading: null, age_seconds: null }).ageSeconds, null);
    assert.equal(mapLatestReading({ reading: null, age_seconds: 30 }).ageSeconds, null);
    // A string where a number belongs is a malformed response, not a default.
    assert.throws(() => mapLatestReading({ reading: raw, age_seconds: "42" }), /age_seconds/);
  });

  // ---- Real-mode client against the MOCK Pi --------------------------------
  const lanIp = process.argv[2] ?? lanAddress();
  if (!lanIp) {
    console.log("SKIP  mock-server tests (no private LAN IPv4 found on this machine)");
  } else {
    const base = (port: number) => `http://${lanIp}:${port}`;
    console.log(`\n--- Real-mode client vs mock Pi on ${lanIp} ---`);

    await withServer(8765, "ok", async () => {
      await t("real: test connection OK", async () => assert.equal((await testPiConnection(base(8765))).ok, true));
      await t("real: latest/history/alerts/thresholds map", async () => {
        const src = createRealSource(base(8765), null);
        const l = await src.getLatest();
        assert.equal(l.pondName, "Test Pond 1");
        assert.equal(l.reading!.values.ph, 7.2);
        assert.equal((await src.getHistory()).length, 10);
        const a = await src.getAlerts();
        assert.equal(a[0].status, "unsafe");
        assert.equal(a[0].parameter, "dissolvedOxygen");
        assert.equal((await src.getThresholds()).approved, false);
      });
      await t("real: latest carries age_seconds, and a 1-min-old reading is not stale", async () => {
        const l = await createRealSource(base(8765), null).getLatest();
        assert.equal(typeof l.ageSeconds, "number");
        assert.ok(l.ageSeconds! >= 55 && l.ageSeconds! <= 130, `unexpected age_seconds ${l.ageSeconds}`);
        const now = Date.now();
        assert.equal(
          isStaleReading({ timestamp: l.reading!.timestamp, ageSeconds: l.ageSeconds, ageAsOfMs: now, nowMs: now }),
          false,
        );
      });
    });

    await withServer(8766, "missing", async () => {
      await t("real: missing pH/DO from Pi => No Data", async () => {
        const src = createRealSource(base(8766), null);
        const r = (await src.getLatest()).reading!;
        const th = await src.getThresholds();
        assert.equal(statusFor("ph", r.values.ph, th), "no_data");
        assert.equal(statusFor("dissolvedOxygen", r.values.dissolvedOxygen, th), "no_data");
        // The mock serves approved=false, so an in-range temperature is NOT Safe.
        assert.equal(statusFor("temperature", r.values.temperature, th), "no_data");
      });
    });

    await withServer(8767, "malformed", async () => {
      await t("real: non-JSON => malformed error", async () => {
        await assert.rejects(createRealSource(base(8767), null).getLatest(), (e: ApiError) => e.kind === "malformed");
      });
    });

    await withServer(8768, "empty", async () => {
      await t("real: empty history/alerts, null reading, thresholds 404", async () => {
        const src = createRealSource(base(8768), null);
        assert.equal((await src.getLatest()).reading, null);
        assert.deepEqual(await src.getHistory(), []);
        assert.deepEqual(await src.getAlerts(), []);
        await assert.rejects(src.getThresholds(), (e: ApiError) => e.kind === "http" && e.status === 404);
      });
      await t("real: empty Pi response never reads as Live", async () => {
        const latest = await createRealSource(base(8768), null).getLatest();
        assert.equal(
          deriveConnection({ hasData: !!latest.reading, isLoading: false, error: null, stale: false }),
          "no_data",
        );
        // No reading => no age to display, and nothing for the dashboard to age.
        assert.equal(latest.ageSeconds, null);
      });
    });

    await t("real: nothing listening => unreachable/timeout", async () => {
      await assert.rejects(
        createRealSource(base(8799), null).getLatest(),
        (e: ApiError) => ["unreachable", "timeout"].includes(e.kind),
      );
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
