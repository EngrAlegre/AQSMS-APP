# PRD: Aqua Smart Monitoring System (AQSMS)

## Problem statement

An Android (Expo / React Native / TypeScript) app for a capstone prototype. It
monitors one freshwater test pond ("Test Pond 1") and shows pH, temperature (°C)
and dissolved oxygen (mg/L), each with a status (Safe / Warning / Unsafe /
No Data) against thresholds, plus reading history and alert history.

Readings come from a Raspberry Pi on the farm LAN, backed by SQLite. An ESP32
posts measurements and its own alert events to that Pi over the same network.

## Constraints

- **No cloud.** No cloud backend, auth or sync; no push notifications; no
  MongoDB/Firebase/AWS/Supabase.
- **Local network only.** No public internet dependency and no port forwarding.
- **SMS is independent.** The app never sends SMS. The ESP32 has its own
  cellular module and sends SMS on its own, so it keeps working when the Wi-Fi,
  the router or the Pi is down.
- **One pond.** One fixed Owner/Admin account, plus any number of Caretaker
  accounts. No public path can create a second owner.
- All Pi endpoints and JSON mapping live in one documented file,
  `frontend/src/api/piApiContract.ts`.

## Decisions

| Decision | Value |
|---|---|
| Pond name | Test Pond 1 |
| Stale after | 10 minutes |
| Accounts | One fixed **Owner/Admin** (`aquasmart@app.com`, provisioned locally on the Pi) plus any number of **Caretakers** (app registration, or created by the owner). Registration stays open; the owner may disable a caretaker, which is reversible |
| Password storage | bcrypt hash on the Pi; never plaintext, never on the phone |
| Thresholds | Read-only in the app; `NULL` limits and `approved = 0` until confirmed in writing |
| Transport | `http://` for bench testing, with a visible warning; self-signed CA + HTTPS on 8443 for real use |
| Android package | `com.aquasmart.khai` |

## Non-negotiable rules

These are the behaviours the prototype is actually being judged on, and each has
a test or a code guard behind it:

1. **A missing measurement is never filled in.** `null` stays `null`; it is
   never coerced to `0`. Missing sensor data shows as **No Data**.
2. **An empty database shows No Data**, never **Live**.
3. **Unapproved thresholds never produce Safe** — not in the app, and no safe
   band in the history chart.
4. **No invented thresholds anywhere** — not in the app, the Pi server, or the
   ESP32 firmware. The firmware ships no threshold constants at all.
5. **No unauthenticated password reset.** Recovery is a local CLI on the Pi.
6. **Plain HTTP is described as plain HTTP.** No claim that credentials are
   protected over it, because they are not.
7. **A role is never taken on trust.** The role is not in the JWT and is never
   read from a request body; the Pi re-reads it from the database on every
   request. An unrecognised or absent role is refused, never defaulted.
8. **Permissions are enforced by the Pi, not by hidden screens.** A caretaker
   token gets `403` on every `/admin/...` route whatever the app draws.
9. **Disabling an account is immediate and reversible.** It blocks sign-in and
   invalidates a token the account already holds; nothing is deleted.
10. **No role change and no account deletion exist**, in the API or the app, so
    a caretaker can never be promoted and a second owner can never be made.

## Implemented

**App.** One sign-in screen for both roles, with Pi address setup and a
connection test that gates registration; registration (always a caretaker, no
role selector) with a **Register as Caretaker** link that defers to the Pi's
`registration_open`; role-aware navigation and a role badge in Settings;
Owner/Admin screen for listing, creating, disabling and re-enabling caretakers;
dashboard with connection badge and stale detection; history with an SVG trend
chart (safe band only when thresholds are approved); alert list; settings with
read-only thresholds and sign-out. Session in SecureStore with `role` and
`status` stored alongside the token and re-validated against `/auth/me` on
launch; 24-hour token; forced return to sign-in on a `401` or a disabled-account
`403`. A session saved by the pre-roles build has no stored role and is
discarded rather than guessed.

**Pi server** (`pi-server/`, Flask + SQLite). `/health` with `registration_open`;
`/auth/register`, `/auth/login`, `/auth/me`; `/readings/latest`, `/readings`,
`/alerts`, `/thresholds`; the owner-only `/admin/users` list/create and
`/admin/users/<u>/disable|enable`; `/esp32/ping`, `/esp32/readings`,
`/esp32/alerts`. `role_required`/`token_required` decorators re-reading role and
status per request, `owner`/`caretaker` roles with one-owner enforced by a
partial unique index on `role = 'owner'`, bcrypt passwords, HS256 JWTs with a
32-byte minimum secret and no role claim, WAL + `BEGIN IMMEDIATE`, `event_id`
deduplication, versioned migrations (`migrations.py` + `schema_version`).
`provision_admin.py`, `setup_account.py`, `reset_password.py`, `make-cert.sh`,
`serve.sh`, `aqsms.service`.

**ESP32 firmware** (`firmware/aqsms_esp32/aqsms_esp32.ino`, one Arduino sketch,
classic ESP32-WROOM-32, esp32:esp32 2.0.17 + OneWire 2.3.8). Wi-Fi link
management, Pi clock as the time base, hand-written JSON payloads, retry with
duplicate-safe event ids, serial commands for a connectivity test that stores
nothing. pH/DO/temperature acquisition with two-point calibration, approved
threshold evaluation, SIM900 SMS with offline operation, and configuration
persisted in flash. The earlier PlatformIO project is retired to
`archive/esp32-firmware-platformio-2026-10-09/`. Compiled clean; never uploaded.

**Removed.** Demo mode, demo scenarios, `demoData.ts`/`demoSource.ts` from
`src/`, the mock adapters, and the `farmer` / `demo1234` credentials.

## Verification status

- **Verified locally:** type-check and lint clean; 113 tests across four suites
  (`logic` 27, `pi_server` 22, `registration` 28, `roles` 36), the last three
  against a real Flask server and a real SQLite database. An ad-hoc driver (not
  kept in the repo) additionally exercised `provision_admin.py`,
  `setup_account.py`, `reset_password.py` and the schema migration through 54
  checks on temporary databases — including a legacy `farmer` database being
  migrated with its bcrypt hash intact.
- **Not verified:** anything on hardware. The app has never run on a phone; the
  Pi scripts have never run on a Pi; the HTTPS handshake has never been
  performed; the ESP32 firmware has never been compiled for this release.

## Open items

1. **Approved thresholds** — species and limits unconfirmed. Do not invent.
   Everything stays unapproved until confirmed in writing.
2. **Field test** — a physical phone against a physical Pi on the pond Wi-Fi.
   The project is not complete until this passes.
3. **Sensor selection and pin assignments** — see `ESP32_TO_PI_SETUP.md` §6 for
   the exact board and sensor information required first.
4. **SIM900** — part number, power supply and wiring unspecified. Do not guess.
5. **P1:** persist the last successful reading across restarts, labelled cached.
6. **P2:** history range selector (6 h / 24 h / 7 d) and CSV export.

## Explicitly out of scope for the role-based release (decided, not unresolved)

- **Threshold editing in the app.** Thresholds stay read-only for both roles and
  keep going through the existing local commissioning process.
- **App-based SMS-recipient management.** Recipients stay managed through the
  existing commissioning process.
- **Account deletion and role promotion.** Neither exists in the API or the app,
  deliberately.
- The independent ESP32 → SIM900 SMS path is unchanged and must stay that way:
  critical alerts do not depend on a logged-in app user, and monitoring does not
  stop when a user signs out.
