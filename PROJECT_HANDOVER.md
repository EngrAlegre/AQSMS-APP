# AQSMS — Project Handover

**Read this first.** Everything else in the repository is referenced from here.

Aqua Smart Monitoring System: pond water-quality monitoring for one farm. An
ESP32 with sensors watches the water, a Raspberry Pi on the farm LAN stores and
serves the data, and an Android app shows it to the farmer. There is no cloud
component — the Pi, the phone and the board are the whole system.

Last updated **13 October 2026**.

---

## 1. The three parts

```
   ESP32 + probes                        Raspberry Pi                    Android phone
   ┌──────────────────┐   Wi-Fi   ┌────────────────────────┐   Wi-Fi   ┌──────────────────┐
   │ pH, temp, DO     │ ────────► │ Flask + SQLite on 8443 │ ◄──────── │ Expo / RN app    │
   │ reads 3 params   │  X-API-Key│ readings · alerts      │  JWT      │ readings, alerts │
   │                  │           │ thresholds · accounts  │  Bearer   │ history, users   │
   │ SIM900 ──► SMS   │           └────────────────────────┘           └──────────────────┘
   └──────────────────┘
     independent of the Pi, of Wi-Fi, and of the app
```

Three facts worth internalising before touching anything:

1. **Two separate credential systems.** People authenticate with a JWT
   (`Authorization: Bearer`). The ESP32 authenticates with `X-API-Key`. They are
   not interchangeable and an ESP32 is never issued a person's token.
2. **The SMS safety path is independent.** Once a valid approved config is on
   the board, the ESP32 sends critical alerts by SMS over the SIM900 with no Pi
   and no Wi-Fi involved. It must keep working with the app closed, with nobody
   logged in, and with the Pi unplugged. Do not make alerts depend on a logged-in
   user, and do not add a second SMS sender.
3. **Thresholds are unapproved by default** (`approved = 0`, NULL limits), so
   every parameter honestly reads **No Data** rather than a green **Safe**. That
   is deliberate. Do not invent or seed threshold values, and do not reseed demo
   readings or alerts.

Monitored parameters: **pH**, **water temperature (°C)**, **dissolved oxygen
(mg/L)** — see `frontend/src/models/parameters.ts`.

---

## 2. Where things stand

| | |
|---|---|
| Repository | https://github.com/EngrAlegre/AQSMS-APP (public) |
| Branch with the current app | **`current-app`** = `1a9756f` |
| `main` | `5d403e4` — an older, unrelated history (4 commits). Not yet updated. |
| Tracked files | 141 |
| Automated checks | **113 passing** (4 suites), `tsc` and `expo lint` clean |
| Release APK | **not built since the icon change** — see §8 |
| Verified on real hardware | **no** — see §11 |

The current work (Owner/Admin and Caretaker accounts, the role API, the new
launcher icon) lives on `current-app`. It is pushed but **not merged into
`main`**, and `current-app` and `main` share no common ancestor, so a merge
brings `main` forward as a single joined history.

---

## 3. Repository map

| Path | What it is |
|---|---|
| `pi-server/` | The Flask API. `server.py` routes, `db.py` schema + `init_db()`, `auth.py` hashing/tokens, `migrations.py` versioned migrations, `config.py` paths and the JWT secret. |
| `pi-server/API_CONTRACT.md` | **The authoritative API reference.** Endpoints, error codes, role rules. |
| `pi-server/provision_admin.py` | Creates the one fixed Owner/Admin. Idempotent. |
| `pi-server/reset_password.py` | Changes any account's password, including the Owner/Admin. |
| `pi-server/setup_account.py` | Creates a caretaker and/or an ESP32 key. |
| `pi-server/make-cert.sh` | Generates the Pi's own CA + TLS certificate. |
| `pi-server/serve.sh` | Starts the API. HTTPS on 8443 when a cert exists, otherwise plain HTTP with a warning. |
| `pi-server/aqsms.service` | systemd unit. Replace `<pi-user>` before installing. |
| `frontend/` | The Expo / React Native app. |
| `frontend/src/api/` | `realSource.ts` is the app's live data layer, `adminApi.ts` the owner routes, `httpClient.ts` the fetch wrapper. |
| `frontend/src/auth/` | `AuthContext.tsx` session state, `adapters.ts` the Pi client, `credentials.ts` input rules mirrored from the server. |
| `frontend/app/` | Screens. `(tabs)/` is the signed-in tabs, `admin/users.tsx` the owner-only screen, `sign-in.tsx` the single login for both roles. |
| `frontend/tests/` | The four suites plus `pi_harness.py`, which boots the real Flask server for them. |
| `frontend/BUILD_ANDROID.md` | Toolchain paths, release signing, and the icon pipeline. |
| `frontend/AQUA_README.md` | App-level reference: screens, data flow, test commands. |
| `frontend/scripts/` | `make-icons.mjs` regenerates launcher art from `icon.png`; `apply-release-signing.js` repoints Gradle at the release keystore. |
| `firmware/aqsms_esp32/aqsms_esp32.ino` | **The whole firmware, one file.** Sensors, Wi-Fi, Pi client, SIM900 SMS. |
| `firmware/tests/run-regression.mjs` | Firmware regression harness. |
| `dev-tools/build-apk.ps1` | The one-command release build. |
| `PHONE_TO_PI_SETUP.md` | **The Pi deployment guide**, start to finish. |
| `ESP32_TO_PI_SETUP.md` | Flashing and configuring the board. |
| `AQSMS-Full-System-Wiring-Guide.md` | Pinout, wiring, provisioning, troubleshooting. |
| `memory/PRD.md` | Product record: decisions, non-negotiable rules, status. |
| `archive/` | A superseded PlatformIO firmware layout, kept for reference. Not built. |

---

## 4. Continuing on another PC

Yes — with one important exception. **Git does not contain everything**, because
generated files, dependencies and secrets are deliberately ignored. Here is the
complete list of what a fresh clone will *not* have:

| Missing | How to get it |
|---|---|
| `frontend/credentials/` — **the release signing keystore** | **Copy from the old PC.** Not in git, and not recoverable if lost. If you lose it you can never update-install over an already-installed copy of the app; you would have to uninstall and reinstall under a new key. |
| `frontend/certs/aqsms-ca.crt` — the Pi's CA | `scp <pi-user>@<pi-address>:aqsms/pi-server/certs/aqsms-ca.crt frontend/certs/` |
| `frontend/node_modules/` | `cd frontend && yarn install` |
| `frontend/android/` | `npx expo prebuild --platform android --no-install` (the build script does it) |
| `pi-server/venv/` | `python -m venv venv && venv\Scripts\python -m pip install -r requirements.txt` |
| `pi-server/aqsms.db`, `jwt_secret.txt`, `pi-server/certs/` | **These live only on the Pi.** Back them up there; never commit them. |
| `.expo/`, `dist/`, `.metro-cache/`, build output | Regenerated automatically |

### Step by step

```powershell
# 1. Get the code (the current app is on current-app, not main)
git clone https://github.com/EngrAlegre/AQSMS-APP.git
cd AQSMS-APP
git checkout current-app

# 2. App dependencies                       (node 24, yarn 1.22)
cd frontend
yarn install

# 3. Pi server test environment             (Python 3.11)
cd ..\pi-server
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

Then copy `frontend/credentials/` and `frontend/certs/aqsms-ca.crt` over from
the old machine, and check everything:

```powershell
cd frontend
npx tsc --noEmit                          # 0 errors
npx expo lint                             # 0 problems
npx --yes tsx tests/logic.test.ts             # 27 checks
npx --yes tsx tests/pi_server.test.ts         # 22 checks
npx --yes tsx tests/registration.test.ts      # 28 checks
npx --yes tsx tests/roles.test.ts             # 36 checks
```

The last three start a **real** Flask server against a scratch SQLite file in
the temp directory — they never touch `aqsms.db`.

### To build an APK on a new PC you also need

JDK 21, the Android SDK, and build-tools 36.1.0. `dev-tools/build-apk.ps1` has
the paths **hard-coded** at the top:

```powershell
$Jdk        = "C:\Android\jdk21"
$Sdk        = "C:\Android\Sdk"
$BuildTools = Join-Path $Sdk "build-tools\36.1.0"
```

On a different machine, edit those three lines first — or install to the same
locations. See `frontend/BUILD_ANDROID.md` §1 for the full prerequisite list.

---

## 5. Accounts and roles

Exactly **two** roles. One fixed Owner/Admin; caretakers are unlimited.

| | Caretaker | Owner/Admin |
|---|---|---|
| Sign in, session restore | yes | yes |
| Readings, history, alerts, thresholds (read) | yes | yes |
| Register from the app | yes — creates a caretaker | yes |
| `GET`/`POST /admin/users` (list, create, disable, enable) | **403** | yes |
| Caretaker-accounts screen | refusal card | full screen |
| Promote anyone to Owner/Admin | does not exist | does not exist |
| Delete an account | does not exist | does not exist |
| Read/reset another account's password | does not exist | does not exist |

**The fixed Owner/Admin:** `aquasmart@app.com` / `aqua123`.

> `aqua123` is **initial prototype credentials**, not a production password. It
> is seven characters and every normal rule requires at least eight — which is
> exactly why it can only be set through the local provisioning script, never
> through registration. Move off it with `reset_password.py` before real use.

Registration is always a caretaker: there is no role selector anywhere in the
app, a `role` field in the request body is ignored, and the reserved admin
identifier is refused. Caretakers are active immediately; the owner can disable
one later, which blocks sign-in **and** invalidates any token it already holds.

**The role is never trusted from the client and is not in the JWT.** It is
re-read from the database on every protected request. A hidden button is not a
control — the Pi enforces all of this independently.

Error convention: **401** means not authenticated (`token_missing`,
`token_expired`, `token_invalid`, `account_missing`, `role_unknown`); **403**
means authenticated but not permitted (`forbidden_role`, `account_disabled`).

---

## 6. Deploying to the Pi

Run in `pi-server/` on the Pi. **Order matters** — and do not point a new APK at
an old backend.

```bash
sudo systemctl stop aqsms

# 1. BACK UP FIRST
cp aqsms.db "aqsms.db.backup-$(date +%Y%m%d-%H%M%S)"

# 2. Rehearse on a copy (do not skip this)
cp aqsms.db /tmp/rehearsal.db
DB_PATH=/tmp/rehearsal.db python3 -c "import db; db.init_db()"
sqlite3 /tmp/rehearsal.db "SELECT * FROM schema_version;"                  # 1
sqlite3 /tmp/rehearsal.db "SELECT username, role, status FROM accounts;"
sqlite3 /tmp/rehearsal.db "SELECT COUNT(*) FROM readings; SELECT COUNT(*) FROM alerts;"
#    Continue only if the counts match the live database.

# 3. Apply
python3 -c "import db; db.init_db()"

# 4. Provision the fixed Owner/Admin (hidden prompt; never an argument)
python3 provision_admin.py

# 5. Validate
sqlite3 aqsms.db "SELECT username, role, status FROM accounts;"
sqlite3 aqsms.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='accounts';"
#    expect idx_accounts_one_owner, NOT idx_accounts_primary_farmer
sqlite3 aqsms.db "SELECT COUNT(*) FROM esp32_keys;"

# 6. Start
sudo systemctl start aqsms
curl -k https://localhost:8443/health
```

**What the migration preserves:** existing bcrypt hashes byte-for-byte, readings,
alerts, threshold approval flags, ESP32 device keys, the JWT secret, and the
HTTPS material. The legacy `farmer` role becomes `caretaker` — it is **not**
promoted. The `accounts` table is rebuilt only because SQLite cannot add a CHECK
constraint by `ALTER`; the old one-account index is retired and replaced by
`idx_accounts_one_owner`.

**Rollback:** stop the service, move the database aside, restore the backup,
start:

```bash
sudo systemctl stop aqsms
mv aqsms.db aqsms.db.failed
cp aqsms.db.backup-<stamp> aqsms.db
sudo systemctl start aqsms
```

**Never** delete or recreate `aqsms.db` as a shortcut, and never reseed demo
readings or alerts.

**Ports:** `./serve.sh` serves **HTTPS on 8443** (gunicorn, when a certificate
exists) and falls back to plain HTTP on 8443 with a loud warning. `python
server.py` uses **8000** — the plain-HTTP developer server. Full walkthrough:
`PHONE_TO_PI_SETUP.md`.

---

## 7. Tests

| Suite | Covers | Checks |
|---|---|---|
| `tests/logic.test.ts` | Mappers, status logic, client vs a mock Pi | 27 |
| `tests/pi_server.test.ts` | Real Flask server and SQLite: ingest, readings, alerts | 22 |
| `tests/registration.test.ts` | Public caretaker registration, duplicate race, reserved identifier | 28 |
| `tests/roles.test.ts` | The permission matrix, disable/re-enable, token invalidation | 36 |

**113 total, all passing**, plus `tsc --noEmit` and `expo lint` clean.

`roles.test.ts` is the one that matters for security claims: it drives the
permission matrix over raw HTTP rather than through the UI, so a hidden button
cannot make it pass. It asserts that a caretaker gets 403 on all four owner
endpoints, that a disabled caretaker is refused at login *and* with the token it
already held, that re-enabling restores both, and that a person's token cannot
authenticate as an ESP32.

Firmware regression: `node firmware/tests/run-regression.mjs`.

---

## 8. Building the release APK

```powershell
cd C:\Users\Jahna\Music\AQSMS-APP-main
powershell -ExecutionPolicy Bypass -File dev-tools\build-apk.ps1
```

One command. It runs type-check, lint, `expo prebuild`, re-applies release
signing, Gradle `assembleRelease`, then `apksigner verify --print-certs` and
prints the SHA-256.

Check three things in its output:

1. The signer is `CN=Aqua Smart Monitoring System`, **not** `CN=Android Debug`.
2. The certificate fingerprint matches your previous release (same keystore).
3. Record the SHA-256 it prints.

`versionCode` in `frontend/app.json` is currently **3**. Android refuses to
install over an existing app unless the `versionCode` increases, so bump it
before any build you install over a previous one. Package is
`com.aquasmart.khai` and has not changed.

**Never run Gradle directly after a prebuild** — `expo prebuild` regenerates
`android/` and the template signs release builds with the public debug key.
`apply-release-signing.js` is what fixes that, and the build script always runs
both in order.

### App icon and splash

`frontend/assets/images/icon.png` is the source; `node scripts/make-icons.mjs`
derives `adaptive-icon.png`, `splash-image.png` and `favicon.png` from it, and
`expo prebuild` bakes those into the APK. If you change the logo, regenerate and
then rebuild — the build script prebuilds for you.

---

## 9. Secrets — never commit these

| Thing | Where it lives | Why it matters |
|---|---|---|
| `frontend/credentials/` (keystore + password) | ignored via `frontend/.gitignore` | Anyone with it can sign an APK that updates over your app. |
| `pi-server/aqsms.db` | the Pi only | Holds every account's bcrypt hash. |
| `pi-server/jwt_secret.txt` | the Pi only | Signs login tokens. Anyone with it can forge a login for any account without a password. Must be ≥ 32 bytes. |
| `pi-server/certs/` | the Pi only | TLS private key. Must never leave the Pi. |
| `frontend/certs/aqsms-ca.crt` | ignored | Public certificate — safe in itself, but machine-specific, so it is not committed. |

The Owner/Admin **password is not in the APK** and is never compared in the app.
Authentication happens only against the Pi.

---

## 10. Gotchas learned the hard way

- **`getpass` hangs on Windows** with redirected stdin: it reads the console via
  `msvcrt` rather than stdin. Script the prompts by patching
  `getpass.getpass`, don't pipe passwords in.
- **`expo prebuild` wipes `android/`** — it is generated output. Never hand-edit
  files in there; change `app.json` or a config plugin instead.
- **Release signing must be re-applied after every prebuild**, or the APK ships
  signed with Android's public debug key and looks fine until you try to install
  it over a real one.
- **`icon.png` is large and tall.** The droplet is 1.25× taller than wide, so
  `make-icons.mjs` scales it to 48% of the canvas for the adaptive icon. Enlarge
  it and a circular launcher mask clips the droplet's tip.
- **`git` is not on PATH** on the original machine; it is at
  `C:\Users\Jahna\AppData\Local\Programs\Git\cmd\git.exe`.
- **PowerShell 5.1**: no `&&`, no ternary, no `??`. `robocopy` exit codes 0–7
  mean success and anything ≥ 8 is a failure — do not treat exit 1 as an error.
- **`git push` from `main` fails** by design: local `main` and `origin/main` are
  unrelated histories. Push with an explicit refspec:
  `git push origin main:current-app`.
- **Firmware is one file** (`aqsms_esp32.ino`, ~110 KB) and structs must be
  declared before the first function that uses them. Built against
  `esp32:esp32` **2.0.17** — pin that version; the 3.x core install fails on a
  673 MB download on this machine.
- **The ESP32's `X-API-Key` and people's JWTs are separate.** Passing a Bearer
  token to `/esp32/*` must fail, and it does.

---

## 11. Honest status

**Verified:** 113 automated checks against a real Flask server and SQLite;
migration rehearsed on temporary databases with hashes compared byte-for-byte;
`tsc` and `expo lint` clean; the icon pipeline diffed against the regenerated
Android resources.

**Not verified — do not assume these work:**

- No physical Android phone or emulator has run the app.
- No real ESP32, probes, or SIM900 have been exercised.
- The **HTTPS handshake has never been performed** end to end.
- The **migration has never been run against the live Pi database**, and the
  fixed Owner/Admin has never been provisioned on real hardware.
- The Gradle release build has not been run since the icon change, so no APK
  exists yet for the current code.

---

## 12. Next actions

1. Review and merge `current-app` into `main` on GitHub.
2. Build the release APK (§8) and confirm the signer is not the debug key.
3. Back up the Pi's `aqsms.db`, rehearse the migration on a copy, then apply it
   and provision the Owner/Admin (§6).
4. Install the APK and walk both roles with the phone checklist in
   `PHONE_TO_PI_SETUP.md`.
5. Change `aqua123` with `reset_password.py` before anyone else uses it.

### Explicitly out of scope for this release (decided, not unresolved)

- Editing thresholds from the app — they stay **read-only**; the existing
  configuration process is still the only way to set them.
- Managing SMS recipients from the app — that stays in the commissioning
  process.
- Deleting accounts, promoting a caretaker to Owner/Admin, and reading or
  resetting another account's password — none of these exist, by design.
