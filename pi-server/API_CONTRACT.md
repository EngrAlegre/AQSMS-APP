# AQSMS Pi Server API Contract

All endpoints expect and return JSON. Error replies are `{"error": "<message>"}`,
and some also carry a machine-readable `{"code": "<code>"}`.

Timestamps are ISO-8601 **UTC** (e.g. `2026-10-07T15:30:57Z`).
Units: pH (unitless), `temperature_c` (**°C**), `dissolved_oxygen_mg_l` (**mg/L**).
Any numeric field may be `null`.

**A `null` means "not measured", and it is never the same as `0`.** The server
does not substitute a value for a missing measurement, and it refuses to store a
reading row in which nothing was measured at all.

---

## Accounts and roles

There are exactly **two** roles.

| Role | How many | How it is created | What it can do |
|---|---|---|---|
| `owner` | exactly **one** | `provision_admin.py`, run locally on the Pi | everything a caretaker can, plus caretaker account management |
| `caretaker` | any number | the app's **Register as Caretaker** screen, or the owner's account screen | readings, history, alerts, read-only thresholds |

The one owner is fixed at `aquasmart@app.com`. Public registration always
creates a **caretaker** and cannot create anything else; there is no
admin-registration endpoint, and no endpoint anywhere changes an account's role.

An account has a **status**: `active` or `disabled`. A disabled account cannot
sign in, and any token it already holds stops working on the next request.
Disabling is reversible and deletes nothing.

**The role is never in the token.** Every authenticated request re-reads the
role and status from the accounts table, so a change takes effect on the very
next request rather than whenever the token happened to expire. Nothing the
phone stores or sends can change what the Pi permits.

### Two separate credential systems

| | Person (owner or caretaker) | ESP32 device |
|---|---|---|
| Credential | username + password → JWT | `X-API-Key: <key>` |
| Header | `Authorization: Bearer <jwt>` | `X-API-Key` |
| Can read readings / alerts / thresholds | yes | **no** |
| Can post measurements | **no** | yes |
| Role | read from the database per request | none — a device is not an account |

A person's token cannot post measurements, and a device key cannot read a
person's data. Neither is a substitute for the other, and **the ESP32 is never
issued a person's JWT** — not even the owner's.

Passwords are stored as **bcrypt** hashes. An ESP32 key is also stored as a
bcrypt hash — the plaintext key is printed once when it is minted and cannot be
retrieved afterwards.

---

## Unauthenticated endpoints

### `GET /health`

Returns system health, the current time, and whether the Pi is accepting new
caretaker registrations.

```json
{
  "status": "ok",
  "timestamp": "2026-10-07T15:30:57Z",
  "registration_open": true
}
```

`registration_open` reflects the server's registration policy (currently:
always open, so that caretakers can be added at any time). It does **not** mean
"there is a free account slot" — there is no longer any such limit. The app calls
this rather than assuming a policy, so the **Register as Caretaker** link can be
withdrawn without an app update. `false` means the app must not offer
registration at all; an unreachable Pi is not treated as `false`.

### `POST /auth/register`

Creates a **caretaker**. Public, and available continuously.

**Request**:
```json
{
  "username": "farmer_joe",
  "password": "a-good-password",
  "confirm_password": "a-good-password",
  "display_name": "Joe Farmer"
}
```

- `username` — required. 3–32 chars, `[A-Za-z0-9._-]` only. Trimmed and
  lower-cased, so `Farmer` and `farmer` are the same account. `aquasmart@app.com`
  is reserved and refused here (the character rule would reject the `@` anyway;
  the reserved check runs first so the caller gets the real reason).
- `password` — required. At least 8 characters and at most **72 bytes**.
  bcrypt reads no more than 72 bytes, and bcrypt 5.x raises rather than
  truncating, so the limit is enforced up front instead of silently ignoring the
  tail of a long passphrase.
- `confirm_password` — required, must equal `password`.
- `display_name` — optional. Falls back to the username.
- `role` — **ignored**. Supplying `"role": "owner"` creates a caretaker.

**Response (201)**:
```json
{
  "token": "eyJ0eXAi...",
  "display_name": "Joe Farmer",
  "role": "caretaker",
  "status": "active"
}
```

**Errors**:

| Status | Code | Cause |
|---|---|---|
| `400` | — | Validation. Messages cover the reserved identifier, the pattern, the length caps, the 8-character minimum, the 72-byte limit and `"Passwords do not match"`. |
| `400` | — | `{"error": "Expected a JSON object body"}` — body was not a JSON object. |
| `409` | `username_taken` | That username already exists on this Pi. |
| `409` | `registration_closed` | The server's policy has registration switched off. |

Failed validation creates nothing — a `400` never leaves a partial account
behind.

**Two phones registering the same name at the same instant produce one `201` and
one `409`**, never two accounts: the `UNIQUE` constraint on `username` is the
backstop, not a check in the handler. Covered by an automated concurrency test.

There is deliberately **no unauthenticated password-reset endpoint**. Anything
reachable on the LAN without knowing the current password would be a way in, not
a way back. Recovery is a local CLI on the Pi — `reset_password.py`.

### `POST /auth/login`

**Request**:
```json
{
  "username": "farmer_joe",
  "password": "a-good-password"
}
```

**Response (200)**:
```json
{
  "token": "eyJ0eXAi...",
  "display_name": "Joe Farmer",
  "role": "caretaker",
  "status": "active"
}
```

`role` and `status` come from the account row. The app routes on them — it does
not infer a role from anything it stored, and it refuses to build a session if
the Pi has not reported a recognised role.

**Errors**:

| Status | Code | Cause |
|---|---|---|
| `400` | — | `{"error": "Missing credentials"}` — either field absent. |
| `401` | — | `{"error": "Invalid username or password"}` — unknown username, wrong password, or an unusable stored hash. |
| `403` | `role_unknown` | The password matched, but the account's role is not one this build recognises. No token is issued. |
| `403` | `account_disabled` | The password matched, but the account has been disabled. No token is issued. |

An unknown username and a wrong password return the **same** message and status,
so the reply does not reveal which usernames exist. The role and status checks
run only **after** the password matched, so a disabled account cannot be
discovered by someone who does not already know its password.

Tokens are HS256 JWTs with a `sub` claim and an `exp` **24 hours** ahead
(`AQSMS_TOKEN_EXPIRY_HOURS`). The signing key must be at least 32 bytes; the
server refuses to start with a shorter or missing one. **No role claim is
carried** — see "Accounts and roles" above.

### `GET /auth/me`

`Authorization: Bearer <token>`

The authenticated identity as the Pi currently sees it — the endpoint the app
calls when restoring a saved session, so a token that merely exists becomes one
that is still valid, still enabled, and still the role it was.

```json
{
  "username": "farmer_joe",
  "display_name": "Joe Farmer",
  "role": "caretaker",
  "status": "active",
  "created_at": "2026-10-07T15:26:02Z"
}
```

Never includes a password hash.

---

## Authenticated endpoints

`Authorization: Bearer <token>` — any active account, whatever its role.

### How a request is refused

| Status | Code | Meaning |
|---|---|---|
| `401` | `token_missing` | No `Authorization` header. |
| `401` | `token_expired` | The token's `exp` has passed. |
| `401` | `token_invalid` | Malformed, or the signature does not verify. |
| `401` | `account_missing` | The token is genuine but its account no longer exists. |
| `401` | `role_unknown` | The account's role is not one this build recognises. |
| `403` | `account_disabled` | The account is real and the token is good, but it has been disabled. |
| `403` | `forbidden_role` | The account is fine, but this endpoint is not for its role. |

The split matters to the app: **`401` means "this session is over"**, so it
discards the stored session and returns to sign-in. A `403` with
`account_disabled` is the same situation from the user's point of view and is
handled the same way. A `403` `forbidden_role` is *not* — the identity is fine,
the action is not, so the app stays signed in and refuses the action.

### `GET /readings/latest`

```json
{
  "pond_name": "Test Pond 1",
  "reading": {
    "timestamp": "2026-10-07T15:30:00Z",
    "ph": 7.2,
    "temperature_c": 22.5,
    "dissolved_oxygen_mg_l": 6.8
  }
}
```

With no readings stored — the state of a fresh install:

```json
{
  "pond_name": "Test Pond 1",
  "reading": null
}
```

`reading: null` means **No Data**. It must never be rendered as `0`, and it must
never be rendered as **Live**.

### `GET /readings?limit=N`

Default limit `50`. Newest first.

```json
{
  "readings": [
    {
      "timestamp": "2026-10-07T15:30:00Z",
      "ph": 7.2,
      "temperature_c": 22.5,
      "dissolved_oxygen_mg_l": null
    }
  ]
}
```

An individual measurement inside a reading may be `null` — that parameter was
not measured in that sample. `{"readings": []}` is the empty-history state; the
app shows an empty state rather than a flat line at zero.

### `GET /alerts?limit=N`

Default limit `50`. Newest first.

```json
{
  "alerts": [
    {
      "id": "1",
      "timestamp": "2026-10-07T15:30:00Z",
      "parameter": "ph",
      "value": 4.5,
      "threshold": "safe_min 6.50",
      "status": "unsafe",
      "message": "pH below the approved safe range"
    }
  ]
}
```

`id` is a string, so the client can key a list on it. `threshold` and `message`
may be `null`.

### `GET /thresholds`

```json
{
  "approved": false,
  "ph": {"safe_min": null, "safe_max": null, "warn_min": null, "warn_max": null},
  "temperature": {"safe_min": null, "safe_max": null, "warn_min": null, "warn_max": null},
  "dissolved_oxygen": {"safe_min": null, "safe_max": null, "warn_min": null, "warn_max": null}
}
```

**This is what a fresh install returns, and it is deliberate.** The table is
seeded with `NULL` limits and `approved = 0`; no threshold value is invented
anywhere in this project. Until an operator approves real limits, every
parameter must display as **Thresholds pending / unavailable**, never as
**Safe**, and charts must draw no safe band.

`approved` is true only when **every** threshold row is approved. A single
unapproved row keeps the whole response unapproved, because a partly-approved
set would let the app assert a judgement about a parameter nobody signed off.

**Read-only.** There is no endpoint that writes a threshold, for either role.
Limits keep going through the existing local commissioning process.

---

## Owner/Admin endpoints

`Authorization: Bearer <token>` where the account's role is `owner`. A caretaker
token gets `403 {"code": "forbidden_role"}` on every one of them, whether or not
the app drew the screen.

<account> = one of these:

```json
{
  "username": "pond-helper",
  "display_name": "Pond Helper",
  "role": "caretaker",
  "status": "active",
  "created_at": "2026-10-07T15:26:02Z"
}
```

### `GET /admin/users`

The **caretaker** accounts, sorted by username. The fixed Owner/Admin is never
in this list — the screen that manages caretakers must not be able to act on the
owner, and the server does not offer it the chance.

```json
{"users": [ { "username": "pond-helper", "...": "..." } ]}
```

### `POST /admin/users`

**Request** (same rules and same validation as public registration):

```json
{
  "username": "pond-helper",
  "password": "a-good-password",
  "confirm_password": "a-good-password",
  "display_name": "Pond Helper"
}
```

Accepts the same fields as `/auth/register`, **ignores `role` the same way**, and
applies the same username and password rules — including the 8-character
minimum and the reserved identifier.

**Response (201)**: `{"user": <account>}` with `role: "caretaker"`.

**Errors**: `400` as for registration, plus
`409 {"code": "username_taken"}`.

### `POST /admin/users/<username>/disable`

### `POST /admin/users/<username>/enable`

**Response (200)**: `{"user": <account>}` with the new status.

| Status | Code | Cause |
|---|---|---|
| `404` | `unknown_account` | No account by that name on this Pi. |
| `403` | `not_a_caretaker` | The target is the Owner/Admin. It cannot be disabled, re-roled or otherwise managed from here. |

**Disabling takes effect on the target's next request**, not when its token
expires: login is refused, `/auth/me` is refused, and every protected endpoint
answers `403 account_disabled`. Re-enabling has the mirror effect, and because
nothing was deleted, a token the account still holds becomes usable again.

### What is deliberately absent

There is no endpoint that **deletes** an account, **changes a role** (so a
caretaker can never be promoted and a second owner can never be made),
**reads or resets another account's password**, writes a **threshold**, or
manages **SMS recipients**. The last two are out of scope for this release and
stay with the existing local commissioning process.

---

## ESP32 ingestion endpoints

`X-API-Key: <device key>` on every request. Keys are minted on the Pi with
`python setup_account.py --add-esp32-key` and stored as bcrypt hashes.

Missing or wrong key → `401 {"error": "Unauthorized API Key"}`. A person's
`Authorization` header is ignored here: a JWT is not a device credential.

### `GET /esp32/ping`

Proves the device can reach the Pi and that its key is accepted. **Stores
nothing.**

```json
{
  "status": "ok",
  "message": "API key accepted. No data was stored.",
  "timestamp": "2026-10-07T15:30:57Z"
}
```

This is the bring-up test for a new board: a connectivity check must never leave
a fake measurement in the pond history. The `timestamp` is also what the board
uses as its clock, since the ESP32 has no real-time clock and the system has no
internet dependency.

### `POST /esp32/readings`

**Request**:
```json
{
  "timestamp": "2026-10-07T15:30:57Z",
  "ph": 7.2,
  "temperature_c": 22.5,
  "dissolved_oxygen_mg_l": null,
  "event_id": "esp32-pond-1-3f2a91c4-17"
}
```

Omit a field entirely, or send `null`, for a parameter that was not measured.
Both mean "no data". **Do not send `0`** — a zero is a real measurement, and
sending one for an absent probe would be indistinguishable from a genuine
reading of zero.

| Field | Required | Notes |
|---|---|---|
| `timestamp` | yes | ISO-8601. A non-ISO value is a `400`. |
| `ph` | no | number or null |
| `temperature_c` | no | number or null, **°C** |
| `dissolved_oxygen_mg_l` | no | number or null, **mg/L** |
| `event_id` | no | string, ≤128 chars. See deduplication below. |

Validation:

- The body must be a JSON object.
- Every supplied measurement must be a number or `null`. `"7.2"` as a string is
  a `400`; so are booleans, `NaN` and infinity.
- **At least one measurement must be present.** An all-null body is refused:
  `400 {"error": "No measurements supplied. Provide at least one of: ph, temperature_c, dissolved_oxygen_mg_l"}`.
- Values are not range-clamped. Clamping would hide a genuine sensor fault.

**Response (201)**: `{"message": "Reading created"}`

**Duplicate**: a repeated `event_id` is not stored twice.

```json
{"status": "duplicate", "message": "Reading already stored"}
```

with HTTP **200**. The `event_id` column has a unique index, so this holds even
if two retries arrive at the same instant — the second insert raises an
`IntegrityError` and is answered the same way rather than returning a `500`.

The device should generate one `event_id` per sample and reuse it across every
retry of that sample, so a lost reply does not become a second row.

### `POST /esp32/alerts`

**Request**:
```json
{
  "timestamp": "2026-10-07T15:30:57Z",
  "parameter": "temperature",
  "value": 35.5,
  "threshold": "safe_max 32.0",
  "status": "warning",
  "message": "Temperature above the approved safe range",
  "event_id": "esp32-pond-1-3f2a91c4-18"
}
```

- `timestamp`, `parameter`, `status` are required.
- `parameter` must be exactly one of `ph`, `temperature`, `dissolved_oxygen`.
  This is validated in Python rather than by letting the database `CHECK`
  constraint raise, so the reply cannot leak SQLite's internal error text.
- `status` must be exactly `warning` or `unsafe`.
- `value` must be a number or `null`.
- `threshold` and `message` must be strings or `null`.
- `event_id` behaves exactly as it does for readings, including the `200`
  duplicate reply.

**Response (201)**: `{"message": "Alert created"}`

The Pi **stores and serves** alert events; it does not send SMS. Sending a text
message is the ESP32's own job and is independent of the Pi by design — it has
to work when the Wi-Fi, the router or the Pi is down, which is when an alert
matters most.

This endpoint is a transport. Nothing in this project decides *when* to post an
alert, because that requires approved limits, and no threshold in the system is
approved yet.

---

## Database, migration and account provisioning

Everything here runs **on the Pi, from a shell on the Pi**. None of it is
reachable over the LAN.

### Schema versions

`db.init_db()` creates the original schema and then applies
`migrations.py`'s versioned steps, recording each in a `schema_version` table.
A brand-new database and a database that has been running on the pond for months
take the **same path**, so the migration is exercised on every install rather
than only on the one that matters. Running it twice is a no-op.

Migration `001` gives `accounts` its `role`, `status` and `created_at` columns.
SQLite cannot add a `CHECK` constraint to an existing column, so the table is
rebuilt: `accounts_new` → `INSERT … SELECT` → `DROP TABLE accounts` → `RENAME`.
Every column is copied verbatim, **including the bcrypt `password_hash`**, and
readings, alerts, thresholds, their approval flags and the ESP32 key rows are
never touched.

The old single-account rule — a partial unique index permitting exactly one
`role = 'farmer'` row — is dropped and replaced by
`idx_accounts_one_owner`, a partial unique index on `role = 'owner'`. Any number
of caretakers may now exist; there can still only ever be one owner, enforced by
SQLite itself.

**A pre-existing `farmer` account becomes a `caretaker`. It is not promoted to
owner.** Nothing in the migration creates the owner; that is a separate,
deliberate step below. No identifier conflict is possible either, because every
username the old schema could hold matched `[A-Za-z0-9._-]+`, which cannot
contain `@`.

### Before migrating: back up

```bash
cd pi-server
systemctl stop aqsms            # whichever unit runs server.py
cp aqsms.db aqsms.db.bak-$(date +%Y%m%d-%H%M%S)
ls -l aqsms.db*
```

If the database is in WAL mode (it is), also keep any `aqsms.db-wal` file
alongside the copy, or stop the service first as above so the WAL is
checkpointed into the main file.

### Apply the migration

```bash
cd pi-server
./venv/bin/python -c "from db import init_db; init_db()"
```

Or simply start the server — it runs the same code path on startup. It prints
one line per migration applied.

### Provision the Owner/Admin

```bash
cd pi-server
./venv/bin/python provision_admin.py
```

- Prompts for the password **twice, hidden**. The password is never an argument,
  never read from a file, never printed, and never logged.
- Creates `aquasmart@app.com` with role `owner`, storing only its bcrypt hash.
- **Re-running does nothing** if the account exists: it exits without prompting
  and without touching the stored hash. Provisioning never resets a password.
- Refuses, with a non-zero exit and an explicit message, if an owner already
  exists under a different name. Resolve that by hand — do not let a tool guess.

The shipped initial password (`aqua123`, 7 characters) is a **prototype
credential, not a production password**. It is accepted *only* here: everywhere
else the 8-character minimum stands, including for admin-created caretakers, and
`reset_password.py` applies it to the owner too. Move the owner off it as soon as
convenient — the tool prints that reminder on every successful run:

```bash
cd pi-server
./venv/bin/python reset_password.py aquasmart@app.com
```

### Validate, afterwards

```bash
cd pi-server
./venv/bin/python - <<'PY'
import sqlite3
c = sqlite3.connect('aqsms.db')
print('schema version:', c.execute('SELECT MAX(version) FROM schema_version').fetchone()[0])
print('accounts:', c.execute('SELECT username, role, status FROM accounts').fetchall())
print('owners (must be 0 or 1):', c.execute("SELECT COUNT(*) FROM accounts WHERE role='owner'").fetchone()[0])
print('readings:', c.execute('SELECT COUNT(*) FROM readings').fetchone()[0])
print('alerts:  ', c.execute('SELECT COUNT(*) FROM alerts').fetchone()[0])
print('esp32 keys:', c.execute('SELECT COUNT(*) FROM esp32_keys').fetchone()[0])
print('thresholds approved:', c.execute('SELECT parameter, approved FROM thresholds').fetchall())
PY
```

Expect: one row per pre-existing account (each now `caretaker`, `active`) plus
the owner; the counts of readings, alerts and ESP32 keys unchanged from before
the migration; and the threshold approval flags exactly as they were.

### Roll back

```bash
cd pi-server
systemctl stop aqsms
mv aqsms.db aqsms.db.failed-$(date +%Y%m%d-%H%M%S)
cp aqsms.db.bak-<the timestamp> aqsms.db
systemctl start aqsms
```

Rolling back means restoring the file; there is no down-migration, because the
migration only adds. If the old server code is restored along with the old file,
it will be running the pre-roles schema it expects.

### Other local tools

| Command | Purpose |
|---|---|
| `python reset_password.py [username]` | Change **any** account's password, including the owner's. Prompts hidden; enforces the full 8-character rule. |
| `python setup_account.py <username> <display_name>` | Create a **caretaker** without a phone to hand. Refuses to overwrite an existing account. |
| `python setup_account.py --add-esp32-key` | Mint a new device key. Printed once. |

`setup_account.py` creates caretakers only: it cannot create an owner and cannot
promote anyone.

---

## Storage notes

- **SQLite, WAL mode**, with `PRAGMA busy_timeout = 5000` and explicit
  `BEGIN IMMEDIATE` around the registration insert.
- The database path is absolute (`DB_PATH`, default beside the server module),
  so `python server.py` and a systemd unit with a different working directory
  cannot open two different empty databases.
- Indexes: `readings(event_id)` and `alerts(event_id)` unique where not null;
  partial unique index `idx_accounts_one_owner` on `accounts(role)` where
  `role = 'owner'`; timestamp indexes for the history and alert queries.
- `schema_version(version, applied_at)` records which migration steps have run.
