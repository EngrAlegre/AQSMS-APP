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
import { deriveConnection } from "../src/logic/connection";
import { evaluateStatus, isStale, statusFor } from "../src/logic/status";
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
