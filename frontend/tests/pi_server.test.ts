/**
 * Integration tests against the REAL Raspberry Pi server: pi-server/server.py
 * (Flask) on a scratch SQLite database, with real bcrypt password hashing and
 * real JWT tokens. Nothing here is mocked.
 *
 * Run:  npx tsx tests/pi_server.test.ts
 *
 * Requires the pi-server virtualenv: see pi-server/requirements.txt.
 * The app refuses loopback addresses, so the server is reached over this
 * machine's private LAN IP, exactly as the phone reaches the Pi.
 */
import assert from "node:assert/strict";
import { ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { piAuthAdapter } from "../src/auth/adapters";
import { ApiError, toApiError } from "../src/api/errors";
import { isPrivateIPv4 } from "../src/api/httpClient";
import { createRealSource, testPiConnection } from "../src/api/realSource";
import { deriveConnection } from "../src/logic/connection";
import { statusFor } from "../src/logic/status";
import { PARAMETER_ORDER } from "../src/models/parameters";

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

const PORT = 8801;
const DB_PATH = path.join(os.tmpdir(), `aqsms_integration_${process.pid}.db`);

function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal && isPrivateIPv4(ni.address)) return ni.address;
    }
  }
  return null;
}

/** The pi-server virtualenv, falling back to whatever python is on PATH. */
function pythonBin(): string {
  const venvWin = path.resolve("../pi-server/venv/Scripts/python.exe");
  const venvNix = path.resolve("../pi-server/venv/bin/python");
  if (fs.existsSync(venvWin)) return venvWin;
  if (fs.existsSync(venvNix)) return venvNix;
  return process.platform === "win32" ? "python" : "python3";
}

interface Harness {
  username: string;
  displayName: string;
  password: string;
  esp32Key: string;
}

function startServer(): Promise<{ proc: ChildProcessWithoutNullStreams; info: Harness }> {
  const proc = spawn(pythonBin(), ["tests/pi_harness.py", String(PORT), DB_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pi-server did not report ready within 30 s")), 30_000);
    let buf = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
      if (line) {
        clearTimeout(timer);
        // Flask needs a moment after import before the socket accepts.
        setTimeout(() => resolve({ proc, info: JSON.parse(line) as Harness }), 1500);
      }
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`pi-server exited early (code ${code}):\n${stderr}`));
    });
  });
}

/** Applies a statement to the scratch database, as an operator on the Pi would. */
function run(sql: string) {
  execFileSync(pythonBin(), [
    "-c",
    "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(sys.argv[2]);c.commit();c.close()",
    DB_PATH,
    sql,
  ]);
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  const lanIp = lanAddress();
  if (!lanIp) {
    console.log("SKIP  no private LAN IPv4 on this machine; cannot exercise the LAN-only client.");
    process.exit(0);
  }
  const base = `http://${lanIp}:${PORT}`;
  console.log(`--- Real pi-server (Flask + SQLite) on ${base} ---`);
  console.log(`--- scratch database: ${DB_PATH} ---\n`);

  let started;
  try {
    started = await startServer();
  } catch (e) {
    console.log(`FAIL  could not start pi-server\n      ${(e as Error).message}`);
    process.exit(1);
  }
  const { proc, info } = started;

  try {
    // ---- Reachability ------------------------------------------------------
    await t("health check reachable over the LAN address", async () => {
      const r = await testPiConnection(base);
      assert.equal(r.ok, true);
      assert.equal(r.reachable, true);
    });

    // ---- Authentication ---------------------------------------------------
    await t("wrong password is rejected (HTTP 401, no token issued)", async () => {
      await assert.rejects(
        piAuthAdapter.signIn(info.username, "definitely-not-the-password", { baseUrl: base }),
        (e: unknown) => {
          const err = toApiError(e);
          return err.kind === "http" && err.status === 401;
        },
      );
    });

    await t("unknown username is rejected (HTTP 401)", async () => {
      await assert.rejects(piAuthAdapter.signIn("nosuchfarmer", info.password, { baseUrl: base }), (e: unknown) => {
        const err = toApiError(e);
        return err.kind === "http" && err.status === 401;
      });
    });

    await t("empty password is rejected (HTTP 400)", async () => {
      await assert.rejects(piAuthAdapter.signIn(info.username, "", { baseUrl: base }), (e: unknown) => {
        const err = toApiError(e);
        return err.kind === "http" && (err.status === 400 || err.status === 401);
      });
    });

    let token: string | null = null;
    await t("correct bcrypt credentials return a JWT and display name", async () => {
      const session = await piAuthAdapter.signIn(info.username, info.password, { baseUrl: base });
      assert.equal(session.username, info.username);
      assert.equal(session.displayName, info.displayName);
      assert.equal(session.provider, "pi");
      assert.ok(session.token && session.token.split(".").length === 3, "expected a JWT");
      token = session.token;
    });

    await t("protected endpoints reject a missing token (HTTP 401)", async () => {
      await assert.rejects(
        createRealSource(base, null).getLatest(),
        (e: ApiError) => e.kind === "http" && e.status === 401,
      );
    });

    await t("protected endpoints reject a forged token (HTTP 401)", async () => {
      await assert.rejects(
        createRealSource(base, "not.a.real.token").getLatest(),
        (e: ApiError) => e.kind === "http" && e.status === 401,
      );
    });

    // ---- Empty database: the shipping state before any sensor reports ------
    await t("empty DB: /readings/latest returns pond name with reading = null", async () => {
      const latest = await createRealSource(base, token).getLatest();
      assert.equal(latest.pondName, "Test Pond 1");
      assert.equal(latest.reading, null);
    });

    await t("empty DB: history and alerts are empty lists", async () => {
      const src = createRealSource(base, token);
      assert.deepEqual(await src.getHistory(), []);
      assert.deepEqual(await src.getAlerts(), []);
    });

    await t("empty DB: thresholds are NULL and approved = false", async () => {
      const th = await createRealSource(base, token).getThresholds();
      assert.equal(th.approved, false);
      for (const k of PARAMETER_ORDER) {
        assert.equal(th.values[k].safeMin, null, `${k}.safeMin must be null until approved`);
        assert.equal(th.values[k].safeMax, null, `${k}.safeMax must be null until approved`);
        assert.equal(th.values[k].warnMin, null);
        assert.equal(th.values[k].warnMax, null);
      }
      assert.match(th.sourceLabel, /not marked approved/);
    });

    await t("empty DB: badge shows No data, never Live", async () => {
      const latest = await createRealSource(base, token).getLatest();
      const conn = deriveConnection({
        hasData: !!latest.reading,
        isLoading: false,
        error: null,
        stale: false,
      });
      assert.equal(conn, "no_data");
      assert.notEqual(conn, "live");
    });

    // ---- ESP32 ingest guard ------------------------------------------------
    await t("ESP32 ingest without an API key is refused (HTTP 401)", async () => {
      const r = await postJson(`${base}/esp32/readings`, { timestamp: new Date().toISOString(), ph: 7.1 });
      assert.equal(r.status, 401);
    });

    await t("ESP32 ingest with a wrong API key is refused (HTTP 401)", async () => {
      const r = await postJson(
        `${base}/esp32/readings`,
        { timestamp: new Date().toISOString(), ph: 7.1 },
        { "X-API-Key": "wrong-key" },
      );
      assert.equal(r.status, 401);
    });

    await t("ESP32 ingest rejects a non-ISO timestamp (HTTP 400)", async () => {
      const r = await postJson(
        `${base}/esp32/readings`,
        { timestamp: "yesterday", ph: 7.1 },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(r.status, 400);
    });

    // ---- A real reading arrives from the hardware --------------------------
    const readingTs = new Date().toISOString();
    await t("ESP32 posts a reading with a valid key (HTTP 201)", async () => {
      const r = await postJson(
        `${base}/esp32/readings`,
        { timestamp: readingTs, ph: 7.18, temperature_c: 28.4, dissolved_oxygen_mg_l: null },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(r.status, 201);
    });

    await t("the posted reading appears in /readings/latest, nulls preserved", async () => {
      const latest = await createRealSource(base, token).getLatest();
      assert.ok(latest.reading, "expected a reading after ESP32 ingest");
      assert.equal(latest.reading!.values.ph, 7.18);
      assert.equal(latest.reading!.values.temperature, 28.4);
      // A missing probe must stay null, never coerced to 0.
      assert.equal(latest.reading!.values.dissolvedOxygen, null);
      assert.equal(new Date(latest.reading!.timestamp).toISOString(), new Date(readingTs).toISOString());
    });

    await t("a fresh reading with unapproved thresholds is still never Safe", async () => {
      const src = createRealSource(base, token);
      const latest = await src.getLatest();
      const th = await src.getThresholds();
      for (const k of PARAMETER_ORDER) {
        assert.equal(
          statusFor(k, latest.reading!.values[k], th),
          "no_data",
          `${k} must read No Data while thresholds are unapproved`,
        );
      }
      // The reading itself is live, even though no status can be judged.
      assert.equal(
        deriveConnection({ hasData: !!latest.reading, isLoading: false, error: null, stale: false }),
        "live",
      );
    });

    await t("history now contains exactly the one ingested record", async () => {
      const history = await createRealSource(base, token).getHistory();
      assert.equal(history.length, 1);
      assert.equal(history[0].values.ph, 7.18);
    });

    // ---- Alert ingest and contract validation -----------------------------
    await t("ESP32 alert with an invalid status is refused (HTTP 400)", async () => {
      for (const bad of ["critical", "ok", "safe", "DANGER"]) {
        const r = await postJson(
          `${base}/esp32/alerts`,
          { timestamp: new Date().toISOString(), parameter: "ph", status: bad, value: 9.9 },
          { "X-API-Key": info.esp32Key },
        );
        assert.equal(r.status, 400, `status "${bad}" should be refused`);
      }
    });

    await t("ESP32 alert with an unknown parameter is refused (HTTP 400)", async () => {
      const r = await postJson(
        `${base}/esp32/alerts`,
        { timestamp: new Date().toISOString(), parameter: "salinity", status: "unsafe", value: 1 },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(r.status, 400);
    });

    await t("ESP32 posts a valid alert and the app maps it, with a stable id", async () => {
      const ts = new Date().toISOString();
      const posted = await postJson(
        `${base}/esp32/alerts`,
        {
          timestamp: ts,
          parameter: "dissolved_oxygen",
          value: 2.4,
          threshold: "min 3.0 mg/L",
          status: "unsafe",
          message: "Aeration failure",
        },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(posted.status, 201);

      const alerts = await createRealSource(base, token).getAlerts();
      assert.equal(alerts.length, 1);
      const a = alerts[0];
      assert.equal(a.parameter, "dissolvedOxygen");
      assert.equal(a.status, "unsafe");
      assert.equal(a.value, 2.4);
      assert.equal(a.threshold, "min 3.0 mg/L");
      assert.equal(a.message, "Aeration failure");
      // The id must come from the database row, not the array index.
      assert.equal(a.id, "1");
    });

    // ---- Approval gate -----------------------------------------------------
    await t("Safe becomes reachable only once every threshold row is approved", async () => {
      const src = createRealSource(base, token);

      // Approve only pH in SQLite, leaving the other two parameters unapproved.
      // The set as a whole must still report "not approved", so no green Safe
      // can appear from a partially-filled thresholds table.
      run("UPDATE thresholds SET safe_min=6.5, safe_max=8.5, warn_min=6.0, warn_max=9.0, approved=1 WHERE parameter='ph'");
      let th = await src.getThresholds();
      assert.equal(th.approved, false, "one approved row must not approve the set");
      assert.equal(statusFor("ph", 7.18, th), "no_data");

      // Now approve the remaining parameters.
      run("UPDATE thresholds SET safe_min=26, safe_max=30, warn_min=24, warn_max=32, approved=1 WHERE parameter='temperature'");
      run("UPDATE thresholds SET safe_min=5, warn_min=3, approved=1 WHERE parameter='dissolved_oxygen'");
      th = await src.getThresholds();
      assert.equal(th.approved, true);
      assert.match(th.sourceLabel, /approved/);
      assert.equal(statusFor("ph", 7.18, th), "safe");
      assert.equal(statusFor("temperature", 28.4, th), "safe");
      assert.equal(statusFor("dissolvedOxygen", 2.4, th), "unsafe");
      assert.equal(statusFor("dissolvedOxygen", null, th), "no_data");
    });
  } finally {
    proc.kill();
    try {
      fs.rmSync(DB_PATH, { force: true });
    } catch {}
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
