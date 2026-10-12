/**
 * Role and permission tests against the REAL Raspberry Pi server
 * (pi-server/server.py, Flask + SQLite + bcrypt + real JWTs).
 *
 * Run:  npx tsx tests/roles.test.ts
 *
 * Covers the Owner/Admin <-> Caretaker boundary that tests/registration.test.ts
 * deliberately leaves alone:
 *
 *   * the role the Pi reports at sign-in and at /auth/me
 *   * the owner listing, creating, disabling and re-enabling caretakers
 *   * a caretaker being refused on every /admin route
 *   * a disabled account being refused at login AND on a token it already holds
 *   * the three ways a token can fail (missing, invalid, expired) plus the
 *     account-that-no-longer-exists and unrecognised-role cases
 *   * the ESP32 key path staying completely separate from person tokens
 *
 * The harness (tests/pi_harness.py) provisions one owner and one caretaker, so
 * both sides of every boundary are exercised against the same running server.
 *
 * Every assertion here is made against the Pi's HTTP replies. The app's own
 * screens are checked in tests/logic.test.ts; a hidden button is not a control,
 * so the control being checked here is always the server's.
 */
import assert from "node:assert/strict";
import { ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCaretaker, fetchManagedUsers, setCaretakerStatus } from "../src/api/adminApi";
import { ApiError, toApiError } from "../src/api/errors";
import { isPrivateIPv4 } from "../src/api/httpClient";
import { authAdapter } from "../src/auth/adapters";

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

const PORT = 8803;
const DB_PATH = path.join(os.tmpdir(), `aqsms_roles_${process.pid}.db`);

/** Must match the value tests/pi_harness.py forces, so minted tokens verify. */
const HARNESS_JWT_SECRET = "integration-test-secret-0123456789abcdef";

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
  adminUsername: string;
  adminDisplayName: string;
  adminPassword: string;
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

/**
 * Runs a snippet against the scratch database. `sys.argv[1]` is the db path,
 * followed by whatever extra arguments the caller passes.
 */
function py(code: string, extraArgs: string[] = [], extraEnv: Record<string, string> = {}): string {
  return execFileSync(pythonBin(), ["-c", code, DB_PATH, ...extraArgs], {
    env: { ...process.env, ...extraEnv },
  })
    .toString()
    .trim();
}

/** A single scalar out of the scratch database. */
function scalar(sql: string): string {
  return execFileSync(pythonBin(), [
    "-c",
    "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute(sys.argv[2]).fetchone()[0])",
    DB_PATH,
    sql,
  ])
    .toString()
    .trim();
}

(async () => {
  const lanIp = lanAddress();
  if (!lanIp) {
    console.log("SKIP  no private LAN IPv4 on this machine; cannot exercise the LAN-only client.");
    process.exit(0);
  }
  const base = `http://${lanIp}:${PORT}`;
  console.log(`--- Real pi-server (roles) on ${base} ---`);
  console.log(`--- scratch database: ${DB_PATH} ---\n`);

  let started;
  try {
    started = await startServer();
  } catch (e) {
    console.log(`FAIL  could not start pi-server\n      ${(e as Error).message}`);
    process.exit(1);
  }
  const { proc, info } = started;

  /** One round trip, with whatever headers the caller wants. */
  async function api(
    method: "GET" | "POST",
    endpoint: string,
    opts: { token?: string | null; body?: unknown } = {},
  ) {
    const res = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  }

  /**
   * A token the Pi will verify, minted outside it so expiry can be exercised.
   * `expiresInHours` may be negative to produce one that has already lapsed.
   */
  function makeToken(username: string, expiresInHours: number): string {
    return py(
      [
        "import datetime, jwt, os, sys",
        "now = datetime.datetime.now(datetime.timezone.utc)",
        "print(jwt.encode(",
        "    {'sub': sys.argv[2], 'iat': now,",
        "     'exp': now + datetime.timedelta(hours=int(sys.argv[3]))},",
        "    os.environ['AQSMS_JWT_SECRET'], algorithm='HS256'))",
      ].join("\n"),
      [username, String(expiresInHours)],
      { AQSMS_JWT_SECRET: HARNESS_JWT_SECRET },
    );
  }

  try {
    // ---- Who does the Pi say I am? -----------------------------------------
    let ownerToken = "";
    let caretakerToken = "";

    await t("the fixed Owner/Admin signs in and the Pi reports role 'owner'", async () => {
      const session = await authAdapter.signIn(info.adminUsername, info.adminPassword, { baseUrl: base });
      assert.equal(session.role, "owner");
      assert.equal(session.status, "active");
      assert.ok(session.token, "expected a token");
      ownerToken = session.token as string;
    });

    await t("an ordinary account signs in and the Pi reports role 'caretaker'", async () => {
      const session = await authAdapter.signIn(info.username, info.password, { baseUrl: base });
      assert.equal(session.role, "caretaker");
      assert.equal(session.status, "active");
      caretakerToken = session.token as string;
    });

    await t("a role sent in the login body is ignored", async () => {
      // The role comes from the account row, never from the request.
      const r = await api("POST", "/auth/login", {
        body: { username: info.username, password: info.password, role: "owner" },
      });
      assert.equal(r.status, 200);
      assert.equal(r.json?.role, "caretaker", "a body field must not upgrade the caller");
    });

    await t("a wrong password still gets a plain 401 with no role in the reply", async () => {
      const r = await api("POST", "/auth/login", { body: { username: info.adminUsername, password: "nope-not-it" } });
      assert.equal(r.status, 401);
      assert.equal(r.json?.role, undefined, "a failed login must not disclose the account's role");
    });

    await t("/auth/me returns the owner's identity and role", async () => {
      const r = await api("GET", "/auth/me", { token: ownerToken });
      assert.equal(r.status, 200);
      assert.equal(r.json?.username, info.adminUsername);
      assert.equal(r.json?.role, "owner");
      assert.equal(r.json?.status, "active");
    });

    await t("/auth/me returns the caretaker's identity and role", async () => {
      const r = await api("GET", "/auth/me", { token: caretakerToken });
      assert.equal(r.status, 200);
      assert.equal(r.json?.username, info.username);
      assert.equal(r.json?.role, "caretaker");
    });

    await t("no account response carries a password hash", async () => {
      for (const r of [
        await api("GET", "/auth/me", { token: ownerToken }),
        await api("GET", "/admin/users", { token: ownerToken }),
      ]) {
        const text = JSON.stringify(r.json);
        assert.ok(!/password/i.test(text), `a response leaked a password field: ${text}`);
        assert.ok(!text.includes("$2"), `a response leaked a bcrypt hash: ${text}`);
      }
    });

    // ---- The owner listing caretakers --------------------------------------
    await t("the owner sees exactly the caretaker accounts, never itself", async () => {
      const users = await fetchManagedUsers({ baseUrl: base, token: ownerToken });
      assert.equal(users.length, 1, `expected just the harness caretaker, got ${JSON.stringify(users)}`);
      assert.equal(users[0].username, info.username);
      assert.equal(users[0].role, "caretaker");
      assert.equal(users[0].status, "active");
      assert.ok(
        !users.some((u) => u.username === info.adminUsername),
        "the Owner/Admin must never be listed for management",
      );
    });

    // ---- The owner creating caretakers -------------------------------------
    const NEW_USER = "pond-helper";
    const NEW_PASS = "helper-password-1";

    await t("the owner creates a caretaker, and it is an ordinary caretaker", async () => {
      const created = await createCaretaker(
        { baseUrl: base, token: ownerToken },
        { username: NEW_USER, displayName: "Pond Helper", password: NEW_PASS, confirmPassword: NEW_PASS },
      );
      assert.equal(created.username, NEW_USER);
      assert.equal(created.displayName, "Pond Helper");
      assert.equal(created.role, "caretaker");
      assert.equal(created.status, "active");
    });

    await t("an admin-created caretaker can sign in on the app", async () => {
      const session = await authAdapter.signIn(NEW_USER, NEW_PASS, { baseUrl: base });
      assert.equal(session.role, "caretaker");
      assert.equal(session.username, NEW_USER);
    });

    await t("the new caretaker appears in the owner's list", async () => {
      const users = await fetchManagedUsers({ baseUrl: base, token: ownerToken });
      assert.equal(users.length, 2);
      assert.deepEqual(
        users.map((u) => u.username).sort(),
        [info.username, NEW_USER].sort(),
      );
    });

    await t("creating a duplicate username is refused with 409 username_taken", async () => {
      const r = await api("POST", "/admin/users", {
        token: ownerToken,
        body: { username: NEW_USER, password: "another-password-1", confirm_password: "another-password-1" },
      });
      assert.equal(r.status, 409);
      assert.equal(r.json?.code, "username_taken");
    });

    await t("the admin screen cannot claim the reserved Owner/Admin identifier", async () => {
      const r = await api("POST", "/admin/users", {
        token: ownerToken,
        body: {
          username: info.adminUsername,
          password: "another-password-1",
          confirm_password: "another-password-1",
        },
      });
      assert.equal(r.status, 400);
    });

    await t("an admin-created account is held to the public password rules", async () => {
      const r = await api("POST", "/admin/users", {
        token: ownerToken,
        body: { username: "shortpw", password: "short1", confirm_password: "short1" },
      });
      assert.equal(r.status, 400);
      assert.match(String(r.json?.error), /at least 8/i);
    });

    await t("an admin-created account is held to the public username rules", async () => {
      const r = await api("POST", "/admin/users", {
        token: ownerToken,
        body: { username: "has space", password: "long-enough-1", confirm_password: "long-enough-1" },
      });
      assert.equal(r.status, 400);
    });

    await t("a role in the admin-create body is ignored: no second owner can exist", async () => {
      const r = await api("POST", "/admin/users", {
        token: ownerToken,
        body: {
          username: "secretowner",
          password: "long-enough-1",
          confirm_password: "long-enough-1",
          role: "owner",
          status: "active",
        },
      });
      assert.equal(r.status, 201);
      assert.equal((r.json?.user as Record<string, unknown>)?.role, "caretaker");
      assert.equal(scalar("SELECT COUNT(*) FROM accounts WHERE role='owner'"), "1");
    });

    // ---- A caretaker is refused on every owner endpoint --------------------
    await t("a caretaker is refused on all four admin endpoints (403, forbidden_role)", async () => {
      const calls: Array<[string, string, unknown?]> = [
        ["GET", "/admin/users", undefined],
        ["POST", "/admin/users", { username: "sneaky", password: "long-enough-1", confirm_password: "long-enough-1" }],
        ["POST", `/admin/users/${info.username}/disable`, undefined],
        ["POST", `/admin/users/${info.username}/enable`, undefined],
      ];
      for (const [method, endpoint, body] of calls) {
        const r = await api(method as "GET" | "POST", endpoint, { token: caretakerToken, body });
        assert.equal(r.status, 403, `${method} ${endpoint} must be refused`);
        assert.equal(r.json?.code, "forbidden_role", `${method} ${endpoint} should say why`);
      }
    });

    await t("a refused caretaker changed nothing", async () => {
      assert.equal(scalar("SELECT COUNT(*) FROM accounts WHERE username='sneaky'"), "0");
      assert.equal(scalar(`SELECT status FROM accounts WHERE username='${info.username}'`), "active");
    });

    await t("the app-level admin calls surface the refusal as an ApiError, not a crash", async () => {
      for (const call of [
        () => fetchManagedUsers({ baseUrl: base, token: caretakerToken }),
        () => createCaretaker({ baseUrl: base, token: caretakerToken }, { username: "x2", password: "long-enough-1", confirmPassword: "long-enough-1" }),
        () => setCaretakerStatus({ baseUrl: base, token: caretakerToken }, info.username, "disabled"),
      ]) {
        await assert.rejects(call, (e: unknown) => {
          const err = toApiError(e);
          return err instanceof ApiError && err.status === 403 && err.code === "forbidden_role";
        });
      }
    });

    // ---- A caretaker keeps the ordinary read access ------------------------
    await t("a caretaker still reads readings, alerts and thresholds", async () => {
      for (const endpoint of ["/readings/latest", "/readings", "/alerts", "/thresholds"]) {
        const r = await api("GET", endpoint, { token: caretakerToken });
        assert.equal(r.status, 200, `${endpoint} must stay available to a caretaker`);
      }
    });

    // ---- Disabling and re-enabling -----------------------------------------
    let victimToken = "";
    const VICTIM = "pond-helper";

    await t("disabling a caretaker reports the new status", async () => {
      const session = await authAdapter.signIn(VICTIM, NEW_PASS, { baseUrl: base });
      victimToken = session.token as string;

      const r = await api("POST", `/admin/users/${VICTIM}/disable`, { token: ownerToken });
      assert.equal(r.status, 200);
      assert.equal((r.json?.user as Record<string, unknown>)?.status, "disabled");
    });

    await t("a disabled caretaker cannot sign in, even with the right password", async () => {
      const r = await api("POST", "/auth/login", { body: { username: VICTIM, password: NEW_PASS } });
      assert.equal(r.status, 403);
      assert.equal(r.json?.code, "account_disabled");
    });

    await t("the token a disabled account already held stops working", async () => {
      const r = await api("GET", "/readings/latest", { token: victimToken });
      assert.equal(r.status, 403, "an existing token must not outlive the disable");
      assert.equal(r.json?.code, "account_disabled");
    });

    await t("a disabled account is also refused at /auth/me and at the admin endpoints", async () => {
      const me = await api("GET", "/auth/me", { token: victimToken });
      assert.equal(me.status, 403);
      assert.equal(me.json?.code, "account_disabled");

      // Disabled is decided before role, so even an owner-shaped request from a
      // disabled account is refused for the right reason.
      const admin = await api("GET", "/admin/users", { token: victimToken });
      assert.equal(admin.status, 403);
      assert.equal(admin.json?.code, "account_disabled");
    });

    await t("a disabled caretaker is still listed, marked disabled", async () => {
      const users = await fetchManagedUsers({ baseUrl: base, token: ownerToken });
      const victim = users.find((u) => u.username === VICTIM);
      assert.ok(victim, "a disabled caretaker must not vanish from the list");
      assert.equal(victim.status, "disabled");
    });

    await t("re-enabling restores sign-in and the same old token works again", async () => {
      const r = await api("POST", `/admin/users/${VICTIM}/enable`, { token: ownerToken });
      assert.equal(r.status, 200);
      assert.equal((r.json?.user as Record<string, unknown>)?.status, "active");

      const again = await authAdapter.signIn(VICTIM, NEW_PASS, { baseUrl: base });
      assert.equal(again.role, "caretaker");

      const reused = await api("GET", "/readings/latest", { token: victimToken });
      assert.equal(reused.status, 200, "nothing was deleted, so the old token is valid again");
    });

    await t("the owner cannot disable or re-enable the Owner/Admin account", async () => {
      for (const action of ["disable", "enable"]) {
        const r = await api("POST", `/admin/users/${info.adminUsername}/${action}`, { token: ownerToken });
        assert.equal(r.status, 403, `${action} on the owner must be refused`);
        assert.equal(r.json?.code, "not_a_caretaker");
      }
      assert.equal(scalar(`SELECT status FROM accounts WHERE username='${info.adminUsername}'`), "active");
    });

    await t("disabling an account that does not exist is a 404, not a silent success", async () => {
      const r = await api("POST", "/admin/users/nobody-here/disable", { token: ownerToken });
      assert.equal(r.status, 404);
      assert.equal(r.json?.code, "unknown_account");
    });

    // ---- How a token fails -------------------------------------------------
    await t("no token at all is 401 token_missing", async () => {
      for (const endpoint of ["/readings/latest", "/auth/me", "/admin/users"]) {
        const r = await api("GET", endpoint);
        assert.equal(r.status, 401, `${endpoint} must require a token`);
        assert.equal(r.json?.code, "token_missing");
      }
    });

    await t("a forged or corrupted token is 401 token_invalid", async () => {
      for (const bad of ["not-a-jwt", "aaa.bbb.ccc", `${ownerToken}x`, `${ownerToken.split(".")[0]}.${ownerToken.split(".")[1]}.forged`]) {
        const r = await api("GET", "/readings/latest", { token: bad });
        assert.equal(r.status, 401, `"${bad}" must not be accepted`);
        assert.equal(r.json?.code, "token_invalid");
      }
    });

    await t("an expired token is 401 token_expired, not a silent success", async () => {
      const expired = makeToken(info.username, -3);
      const r = await api("GET", "/readings/latest", { token: expired });
      assert.equal(r.status, 401);
      assert.equal(r.json?.code, "token_expired");
    });

    await t("a token for an account that no longer exists is 401 account_missing", async () => {
      const ghostPass = "ghost-password-1";
      const created = await api("POST", "/admin/users", {
        token: ownerToken,
        body: { username: "ghost", password: ghostPass, confirm_password: ghostPass },
      });
      assert.equal(created.status, 201);

      const session = await authAdapter.signIn("ghost", ghostPass, { baseUrl: base });
      run("DELETE FROM accounts WHERE username='ghost'");

      const r = await api("GET", "/readings/latest", { token: session.token });
      assert.equal(r.status, 401);
      assert.equal(r.json?.code, "account_missing");

      const login = await api("POST", "/auth/login", { body: { username: "ghost", password: ghostPass } });
      assert.equal(login.status, 401, "a deleted account cannot sign back in");
    });

    await t("an unrecognised role is refused at every entry point", async () => {
      // The schema's CHECK constraint stops this arising from the app, so the
      // row is written directly, as a hand-edited database would be. The point
      // is that the server refuses such an account rather than treating an
      // unknown role as a weaker role or as no role at all.
      const misroledPass = "misroled-password-1";
      const created = await api("POST", "/admin/users", {
        token: ownerToken,
        body: { username: "misroled", password: misroledPass, confirm_password: misroledPass },
      });
      assert.equal(created.status, 201);
      const session = await authAdapter.signIn("misroled", misroledPass, { baseUrl: base });

      py(
        [
          "import sqlite3, sys",
          "c = sqlite3.connect(sys.argv[1])",
          "c.execute('PRAGMA ignore_check_constraints=ON')",
          "c.execute(\"UPDATE accounts SET role='supervisor' WHERE username='misroled'\")",
          "c.commit()",
        ].join("\n"),
      );

      try {
        const login = await api("POST", "/auth/login", { body: { username: "misroled", password: misroledPass } });
        assert.equal(login.status, 403, "an unusable role is not a successful sign-in");
        assert.equal(login.json?.code, "role_unknown");
        assert.equal(login.json?.token, undefined, "no token may be issued for an unknown role");

        const held = await api("GET", "/readings/latest", { token: session.token });
        assert.equal(held.status, 401, "a held token must stop working the moment the role is unusable");
        assert.equal(held.json?.code, "role_unknown");
      } finally {
        py(
          [
            "import sqlite3, sys",
            "c = sqlite3.connect(sys.argv[1])",
            "c.execute('PRAGMA ignore_check_constraints=ON')",
            "c.execute(\"UPDATE accounts SET role='caretaker' WHERE username='misroled'\")",
            "c.commit()",
          ].join("\n"),
        );
      }
    });

    // ---- The ESP32 path is untouched by any of this ------------------------
    await t("a person's token cannot act as an ESP32: no X-API-Key, no entry", async () => {
      const ping = await api("GET", "/esp32/ping", { token: ownerToken });
      assert.equal(ping.status, 401, "an Owner/Admin JWT is not a device credential");

      const ingest = await api("POST", "/esp32/readings", {
        token: ownerToken,
        body: { timestamp: new Date().toISOString(), ph: 7.2 },
      });
      assert.equal(ingest.status, 401, "the ESP32 ingest route accepts only X-API-Key");
    });

    await t("the device key still works, and a JWT is not a substitute for it", async () => {
      const res = await fetch(`${base}/esp32/ping`, { headers: { "X-API-Key": info.esp32Key } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).status, "ok");

      const wrong = await fetch(`${base}/esp32/ping`, {
        headers: { "X-API-Key": "not-the-key", Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(wrong.status, 401, "a valid token must not rescue a bad device key");
    });

    await t("the owner's token is still an ordinary token on the read routes", async () => {
      // The split is between the two credential systems, not between the roles:
      // the owner reads readings over JWT exactly as a caretaker does.
      for (const endpoint of ["/readings/latest", "/alerts", "/thresholds"]) {
        const r = await api("GET", endpoint, { token: ownerToken });
        assert.equal(r.status, 200, `${endpoint} must work for the owner`);
      }
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
