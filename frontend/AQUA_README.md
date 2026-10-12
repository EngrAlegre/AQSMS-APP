# Aqua Smart Monitoring System — Android app

An Expo / React Native / TypeScript Android app for **one** freshwater test
pond. It shows pH, temperature (°C) and dissolved oxygen (mg/L), plus status,
reading history and alert history, against a Raspberry Pi on the local network.

> **Status.** The app, the Pi API and the ESP32 firmware exist; none has been run
> on real hardware. There are no demo fixtures and no mock sign-in in the
> shipping app. It is not finished until a physical phone talks to a real Pi
> over the farm Wi-Fi. See "Verification status" at the end.

---

## 1. Architecture

```
app/                       Screens (expo-router, file-based)
  sign-in.tsx              Pi address + connection test, then sign in or create account
  (tabs)/index.tsx         Dashboard
  (tabs)/history.tsx       Reading history + trend chart
  (tabs)/alerts.tsx        Alert history
  (tabs)/settings.tsx      Pi address, test connection, thresholds (read-only), sign out
src/
  models/                  Typed data models (Reading, AlertRecord, ThresholdSet, …)
  api/piApiContract.ts     The ONLY place for Pi endpoint paths and JSON mapping
  api/httpClient.ts        fetch with timeout, LAN-only URL validation, error classification
  api/realSource.ts        The Pi data source, and testPiConnection
  api/errors.ts            ApiError (incl. the Pi's own message and error code)
  auth/AuthContext.tsx     Session state; signs out on a 401
  auth/adapters.ts         AuthAdapter: piAuthAdapter (signIn + register)
  auth/credentials.ts      Client mirror of the server's username/password rules
  auth/session-events.ts   Session-expiry notice, handed to the sign-in screen
  logic/status.ts          Safe/Warning/Unsafe/No Data evaluation, stale check
  logic/connection.ts      Connection state — never "Live" without a real reading
  network/networkCheck.ts  Best-effort "wrong Wi-Fi" hint
  components/              SensorCard, StatusChip, TrendChart, Banner, …
```

There is no `demoSource`, no `demoData` under `src/`, and no scenario picker.
Synthetic fixtures exist only in `tests/fixtures/`, used by automated tests and
never bundled into the app.

`backend/` (a legacy FastAPI/Mongo template) is **not used** by this app.

### Status rules

- **Safe** — the value is inside `[safeMin, safeMax]` **and the thresholds are
  approved**.
- **Warning** — outside the safe range but inside `[warnMin, warnMax]`.
- **Unsafe** — outside the warn limits.
- **No Data** — the value is missing, the thresholds are unavailable, **or the
  thresholds are unapproved**.
- **Stale** — the latest reading is older than 10 minutes.

### How data is labelled

- A `reading: null` response is **No Data**. It is never rendered as `0`, and it
  never produces a **Live** badge.
- An empty history shows an empty state, not a flat line at zero. Missing values
  in a row show as **No Data**, not as blanks that read like zeros.
- Thresholds are **read-only** in the app. While `approved` is false they read
  **Thresholds pending / unavailable**, the chart draws **no safe band**, and
  **Safe** is unreachable. This is the whole reason the thresholds table is
  seeded with `NULL` limits rather than plausible-looking numbers.
- If a refresh fails while older data is still on screen, the badge says
  **NOT LIVE** and a banner says when that data was received.
- When the Pi answers `401` to a request carrying a token, the app discards the
  session, returns to sign-in, and says why.

---

## 2. Accounts

Accounts are real and live on the Pi. There is no mock account and no
hardcoded credential anywhere in this app.

There are two roles. An **Owner/Admin** — exactly one, fixed at
`aquasmart@app.com`, provisioned locally on the Pi with
`pi-server/provision_admin.py`, never from the app — and any number of
**Caretakers**. Registration assigns the role on the server; the app has no role
selector, and a `role` field in the request body is ignored.

- Both roles sign in through the **same** screen. The Pi returns the account's
  role with the token, and the app routes on that — it never infers a role from
  anything it stored.
- **Register as Caretaker** on the sign-in screen. It is offered only after the
  Pi address has been saved **and** a connection test against it has succeeded,
  so the account is always written to a Pi the phone has actually reached. The
  link also defers to the Pi's `registration_open`, so registration can be
  withdrawn server-side without a new APK.
- The username and password go to the Pi, which stores a **bcrypt** hash. No
  plaintext password is stored anywhere, on the phone or on the Pi.
- Validation is mirrored on both sides: username 3–32 chars from
  `[A-Za-z0-9._-]`, password at least 8 characters and at most 72 bytes (bcrypt
  reads no further, so over-long input is refused rather than silently
  truncated). `aquasmart@app.com` is reserved and refused.
- **Registration stays open**, and there is no cap on caretakers. Two phones
  registering the *same* name at the same instant yield exactly one account: the
  `UNIQUE` constraint in SQLite is the backstop, not a check in the handler.
- The Owner/Admin sees a **Caretaker accounts** screen (Settings → Caretaker
  accounts) to list, create, disable and re-enable caretakers. A caretaker does
  not see it — and the Pi refuses those requests regardless of what the app
  draws, so hiding the screen is a convenience and not the control.
- Disabling an account blocks sign-in and stops any token it already holds, on
  its next request. Nothing is deleted; re-enabling restores it, and because the
  account still exists, a token it held becomes usable again.
- A forgotten password is recovered **on the Pi**, with
  `pi-server/reset_password.py`. There is deliberately no network endpoint that
  resets a password, and no way to read or reset another account's password.

Signing in stores the Pi's JWT in SecureStore, along with the role and status
the Pi reported. Tokens last 24 hours and carry **no role claim** — the Pi
re-reads the role from its database on every request. A session saved by a build
from before roles existed has no stored role and is discarded rather than
guessed, so signing in again is required once. The Pi's signing key lives in
`pi-server/jwt_secret.txt` and is never committed.

---

## 3. Networking

### Plain HTTP — read this before using it

A Pi on the LAN typically serves plain `http://`. Release builds on Android 9+
block cleartext by default, and `app.json` re-enables it:

```json
["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
```

**Over plain HTTP the password and the session token cross the Wi-Fi
unencrypted.** There is no "encrypted HTTP" mode in this project and nothing
here claims otherwise. Anyone who can see the traffic can read the password, or
copy the token and use it until it expires; anyone who can alter traffic can
change what the Pi sends back. That is tolerable for a bench test on a network
you control and not tolerable for a pond that runs unattended.

The app makes this visible rather than hiding it: whenever the saved address
starts with `http://`, the sign-in screen shows a warning that credentials are
sent unencrypted.

### HTTPS on the local network

The Pi can serve HTTPS with a certificate it issues itself — no public CA, no
domain name, no port forwarding, and no internet needed. `pi-server/make-cert.sh`
creates a private CA and a server certificate naming the Pi's LAN address;
`serve.sh` serves TLS on port 8443 when that certificate exists.

The phone is built to trust that one CA: copy `certs/aqsms-ca.crt` from the Pi
to `frontend/certs/` before building, and `plugins/with-pi-certificate.js`
bundles it and points Android's network security config at it. That is
certificate pinning to one specific Pi.

If the certificate file is absent the build still succeeds, with a warning — the
resulting APK simply does not trust the Pi's HTTPS, and reports a connection
failure for an `https://` address. Plain `http://` keeps working.

Full step-by-step: `../PHONE_TO_PI_SETUP.md`.

### Address rules

- The app accepts **private LAN addresses only**: 10.x, 172.16–31.x, 192.168.x,
  169.254.x, or a local hostname.
- It rejects `localhost`, `127.x` and `0.0.0.0` with an explanation, because on
  a phone those mean the phone itself.
- Permissions are `INTERNET`, `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE`;
  the last two are used only for the "wrong Wi-Fi" hint.
- **Do not expose the Pi API to the public internet.** The phone must be on the
  same network as the Pi.
- Give the Pi a fixed address (a DHCP reservation on the router). Some phones
  cannot resolve `.local` names, so a literal IP is more reliable.
- Some routers have **client isolation** on, which silently prevents two devices
  on the same Wi-Fi from reaching each other. If the Pi is up, the phone is
  online, and they still cannot see each other, check that setting.

---

## 4. Building and running

```bash
cd frontend
yarn install

# correctness gates
npx tsc --noEmit
npx expo lint
npx --yes tsx tests/logic.test.ts
npx --yes tsx tests/pi_server.test.ts
npx --yes tsx tests/registration.test.ts
npx --yes tsx tests/roles.test.ts
```

`pi_server.test.ts`, `registration.test.ts` and `roles.test.ts` start the **real**
Flask server against a **real** SQLite database in a temp file. They need the Pi
server's virtualenv (see `../pi-server/`).

The APK build, release signing and signature verification are in
**`BUILD_ANDROID.md`**.

> The web preview cannot reach an `http://` LAN address, so real-API behaviour
> can only be checked on a phone or an emulator.

---

## 5. Verification status

**Verified locally on the development machine:** type-check, lint, and 113
automated tests across four suites — including that a `reading: null` response
never reads as Live, that unapproved thresholds never read as Safe, that the
password is stored as a bcrypt hash, that public registration always creates a
caretaker and never an owner, that two simultaneous registrations of one name
produce exactly one account, that a caretaker is refused on every Owner/Admin
endpoint, and that a disabled account is refused at login and on a token it
already held.

**Not verified:** anything on physical hardware. The app has never run on a real
Android phone or emulator; the Pi scripts have never run on a Raspberry Pi; the
HTTPS handshake has never been performed; the ESP32 firmware has never been
compiled. Treat the first run as a test, and expect to work through
`../PHONE_TO_PI_SETUP.md` Part 6.
