# AQSMS — Full-System Materials & Step-by-Step Wiring Guide

Updated: October 9, 2026
Revision: Full-system, matched to the delivered firmware `firmware/aqsms_esp32/aqsms_esp32.ino`.
Status: **NOT an as-built or hardware-tested document.** The firmware has been
compiled; nothing has been uploaded, calibrated, or operated on hardware.

## 1. Scope and limits

Includes ESP32, original SEN0161 pH, SEN0237 dissolved oxygen, waterproof
DS18B20, SIM900 SMS, Raspberry Pi 4B/local SQLite server, Android app, and the
complete solar/battery/power-distribution subsystem.

Critical SMS operates independently of the app, internet, and Pi connectivity,
using valid readings and approved configuration held locally on the board. This
follows the signed AQSMS agreement. Water-level sensors are not in that
agreement's scope.

The supplied SolaPAP guide is an organizational reference only. Its battery
voltage, panel, controller, blower, and wiring are **NOT** applicable here and
must not be copied.

Exact solar manager, panel, battery, regulators, and SIM900 carrier-board
specifications remain unresolved. Their affected connections are marked
**DO NOT CONNECT UNTIL VERIFIED**. Their presence in this document does not
establish that the parts have been supplied.

**What has actually been established.** The firmware compiles cleanly for a
classic ESP32 (§13 records the exact command, versions and result). That is the
only verification that exists. No upload, no probe calibration, no SMS
delivery, no solar charging, and no end-to-end operation has been performed.

## 2. Deliverables and file locations

| Artifact | Location |
|---|---|
| ESP32 firmware — **the entire application, one file** | `firmware/aqsms_esp32/aqsms_esp32.ino` |
| This guide | `AQSMS-Full-System-Wiring-Guide.md` |
| Pi API contract the firmware implements | `pi-server/API_CONTRACT.md` |
| Pi device bring-up reference | `ESP32_TO_PI_SETUP.md` |
| Previous PlatformIO firmware, retired | `archive/esp32-firmware-platformio-2026-10-09/` |

The single-file rule applies to the ESP32 firmware only. It does not apply to
the Pi server or the app.

`firmware/aqsms_esp32/` contains exactly one file. That is intentional: no
custom `.h`/`.cpp`, no extra sketch tabs. DS18B20 handling is implemented inside
the sketch rather than pulling in DallasTemperature, so OneWire is the only
external library.

The previous `esp32-firmware/` PlatformIO project has been removed and
preserved under `archive/`. It is also recoverable from git history.

## 3. Complete materials inventory

| Component | Quantity / specification | Status or purpose |
|---|---|---|
| ESP32 development board | 1; classic WROOM-32 assumed for the GPIO map | **Verify exact board and pin availability** |
| Original DFRobot SEN0161 kit | 1 pH probe, converter, Gravity cable | User-identified model; **verify PCB is not V2** |
| DFRobot SEN0237 DO kit | 1 probe, converter, Gravity cable | Photo-based identification; **verify label** |
| Waterproof DS18B20 probe | 1 | In agreed scope; **verify wire functions** |
| DS18B20 pull-up | 4.7 kΩ initial value | Data to 3.3 V; validate with the actual cable |
| pH divider resistors | 2 × 10 kΩ, preferably 1% | Protective interface — §8 Step 4 |
| SIM900 carrier board | 1 | **Exact variant, connector and UART levels unresolved** |
| GSM antenna | Compatible with module connector/bands | Required for the cellular test |
| SIM card and SMS service/load | Compatible active service | Verify local network support and coverage |
| Modem supply/regulator | Rating selected from carrier documentation | Required dedicated load branch |
| UART level interface | As required by the verified carrier | Do not assume native logic compatibility |
| Modem bypass capacitors | Values/layout from verified documentation | Install near load as applicable |
| Raspberry Pi 4B, 4 GB | 1 | User reports Pi available |
| Pi storage | Existing compatible OS storage | Verify actual installation |
| Pi power supply/regulator and cable | Rated for Pi and attached loads | Verify stable input under load |
| ESP32 USB data cable | 1 | Bench programming/power |
| Local Wi-Fi access point/router | Existing or supplied | **2.4 GHz only** — the ESP32 has no 5 GHz radio |
| Solar panel | Voltage, Voc, current, wattage unknown | **DO NOT CONNECT UNTIL VERIFIED** |
| Solar power manager/charge controller | Exact model unknown | **DO NOT CONNECT UNTIL VERIFIED** |
| Battery pack | Chemistry, series count, voltage, capacity unknown | **DO NOT CONNECT UNTIL VERIFIED** |
| Battery BMS/protection | As required by the actual pack | May be built in; verify before duplicating |
| Load regulators | As required for each rail | Verify input/output and continuous/transient ratings |
| Main load switch | DC-rated for the selected system | Do not interrupt mandatory charging connections blindly |
| Fuses/protection and holders | Ratings from conductors/load design | Source and branch protection as appropriate |
| Power distribution terminals | Rated, insulated, mechanically secure | **Do not route high-current loads through a breadboard** |
| Power wiring/connectors | Sized for current, length, environment | Gauge and fuse ratings unresolved |
| Signal wiring/terminals | Suitable for the interfaces | Follow labels, not colours alone |
| Probe calibration supplies | pH buffers; correct DO electrolyte/membrane; rinse water | Client-supplied under agreement |
| Multimeter and reference thermometer | 1 each | Pre-power checks and calibration |
| DO aeration equipment / clean vessel | For the manufacturer's calibration procedure | Required test setup |
| Enclosure/mounting/strain relief | Client-selected if used | Do not imply a custom waterproof enclosure is included |
| Development machine tooling | Arduino IDE 2.x or `arduino-cli`; ESP32 core; OneWire library | See §13 |

Confirm actual quantities, supplied parts, replacement requirements, and extra
parts before purchasing or assembly. No solar/battery runtime is promised
without an approved load/duration test.

## 4. Confirmed versus unresolved hardware

### 4.1 Confirmed from the project sources

These are established by the Pi server source and the wiring guides, and the
firmware is built against them.

| # | Fact |
|---|---|
| C1 | Device authentication is the `X-API-Key` header, checked against bcrypt hashes in `esp32_keys` |
| C2 | `GET /esp32/ping` stores nothing and returns the `timestamp` that is the board's only clock source |
| C3 | `POST /esp32/readings` accepts `timestamp`, `ph`, `temperature_c`, `dissolved_oxygen_mg_l`, `event_id` |
| C4 | An unmeasured parameter must be omitted or `null`. A body with no measurements is rejected `400`. **Never send `0`** |
| C5 | A repeated `event_id` returns **HTTP 200** `{"status":"duplicate"}` and counts as success |
| C6 | `POST /esp32/alerts` takes `parameter` ∈ `ph`\|`temperature`\|`dissolved_oxygen` and `status` ∈ `warning`\|`unsafe` |
| C7 | **`GET /thresholds` requires a person's JWT** (owner or caretaker). The device key cannot read it — for that reason the approved limits must live on the board |
| C8 | The Pi's `thresholds` table is seeded with `NULL` limits and `approved = 0` |
| C9 | The Pi has **no** SMS capability and stores **no** SMS recipients |
| C10 | Classic ESP32: ADC1 is GPIO32–39; ADC2 conflicts with Wi-Fi |
| C11 | Classic ESP32 has three UARTs; UART2 is remappable to GPIO16/17 |
| C12 | A non-finite conversion result is omitted from the payload, never written as `0` or `null` |

### 4.2 Unresolved — keep marked, do not guess

| # | Item | Blocked connection |
|---|---|---|
| U1 | ESP32 board model (WROOM-32 assumed, unverified) | The whole pin map |
| U2 | Original SEN0161 **versus** SEN0161-V2 | pH 5.00 V rail; whether the divider is needed |
| U3 | SIM900 carrier-board variant | The entire modem path |
| U4 | Modem supply/regulator rating | **DO NOT CONNECT** |
| U5 | Modem UART logic levels | GPIO16/17 level interface |
| U6 | PWRKEY control circuit | Firmware leaves PWRKEY unassigned |
| U7 | Solar manager model and terminal labels | **DO NOT CONNECT** |
| U8 | Panel Voc / Isc / wattage | **DO NOT CONNECT** |
| U9 | Battery chemistry / series / Ah / BMS | **DO NOT CONNECT** |
| U10 | Load regulator models and ratings | All rails |
| U11 | Wire gauge and fuse ratings | Distribution |
| U12 | DS18B20 waterproof probe wire functions | 3-wire power |
| U13 | Actual pH buffer and DO calibration data | All calibration constants |
| U14 | Written approved thresholds | Alerts, SMS and any Safe status |
| U15 | SMS recipient number(s) | SMS delivery |
| U16 | Solar-manager telemetry interface | **No battery percentage is implemented anywhere** |

Item U16 deserves emphasis. The firmware contains **no** battery level, charge
state, or solar telemetry of any kind. No documented interface exists for it,
and a fabricated battery percentage on a dashboard is worse than an empty field.

## 5. GPIO map as compiled

This is the map the delivered firmware is built with. It is still a **proposal
for a classic ESP32-WROOM-32**, not a confirmed as-built map. Check the actual
board, its schematic, its boot behaviour, and pin conflicts before wiring.

| Function | Pin in firmware | Constant | Confirmation needed |
|---|---|---|---|
| DO ADC | GPIO34 (ADC1, input-only) | `AQSMS_PIN_DO_ADC` | Verify board |
| pH ADC | GPIO35 (ADC1, input-only), via divider | `AQSMS_PIN_PH_ADC` | Verify board and divider ratio |
| DS18B20 data | GPIO4 | `AQSMS_PIN_ONEWIRE` | Verify GPIO4 is free on the actual board |
| ESP32 RX from modem TX | GPIO16 | `AQSMS_PIN_MODEM_RX` | **Not valid on a WROVER (PSRAM uses 16/17)** |
| ESP32 TX to modem RX | GPIO17 | `AQSMS_PIN_MODEM_TX` | Same restriction |
| SIM900 PWRKEY | **unassigned (`-1`)** | `AQSMS_PIN_MODEM_PWRKEY` | Carrier schematic/control circuit required |
| Solar/battery telemetry | **unassigned** | — | Only if the hardware provides a documented interface |

Changing a pin means changing it here **and** in the firmware **and** in this
table. Do not let the three drift apart.

Use ADC1 for the classic ESP32's analog channels to avoid the ADC2/Wi-Fi
conflict. ADC pin mappings differ between ESP32 variants; this map is not valid
for ESP32-C3/S3.

## 6. System diagrams

### Data and alerts

```text
SEN0161 pH -> divider -> GPIO35 --+
SEN0237 DO ------------> GPIO34 --+--> ESP32 --> local Wi-Fi/API --> Pi + SQLite --> app
DS18B20 ----------------> GPIO4 --+
                                   |
                                   +--> UART interface --> SIM900 --> SMS recipient
```

No analog signal wire to the Pi exists in this architecture. SMS is not routed
through the Android app, and does not pass through the Pi at all.

### Solar and load power — conceptual only

```text
Solar panel -> verified solar-manager PV input
Battery <----> verified manager BAT terminals / approved battery protection
                        |
               documented load/system output
                        |
              approved protection/distribution
                        |
           +------------+-------------+-------------+
           |            |             |             |
       ESP32 rail   pH 5.00 V     Pi power rail   SIM900 carrier rail
           |
       3.3 V -> DO + DS18B20
```

This is **NOT** permission to attach loads to an arbitrary LOAD/SYS/BAT
terminal. Use the actual manager's specified topology. A battery BMS is not a
substitute for the correct charger.

## 7. Power-rail verification table

| Load | Requirement | Source/connection decision |
|---|---|---|
| DO SEN0237 | Manufacturer supply 3.3–5.5 V; output 0–3.0 V | 3.3 V selected for the bench connection |
| Original SEN0161 | Manufacturer module supply 5.00 V | Verified stable 5.00 V rail |
| DS18B20 | 3.0–5.5 V supply | 3.3 V external-power mode selected |
| ESP32 development board | Depends on the board's power input | Verify the regulated input and onboard regulator |
| Raspberry Pi | Verify manufacturer requirement and actual peripherals | Dedicated correctly rated path; **not from the ESP32** |
| SIM900 carrier | Board-specific input and logic levels | **DO NOT CONNECT UNTIL VERIFIED** |
| Solar manager | Board-specific PV/BAT/SYS limits | **DO NOT CONNECT UNTIL VERIFIED** |

SIMCom's bare SIM900 design specifies a 3.2–4.8 V supply and bursts up to 2 A.
These are **bare-module** requirements, NOT a universal instruction for a
regulated SIM900 development board. The firmware contains no modem power code
precisely because assuming the bare module's numbers for an unknown carrier is
how hardware gets destroyed.

Do not power the SIM900 or the Pi from the ESP32 3V3 pin. Do not assume the
solar manager can carry their combined peak load.

## 8. Assembly — power disconnected first

### Step 1 — Hardware audit

1. Photograph board labels, connectors, and both sides of the solar manager and
   the SIM900 carrier.
2. Record panel Voc and rated output; battery chemistry, series count, maximum
   charged voltage, capacity; BMS; regulator ratings.
3. Check the solar manager's battery compatibility, input limits, outputs,
   protection and charge/load operation.
4. Check the ESP32 variant and its existing pin allocation.
5. Verify all converter and probe wire functions from labels or documentation.
6. Leave unresolved power paths disconnected.

With items 1–3 in hand the draft map in §5 can be finalised. Until then it
stays a draft.

### Step 2 — Begin with a bench-powered sensor subsystem

Use USB for the ESP32 and a verified 5.00 V sensor supply for the original
SEN0161. Leave solar power, modem power and Pi power integration disconnected
until their electrical design is verified.

If USB powers the ESP32 and a separate supply powers the pH board, share ground
but do not tie the separate positive supply to the ESP32 USB/5V rail. Prevent
backfeeding when later changing to system power.

### Step 3 — DO converter

1. With power off, DO `+` to ESP32 3V3; DO `−` to common GND.
2. Leave `A` disconnected from GPIO34 initially.
3. Attach the DO probe to its own converter's BNC socket and lock it.
4. Power and check converter supply and the A-to-ground voltage.
5. Require the output to be within SEN0237's specified 0–3.0 V range.
6. Disconnect power, then connect `A` to GPIO34.

Keep the converter and BNC dry. No divider is required for this confirmed
SEN0237 output on a classic ESP32 at 11 dB attenuation; do not generalise that
to other boards or to the pH channel.

### Step 4 — Original SEN0161 pH

1. With power off, pH `+` to verified 5.00 V, pH `−` to common GND.
2. pH `A` to resistor R1, 10 kΩ.
3. R1's other end to junction J.
4. R2, 10 kΩ, between J and common GND.
5. Leave J disconnected from GPIO35 initially.
6. Attach the pH probe to its own converter's BNC.
7. Power and measure `A` and `J` relative to ground.
8. `J` should be nominally half of `A`; verify it stays within the intended
   0–2.5 V design range for an output up to 5 V.
9. Power off; connect `J` to GPIO35.

```text
pH A -- 10k R1 --+--> GPIO35
                |
              10k R2
                |
               GND
```

This divider is a conservative proposed interface, not the manufacturer's
circuit. The original SEN0161 is not SEN0161-V2. Confirm output behaviour and
loading; calibrate with the divider in place and account for its ratio exactly
once. A regulated V2 module has different specifications.

**How "exactly once" is enforced in the firmware.** The divider ratio appears
in exactly one place: the ADC boundary, converting the junction voltage to the
pH board's own output voltage. Calibration constants are then expressed in
**board millivolts**. Entering junction millivolts into the calibration
constants would apply the divider twice and produce a confident, wrong pH.

### Step 5 — DS18B20 temperature

After confirming wire functions and GPIO4 availability:

1. VDD to 3.3 V.
2. GND to common GND.
3. DQ to GPIO4.
4. Add 4.7 kΩ between DQ and 3.3 V, unless an equivalent pull-up already exists.
5. Use externally powered three-wire operation, not parasite power.
6. Check wiring before power, then test device identification and temperature
   conversions.

```text
3.3 V ----+---------------- DS18B20 VDD
          |
         4.7k
          |
GPIO4 ----+---------------- DS18B20 DQ
GND ----------------------- DS18B20 GND
```

Do not infer waterproof-probe conductor functions from red/black/yellow colours
alone. Pull-up and cable behaviour must be validated for the actual cable
length.

The firmware scans the bus for a DS18B20 family code (`0x28`), verifies the
8-bit ROM CRC and the 9-byte scratchpad CRC, and range-checks the result. A
probe that fails any of those is reported as **not measured** — never as a
stale previous value.

### Step 6 — SIM900 supply and UART

**DO NOT CONNECT UNTIL THE CARRIER BOARD IS VERIFIED.**

1. Obtain its supply/input, UART-level and power-key documentation.
2. Verify a dedicated regulator/load branch, peak-current support, and protection.
3. Verify UART compatibility; select the proper level interface if required.
4. Attach the antenna and SIM with power off, per the board's instructions.
5. Check the supply voltage at the carrier input before attaching it.
6. Connect modem ground to the documented common-ground arrangement.
7. Proposed signal directions, only after verification:
   - SIM900 TX → compatible interface → ESP32 RX GPIO16.
   - ESP32 TX GPIO17 → compatible interface → SIM900 RX.
8. Add PWRKEY/control only per the carrier circuit; **do not assume a direct
   GPIO connection is valid.** The firmware ships with PWRKEY unassigned and
   will say so on the console rather than pretend to drive it.
9. Check the supply during actual transmit bursts, not only at idle.

Do not use thin breadboard jumpers as an assumed adequate high-current modem
power path. Wire size, length and fuse ratings require the actual design.

### Step 7 — Raspberry Pi

1. Use a verified dedicated Pi supply for initial setup.
2. Verify server operation, storage and local network reachability.
3. Later integrate a documented solar-system regulator and cable rated for the
   Pi and its peripherals.
4. Check load voltage and reset/undervoltage behaviour under combined operation.
5. Do not wire the Pi's power input until the chosen supply path is verified.

### Step 8 — Solar manager, battery and load distribution

**DO NOT CONNECT UNTIL EXACT MODELS/RATINGS ARE VERIFIED.**

1. Complete a terminal table for the actual board: PV, BAT, SYS/LOAD, grounds,
   and control/telemetry pins.
2. Check panel Voc against the manager's maximum PV input.
3. Check battery chemistry/series count/charge voltage against charger support.
4. Verify BMS/protection and required source and branch fuses.
5. Select regulators for the full battery voltage range and the combined
   continuous/transient loads.
6. Measure regulator outputs before connecting each load.
7. Connect panel/battery/controller in the manufacturer's specified order; no
   universal order is assumed here.
8. Add one load branch at a time, with power off between changes.
9. Validate charging with loads active only if the actual manager supports it.
10. Test loss of sunlight, restart behaviour, and agreed power continuity under load.

## 9. Calibration

### 9.1 DO

Inspect the membrane and the secondhand probe's history. Use the manufacturer's
specified electrolyte (0.5 mol/L NaOH, corrosive; appropriate gloves and eye
protection). Follow the filling and air-saturated-water calibration procedure,
record the actual temperature and output, and compare with a reference meter
where available. Do not use example constants as probe-specific results.

Record two points for the firmware:

| Point | Meaning | Constant |
|---|---|---|
| 1 | Air-saturated water | `AQSMS_DO_CAL_V1_MV`, `AQSMS_DO_CAL_V1_MGL` |
| 2 | Zero-oxygen solution (usually 0 mg/L) | `AQSMS_DO_CAL_V2_MV`, `AQSMS_DO_CAL_V2_MGL` |
| — | Water temperature during calibration | `AQSMS_DO_CAL_TEMP_C` |
| — | Temperature coefficient, from your own two-temperature work | `AQSMS_DO_TEMP_COEF_PCT_PER_C` |

Temperature compensation is compiled in only when
`AQSMS_DO_TEMP_COMP_ENABLED` is `1`. It ships at `0` because a manufacturer's
example coefficient is not this probe's coefficient, and presenting an
uncompensated number as a compensated one is a wrong number.

With compensation enabled and the DS18B20 unreadable, DO is reported **absent**
rather than silently uncompensated.

### 9.2 pH

Use the original SEN0161 calibration instructions and proper buffers. Keep the
divider installed throughout. Record the buffer value, temperature and stable
ADC voltage.

| Point | Meaning | Constant |
|---|---|---|
| 1 | Buffer 1 | `AQSMS_PH_CAL_V1_MV` (board mV), `AQSMS_PH_CAL_V1_PH` |
| 2 | Buffer 2 | `AQSMS_PH_CAL_V2_MV` (board mV), `AQSMS_PH_CAL_V2_PH` |
| — | Divider ratio actually measured | `AQSMS_PH_DIVIDER_RATIO` |

Then set `AQSMS_PH_CALIBRATED` to `1`. Until it is `1`, the firmware reports pH
as **not measured** and posts nothing for it. This is deliberate: an
uncalibrated pH number that looks plausible is the most dangerous output this
system could produce.

### 9.3 Firmware-level guarantees

Missing, uncalibrated and stale readings are distinguishable and never become
invented numerical values or a Safe status. The firmware reports "not measured"
with the reason rather than a number in every one of those cases.

## 10. Firmware configuration reference

Everything an installer edits is in Section 1 of `aqsms_esp32.ino`. Nothing
below that block needs to change.

### 10.1 Connection and identity

| Constant | Meaning | Ships as |
|---|---|---|
| `AQSMS_WIFI_SSID` / `AQSMS_WIFI_PASSWORD` | 2.4 GHz network | placeholder |
| `AQSMS_PI_HOST` / `AQSMS_PI_PORT` | Pi address; must match the certificate's SAN | placeholder / `8443` |
| `AQSMS_USE_TLS` | `1` = HTTPS with the embedded CA | `1` |
| `AQSMS_DEVICE_ID` | Board name in `event_id`; unsafe characters are replaced rather than emitted | `esp32-pond-1` |
| `AQSMS_DEVICE_API_KEY` | Device key from `setup_account.py --add-esp32-key` | placeholder |
| `AQSMS_PI_CA_PEM` | The Pi's **public** CA certificate | placeholder |

`AQSMS_PI_CA_PEM` holds public certificate data, which is safe to embed. It
must never contain a private key. There is no option to skip certificate
verification, and none should be added: a mode that accepts any certificate
would defeat the purpose of installing one. `setInsecure()` appears nowhere in
the sketch.

**Cold boot needs no clock.** Certificate *validity dates* are not checked in
this build, so a first-boot HTTPS connection works with the system time still at
zero — which matters, because the board's only source of time is the HTTPS ping
itself. This was verified against the installed core rather than assumed:

| Evidence | Finding |
|---|---|
| `tools/sdk/esp32/sdkconfig` | `# CONFIG_MBEDTLS_HAVE_TIME_DATE is not set` |
| `mbedtls/port/include/mbedtls/esp_config.h` | `MBEDTLS_HAVE_TIME_DATE` is defined only under that unset symbol, so it is `#undef`'d |
| `sdkconfig.h` for all four esp32 variants | none define `CONFIG_MBEDTLS_HAVE_TIME_DATE` |

The certificate chain, host name and signature are still verified — only the
"not before / not after" window is skipped. This is a property of the pinned
`esp32:esp32` 2.0.17 core and could change in a future core; if it did, the
failure would be visible rather than silent, because `pi_request()` now appends
the mbedTLS error text to the reason it prints.

### 10.2 Approved thresholds — shipped unconfigured

`AQSMS_THRESHOLDS_CONFIGURED` ships at `0`. In that state every parameter
evaluates to **unknown**: no alert, no SMS, and nothing described as Safe.

Limits are seeded from the compile-time block only on the very first boot, then
live in flash and can be changed from the console. Section 4.1 C7 explains why
they cannot come from the Pi.

The evaluation rule, stated exactly, is:

| Reading | Result |
|---|---|
| inside `[safe_min, safe_max]` | Safe |
| outside safe, inside `[warn_min, warn_max]` | Warning |
| outside `[warn_min, warn_max]` | Unsafe |
| limits not configured | **Unknown** |

`warn_min <= safe_min <= safe_max <= warn_max` is enforced when limits are
entered. An inverted window is rejected rather than stored, because it would
make every reading Safe or Unsafe by accident.

### 10.3 SMS recipients — shipped empty

`AQSMS_SMS_RECIPIENTS_INITIAL` is empty. With no recipient, the firmware
reports "not sent — no recipient configured" rather than failing silently.

### 10.4 Timing

| Constant | Default | Behaviour |
|---|---|---|
| `AQSMS_SAMPLE_INTERVAL_MS` | 300000 | 5 minutes, matching the app's 288-record 24-hour history |
| `AQSMS_HTTP_TIMEOUT_MS` | 8000 | Connect and read timeout |
| `AQSMS_HTTP_MAX_ATTEMPTS` | 3 | Retries per POST, with the same `event_id` |
| `AQSMS_WIFI_CONNECT_TIMEOUT_MS` | 20000 | Give up on one association attempt |
| `AQSMS_WIFI_RETRY_INTERVAL_MS` | 15000 | Minimum gap between attempts — never a tight spin |
| `AQSMS_TIME_RESYNC_INTERVAL_MS` | 3600000 | Hourly clock re-anchor |
| `AQSMS_SMS_COOLDOWN_MS` | 1800000 | Per-parameter alert cooldown |
| `AQSMS_SMS_MIN_GAP_MS` | 60000 | Minimum gap between any two messages |
| `AQSMS_SMS_MAX_ATTEMPTS` | 3 | Bounded retries per recipient |
| `AQSMS_OUTBOX_SLOTS` | 16 | Pending alert records retained across a Pi outage |
| `AQSMS_OUTBOX_FORMAT` | 1 | Stored-outbox layout version. Bump it if the record changes; a mismatch discards the **outbox only** and says so — thresholds and recipients are never erased |

Retries apply to transport failures and `5xx` only. A `4xx` means the Pi refused
that exact request; resending an identical body would be refused identically,
so it is reported and dropped.

A sample taken while Wi-Fi is down is **dropped, not queued**. A stale reading
delivered later is more misleading than a visible gap. Alerts are the exception:
they are recorded locally first and synced when the Pi returns, because losing
an alert record is worse than delaying it.

## 11. Serial console reference

Open the serial monitor at **115200**. The console never prints the Wi-Fi
password or the device API key, and masks recipient numbers to their last three
digits.

| Command | Effect |
|---|---|
| `?` | Command list |
| `w` | Wi-Fi state: SSID, address, gateway, RSSI |
| `p` | `GET /esp32/ping` — proves route and key, **stores nothing** |
| `t` | Clock state and whether it is synced |
| `s` | Take a sample and print it; posts nothing |
| `S` | Take a sample and post it |
| `thr` | Show the approved-limit configuration |
| `setthr <param> <smin> <smax> <wmin> <wmax>` | Store limits locally **and mark approved** |
| `clrthr <param>` | Unapprove one parameter |
| `recip` | Show recipients, masked |
| `addrecip <number>` | Add an E.164 number |
| `clrrecip` | Clear the recipient list |
| `modem` | Modem diagnostics: `CPIN` (six distinct SIM states), `CREG`, `CSQ` |
| `smstest` | Send ONE explicitly authorised test message |
| `outbox` | Show locally recorded alerts: sync state, SMS state, stable event id |
| `flush` | Push pending alerts to the Pi |
| `cfgreset` | Erase stored thresholds, recipients and outbox |
| `reboot` | Restart |

`setthr` is the point at which a limit becomes something this board will act on,
**including by SMS**. Treat it as an approval step, not a preference.

## 12. Modem commissioning and SMS

### 12.1 Bring-up sequence

1. Confirm the modem responds to `AT` (the firmware tries the configured baud,
   then 19200 and 115200, and reports which answered).
2. Check SIM readiness, network registration, and signal quality: `modem`.
   The firmware reads the modem's own `+CPIN: ...` line — not the `OK` that
   follows it — and reports one of six distinct states: `READY`,
   `SIM PIN REQUIRED`, `SIM PUK REQUIRED`, `SIM NOT INSERTED`, `ERROR`, or
   `NO ANSWER (timeout)`. Each gets its own advice; a SIM the modem has
   declared `NOT READY` is reported as not inserted, never as ready.
3. SMS mode is configured automatically (`AT+CMGF=1`, `AT+CSCS="GSM"`,
   `AT+CNMI=2,1,0,1,0`, `AT+CSMP=49,167,0,0` — text mode with delivery reports
   routed to the board).
4. Send an explicitly authorised test to the registered recipient: `smstest`.
5. Read the result state — see 12.2.
6. Verify approved-threshold alerts, bounded retries, cooldown and fault reporting.
7. Repeat the test with Wi-Fi and the Pi unavailable, after valid configuration
   exists locally. **This is the test that matters most.**
8. Confirm alert history synchronisation without retries turning into repeated messages.

### 12.2 Five delivery facts, one vocabulary

The firmware keeps these apart, never promotes one to another, and uses the same
five words in the sending code, in flash, and in what the console prints. They
are ordered weakest to strongest, and the strongest outcome wins.

| State | Meaning | Evidence |
|---|---|---|
| **Not attempted** | Nothing was written to the modem | No SIM, no recipients, cooldown, or registration lost |
| **Failed** | The modem refused it, or the transaction did not complete | Refusal or timeout |
| **Submitted** | The command and body were written to the modem | No confirmation yet |
| **Accepted** | The modem took the message and handed it to the network | `+CMGS: <ref>` |
| **Delivered** | The network reports the handset acknowledged it | A `+CDS` report for **that same `<ref>`** with status 0 |

"Accepted" is not "received". Where the carrier does not supply delivery
reports, a message stays at Accepted and the console says so — it is never
upgraded to Delivered on a guess.

Two rules make the ordering mean something:

- **A delivered message is never displayed as failed.** Because the states are
  ordered and combined with "strongest wins", a later weaker result — a second
  recipient that failed, a retry that timed out — cannot pull a confirmed
  delivery back down. The console prints one word per alert, and it is the
  strongest thing that actually happened.
- **A delivery report is only believed when it matches.** A `+CDS` counts as
  confirmation only if its message reference equals the `<ref>` the modem
  returned for *this* message. A report for a different message, or one with no
  status field at all, is printed and ignored rather than credited to the wrong
  alert.

### 12.2.1 An alert is recorded before it is sent

The order of operations in the alert path is deliberate and fixed:

1. **Record** the alert, minting its `event_id` once and storing it with the
   record.
2. **Persist** it to flash — still before the modem or the network is touched.
3. **Send**, and update that same record with the outcome.

So a power cut in the middle of a blocking `AT+CMGS` cannot lose the alert, and
it cannot leave the board believing a message it never sent was delivered. The
stored id is what every retry sends, on this boot and on every later one, so an
alert resent after a reboot is still recognised by the Pi as the same event and
still not stored twice.

`AQSMS_OUTBOX_FORMAT` versions the stored layout. If it is bumped, a mismatch
discards the **outbox only** and says so on the console; thresholds and SMS
recipients are held under their own flash keys and are never erased by a format
change.

### 12.3 Independence and anti-flood

SMS runs on the ESP32 over the cellular network. It does not touch the Pi API
and keeps working with no Wi-Fi, no router, no Pi and no phone app — which is
exactly when an alert matters. Approved limits and recipients live in flash for
this reason.

A parameter that has alerted stays quiet for its cooldown, and no two messages
ever go out closer together than `AQSMS_SMS_MIN_GAP_MS`. A day of bad water
becomes a series of alerts, not a flood of texts.

The board never fabricates approved settings. Before limits and a recipient are
configured, it sends nothing and says why.

### 12.4 Power

Power the carrier board from its own documented input via a dedicated branch
sized for its transmit bursts. Do not use the ESP32 3V3 pin. Do not copy the
bare SIM900 module's 3.2–4.8 V / 2 A figures onto an unknown carrier — check
the carrier's documentation. PWRKEY is driven by the carrier's own keying
circuit, not by an assumed GPIO.

## 13. Building and flashing the firmware

### 13.1 What was actually compiled

The delivered sketch was compiled with the toolchain already present on this
machine. Recorded verbatim:

| Item | Value |
|---|---|
| Command | `arduino-cli compile --fqbn esp32:esp32:esp32 --warnings all <repo>\firmware\aqsms_esp32` |
| `arduino-cli` | 1.5.1 |
| Platform | `esp32:esp32` 2.0.17 |
| Board (FQBN) | `esp32:esp32:esp32` — classic ESP32 Dev Module |
| Library | `OneWire` 2.3.8 (Paul Stoffregen) |
| Result | **exit 0** |
| Flash use | 960 221 bytes (73%) of 1 310 720 |
| RAM use | 48 628 bytes (14%) of 327 680; 279 052 free for locals |
| Diagnostics in the sketch | 0 warnings, 0 errors |

The only compiler output attributable to a dependency was two benign
`extra tokens at end of #undef directive` warnings inside `OneWire.cpp` — a
known quirk of that library under the ESP32 core's macro definitions. They are
not in this project's code and do not affect behaviour.

### 13.1.1 Logic tests that run without hardware

The parts of the sketch that decide things — SMS state names, `AT+CPIN?`
classification, `+CDS` delivery-report parsing and alert event-id construction —
are written as a dependency-free region between the `@AQSMS-PURE-BEGIN` and
`@AQSMS-PURE-END` markers, so they can be compiled and executed off the board:

```powershell
node firmware/tests/run-regression.mjs
```

`firmware/tests/run-regression.mjs` extracts that region **verbatim** from
`aqsms_esp32.ino` — the tests run the shipped code, not a copy of it, so the two
cannot drift apart — compiles it with the Android NDK's clang targeting
freestanding `wasm32`, and runs it under Node. Result of the last run:

| Item | Value |
|---|---|
| Assertions | **69 passed, 0 failed** |
| Toolchain | NDK clang++ 27.1.12297006 → `wasm32`, `-std=c++17 -O1 -nostdlib` |
| Runtime | Node v24.21.0 |

The suite covers, among others: that a confirmed-delivered message is never
displayed as failed; that `+CPIN: NOT READY` is never classified as READY; that
a `+CDS` report carrying no status field yields no status rather than reading
one out of the `<dt>` timestamp; and that an alert id survives a rebuild
unchanged. It earned its keep immediately — the first run failed on
`+CPIN: NOT READY`, which the original substring check had misread as READY.

This is a test of decision logic only. It says nothing about the ESP32, the
modem, a SIM, a probe or the Pi.

**Compiling and these logic tests are the only verification that exists.**
Nothing in this document claims the firmware has been uploaded, that any probe
has been calibrated, that any SMS has been delivered, or that the system works
end to end.

### 13.2 Flashing

```powershell
# Install the classic ESP32 core if it is not already present:
& "<arduino-cli>" core install esp32:esp32@2.0.17
& "<arduino-cli>" lib install "OneWire@2.3.8"

# Compile
& "<arduino-cli>" compile --fqbn esp32:esp32:esp32 "<repo>\firmware\aqsms_esp32"

# Find the port, then upload
& "<arduino-cli>" board list
& "<arduino-cli>" upload -p <COMx> --fqbn esp32:esp32:esp32 "<repo>\firmware\aqsms_esp32"

# Watch the console
& "<arduino-cli>" monitor -p <COMx> --config baudrate=115200
```

With the Arduino IDE, open `firmware/aqsms_esp32/aqsms_esp32.ino` directly —
the sketch folder name matches the file name, which is what the IDE requires.

### 13.3 Expected first-boot output

1. A banner naming the device and the Pi, and stating plainly that the board is
   not hardware-tested.
2. `[cfg] thresholds UNCONFIGURED ...` and `[cfg] SMS recipient list EMPTY ...`
   — both correct on a fresh board.
3. `[temp] no DS18B20 on GPIO4 — temperature will be reported as NOT MEASURED`
   while nothing is wired.
4. Wi-Fi connection, then the clock anchored from `/esp32/ping`.
5. The command list.

A first boot that reports measurements, or reports anything as Safe, is wrong.
Nothing is wired yet.

## 14. Integrated test matrix

| Test | Required evidence | Run? |
|---|---|---|
| Firmware compiles for the confirmed board | `arduino-cli` output, versions, exit status | **Yes — exit 0, §13.1** |
| Decision logic (states, `+CPIN?`, `+CDS`, event ids) | `run-regression.mjs` output | **Yes — 69/69, §13.1.1** |
| Sensor power/ADC protection | Actual measured supply and signal voltages | **Not run** |
| DO and pH calibration | Recorded real calibration values | **Not run** |
| Temperature | Detected probe and plausible completed conversions | **Not run** |
| Probe interaction | Individual, then combined, water tests | **Not run** |
| SMS | Modem results and recipient receipt | **Not run** |
| Pi communication | Actual API/authentication and database records | **Not run** |
| Phone display | Actual phone/Pi test; truthful missing-data state | **Not run** |
| Offline alerts | SMS works without Pi/app after valid cached configuration | **Not run** |
| Solar charging | Actual manager/battery measurements | **Not run** |
| Power continuity | Approved duration/load and measured result | **Not run** |
| Combined peak loads | Stable supply during modem transmission and Pi activity | **Not run** |

## 15. Troubleshooting

| Symptom | Inspect |
|---|---|
| Wrong analog readings | Pin allocation, ground, attenuation, supply, divider ratio, calibration |
| pH plausible but wrong | Divider applied twice — calibration must be in **board** mV, see §9.2 |
| Temperature unavailable | Probe wire identity, pull-up, cable, device address, conversion completion |
| Temperature reads a stale value | A conversion read before it completed; the 750 ms wait is required |
| "not measured" on a wired probe | Calibration flag still `0`, or the value fell outside the plausibility window |
| No alert despite bad water | Thresholds unconfigured — that is by design until limits are approved |
| SIM900 resets during send | Supply transient response, wiring losses, decoupling, regulator capacity |
| SMS not received | SIM/service, registration, signal, recipient, modem error responses |
| `SIM PIN REQUIRED` / `SIM PUK REQUIRED` | The SIM is locked. The firmware will not guess a PIN — unlock it in a phone first |
| `SIM NOT INSERTED` | Seating, contacts, or the modem's SIM holder; also the answer when the modem reports `NOT READY` |
| Stuck at `Accepted`, never `Delivered` | Expected where the carrier supplies no delivery reports; not a fault |
| An alert reads `not attempted` | A gate refused it and printed why — no SIM, no recipients, cooldown, or registration lost |
| Alert shows a stable id you have seen before | Correct: an alert keeps one identity across retries and reboots so the Pi stores it once |
| `TLS:` on a Pi POST failure | The mbedTLS error text is appended to the reason; check the CA, clock and host name |
| `no '>' prompt` on send | Modem refused `AT+CMGS`; check SIM, registration, and the number's format |
| Pi resets | Supply/cable and combined load behaviour |
| Charging absent | Actual PV/BAT compatibility, polarity, limits and configuration |
| Sensors shift together | Probe interaction, ground paths, supply noise |
| Clock never syncs | Wi-Fi, `/esp32/ping` reachability, and the Pi's clock response |

## 16. Sign-off checklist

- [ ] Every material identified as supplied, missing, or required
- [ ] Solar manager, battery, panel and SIM900 carrier models verified
- [ ] Actual GPIO map approved and conflicts resolved (esp. GPIO16/17 vs PSRAM)
- [ ] No unresolved power connection energised
- [x] Firmware compiled for the confirmed board; result recorded (§13.1)
- [ ] Firmware uploaded to the board
- [ ] Sensors calibrated and individually/collectively tested
- [ ] Approved thresholds entered in writing and stored on the board
- [ ] SMS recipient configured, test message received
- [ ] Offline SMS alert verified with the Pi powered down
- [ ] Actual phone, network and solar tests documented
- [ ] Final as-built guide updated to replace every draft label

## 17. Outstanding information

Required before final power wiring: clear board photos and labels for the solar
manager and SIM900 carrier, the panel label, the battery label and BMS details,
regulator models and ratings, the ESP32 model, probe wire functions, and
confirmation of which pH board is in hand.

Required before the firmware produces measurements: the pH buffer values and
their measured ADC voltages, the DO calibration voltages and temperature, the
measured divider ratio, and the DO temperature coefficient if compensation is
to be used.

Required before any alert or SMS: the approved thresholds in writing, and the
recipient number.

No private keys, passwords, JWT secrets or device API keys should be uploaded as
hardware-reference data.
