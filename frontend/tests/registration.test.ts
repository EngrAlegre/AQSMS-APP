/**
 * Account-creation tests against the REAL Raspberry Pi server
 * (pi-server/server.py, Flask + SQLite + bcrypt + real JWTs).
 *
 * Run:  npx tsx tests/registration.test.ts
 *
 * The server is started with NO account provisioned, so the checks below begin
 * from an empty install. Registration is NOT one-shot any more: it stays open
 * and always creates a Caretaker. What this file pins down is that the endpoint
 * cannot be talked into creating anything else, and that the public caretaker
 * rules (username shape, 8-character minimum) still hold.
 *
 * Owner/Admin provisioning, role enforcement and account disable/enable are
 * covered in tests/roles.test.ts.
 */
import assert from "node:assert/strict";
import { ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ApiError, toApiError } from "../src/api/errors";
import { isPrivateIPv4 } from "../src/api/httpClient";
import { createRealSource } from "../src/api/realSource";

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

const PORT = 8802;
const DB_PATH = path.join(os.tmpdir(), `aqsms_registration_${process.pid}.db`);

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
  esp32Key: string;
  provisioned: boolean;
}

/** `provision: false` starts with an empty accounts table. */
function startServer(provision: boolean): Promise<{ proc: ChildProcessWithoutNullStreams; info: Harness }> {
  const args = ["tests/pi_harness.py", String(PORT), DB_PATH];
  if (!provision) args.push("no");

  const proc = spawn(pythonBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pi-server did not report ready within 30 s")), 30_000);
    let buf = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
      if (line) {
        clearTimeout(timer);
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

(async () => {
  const lanIp = lanAddress();
  if (!lanIp) {
    console.log("SKIP  no private LAN IPv4 on this machine; cannot exercise the LAN-only client.");
    process.exit(0);
  }
  const base = `http://${lanIp}:${PORT}`;
  console.log(`--- Real pi-server, empty install, on ${base} ---`);
  console.log(`--- scratch database: ${DB_PATH} ---\n`);

  async function register(body: unknown, raw = false) {
    const res = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function health() {
    const res = await fetch(`${base}/health`);
    return (await res.json()) as { registration_open: boolean };
  }

  async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  let started;
  try {
    started = await startServer(false);
  } catch (e) {
    console.log(`FAIL  could not start pi-server\n      ${(e as Error).message}`);
    process.exit(1);
  }
  const { proc, info } = started;

  try {
    await t("a fresh install reports registration is open", async () => {
      assert.equal((await health()).registration_open, true);
    });

    // ---- Validation: none of these may create an account -------------------
    await t("registration rejects a username that is too short", async () => {
      const r = await register({ username: "ab", password: "long-enough-1", confirm_password: "long-enough-1" });
      assert.equal(r.status, 400);
    });

    await t("registration rejects a username with spaces or punctuation", async () => {
      for (const bad of ["has space", "semi;colon", "emoji🙂", "a/b"]) {
        const r = await register({ username: bad, password: "long-enough-1", confirm_password: "long-enough-1" });
        assert.equal(r.status, 400, `username "${bad}" should be refused`);
      }
    });

    await t("registration rejects a password under 8 characters", async () => {
      const r = await register({ username: "farmer", password: "short1", confirm_password: "short1" });
      assert.equal(r.status, 400);
    });

    await t("registration rejects a password over bcrypt's 72-byte limit", async () => {
      const long = "x".repeat(80);
      const r = await register({ username: "farmer", password: long, confirm_password: long });
      assert.equal(r.status, 400);
      assert.match(String(r.json?.error), /too long/i);
    });

    await t("registration rejects mismatched passwords", async () => {
      const r = await register({ username: "farmer", password: "long-enough-1", confirm_password: "long-enough-2" });
      assert.equal(r.status, 400);
      assert.match(String(r.json?.error), /do not match/i);
    });

    await t("registration rejects a non-JSON body cleanly", async () => {
      const r = await register("this is not json", true);
      assert.equal(r.status, 400);
    });

    await t("failed validation did not create an account", async () => {
      assert.equal((await health()).registration_open, true);
    });

    // ---- A registration creates a caretaker, and registration stays open ----
    const PASSWORD = "correct-horse-battery";
    let token: string | null = null;

    await t("registration creates a CARETAKER account and returns a token", async () => {
      const r = await register({ username: "Farmer", password: PASSWORD, confirm_password: PASSWORD });
      assert.equal(r.status, 201);
      assert.equal(r.json.display_name, "Farmer");
      assert.equal(r.json.role, "caretaker", "public registration must only ever create a caretaker");
      assert.equal(r.json.status, "active");
      assert.ok(typeof r.json.token === "string", "expected a token");
      assert.equal(r.json.token.split(".").length, 3, "expected a JWT");
      token = r.json.token;
    });

    await t("registration stays open once an account exists", async () => {
      assert.equal((await health()).registration_open, true);
    });

    await t("the token from registration is accepted on a protected endpoint", async () => {
      const latest = await createRealSource(base, token).getLatest();
      assert.equal(latest.reading, null, "a brand new install has no readings");
    });

    await t("the registered account can sign in afterwards", async () => {
      const r = await postJson(`${base}/auth/login`, { username: "farmer", password: PASSWORD });
      assert.equal(r.status, 200);
      assert.ok(typeof r.json.token === "string");
    });

    await t("the password is stored as a bcrypt hash, never in the clear", async () => {
      const stored = execFileSync(pythonBin(), [
        "-c",
        "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute('SELECT password_hash FROM accounts').fetchone()[0])",
        DB_PATH,
      ]).toString().trim();
      assert.ok(stored.startsWith("$2"), `expected a bcrypt hash, got: ${stored}`);
      assert.ok(!stored.includes(PASSWORD), "the stored hash must not contain the password");
    });

    await t("a second, different caretaker can also register", async () => {
      const r = await register({ username: "helper", password: "another-one-1", confirm_password: "another-one-1" });
      assert.equal(r.status, 201);
      assert.equal(r.json.role, "caretaker");
    });

    await t("a duplicate username is refused with 409 username_taken", async () => {
      const r = await register({ username: "Farmer", password: "another-one-1", confirm_password: "another-one-1" });
      assert.equal(r.status, 409);
      assert.equal(r.json.code, "username_taken");
    });

    await t("registration refuses the reserved Owner/Admin identifier", async () => {
      const r = await register({
        username: "aquasmart@app.com",
        password: "long-enough-1",
        confirm_password: "long-enough-1",
      });
      assert.equal(r.status, 400, "the fixed admin identifier must not be claimable from the app");
    });

    await t("a role in the request body is ignored: registration is always a caretaker", async () => {
      const r = await register({
        username: "wannabeowner",
        password: "long-enough-1",
        confirm_password: "long-enough-1",
        role: "owner",
      });
      assert.equal(r.status, 201);
      assert.equal(r.json.role, "caretaker", "a body field must not be able to mint an owner");

      const owners = execFileSync(pythonBin(), [
        "-c",
        "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute(\"SELECT COUNT(*) FROM accounts WHERE role='owner'\").fetchone()[0])",
        DB_PATH,
      ]).toString().trim();
      assert.equal(owners, "0", "no public request may create an Owner/Admin");
    });

    // ---- The race: two registrations of the SAME name at one instant --------
    await t("simultaneous registrations of one username: exactly one succeeds", async () => {
      const [a, b] = await Promise.all([
        register({ username: "race", password: "race-password-1", confirm_password: "race-password-1" }),
        register({ username: "race", password: "race-password-2", confirm_password: "race-password-2" }),
      ]);

      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [201, 409], `expected one 201 and one 409, got ${JSON.stringify(statuses)}`);

      const count = execFileSync(pythonBin(), [
        "-c",
        "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute(\"SELECT COUNT(*) FROM accounts WHERE username='race'\").fetchone()[0])",
        DB_PATH,
      ]).toString().trim();
      assert.equal(count, "1", "exactly one account may exist for that username");
    });

    // ---- ESP32 connectivity check stores nothing --------------------------
    await t("the ESP32 connectivity probe refuses a missing key (HTTP 401)", async () => {
      const res = await fetch(`${base}/esp32/ping`);
      assert.equal(res.status, 401);
    });

    await t("the ESP32 connectivity probe refuses a wrong key (HTTP 401)", async () => {
      const res = await fetch(`${base}/esp32/ping`, { headers: { "X-API-Key": "not-the-key" } });
      assert.equal(res.status, 401);
    });

    await t("the ESP32 connectivity probe accepts the real key and stores nothing", async () => {
      const res = await fetch(`${base}/esp32/ping`, { headers: { "X-API-Key": info.esp32Key } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "ok");

      // The whole point: a connectivity test must not leave a fake measurement.
      const history = await createRealSource(base, token).getHistory();
      assert.deepEqual(history, [], "the probe must not have inserted a reading");
    });

    // ---- Ingest must not invent data --------------------------------------
    await t("a reading with every measurement null is refused (HTTP 400)", async () => {
      const r = await postJson(
        `${base}/esp32/readings`,
        { timestamp: new Date().toISOString(), ph: null, temperature_c: null, dissolved_oxygen_mg_l: null },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(r.status, 400, "an empty reading is not a measurement");
    });

    await t("a reading with a non-numeric measurement is refused (HTTP 400)", async () => {
      for (const bad of ["7.2", true, { v: 7 }]) {
        const r = await postJson(
          `${base}/esp32/readings`,
          { timestamp: new Date().toISOString(), ph: bad },
          { "X-API-Key": info.esp32Key },
        );
        assert.equal(r.status, 400, `ph=${JSON.stringify(bad)} should be refused`);
      }
    });

    await t("a replayed reading with the same event_id is stored only once", async () => {
      const payload = { timestamp: new Date().toISOString(), ph: 7.4, event_id: "boot-42-reading-1" };

      const first = await postJson(`${base}/esp32/readings`, payload, { "X-API-Key": info.esp32Key });
      assert.equal(first.status, 201);

      const second = await postJson(`${base}/esp32/readings`, payload, { "X-API-Key": info.esp32Key });
      assert.equal(second.status, 200);
      assert.equal(second.json.status, "duplicate");

      const history = await createRealSource(base, token).getHistory();
      assert.equal(history.length, 1, "the replayed reading must not be stored twice");
    });

    await t("an alert with a non-numeric value is refused (HTTP 400)", async () => {
      const r = await postJson(
        `${base}/esp32/alerts`,
        { timestamp: new Date().toISOString(), parameter: "ph", status: "unsafe", value: "very high" },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(r.status, 400);
    });

    await t("an unknown parameter is refused without leaking SQLite internals", async () => {
      const r = await postJson(
        `${base}/esp32/alerts`,
        { timestamp: new Date().toISOString(), parameter: "salinity", status: "unsafe", value: 1 },
        { "X-API-Key": info.esp32Key },
      );
      assert.equal(r.status, 400);
      assert.ok(
        !/CHECK constraint|sqlite|INSERT INTO/i.test(String(r.json?.error)),
        `error must not expose schema internals, got: ${r.json?.error}`,
      );
    });

    // ---- The server refuses to sign tokens with a weak secret --------------
    await t("a short JWT secret is refused at startup", async () => {
      const result = spawn(pythonBin(), ["-c", "import os;os.environ['AQSMS_JWT_SECRET']='tooshort';import config;config.jwt_secret()"], {
        cwd: path.resolve("../pi-server"),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const code: number = await new Promise((resolve) => {
        let err = "";
        result.stderr.on("data", (d: Buffer) => (err += d.toString()));
        result.on("exit", (c) => resolve(c ?? -1));
      });
      assert.notEqual(code, 0, "the process must fail rather than accept a weak key");
    });

    await t("a missing JWT secret is refused at startup", async () => {
      const result = spawn(
        pythonBin(),
        ["-c", "import os;os.environ.pop('AQSMS_JWT_SECRET',None);import config;config.jwt_secret()"],
        { cwd: path.resolve("../pi-server"), stdio: ["ignore", "pipe", "pipe"] },
      );
      const code: number = await new Promise((resolve) => {
        result.on("exit", (c) => resolve(c ?? -1));
      });
      assert.notEqual(code, 0, "the process must fail rather than fall back to a shipped secret");
    });
  } finally {
    proc.kill();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(DB_PATH + suffix, { force: true });
      } catch {}
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
