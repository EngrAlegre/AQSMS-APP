# ESP32 → Raspberry Pi setup

How to bring up the ESP32 board, get it talking to the Pi API, and how real
sensor measurements will enter the system.

The firmware is now a **single Arduino sketch** at
`firmware/aqsms_esp32/aqsms_esp32.ino`. It replaces the earlier PlatformIO
project, which is preserved under `archive/esp32-firmware-platformio-2026-10-09/`.

> **Read this first.** No sensor is assumed to be wired, and none is assumed to
> be calibrated. The firmware ships with every measurement marked absent, so it
> posts nothing until you connect a real probe and enter its calibration. It
> never sends a zero, a placeholder, or an invented number for a sensor that
> isn't there. Section 6 lists exactly what is still needed.

---

## 1. The board

Target board: **ESP32 DevKitC (WROOM-32)**.

The project is configured for the `esp32dev` PlatformIO board, which builds for
a plain ESP32-WROOM module. Two hardware facts that matter throughout:

- **2.4 GHz Wi-Fi only.** There is no 5 GHz radio. A 5 GHz-only SSID will not
  appear in a scan, and there is nothing to configure around it — use the
  2.4 GHz network name.
- **3.3 V logic.** GPIO pins are not 5 V tolerant. Several common sensor
  breakouts output 5 V, and connecting one directly can destroy the pin or the
  module. This is the main reason pin assignments are not fixed yet.

---

## 2. Build and flash

The sketch needs the classic ESP32 core and exactly one library.

```powershell
$cli = "<path to>\arduino-cli.exe"      # Arduino IDE ships one; see BUILD notes

& $cli core install esp32:esp32@2.0.17   # classic ESP32, ~hundreds of MB
& $cli lib  install "OneWire@2.3.8"

# 1. Edit section 1 of firmware\aqsms_esp32\aqsms_esp32.ino (see the table below)

# 2. Build
& $cli compile --fqbn esp32:esp32:esp32 "<repo>\firmware\aqsms_esp32"

# 3. Flash (board on USB)
& $cli board list
& $cli upload -p <COMx> --fqbn esp32:esp32:esp32 "<repo>\firmware\aqsms_esp32"

# 4. Watch the console
& $cli monitor -p <COMx> --config baudrate=115200
```

The expected compile result for the delivered sketch is recorded in
`AQSMS-Full-System-Wiring-Guide.md` §13.1. Compiling is the only verification
that has been performed on it — no upload, calibration or field test.

### What to set in section 1 of the sketch

| Setting | What to enter |
|---|---|
| `AQSMS_WIFI_SSID` / `AQSMS_WIFI_PASSWORD` | The **2.4 GHz** network the Pi is on |
| `AQSMS_PI_HOST` | The Pi's LAN address, e.g. `192.168.1.50` — the same value you typed in the phone app |
| `AQSMS_PI_PORT` | `8443` for HTTPS, `8000` for the plain-HTTP dev server |
| `AQSMS_USE_TLS` | `1` for HTTPS. `0` sends the device key and every measurement unencrypted |
| `AQSMS_DEVICE_API_KEY` | The value printed by `setup_account.py --add-esp32-key` (section 3) |
| `AQSMS_DEVICE_ID` | A name for this board, e.g. `esp32-pond-1` |
| `AQSMS_PI_CA_PEM` | The contents of `pi-server/certs/aqsms-ca.crt`, only when `AQSMS_USE_TLS` is 1 |

The device key and the Wi-Fi password are real credentials, and the sketch
carries them as constants in section 1. Keep the placeholders in version
control and never commit a filled-in copy.

If `AQSMS_USE_TLS` is 1 and `AQSMS_PI_CA_PEM` is still the placeholder, the TLS
handshake fails and nothing is transmitted. That is deliberate: the alternative
— accepting any certificate — would defeat the point of installing one.

---

## 3. Create the device credential

The ESP32 does **not** use an app user's username and password — not even the
Owner/Admin's. It gets its own API key, and the two credential systems do not
overlap:

- A person's token cannot post measurements.
- An ESP32 key cannot read readings, alerts or thresholds.
- The board is never issued a person's JWT, of either role.

Mint a key on the Pi:

```bash
cd ~/aqsms/pi-server
./venv/bin/python setup_account.py --add-esp32-key
```

It prints the key **once** — only a bcrypt hash is stored in `esp32_keys`, so
there is no way to read it back. Copy it into `AQSMS_DEVICE_API_KEY` now. If you
lose it, mint another; keys are additive and the old one keeps working until you
delete its row.

---

## 4. Prove the link before wiring anything

This is the connectivity test, and it **stores nothing on the Pi**. It can be
run as many times as you like during bring-up:

```bash
# On the Pi, first confirm the endpoint itself works with a known-good key:
curl -k -H "X-API-Key: <the key>" https://<pi-address>:8443/esp32/ping
# -> {"status":"ok","message":"API key accepted. No data was stored.","timestamp":"..."}
```

Now from the board. Open `pio device monitor` and press:

| Key | What it does |
|---|---|
| `p` | GET `/esp32/ping`. Proves Wi-Fi, the route, and the key — and stores nothing. |
| `w` | Wi-Fi state: SSID, address, gateway, signal strength |
| `s` | Take a sensor sample and print it. Posts nothing. |
| `t` | Current time and whether the clock is synced from the Pi |
| `?` | The same list |

The sketch's console has more commands than these — thresholds, recipients,
modem diagnostics, alert outbox. `?` prints all of them, and
`AQSMS-Full-System-Wiring-Guide.md` §11 is the full reference.

A working `p` looks like:

```
[cmd] pinging the Pi (nothing will be stored)
[pi] ping accepted: {"status":"ok","message":"API key accepted. No data was stored.","timestamp":"..."}
```

Expected failures:

| Console says | Meaning |
|---|---|
| `wifi is down` | Not associated yet, or a 5 GHz SSID |
| `ping rejected, HTTP 401` | Wrong `X-API-Key`, or one that was never added to `esp32_keys` |
| `connection refused` | Right address, nothing listening. Check the port (8443 vs 8000) and whether `aqsms` is running |
| `connection timed out` | The board cannot reach the Pi at all. Same SSID? Router client isolation on? |
| `certificate` / handshake failure | `AQSMS_USE_TLS` is 1 but the CA was not pasted into `AQSMS_PI_CA_PEM`, or the certificate does not name the address in `AQSMS_PI_HOST` |

Once `p` succeeds, the board is correctly provisioned. Everything after this is
about sensors.

---

## 5. What the firmware sends, exactly

### 5.1 Routes

| Method | Path | Header | Purpose |
|---|---|---|---|
| GET | `/esp32/ping` | `X-API-Key` | Connectivity test. **Stores nothing.** |
| POST | `/esp32/readings` | `X-API-Key` | One measurement sample |
| POST | `/esp32/alerts` | `X-API-Key` | One alert event, for logging |

All three take `X-API-Key: <device key>`. None takes a person's token — the
board is never issued one — and none uses a cookie or a session.

### 5.2 A reading payload

Only parameters that were actually measured appear. An absent measurement is
**omitted**, not sent as `0` and not sent as `null` — an omitted field and a
null both mean "no data", whereas `0` means "the sensor read zero", which is a
different and possibly dangerous claim.

```json
{
  "timestamp": "2026-10-09T04:15:00Z",
  "ph": 7.12,
  "temperature_c": 28.40,
  "dissolved_oxygen_mg_l": null,
  "event_id": "esp32-pond-1-3f2a91c4-17"
}
```

| Field | Type | Unit | Notes |
|---|---|---|---|
| `timestamp` | string | ISO-8601 UTC | Required. Must end in `Z` or carry an offset the Pi can parse. |
| `ph` | number or null | pH units | Optional. Omit or `null` when not measured. |
| `temperature_c` | number or null | **°C** | Optional. Note the `_c`: the Pi stores Celsius, not Fahrenheit. |
| `dissolved_oxygen_mg_l` | number or null | **mg/L** | Optional. Note the `_mg_l` suffix. |
| `event_id` | string, ≤128 chars | — | Optional but used. See 5.4. |

Rules the Pi enforces:

- The body must be a JSON object.
- `timestamp` is required and must parse as ISO-8601.
- Every supplied measurement must be a number or `null`. Strings are rejected:
  `"7.1"` is a `400`, not a silent conversion. Booleans, `NaN` and infinity are
  rejected too.
- **At least one measurement must be present.** An all-null body is a `400`
  ("No measurements supplied"). This is the server enforcing "never store a row
  that contains no real data".
- Values may be negative and may be fractional; no range clamping is applied,
  because a clamped value would hide a genuine sensor fault.

### 5.3 An alert payload

```json
{
  "timestamp": "2026-10-09T04:15:00Z",
  "parameter": "ph",
  "value": 4.10,
  "threshold": "safe_min 6.50",
  "status": "warning",
  "message": "pH below the approved safe range",
  "event_id": "esp32-pond-1-3f2a91c4-18"
}
```

| Field | Type | Notes |
|---|---|---|
| `timestamp` | string | Required, ISO-8601 |
| `parameter` | string | Required. Exactly one of `ph`, `temperature`, `dissolved_oxygen` |
| `status` | string | Required. Exactly `warning` or `unsafe` |
| `value` | number or null | The measurement that triggered it |
| `threshold` | string or null | Text describing the limit, so the log is self-explanatory |
| `message` | string or null | Free text |
| `event_id` | string, ≤128 chars | Optional but used |

A `400` here is nearly always one of: `parameter` not in the three allowed
values, `status` not `warning`/`unsafe`, or a `value` sent as a string.

### 5.4 Duplicate-safe event handling

A POST that is retried because the reply was lost must not be stored twice. That
is what `event_id` is for: the Pi has a unique index on it and answers

```json
{"status": "duplicate", "message": "Reading already stored"}
```

with HTTP `200` for a repeat. The firmware therefore:

- generates the event id **once per sample**, as `<device-id>-<boot-id>-<seq>`,
  and reuses the same id for every retry of that sample;
- treats the `200 duplicate` reply as success, and prints
  *"already stored (duplicate event id, not written twice)"* so a run of them is
  visible as what it is — replies being lost on the network.

`event_id` is also safe if the board reboots mid-retry: a new boot gets a new
random boot id, so ids cannot collide across runs.

**Alerts are identified differently, and deliberately so.** A reading is sent
once and dropped if it cannot be sent (see 5.5), so its id only needs to be
stable for the life of one boot. An alert is different: it is persisted to flash
*before* any modem or network work, and then retried across reboots until the
Pi accepts it. Its id is therefore minted **once, when the alert is recorded**,
and stored alongside it — `<device-id>-<8 hex nonce>-<seq>` — and that stored
string is what every retry sends, on this boot and on every later one. An alert
resent after a power cut carries the same id it carried the first time, so the
Pi's duplicate index still recognises it and it is still not stored twice.

If you change the stored alert format, bump `AQSMS_OUTBOX_FORMAT`. A mismatch
discards the *outbox only*, says so loudly on the console, and leaves your
thresholds and SMS recipients untouched — they live under their own flash keys
and are never erased by a format change.

### 5.5 Timeouts, reconnect and retries

| Setting | Default | Behaviour |
|---|---|---|
| `AQSMS_HTTP_TIMEOUT_MS` | 8000 | Connect and read timeout. A powered-off Pi costs 8 s, not minutes. |
| `AQSMS_HTTP_MAX_ATTEMPTS` | 3 | Retries per POST, with the same event id |
| `AQSMS_WIFI_CONNECT_TIMEOUT_MS` | 20000 | Give up on one association attempt |
| `AQSMS_WIFI_RETRY_INTERVAL_MS` | 15000 | Minimum gap between attempts — never a tight spin |
| `AQSMS_SAMPLE_INTERVAL_MS` | 300000 | 5 minutes, matching the app's 288-record, 24-hour history |
| `AQSMS_TIME_RESYNC_INTERVAL_MS` | 3600000 | Hourly clock re-anchor |

Retries apply to transport failures and `5xx` only. A `4xx` means the Pi refused
that exact request, and resending an identical body would be refused
identically — so it is reported and dropped, not retried.

A sample taken while the Wi-Fi is down is **dropped, not queued**. Queueing
would need its own storage and its own duplicate rules, and a stale reading
delivered later is often more misleading than a visible gap.

**Alerts are not dropped.** A threshold breach is recorded in the local outbox —
on flash, before the modem or the network is touched — and pushed to the Pi as
soon as it can be. The outbox survives a reboot, and the order of operations is
fixed: record, persist, *then* send, and update that same record with the
outcome. An alert is never lost because the modem was slow, and a power cut
during an SMS cannot leave the board believing a message it never sent was
delivered.

### 5.6 Timestamps, and why there is no RTC

The ESP32 has no battery-backed real-time clock, and this system deliberately
does not require internet access, so NTP is not available either. Instead the
board reads the Pi's clock — the `timestamp` field in the `/esp32/ping` reply —
and uses it as an origin, adding elapsed milliseconds.

- If the clock has **never** synced, the firmware refuses to post a reading and
  says so on the console. It does not invent a timestamp.
- The clock is re-anchored hourly, because the ESP32's counter drifts.
- Between syncs, the timestamp is only as accurate as that counter. For a
  five-minute sample interval this is well inside the noise of the measurement
  itself, but it is not a precision time source, and this document does not
  claim otherwise.

---

## 6. Sensors: what is not known yet

**No sensor is wired, and the firmware reflects that.** `sensors_read()` returns
every `has*` flag false, so `sample_and_publish()` finds nothing to send and
posts nothing. There is no placeholder conversion, no default pin, and no
"assume a SEN0161" path.

I am specifically **not** assuming any of the following, because assuming them
would produce numbers that look real and are not:

- that the pH probe is a SEN0161, or any particular DFRobot/Atlas part;
- that a temperature probe exists at all, or that it is a DS18B20 rather than an
  analog thermistor;
- that the dissolved-oxygen probe exists, is calibrated, or has temperature
  compensation;
- that the analog interfaces are linear, or that their output span is within the
  ESP32's input range.

### What I need before finalising pin assignments

To assign pins responsibly I need, for the actual hardware:

1. **A clear photo of the board, top and bottom** — or the silkscreen text.
   Useful strings: on the module shield, something like `ESP32-WROOM-32` or
   `ESP32-WROVER-B`; on the board itself, something like `DOIT ESP32 DEVKIT V1`,
   `NodeMCU-32S`, or `ESP32-DevKitC V4` with a revision number. The pinout and
   the available 5 V/3.3 V rails differ between these.
2. **The pin labels exactly as printed**, and which pins are broken out on each
   side. A photo showing the labels is enough.
3. **Where the power rails are**: is there a labelled `5V` (or `VIN`) pin, and a
   `3V3` pin, and does the board have a second `GND` for each?
4. **Each sensor module's part number** as printed on its PCB, and whether its
   interface is analog, I²C, UART or OneWire. These need different pins and
   different libraries.
5. **Each analog module's supply voltage and output span.** A module that runs
   on 5 V and outputs 0–5 V cannot go straight into a 3.3 V ESP32 pin.
6. **Whether each module has an onboard regulator or level shifter** — common on
   the DFRobot-style pH interfaces, absent on bare probes.
7. **What calibration solutions you have** (their pH values, or the DO
   calibration method), and whether the probes have ever been calibrated.
8. **For the DO probe**: does it have an onboard temperature-compensation
   circuit, and does it need a galvanic-isolation board? A DO probe and a pH
   probe sharing a ground path is a well-known source of unstable readings.
9. **For the SIM900**: the exact breakout part number, and how you intend to
   power it. See section 8.

With items 1–3 I can give a safe default pin map for the board. Items 4–8 decide
whether that map is actually usable, and item 9 is separate.

### How a real measurement will enter the payload

The conversion already exists in the sketch; what it lacks is your calibration
data. Fill in section 1.7 for pH and section 1.8 for dissolved oxygen, then set
the matching calibration flag to `1`:

```cpp
#define AQSMS_PH_CALIBRATED          1     // was 0
#define AQSMS_PH_CAL_V1_MV           ...   // BOARD millivolts, divider undone once
#define AQSMS_PH_CAL_V1_PH           4.00f
#define AQSMS_PH_CAL_V2_MV           ...
#define AQSMS_PH_CAL_V2_PH           7.00f
```

Until those flags are `1` the parameter is reported as **not measured** with a
reason, and is omitted from the payload. The `has*` flags are what keep a
missing measurement missing all the way to the database — an uncalibrated pH
probe is never filed as a plausible 7.0.

The DS18B20 needs no configuration beyond its pin: it is detected on the bus at
boot and reported only when a CRC-checked conversion completes.

One more guard worth knowing about: if a conversion ever returns `NaN` or
infinity, `append_measurement()` **omits that parameter** and logs it. It does
not write `null` and it does not write a zero — because a non-finite value is a
sensor fault, and filing it as a measurement of zero would be a lie about the
water.

---

## 7. Alerts on the Pi, SMS on the board

These are two different jobs, and the firmware keeps them apart.

**What the Pi does.** The board POSTs an alert event to `/esp32/alerts`, and the
Pi stores it in `alerts`. It appears in the app's alert list, for either role.

**What the Pi does not do.** The Pi does not send SMS, and has no way to.

**What SMS is.** Sending a text message is the ESP32's own job, in `sms.cpp`,
using a SIM900. It is deliberately independent: it has to work when the Wi-Fi,
the router or the Pi is down, which is exactly when an alert matters most. It
does not go through the Pi and does not depend on the Pi being reachable.

**Thresholds live on the board, and ship unconfigured.** The device key cannot
read the Pi's `thresholds` table — `GET /thresholds` requires a person's JWT —
so the approved limits have to be present locally for the SMS path to work with
the Pi unreachable. They are seeded into flash on first boot only if you set
`AQSMS_THRESHOLDS_CONFIGURED` to `1`, and can be entered from the console with
`setthr` afterwards.

Out of the box the flag is `0` and the Pi's table is `NULL` with `approved = 0`.
Every parameter therefore evaluates to **unknown**: no alert, no SMS, and
nothing described as Safe. That is not an unfinished corner — a limit invented
in the firmware would silently drift from the Pi's copy, and nobody reviewing
the thresholds would see it.

The sequence is: approve real limits **in writing**, then enter them on the
board. `setthr` is an approval step, not a preference.

---

## 8. SIM900: implemented in firmware, unverified on hardware

**The SMS path is now implemented** in section 8 of the sketch: modem bring-up
with autobaud detection, SIM readiness, network registration, signal quality,
`AT+CMGS` transaction handling, bounded retries, per-parameter cooldown and a
minimum gap between messages, recipients persisted in flash, and alert events
recorded locally before they are pushed to the Pi.

It distinguishes five facts that are easy to conflate. The states are ordered
from weakest to strongest, and the strongest outcome wins — so a message that
was actually confirmed delivered can never be displayed as failed:

| State | Evidence |
|---|---|
| **Not attempted** | Nothing was written to the modem — no SIM, no recipients configured, cooldown, or registration lost |
| **Failed** | The modem refused it, or the transaction did not complete |
| **Submitted** | The command and body were written to the modem |
| **Accepted** | The modem answered `+CMGS: <ref>` — handed to the network |
| **Delivered** | A `+CDS` report for *that same `<ref>`* with status 0 — the handset acknowledged |

"Accepted" is not "received". Where a carrier supplies no delivery reports the
message stays at Accepted, and the console says so.

A `+CDS` report is only accepted as confirmation when its message reference
matches the reference the modem returned for this message. A report for another
message — or one with no status field at all — is logged and does not mark this
alert's SMS as delivered.

**None of this has been exercised against a real modem.** It compiles; it has
never transmitted.

The firmware still makes no assumptions about modem power, because the usual
assumption costs hardware:

- A bare SIM900 draws current peaks around **2 A** on a 3.2–4.8 V rail. That is
  the **bare module's** requirement — a carrier board may have its own regulator
  and a completely different input. The firmware contains no modem power code
  for that reason. Check the carrier's documentation.
- Its logic levels are not a clean match for a 3.3 V ESP32, and the direction of
  the mismatch differs between breakouts. Use the carrier's documented level
  interface.
- The ESP32's own peak current during Wi-Fi transmission has to be budgeted
  alongside it, from the same supply.

PWRKEY ships **unassigned**. The firmware will say so on the console rather than
pretend to drive a pin that has no verified keying circuit behind it.

Before wiring: send the carrier board's exact part number and a photo of it, and
a statement of how it will be powered.

---

## 9. Checklist

- [ ] Section 1 of `aqsms_esp32.ino` edited: 2.4 GHz SSID, Pi address, device key, CA certificate
- [x] `node firmware/tests/run-regression.mjs` passes — 69 assertions, 0 failures
- [ ] `arduino-cli compile --fqbn esp32:esp32:esp32` builds
- [ ] Firmware flashed; the serial monitor shows the banner
- [ ] `w` shows the board connected with an address on the Pi's subnet
- [ ] `p` returns `API key accepted. No data was stored.`
- [ ] `t` shows a synced clock
- [ ] `s` reports every parameter as *not measured* — correct while nothing is wired
- [ ] `thr` reports every parameter NOT APPROVED — correct until limits are approved in writing
- [ ] The app still shows **No Data** after all of the above (nothing was stored)
- [ ] Sensor part numbers, board photo and power details sent on, per section 6

The first line is the only one that can be ticked from a desk. Everything below
it needs the board, the Pi, a SIM, or a sensor, and stays unticked until it has
actually been done — see the "not run" list at the end of
`AQSMS-Full-System-Wiring-Guide.md` §13.

That second-to-last line is the useful one: after a successful bring-up the
dashboard must look exactly as empty as it did before, because a connectivity
test that leaves data behind is not a connectivity test.
