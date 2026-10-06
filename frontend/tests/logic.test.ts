/**
 * Logic + Real-mode client tests (run with: npx tsx tests/logic.test.ts <lanBaseUrl>).
 * The Real-mode part talks to tests/mock_pi_server.py, which implements the
 * GUESSED placeholder contract — it verifies the app's code path, not the real Pi.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { createDemoSource } from "../src/api/demoSource";
import { ApiError } from "../src/api/errors";
import { normalizeBaseUrl } from "../src/api/httpClient";
import { createRealSource, testPiConnection } from "../src/api/realSource";
import { deriveConnection } from "../src/logic/connection";
import { evaluateStatus, isStale, statusFor } from "../src/logic/status";
import { DEMO_THRESHOLDS } from "../src/api/demoData";

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

const TH = DEMO_THRESHOLDS;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withServer(port: number, mode: string, fn: () => Promise<void>) {
  const p = spawn("python3", ["tests/mock_pi_server.py", String(port), mode], { stdio: "ignore" });
  await sleep(700);
  try {
    await fn();
  } finally {
    p.kill();
  }
}

(async () => {
  const lanIp = process.argv[2];

  // ---- Status rules -------------------------------------------------------
  await t("missing pH/temp/DO => No Data (never Safe)", () => {
    for (const k of ["ph", "temperature", "dissolvedOxygen"] as const) {
      assert.equal(statusFor(k, null, TH), "no_data");
      assert.equal(evaluateStatus(undefined as unknown as null, TH.values[k]), "no_data");
      assert.equal(evaluateStatus(NaN, TH.values[k]), "no_data");
    }
  });
  await t("no thresholds => No Data", () => assert.equal(statusFor("ph", 7.2, null), "no_data"));
  await t("safe / warning / unsafe bands", () => {
    assert.equal(statusFor("ph", 7.2, TH), "safe");
    assert.equal(statusFor("ph", 8.7, TH), "warning");
    assert.equal(statusFor("ph", 9.3, TH), "unsafe");
    assert.equal(statusFor("dissolvedOxygen", 4.2, TH), "warning");
    assert.equal(statusFor("dissolvedOxygen", 2.5, TH), "unsafe");
  });
  await t("stale after 10 minutes", () => {
    const now = Date.now();
    assert.equal(isStale(new Date(now - 9 * 60000).toISOString(), now), false);
    assert.equal(isStale(new Date(now - 11 * 60000).toISOString(), now), true);
  });

  // ---- Connection labels --------------------------------------------------
  await t("demo data is never labelled live", () => {
    assert.equal(deriveConnection({ mode: "demo", hasData: true, isLoading: false, error: null, stale: false }), "simulated");
  });
  await t("real + failed refresh with old data => cached (not live)", () => {
    const err = new ApiError("timeout", "x", "y");
    assert.equal(deriveConnection({ mode: "real", hasData: true, isLoading: false, error: err, stale: false }), "cached");
    assert.equal(deriveConnection({ mode: "real", hasData: false, isLoading: false, error: err, stale: false }), "unreachable");
  });

  // ---- Demo scenarios ------------------------------------------------------
  await t("demo 'missing' scenario: latest pH & DO null, temp present", async () => {
    const r = (await createDemoSource("missing").getLatest()).reading!;
    assert.equal(r.values.ph, null);
    assert.equal(r.values.dissolvedOxygen, null);
    assert.equal(typeof r.values.temperature, "number");
    assert.equal(statusFor("ph", r.values.ph, TH), "no_data");
  });
  await t("demo 'unreachable' rejects", () => assert.rejects(createDemoSource("unreachable").getLatest()));
  await t("demo 'malformed' rejects with malformed kind", async () => {
    await assert.rejects(createDemoSource("malformed").getLatest(), (e: ApiError) => e.kind === "malformed");
  });
  await t("demo 'no_alerts' returns []", async () => assert.deepEqual(await createDemoSource("no_alerts").getAlerts(), []));
  await t("demo 'stale' latest is older than 10 min", async () => {
    const r = (await createDemoSource("stale").getLatest()).reading!;
    assert.equal(isStale(r.timestamp, Date.now()), true);
  });

  // ---- URL validation ------------------------------------------------------
  await t("URL validation", () => {
    assert.equal(normalizeBaseUrl("192.168.1.50:8000").url, "http://192.168.1.50:8000");
    assert.throws(() => normalizeBaseUrl(""));
    assert.throws(() => normalizeBaseUrl("localhost:8000"));
    assert.throws(() => normalizeBaseUrl("127.0.0.1"));
    assert.throws(() => normalizeBaseUrl("8.8.8.8"));
    assert.equal(normalizeBaseUrl("aquapi.local:8000").host, "aquapi.local");
  });

  // ---- Real mode against MOCK Pi (placeholder contract) --------------------
  if (lanIp) {
    const base = (port: number) => `http://${lanIp}:${port}`;
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
        assert.equal(statusFor("temperature", r.values.temperature, th), "safe");
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
    });
    await t("real: nothing listening => unreachable/timeout", async () => {
      await assert.rejects(createRealSource(base(8799), null).getLatest(), (e: ApiError) => ["unreachable", "timeout"].includes(e.kind));
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
