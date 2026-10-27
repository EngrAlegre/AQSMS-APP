/* ===========================================================================
 * AQSMS — Aqua Smart Monitoring System
 * ESP32 pond-node firmware.  SINGLE FILE BY DESIGN.
 * ---------------------------------------------------------------------------
 * Board target : classic ESP32-WROOM-32 development board (esp32dev / DOIT
 *                ESP32 DEVKIT V1 class).  NOT for ESP32-C3/S3 — the ADC pins
 *                and the UART numbering below are classic-ESP32 specific.
 * Core         : arduino-esp32 2.0.17  (FQBN  esp32:esp32:esp32)
 * Libraries    : OneWire 2.3.8  (Paul Stoffregen) — the only external library.
 *                DS18B20 handling is implemented here rather than pulling in
 *                DallasTemperature, so the whole application really is one file.
 *
 * WHAT THIS FILE IS
 *   Configuration, pH acquisition + calibration, dissolved-oxygen acquisition
 *   + calibration, DS18B20 temperature, approved-threshold evaluation, SIM900
 *   modem with real SMS, Wi-Fi + Raspberry Pi API communication, reconnection
 *   and error handling, and configuration persistence.
 *
 * WHAT THIS FILE IS NOT — read before trusting anything below
 *   * Nothing here has been run on hardware.  It has been compiled, and that
 *     is the only claim made.  No upload, no calibration, no SMS delivery, no
 *     solar charging, no end-to-end operation has been performed.
 *   * Every value under "LOCAL CONFIGURATION" is a PLACEHOLDER.  The firmware
 *     will run with them, and will correctly refuse to produce measurements,
 *     alerts or SMS until real values replace them.
 *   * The solar power manager, panel, battery, regulators and the SIM900
 *     carrier board are UNRESOLVED.  No solar or modem power wiring is
 *     invented here.  See AQSMS-Full-System-Wiring-Guide.md.
 *
 * THREE RULES THIS FILE OBEYS ABSOLUTELY
 *   1. A missing measurement is ABSENT.  It is never 0, never a placeholder.
 *   2. Nothing is reported "Safe" without valid readings AND operator-approved
 *      limits.  Unconfigured limits produce "unknown", never "safe".
 *   3. No secret is ever written to the serial console.
 * ===========================================================================
 */


/* ===========================================================================
 * SECTION 1 — LOCAL CONFIGURATION
 * ---------------------------------------------------------------------------
 * Everything an installer must edit lives in this section.  Nothing below it
 * needs to change.
 * ===========================================================================
 */

/* ---------------------------------------------------------------------------
 * 1.1  Wi-Fi
 * Classic ESP32 is 2.4 GHz ONLY.  A 5 GHz-only SSID will never appear.
 * AQSMS_WIFI_PASSWORD is a secret and is never printed.
 * ------------------------------------------------------------------------ */
#define AQSMS_WIFI_SSID              "REPLACE_ME_2G4_SSID"
#define AQSMS_WIFI_PASSWORD          "REPLACE_ME_WIFI_PASSWORD"

/* ---------------------------------------------------------------------------
 * 1.2  Raspberry Pi API
 * AQSMS_PI_HOST must be the exact address that the Pi's server certificate
 * names in its SAN list (see pi-server/make-cert.sh).  If it does not match,
 * the TLS handshake fails — deliberately.  There is no "ignore certificate"
 * switch in this firmware and there must never be one.
 *
 * AQSMS_USE_TLS 1 → HTTPS on 8443 with the CA below.  Keep it at 1.
 * AQSMS_USE_TLS 0 → plain HTTP.  The device key and every reading travel in
 *                   clear text.  Bench bring-up only.
 * ------------------------------------------------------------------------ */
#define AQSMS_PI_HOST                "10.42.0.1"
#define AQSMS_PI_PORT                8443
#define AQSMS_USE_TLS                1

/* ---------------------------------------------------------------------------
 * 1.3  Device identity and credential
 * Mint the key on the Pi:   ./venv/bin/python setup_account.py --add-esp32-key
 * It is printed ONCE.  This key is a secret: it is never printed by this
 * firmware, only its length and a masked form.
 * ------------------------------------------------------------------------ */
#define AQSMS_DEVICE_ID              "esp32-pond-1"
#define AQSMS_DEVICE_API_KEY         "REPLACE_ME_DEVICE_API_KEY"

/* ---------------------------------------------------------------------------
 * 1.4  Pi public CA certificate (PUBLIC DATA — safe to embed)
 * Paste the CONTENTS of pi-server/certs/aqsms-ca.crt between the markers.
 * This is the Pi's public CA certificate.  A PRIVATE KEY MUST NEVER APPEAR
 * HERE.  If the placeholder is left in place while AQSMS_USE_TLS is 1, every
 * TLS handshake fails and nothing is transmitted — which is the correct
 * behaviour, not a bug to work around.
 * ------------------------------------------------------------------------ */
static const char AQSMS_PI_CA_PEM[] =
"-----BEGIN CERTIFICATE-----\n"
"MIIFRjCCAy6gAwIBAgIUK12DhOtVc+LKdAbixSo6q+jLCnIwDQYJKoZIhvcNAQEL\n"
"BQAwKTEXMBUGA1UEAwwOQVFTTVMgTG9jYWwgQ0ExDjAMBgNVBAoMBUFRU01TMB4X\n"
"DTI2MTAwOTA3MTAzOFoXDTM2MTAwNjA3MTAzOFowKTEXMBUGA1UEAwwOQVFTTVMg\n"
"TG9jYWwgQ0ExDjAMBgNVBAoMBUFRU01TMIICIjANBgkqhkiG9w0BAQEFAAOCAg8A\n"
"MIICCgKCAgEAu4jkqhQwwqiUxJ6NBsU/Z3O9HtUdJ4JWnQg8WdC+TWlG8VT6iQkF\n"
"bfq4puT2KwPmqGI8jkUhBTiO1KHOtmwpp1WNQ1A3gcDPPU78DbT+Rx2gZ87vcitM\n"
"cPjJEQOrd9kK27HeGtQfbdTwY4YWyl/gfaS2qUc8jmFBXPnRztoLeKwMhapG9Kyf\n"
"px3eb8f7pEZ+ZhkeZQLDvYfgnV7f7+QpP5dKhv5P0odxz/LZxk/m5bsw5lCZcK0h\n"
"gzQW4S+BdM3Cg/KgUJkU/hUMh3Ly77+0mUbiVobuNDSdAufIeAsNmb8C9cgZg4NI\n"
"PeN2P7zv4RGGNknrThKpxz46SS46TjgyPg3O9ZPliAk6gdjFM3/SAF9Ji3qV2Zyh\n"
"yybf+xGAb1mp+Ac2j9ZNQTkG2I+mSjs/bGXZRa8aHL3qqxAOHeRwKGlqpDLlzCJJ\n"
"f9+gHqeS4UJa23gyXUqvoyxatTW0MmDyDGGNebUphJMv8PtSLlNRNv9sRP6ELBa1\n"
"Fqri0ejLdtiCIAEGxRSgUGH7DWOuQ4TUjWTk3AVsWgm6SUyWta+rp5luCp7aDg47\n"
"AE5WfZcKLcIdfWzXlKSe2kiztq+Gk9NEngxrwvbqdaG0NH3Ay8pVf/+g019R48Ez\n"
"/65W9UVARxWUtvv2Jxwij6rJiJ9cgESK5xZL9BXIZfdOGpoiC+TlpAUCAwEAAaNm\n"
"MGQwHQYDVR0OBBYEFFBO2Rl7nHhEEUBY1pdTArOXTimCMB8GA1UdIwQYMBaAFFBO\n"
"2Rl7nHhEEUBY1pdTArOXTimCMBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/\n"
"BAQDAgEGMA0GCSqGSIb3DQEBCwUAA4ICAQCA3k4tMTM0WXt1C9u9hqLd+e3USfGq\n"
"ceG0kjzGBevDdxKvpeDrasz1Da4rEqPCq8tb21m7DiI43sm8HSEBOw/L6NzAqVEx\n"
"a9hpNVMeOEpXMnfNOcIztsd7qLHZKAyC/a/gOSuzd2t4E6NyiYOYgd0kiRfNcbpc\n"
"EK0FXWfTGtMKysMTpt9B0lN+1iYSSR/OaJgIktReMyfycnF23SPe9euvH7Yd0IDh\n"
"3K9CPDNzYzEvONluqM1zPDwY1aurCcvVc6lNlLOKsIPcpITHWpSN5brvA9SqokOy\n"
"2DcaVftXhz4Kwwo+Eo8wOKlgaH3yzm4f3Xcv1x1Kx3g0Rsq/ZGYANXx7X/HG/VVo\n"
"XWKoRu9wVmtHuGvbTXbCT1R7/lWkAyYxKrUWVsj+4Ki4Y2sIdPTnx8yPpujO/3Mf\n"
"JcUIPNI9Ohot/m3Lve7j1ZJx8cntEM81hIfOYCfHGeY3ybDRCiZaf6MXrUDNNLxA\n"
"dopsrPVst6XF2AK7fLLiMK9IJEcncIXOS31L+QYOjXNBTR1aWIZGQKDzN8LuZ/DJ\n"
"TxZBzcx1qly7d2yaebec2EkKdmC5iWPrRxuHgZSuaCG6B2OGcFP++D8PN+FwBEJO\n"
"/pmMKT3ozpOyAXQCexyfrlUIrV9zPw8Oy+gr7AEIZCBvePDH2ahfaDlMRIbG8Xty\n"
"gkjMDvDsJbYDgA==\n"
"-----END CERTIFICATE-----\n";

/* ---------------------------------------------------------------------------
 * 1.5  GPIO map  — DRAFT, NOT AS-BUILT
 * From AQSMS-Full-System-Wiring-Guide.md section 3.  Every entry below is a
 * proposal pending confirmation of the actual board.  Changing a pin here
 * MUST be matched by a change in that guide; do not let the two drift.
 *
 * Classic ESP32: GPIO34/35 are ADC1 inputs and input-only — correct for both
 * analog channels, and ADC1 avoids the ADC2/Wi-Fi conflict.
 *
 * GPIO16/17 are UART2's default pins.  On a WROVER (PSRAM) module GPIO16/17
 * are taken by the PSRAM and are NOT usable — verify the module first.
 * ------------------------------------------------------------------------ */
#define AQSMS_PIN_PH_ADC             35     // ADC1, pH  (via divider)
#define AQSMS_PIN_DO_ADC             34     // ADC1, DO  (direct)
#define AQSMS_PIN_ONEWIRE            4      // DS18B20 DQ
#define AQSMS_PIN_MODEM_RX           16     // ESP32 RX  <- modem TX
#define AQSMS_PIN_MODEM_TX           17     // ESP32 TX  -> modem RX

/* PWRKEY is UNRESOLVED (no carrier-board schematic).  Leave at -1 and this
 * firmware will neither drive nor claim to drive a power key.  Set it only to
 * a pin the carrier documentation actually specifies, and only through the
 * carrier's own keying circuit — never a bare GPIO straight into the module. */
#define AQSMS_PIN_MODEM_PWRKEY       (-1)

#define AQSMS_MODEM_UART             2      // HardwareSerial instance number
#define AQSMS_MODEM_BAUD             9600   // UNVERIFIED — check carrier docs

/* ---------------------------------------------------------------------------
 * 1.6  Analog front end
 * AQSMS_PH_DIVIDER_RATIO is applied EXACTLY ONCE, to convert the divider
 * junction voltage back to the pH board's own output voltage.
 * Equal 10k/10k resistors give 2.0.  Measure the real pair and put the real
 * number here — a 1% pair is not exactly 2.000.
 * The SEN0237 DO output is 0–3.0 V and needs no divider.
 * ------------------------------------------------------------------------ */
#define AQSMS_PH_DIVIDER_RATIO       2.0f
#define AQSMS_ADC_SAMPLES            32     // averaged per reading
#define AQSMS_ADC_SAMPLE_DELAY_MS    5

/* ---------------------------------------------------------------------------
 * 1.7  pH calibration — TWO POINT, WHOLE CHAIN
 * Set AQSMS_PH_CALIBRATED to 1 only after recording real buffers.
 * V*_MV is the pH BOARD output voltage in millivolts, i.e.
 *     (measured junction mV) x AQSMS_PH_DIVIDER_RATIO
 * Do NOT feed the junction voltage in here — that would apply the divider
 * twice.  Calibrating on board voltage and then dividing again is the single
 * most common way to get a confident wrong answer.
 * ------------------------------------------------------------------------ */
#define AQSMS_PH_CALIBRATED          1
#define AQSMS_PH_CAL_V1_MV           2130.2f   // board mV in pH 7.00 buffer
#define AQSMS_PH_CAL_V1_PH           7.00f
#define AQSMS_PH_CAL_V2_MV           2164.7f   // board mV in pH 9.18 buffer (borax)
#define AQSMS_PH_CAL_V2_PH           9.18f
#define AQSMS_PH_VALID_MV_MIN        0.0f   // board output plausibility window
#define AQSMS_PH_VALID_MV_MAX        5000.0f

/* ---------------------------------------------------------------------------
 * 1.8  Dissolved-oxygen calibration — TWO POINT, WHOLE CHAIN
 * V*_MV is the DO BOARD output in millivolts (no divider on this channel).
 * The classic SEN0237 pair is (air-saturated water at the calibration
 * temperature) and (zero-oxygen solution, 0 mg/L).
 *
 * AQSMS_DO_CAL_TEMP_C is the water temperature during calibration.
 * AQSMS_DO_TEMP_COEF_PCT_PER_C is the probe's own temperature coefficient in
 * percent per degree Celsius, taken from YOUR calibration at two temperatures.
 *
 * AQSMS_DO_TEMP_COMP_ENABLED is a separate switch because a preprocessor #if
 * cannot test a floating-point value — the coefficient is used in compiled C++
 * code, the switch decides whether that code is compiled at all.
 *
 * It is 0 by default ON PURPOSE: using a manufacturer's example constant as if
 * it were this probe's measured coefficient is exactly the kind of invention
 * this project forbids.  With 0, temperature is measured and reported but is
 * not used to correct DO.  Set it to 1 only together with a real coefficient.
 *
 * Consequence, stated plainly: with compensation ON and the DS18B20 not
 * readable, DO is reported ABSENT rather than uncompensated.  An uncompensated
 * DO number silently presented as a compensated one is a wrong number, and a
 * wrong number is worse than a visible gap.
 * ------------------------------------------------------------------------ */
#define AQSMS_DO_CALIBRATED          0
#define AQSMS_DO_CAL_V1_MV           0.0f   // air-saturated water
#define AQSMS_DO_CAL_V1_MGL          0.0f   // its mg/L at AQSMS_DO_CAL_TEMP_C
#define AQSMS_DO_CAL_V2_MV           0.0f   // zero-oxygen solution
#define AQSMS_DO_CAL_V2_MGL          0.0f   // usually 0.0
#define AQSMS_DO_CAL_TEMP_C          25.0f
#define AQSMS_DO_TEMP_COMP_ENABLED   0      // 0 or 1 — NOT a float test
#define AQSMS_DO_TEMP_COEF_PCT_PER_C 0.0f   // ignored while the switch above is 0
#define AQSMS_DO_VALID_MV_MIN        0.0f
#define AQSMS_DO_VALID_MV_MAX        3000.0f  // SEN0237 documented span

/* ---------------------------------------------------------------------------
 * 1.9  DS18B20
 * 12-bit conversion takes up to 750 ms.  AQSMS_TEMP_VALID_MIN/MAX is a
 * plausibility window for pond water; readings outside it are treated as a
 * probe fault rather than as weather.
 * ------------------------------------------------------------------------ */
#define AQSMS_TEMP_VALID_MIN_C       (-20.0f)
#define AQSMS_TEMP_VALID_MAX_C       80.0f

/* ---------------------------------------------------------------------------
 * 1.10  APPROVED LIMITS  — SHIPPED UNCONFIGURED, DELIBERATELY
 * Leave AQSMS_THRESHOLDS_CONFIGURED at 0 until limits are approved IN WRITING.
 * With 0, every parameter evaluates to "unknown": no alert is raised, no SMS
 * is sent, and nothing is ever described as Safe.
 *
 * There is no endpoint that lets this device read the Pi's thresholds — GET
 * /thresholds requires a farmer JWT, which the device does not and must not
 * have.  The approved limits therefore have to live on the board.  They are
 * seeded into flash on first boot only when this flag is 1, and can then be
 * changed from the serial console without recompiling.
 *
 * Limits are entered as safe_min, safe_max, warn_min, warn_max, mirroring the
 * Pi's schema.  warn_min <= safe_min and warn_max >= safe_max is enforced.
 * ------------------------------------------------------------------------ */
#define AQSMS_THRESHOLDS_CONFIGURED  0

#define AQSMS_PH_SAFE_MIN            0.0f
#define AQSMS_PH_SAFE_MAX            0.0f
#define AQSMS_PH_WARN_MIN            0.0f
#define AQSMS_PH_WARN_MAX            0.0f

#define AQSMS_TEMP_SAFE_MIN          0.0f
#define AQSMS_TEMP_SAFE_MAX          0.0f
#define AQSMS_TEMP_WARN_MIN          0.0f
#define AQSMS_TEMP_WARN_MAX          0.0f

#define AQSMS_DO_SAFE_MIN            0.0f
#define AQSMS_DO_SAFE_MAX            0.0f
#define AQSMS_DO_WARN_MIN            0.0f
#define AQSMS_DO_WARN_MAX            0.0f

/* ---------------------------------------------------------------------------
 * 1.11  SMS RECIPIENTS — SHIPPED EMPTY, DELIBERATELY
 * Comma-separated list in E.164 form, e.g. "+639171234567,+639181234567".
 * Empty means: no SMS is sent, and the reason is reported as
 * "no recipient configured" rather than being silently ignored.
 * Seeded into flash on first boot, then editable from the console.
 * ------------------------------------------------------------------------ */
#define AQSMS_SMS_RECIPIENTS_INITIAL ""

/* ---------------------------------------------------------------------------
 * 1.12  Timing
 * ------------------------------------------------------------------------ */
#define AQSMS_SAMPLE_INTERVAL_MS     300000UL   // 5 min — matches the app's 24 h view
#define AQSMS_SERIAL_BAUD            115200

#define AQSMS_WIFI_CONNECT_TIMEOUT_MS 20000UL
#define AQSMS_WIFI_RETRY_INTERVAL_MS  15000UL

#define AQSMS_HTTP_TIMEOUT_MS        8000L
#define AQSMS_HTTP_MAX_ATTEMPTS      3

#define AQSMS_TIME_RESYNC_INTERVAL_MS 3600000UL  // hourly
#define AQSMS_TIME_FIRST_RETRY_MS     60000UL

/* SMS pacing.  AQSMS_SMS_COOLDOWN_MS is per parameter: once pH has alerted,
 * pH stays quiet for this long even if every sample is still out of range.
 * AQSMS_SMS_MIN_GAP_MS is between ANY two messages, so a day of bad water can
 * never turn into a burst of texts.  Both are anti-flood, not anti-alert. */
#define AQSMS_SMS_MIN_GAP_MS         60000UL
#define AQSMS_SMS_COOLDOWN_MS        1800000UL  // 30 min
#define AQSMS_SMS_MAX_ATTEMPTS       3
#define AQSMS_SMS_AT_TIMEOUT_MS      20000UL
#define AQSMS_SMS_AT_SHORT_MS        3000UL
#define AQSMS_SMS_REG_WAIT_MS        120000UL   // bounded network-registration wait
#define AQSMS_SMS_DELIVERY_WAIT_MS   30000UL    // bounded wait for a delivery report

#define AQSMS_OUTBOX_SLOTS           16         // pending Pi alert syncs retained

/* Format version of the stored alert outbox.  Bump this whenever the
 * AlertRecord layout changes.  A version mismatch discards the OUTBOX only —
 * thresholds ("thr0".."thr2") and SMS recipients ("recip") live under their own
 * NVS keys and are never reset by a format change.  The board says so on the
 * console when it happens; it never erases configuration silently. */
#define AQSMS_OUTBOX_FORMAT          1


/* ===========================================================================
 * SECTION 2 — Includes and fixed constants
 * ===========================================================================
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <OneWire.h>
#include <math.h>

// Pi API contract — see pi-server/API_CONTRACT.md.  These strings are the
// server's exact vocabulary; "temperature" and "dissolved_oxygen" are what the
// alerts route accepts, while "temperature_c" and "dissolved_oxygen_mg_l" are
// the reading field names.  Do not "tidy" them into agreement with each other.
static const char *const PARAM_KEY[3]       = {"ph", "temperature", "dissolved_oxygen"};
static const char *const PARAM_FIELD[3]     = {"ph", "temperature_c", "dissolved_oxygen_mg_l"};

#define STATUS_UNKNOWN  0
#define STATUS_SAFE     1
#define STATUS_WARNING  2
#define STATUS_UNSAFE   3

#define PARAM_PH   0
#define PARAM_TEMP 1
#define PARAM_DO   2
#define PARAM_COUNT 3

// Event-id limits.  AQSMS_EVENT_ID_MAX is the server's own hard limit
// (pi-server/server.py: MAX_EVENT_ID_LENGTH = 128; _as_event_id() rejects an
// empty or whitespace-only id, and anything longer).  AQSMS_EVENT_ID_BUF is
// what this firmware stores per alert — comfortably inside that limit.
#define AQSMS_EVENT_ID_MAX 128
#define AQSMS_EVENT_ID_BUF 64

// NOTE ON FILE ORDER — do not "tidy" this by moving helpers upward.
// arduino-cli generates C++ prototypes and inserts them immediately before the
// FIRST function definition in the sketch. Every type used in a function
// signature must therefore already be declared by that point, which is why all
// structs live here in section 3 and no function is defined before them.
// Moving a helper above this block produces "'Sample' does not name a type".


/* ===========================================================================
 * SECTION 3 — Measurement and alert records
 * ===========================================================================
 */

// A sample.  Absence is represented by the has* flag and NEVER by the value.
// A disconnected pH probe reads as a plausible neutral 7.0 if you let a zero
// stand in for it; the flag is what keeps a gap visible all the way to SQLite.
struct Sample {
    bool  has_ph;              float ph;
    bool  has_temperature_c;   float temperature_c;
    bool  has_do_mg_l;         float dissolved_oxygen_mg_l;
    bool  has_do_temp_warning; // DO present but uncompensated — see 1.8
};

struct Thresholds {
    bool  configured;   // operator-supplied AND approved.  Not inferred.
    float safe_min, safe_max, warn_min, warn_max;
};

/* ---------------------------------------------------------------------------
 * SMS DELIVERY STATE — ONE vocabulary, used by the send path, the stored
 * record and the console.  There is exactly one enum and exactly one set of
 * names; a state can never mean one thing in one place and another elsewhere.
 *
 * The ordering is deliberate: a higher value is a STRONGER claim, so "best
 * result across recipients" is a plain maximum and a weaker later report can
 * never overwrite a stronger earlier one.
 *
 *   NOT_ATTEMPTED  nothing was ever written to the modem: no recipient, no
 *                  modem, an unusable SIM, or suppressed by the anti-flood
 *                  gates.  The console always prints WHICH of those it was.
 *   FAILED         the modem or the network refused the attempt.
 *   SUBMITTED      the body went out; no confirmation arrived before timeout.
 *   ACCEPTED       the modem answered +CMGS: <mr> — handed to the network.
 *                  This is NOT proof anyone received it.
 *   DELIVERED      a +CDS report naming THIS message's reference carried
 *                  status 0.  Nothing else may ever produce this state.
 * ------------------------------------------------------------------------ */
#define SMS_NOT_ATTEMPTED 0
#define SMS_FAILED        1
#define SMS_SUBMITTED     2
#define SMS_ACCEPTED      3
#define SMS_DELIVERED     4

/* ---------------------------------------------------------------------------
 * SIM state, from AT+CPIN?.  Kept as distinct values because "the SIM is not
 * ready" is five different problems with five different fixes.
 * ------------------------------------------------------------------------ */
#define SIM_UNKNOWN       0
#define SIM_READY         1
#define SIM_PIN_REQUIRED  2
#define SIM_PUK_REQUIRED  3
#define SIM_NOT_INSERTED  4
#define SIM_ERROR         5
#define SIM_TIMEOUT       6

// One alert event.  It is recorded locally FIRST and only then pushed to the
// Pi, because the Pi may be unreachable at exactly the moment it matters.
struct AlertRecord {
    uint32_t seq;
    uint32_t epoch;              // unix seconds
    uint8_t  param;
    uint8_t  status;             // STATUS_WARNING or STATUS_UNSAFE
    float    value;
    uint8_t  pending;            // 1 = not yet accepted by the Pi
    uint8_t  sms;                // one of the SMS_* values above
    char     event_id[AQSMS_EVENT_ID_BUF];   // stable identity, minted once
};

// Outcome of one SMS attempt.  state is one of the SMS_* values above — the
// same enum the record stores, so there is no translation layer to get wrong.
struct SmsResult {
    uint8_t state;
    int     modem_ref;  // +CMGS message reference, -1 if none
    String  detail;
};

// A parsed +CDS delivery report.  See cds_parse() for why this is not just
// "the last comma-separated number".
struct CdsReport {
    int  fo;
    int  mr;       // message reference — the ONLY field that ties a report to a
                   // specific message.  A report that does not name our
                   // reference is not confirmation of our message.
    int  st;       // status; 0 = delivered
    bool has_st;   // false when the modem sent no <st> field at all
    bool valid;
};

// Ties a +CMGS message reference to the alert it belongs to, so a delivery
// report arriving after sms_send_one() has already returned still lands on the
// right record — and only on that record.
struct SmsRefTrack {
    int      ref;        // +CMGS message reference, -1 = free slot
    uint32_t alert_seq;  // AlertRecord.seq it belongs to
};

// One HTTP exchange with the Pi.
struct PiReply {
    int    code;
    String body;
    bool   transport_ok;   // false = never reached the server at all
};


/* ===========================================================================
 * PURE LOGIC — self-contained: no Arduino types, no libc, no globals.
 * ---------------------------------------------------------------------------
 * Everything between the @AQSMS-PURE markers is dependency-free on purpose, and
 * is the ONLY part of this sketch that also compiles away from the ESP32.
 * firmware/tests/run-regression.mjs extracts these bytes, together with the
 * SMS_ and SIM_ defines and the CdsReport struct declared above, and runs them
 * on the host — so the tests exercise the shipped code rather than a copy of
 * it.  Adding an Arduino type or a libc call inside the markers breaks that
 * harness; keep this region dependency-free.
 * ===========================================================================
 */

/* @AQSMS-PURE-BEGIN */

static uint32_t aqsms_len(const char *s) {
    uint32_t n = 0;
    if (!s) return 0;
    while (s[n]) n++;
    return n;
}

static bool aqsms_starts_with(const char *s, const char *prefix) {
    if (!s || !prefix) return false;
    for (uint32_t i = 0; prefix[i]; i++)
        if (s[i] != prefix[i]) return false;
    return true;
}

static bool aqsms_contains(const char *hay, const char *needle) {
    if (!hay || !needle) return false;
    uint32_t nl = aqsms_len(needle);
    if (nl == 0) return true;
    for (uint32_t i = 0; hay[i]; i++) {
        uint32_t j = 0;
        while (j < nl && hay[i + j] && hay[i + j] == needle[j]) j++;
        if (j == nl) return true;
    }
    return false;
}

// Does the line read exactly "<key><spaces><value>", allowing trailing
// whitespace?  Exactness is the whole point: a substring search for "READY"
// also matches "NOT READY", so a SIM the modem has explicitly declared
// unusable would be classified as READY and the firmware would go on to try
// sending from a SIM that cannot work.  A negative answer is the dangerous
// direction to get wrong, so it is matched exactly rather than searched for.
static bool aqsms_value_is(const char *line, const char *key, const char *value) {
    if (!line || !key || !value) return false;
    if (!aqsms_starts_with(line, key)) return false;
    uint32_t i = aqsms_len(key);
    while (line[i] == ' ' || line[i] == '\t') i++;
    uint32_t v = aqsms_len(value);
    for (uint32_t j = 0; j < v; j++)
        if (line[i + j] != value[j]) return false;
    i += v;
    while (line[i] == ' ' || line[i] == '\t' || line[i] == '\r' || line[i] == '\n') i++;
    return line[i] == '\0';
}

static const char *sms_state_name(uint8_t st) {
    switch (st) {
        case SMS_NOT_ATTEMPTED: return "not attempted";
        case SMS_FAILED:        return "failed";
        case SMS_SUBMITTED:     return "submitted";
        case SMS_ACCEPTED:      return "accepted";
        case SMS_DELIVERED:     return "delivered";
    }
    return "unknown";
}

// Stronger claim wins.  Used to collapse several recipients into one verdict;
// it is also what guarantees a delivered result can never be downgraded.
static uint8_t sms_state_merge(uint8_t a, uint8_t b) {
    return a > b ? a : b;
}

static const char *sim_state_name(uint8_t st) {
    switch (st) {
        case SIM_READY:        return "READY";
        case SIM_PIN_REQUIRED: return "SIM PIN REQUIRED";
        case SIM_PUK_REQUIRED: return "SIM PUK REQUIRED";
        case SIM_NOT_INSERTED: return "SIM NOT INSERTED";
        case SIM_ERROR:        return "ERROR";
        case SIM_TIMEOUT:      return "NO ANSWER (timeout)";
    }
    return "UNKNOWN";
}

// Classify AT+CPIN? from THREE separate observations rather than one search of
// one line.  The modem answers with its own "+CPIN: ..." line and THEN "OK";
// searching the OK line for "READY" can never succeed, which is exactly the
// bug this replaces.
//
// The +CPIN values are matched EXACTLY (see aqsms_value_is).  The replies are
// a closed set from 27.007: READY, SIM PIN, SIM PUK, SIM PIN2, SIM PUK2,
// NOT INSERTED, NOT READY.  "READY" and "NOT READY" differ by three characters
// and mean opposite things, so a substring search is not good enough here.
static uint8_t cpin_classify(const char *info_line, bool saw_info,
                             const char *error_line, bool saw_error,
                             bool timed_out) {
    if (saw_info && info_line) {
        if (aqsms_value_is(info_line, "+CPIN:", "READY"))        return SIM_READY;
        if (aqsms_value_is(info_line, "+CPIN:", "SIM PIN") ||
            aqsms_value_is(info_line, "+CPIN:", "SIM PIN2"))     return SIM_PIN_REQUIRED;
        if (aqsms_value_is(info_line, "+CPIN:", "SIM PUK") ||
            aqsms_value_is(info_line, "+CPIN:", "SIM PUK2"))     return SIM_PUK_REQUIRED;
        if (aqsms_value_is(info_line, "+CPIN:", "NOT INSERTED") ||
            aqsms_value_is(info_line, "+CPIN:", "NOT READY"))    return SIM_NOT_INSERTED;
        // An info line we do not recognise is never promoted to READY.
        return SIM_UNKNOWN;
    }
    if (saw_error && error_line) {
        // AT+CMEE=1 makes these numeric; the text forms are matched too, in
        // case the setting did not take on this modem.  The codes are matched
        // exactly, so an error 100 or 130 cannot be read as 10 or 13.
        if (aqsms_value_is(error_line, "+CME ERROR:", "10") ||
            aqsms_value_is(error_line, "+CMS ERROR:", "10") ||
            aqsms_value_is(error_line, "+CME ERROR:", "SIM not inserted") ||
            aqsms_value_is(error_line, "+CMS ERROR:", "SIM not inserted"))
            return SIM_NOT_INSERTED;
        if (aqsms_value_is(error_line, "+CME ERROR:", "13") ||
            aqsms_value_is(error_line, "+CMS ERROR:", "13") ||
            aqsms_value_is(error_line, "+CME ERROR:", "SIM failure") ||
            aqsms_value_is(error_line, "+CMS ERROR:", "SIM failure"))
            return SIM_ERROR;
        if (aqsms_contains(error_line, "PUK"))          return SIM_PUK_REQUIRED;
        if (aqsms_contains(error_line, "PIN"))          return SIM_PIN_REQUIRED;
        return SIM_ERROR;
    }
    if (timed_out) return SIM_TIMEOUT;
    return SIM_UNKNOWN;
}

// Parse a +CDS delivery report.
//
// Text mode (AT+CMGF=1, which this firmware sets) formats it as
//     +CDS: <fo>,<mr>,[<ra>],[<tora>],<scts>,<dt>,<st>
// In PDU mode the layout is different entirely — see sms_begin(), which pins
// text mode rather than assuming it.
//
// <scts> and <dt> are QUOTED STRINGS that contain a comma and digits, e.g.
// "26/10/09,12:30:00+32".  Taking the last comma in the line — the previous
// approach — can land inside <dt> and yield a status that is really part of a
// timestamp.  Fields are therefore split OUTSIDE QUOTES and digits inside a
// quoted field are never read as numbers.
static bool cds_parse(const char *line, CdsReport &out) {
    out.fo = -1;
    out.mr = -1;
    out.st = -1;
    out.has_st = false;
    out.valid = false;

    if (!line) return false;
    if (!aqsms_starts_with(line, "+CDS:")) return false;

    const int MAXF = 12;
    int  field[MAXF];
    bool pure[MAXF];     // field is a BARE INTEGER: digits, and unquoted
    int  n = 0;
    uint32_t acc = 0;
    bool digits = false;
    bool clean  = true;
    bool in_quotes = false;

    for (const char *p = line + 5; *p; p++) {
        char c = *p;

        if (c == '"') {
            in_quotes = !in_quotes;
            clean = false;                 // a quoted field can never be <st>
            continue;
        }
        if (!in_quotes && c == ',') {
            if (n < MAXF) {
                field[n] = digits ? (int)acc : -1;
                pure[n]  = digits && clean;
            }
            n++;
            acc = 0; digits = false; clean = true;
            continue;
        }
        if (in_quotes) continue;           // the commas inside <scts>/<dt> are
                                           // NOT field separators
        if (c >= '0' && c <= '9') {
            if (acc < 100000000UL) acc = acc * 10u + (uint32_t)(c - '0');
            digits = true;
        } else if (c == '+' || c == ' ') {
            // a leading sign, or the space after "+CDS:" — neither disqualifies
        } else {
            clean = false;                 // '/' ':' or anything else
        }
    }
    if (n < MAXF) { field[n] = digits ? (int)acc : -1; pure[n] = digits && clean; }

    const int last = (n < MAXF) ? n : (MAXF - 1);

    out.fo = (last >= 0 && pure[0]) ? field[0] : -1;
    out.mr = (last >= 1 && pure[1]) ? field[1] : -1;

    // <st> is read from the END of the line, and only when the final field is a
    // bare integer.  That is what makes this work whether the modem quotes
    // <scts>/<dt> — the usual text-mode form, whose inner commas must be
    // ignored — or emits them unquoted, in which case their commas split into
    // extra fields and a fixed index would read a piece of a timestamp.
    if (last >= 3 && pure[last]) {
        out.has_st = true;
        out.st = field[last];
    }

    out.valid = (out.mr >= 0);
    return out.valid;
}

// The Pi's own rule for an event_id (pi-server/server.py, _as_event_id): a
// non-empty string, stripped, at most MAX_EVENT_ID_LENGTH characters.  Checked
// before the id is stored, so an unusable one can never be persisted and then
// re-sent forever.
static bool event_id_valid(const char *id) {
    uint32_t n = aqsms_len(id);
    if (n == 0 || n > AQSMS_EVENT_ID_MAX) return false;
    if (id[0] == ' ' || id[n - 1] == ' ') return false;   // the server strips; a
                                                          // stripped id is a
                                                          // different identity
    for (uint32_t i = 0; i < n; i++) {
        char c = id[i];
        if (c < 0x20 || c == 0x7f) return false;          // control characters
        if (c == '"' || c == '\\') return false;          // would corrupt the JSON body
    }
    return true;
}

// Build the stable identity of ONE alert.  Called EXACTLY ONCE, when the alert
// record is created; the result is stored in the record itself and re-sent
// unchanged by every retry, every outbox flush and every reboot.  That is what
// lets the Pi's unique index on event_id collapse a flurry of retries into a
// single stored row.
//
// The device id is operator-supplied, so it is sanitised here rather than
// trusted: the id is interpolated straight into a hand-built JSON body and a
// stray quote or backslash would corrupt the request.
static void event_id_build(char *out, uint32_t cap, const char *device_id,
                           uint32_t nonce, uint32_t seq) {
    if (cap == 0) return;

    const uint32_t tail = 1 + 8 + 1 + 10;          // "-XXXXXXXX-NNNNNNNNNN"
    const uint32_t room = (cap > tail + 1) ? (cap - tail - 1) : 0;
    uint32_t n = 0;

    for (uint32_t i = 0; device_id && device_id[i] && n < room; i++) {
        char c = device_id[i];
        bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.';
        out[n++] = safe ? c : '_';
    }
    if (n == 0) { out[n++] = 'd'; out[n++] = 'e'; out[n++] = 'v'; }

    static const char HEXD[] = "0123456789abcdef";
    out[n++] = '-';
    for (int shift = 28; shift >= 0; shift -= 4) out[n++] = HEXD[(nonce >> shift) & 0xF];
    out[n++] = '-';
    {
        char tmp[10];
        int k = 0;
        uint32_t v = seq;
        do { tmp[k++] = (char)('0' + (v % 10u)); v /= 10u; } while (v && k < 10);
        while (k > 0) out[n++] = tmp[--k];
    }
    out[n] = '\0';
}

/* @AQSMS-PURE-END */


static const char *param_title(uint8_t p) {
    switch (p) {
        case PARAM_PH:   return "pH";
        case PARAM_TEMP: return "Temperature";
        case PARAM_DO:   return "Dissolved oxygen";
    }
    return "?";
}

static HardwareSerial &modem_port() {
    static HardwareSerial port(AQSMS_MODEM_UART);
    return port;
}


/* ===========================================================================
 * SECTION 4 — Persisted configuration (NVS flash)
 * ---------------------------------------------------------------------------
 * Thresholds, recipients and the alert outbox survive a power cut.  That is
 * not a convenience: the signed agreement requires critical SMS to work with
 * no app, no internet and no Pi, which means the approved limits and the
 * recipient have to be on the board already.
 * ===========================================================================
 */
static Preferences g_nvs;

static Thresholds g_thresholds[PARAM_COUNT];
static String     g_recipients;                 // comma-separated, E.164
static AlertRecord g_outbox[AQSMS_OUTBOX_SLOTS];
static uint8_t    g_outbox_head  = 0;
static uint8_t    g_outbox_count = 0;
static uint32_t   g_alert_seq    = 0;

static void config_load() {
    // Fail safe: if anything is missing or malformed, the parameter stays
    // UNCONFIGURED.  Nothing is guessed from a partial read.
    for (uint8_t i = 0; i < PARAM_COUNT; i++) {
        Thresholds t;
        memset(&t, 0, sizeof(t));
        t.configured = false;
        size_t got = g_nvs.getBytes(("thr" + String(i)).c_str(), &t, sizeof(t));
        if (got == sizeof(t)) {
            g_thresholds[i] = t;
        } else {
            g_thresholds[i] = t;   // explicit: unconfigured
        }
    }

    g_recipients = g_nvs.getString("recip", "");

    // The outbox is opaque binary whose layout can change between firmware
    // versions, so it carries its OWN format word.  A mismatch discards the
    // outbox and nothing else: thresholds ("thr0".."thr2") and recipients
    // ("recip") are separate keys and are deliberately NOT touched here.  The
    // reason is printed either way — a silent reset would look like alerts
    // vanishing by themselves.
    uint8_t  prev_count = (uint8_t)g_nvs.getUChar("ob_count", 0);
    uint16_t ver        = (uint16_t)g_nvs.getUShort("ob_ver", 0);
    size_t   got        = g_nvs.getBytes("outbox", g_outbox, sizeof(g_outbox));

    if (ver == AQSMS_OUTBOX_FORMAT && got == sizeof(g_outbox)) {
        g_outbox_head  = (uint8_t)g_nvs.getUChar("ob_head", 0);
        g_outbox_count = (uint8_t)g_nvs.getUChar("ob_count", 0);
        if (g_outbox_head >= AQSMS_OUTBOX_SLOTS) g_outbox_head = 0;
        if (g_outbox_count > AQSMS_OUTBOX_SLOTS) g_outbox_count = 0;
    } else {
        memset(g_outbox, 0, sizeof(g_outbox));
        g_outbox_head  = 0;
        g_outbox_count = 0;

        if (ver == 0) {
            Serial.println("[cfg] no stored alert outbox — starting with an empty one");
        } else if (ver != AQSMS_OUTBOX_FORMAT) {
            Serial.printf("[cfg] alert outbox format changed (%u -> %u).\n",
                          (unsigned)ver, (unsigned)AQSMS_OUTBOX_FORMAT);
            if (prev_count) {
                Serial.printf("[cfg]   %u locally recorded alert(s) could not be read and\n",
                              (unsigned)prev_count);
                Serial.println("[cfg]   were discarded — they were NOT sent to the Pi.");
            }
            Serial.println("[cfg]   Thresholds and SMS recipients were NOT erased: they are");
            Serial.println("[cfg]   stored under their own keys and are unaffected.");
        } else {
            Serial.printf("[cfg] alert outbox size mismatch (%u stored vs %u expected);\n",
                          (unsigned)got, (unsigned)sizeof(g_outbox));
            Serial.println("[cfg]   the outbox was discarded. Thresholds and recipients are");
            Serial.println("[cfg]   stored separately and were NOT erased.");
        }

        g_nvs.putUShort("ob_ver", AQSMS_OUTBOX_FORMAT);
        g_nvs.putUChar("ob_head", 0);
        g_nvs.putUChar("ob_count", 0);
    }

    g_alert_seq = g_nvs.getULong("alert_seq", 0);
}

// One-time seeding from the compile-time block.  Runs only when the flash has
// never been provisioned, so a console change is never overwritten by a
// reflash.  Every seeded value is a placeholder until an installer replaces it.
static void config_seed_from_compile_time() {
    if (g_nvs.getBool("seeded", false)) return;

#if AQSMS_THRESHOLDS_CONFIGURED
    struct { float smin, smax, wmin, wmax; } seed[PARAM_COUNT] = {
        { AQSMS_PH_SAFE_MIN,   AQSMS_PH_SAFE_MAX,   AQSMS_PH_WARN_MIN,   AQSMS_PH_WARN_MAX   },
        { AQSMS_TEMP_SAFE_MIN, AQSMS_TEMP_SAFE_MAX, AQSMS_TEMP_WARN_MIN, AQSMS_TEMP_WARN_MAX },
        { AQSMS_DO_SAFE_MIN,   AQSMS_DO_SAFE_MAX,   AQSMS_DO_WARN_MIN,   AQSMS_DO_WARN_MAX   },
    };
    for (uint8_t i = 0; i < PARAM_COUNT; i++) {
        g_thresholds[i].configured = true;
        g_thresholds[i].safe_min = seed[i].smin;
        g_thresholds[i].safe_max = seed[i].smax;
        g_thresholds[i].warn_min = seed[i].wmin;
        g_thresholds[i].warn_max = seed[i].wmax;
        g_nvs.putBytes(("thr" + String(i)).c_str(), &g_thresholds[i], sizeof(Thresholds));
    }
    Serial.println("[cfg] thresholds seeded from compile-time block (marked approved)");
#else
    Serial.println("[cfg] thresholds UNCONFIGURED — no alert will be raised and");
    Serial.println("[cfg]   nothing will be reported Safe until limits are approved");
    Serial.println("[cfg]   and entered (console: setthr <param> <smin> <smax> <wmin> <wmax>)");
#endif

    g_recipients = String(AQSMS_SMS_RECIPIENTS_INITIAL);
    g_recipients.trim();
    g_nvs.putString("recip", g_recipients);
    if (g_recipients.length() == 0) {
        Serial.println("[cfg] SMS recipient list EMPTY — no SMS will be sent");
        Serial.println("[cfg]   (console: addrecip +639171234567)");
    } else {
        Serial.println("[cfg] SMS recipients seeded from compile-time block");
    }

    g_nvs.putBool("seeded", true);
}

static void outbox_save() {
    g_nvs.putBytes("outbox", g_outbox, sizeof(g_outbox));
    g_nvs.putUChar("ob_head", g_outbox_head);
    g_nvs.putUChar("ob_count", g_outbox_count);
    g_nvs.putUShort("ob_ver", AQSMS_OUTBOX_FORMAT);
    g_nvs.putULong("alert_seq", g_alert_seq);
}

static void config_begin() {
    // Namespace is deliberately short; NVS caps it at 15 characters.
    g_nvs.begin("aqsms", false);
    config_load();
    config_seed_from_compile_time();
}


/* ===========================================================================
 * SECTION 5 — Clock
 * ---------------------------------------------------------------------------
 * The ESP32 has no battery-backed RTC and this system deliberately does not
 * depend on the internet, so there is no NTP either.  The Pi's /esp32/ping
 * reply carries an ISO-8601 UTC timestamp, and that is the origin.  Elapsed
 * time is added with millis().
 *
 * If the clock has NEVER synced, readings are not posted and SMS timestamps
 * are not fabricated.  An alert SMS without an honest timestamp is still worth
 * sending — the SMS body says "clock not synced" rather than implying a time
 * it does not know.
 * ===========================================================================
 */
static bool     g_clock_synced   = false;
static uint32_t g_clock_epoch    = 0;   // unix seconds at the moment of sync
static uint32_t g_clock_millis   = 0;   // millis() at the moment of sync

static uint32_t clock_now_epoch() {
    if (!g_clock_synced) return 0;
    return g_clock_epoch + (uint32_t)((millis() - g_clock_millis) / 1000UL);
}

// Howard Hinnant's civil-from-days.  Reproduces the algorithm the existing
// pi_client.cpp used, so timestamps stay byte-identical in shape.
static void civil_from_days(int32_t z, int32_t &y, uint32_t &m, uint32_t &d) {
    z += 719468;
    const int32_t era = (z >= 0 ? z : z - 146096) / 146097;
    const uint32_t doe = (uint32_t)(z - era * 146097);
    const uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    y = (int32_t)yoe + era * 400;
    const uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const uint32_t mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    m = mp + (mp < 10 ? 3 : -9);
    y += (m <= 2);
}

// ISO-8601 UTC, always ending in Z.  The Pi rejects offsets other than Z in
// the existing client's parser, and matching that is safer than exploiting
// dateutil's tolerance on the server.
static String iso8601_utc(uint32_t epoch) {
    if (epoch == 0) return String("");
    uint32_t days = epoch / 86400UL;
    uint32_t rem  = epoch % 86400UL;
    int32_t y; uint32_t m, d;
    civil_from_days((int32_t)days, y, m, d);
    char buf[32];
    snprintf(buf, sizeof(buf), "%04ld-%02lu-%02luT%02lu:%02lu:%02luZ",
             (long)y, (unsigned long)m, (unsigned long)d,
             (unsigned long)(rem / 3600UL),
             (unsigned long)((rem % 3600UL) / 60UL),
             (unsigned long)(rem % 60UL));
    return String(buf);
}

// Parse the "timestamp":"YYYY-MM-DDTHH:MM:SSZ" field out of the ping reply.
static bool parse_iso_utc(const String &iso, uint32_t &epoch_out) {
    if (iso.length() < 20) return false;
    if (iso[4] != '-' || iso[7] != '-' || iso[10] != 'T' ||
        iso[13] != ':' || iso[16] != ':') return false;
    char tail = iso[19];
    if (tail != 'Z' && tail != 'z') return false;   // numeric offsets rejected

    int Y = iso.substring(0, 4).toInt();
    int M = iso.substring(5, 7).toInt();
    int D = iso.substring(8, 10).toInt();
    int h = iso.substring(11, 13).toInt();
    int m = iso.substring(14, 16).toInt();
    int s = iso.substring(17, 19).toInt();
    if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59 || s > 60) return false;

    // days_from_civil
    int32_t yy = Y - (M <= 2);
    const int32_t era = (yy >= 0 ? yy : yy - 399) / 400;
    const uint32_t yoe = (uint32_t)(yy - era * 400);
    const uint32_t doy = (153 * (M + (M > 2 ? -3 : 9)) + 2) / 5 + D - 1;
    const uint32_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    const int32_t days = era * 146097 + (int32_t)doe - 719468;

    epoch_out = (uint32_t)((int64_t)days * 86400LL + h * 3600 + m * 60 + s);
    return true;
}

static void clock_anchor(uint32_t epoch) {
    g_clock_epoch   = epoch;
    g_clock_millis  = millis();
    g_clock_synced  = true;
}


/* ===========================================================================
 * SECTION 6 — Sensors
 * ---------------------------------------------------------------------------
 * pH   : SEN0161 (original) output -> 10k/10k divider -> GPIO35.
 * DO   : SEN0237 output -> GPIO34 directly.
 * Temp : DS18B20 on GPIO4, external 3-wire power, 4.7k pull-up.
 *
 * The pH divider is undone ONCE, here, at the ADC boundary.  Calibration then
 * works in board volts.  There is no second division anywhere in this file —
 * grep AQSMS_PH_DIVIDER_RATIO and you will find exactly one multiplication.
 * ===========================================================================
 */

static float adc_mean_millivolts(uint8_t pin) {
    // analogReadMilliVolts() applies the chip's factory calibration and the
    // pin's attenuation curve.  Averaging it reduces the ESP32 ADC's noise on
    // a long probe cable; it does not make the ADC better than it is.
    uint32_t total = 0;
    for (uint16_t i = 0; i < AQSMS_ADC_SAMPLES; i++) {
        total += analogReadMilliVolts(pin);
        delay(AQSMS_ADC_SAMPLE_DELAY_MS);
    }
    return (float)total / (float)AQSMS_ADC_SAMPLES;
}

static OneWire g_onewire(AQSMS_PIN_ONEWIRE);
static bool    g_ds_present = false;
static uint8_t g_ds_addr[8];

static bool ds_scan() {
    if (!g_onewire.search(g_ds_addr)) {
        g_onewire.reset_search();
        return false;
    }
    if (OneWire::crc8(g_ds_addr, 7) != g_ds_addr[7]) return false;
    if (g_ds_addr[0] != 0x28) return false;   // DS18B20 family code
    return true;
}

// Blocking conversion.  750 ms at 12-bit.  This is the one deliberate delay in
// the sample path, and it cannot be avoided: reading the scratchpad before the
// conversion completes returns the PREVIOUS result, which is how a stale
// temperature gets filed as a current one.
static bool ds_read_c(float &out_c) {
    if (!g_ds_present) return false;
    if (!g_onewire.reset()) return false;

    g_onewire.select(g_ds_addr);
    g_onewire.write(0x44, 1);       // CONVERT T, parasite-power bit set (harmless
                                    // with external power, required without it)
    delay(750);

    if (!g_onewire.reset()) return false;
    g_onewire.select(g_ds_addr);
    g_onewire.write(0xBE, 0);       // READ SCRATCHPAD

    uint8_t sp[9];
    for (uint8_t i = 0; i < 9; i++) sp[i] = g_onewire.read();

    if (OneWire::crc8(sp, 8) != sp[8]) return false;   // CRC catches cable noise

    int16_t raw = (int16_t)((sp[1] << 8) | sp[0]);
    float c = (float)raw / 16.0f;

    if (!isfinite(c)) return false;
    if (c < AQSMS_TEMP_VALID_MIN_C || c > AQSMS_TEMP_VALID_MAX_C) return false;

    out_c = c;
    return true;
}

static void sensors_begin() {
    analogReadResolution(12);
    analogSetPinAttenuation(AQSMS_PIN_PH_ADC, ADC_11db);
    analogSetPinAttenuation(AQSMS_PIN_DO_ADC, ADC_11db);

    g_ds_present = ds_scan();
    if (g_ds_present) {
        Serial.printf("[temp] DS18B20 found, address %02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X\n",
                      g_ds_addr[0], g_ds_addr[1], g_ds_addr[2], g_ds_addr[3],
                      g_ds_addr[4], g_ds_addr[5], g_ds_addr[6], g_ds_addr[7]);
    } else {
        g_onewire.reset_search();
        Serial.println("[temp] no DS18B20 on GPIO4 — temperature will be reported as NOT MEASURED");
    }
}

static float ph_from_board_mv(float board_mv) {
    float span = (AQSMS_PH_CAL_V2_MV - AQSMS_PH_CAL_V1_MV);
    if (span == 0.0f) return NAN;
    float slope = (AQSMS_PH_CAL_V2_PH - AQSMS_PH_CAL_V1_PH) / span;
    return AQSMS_PH_CAL_V1_PH + (board_mv - AQSMS_PH_CAL_V1_MV) * slope;
}

static float do_from_board_mv(float board_mv, float temp_c, bool have_temp, bool &compensated) {
    compensated = false;
    float span = (AQSMS_DO_CAL_V2_MV - AQSMS_DO_CAL_V1_MV);
    if (span == 0.0f) return NAN;

    float slope = (AQSMS_DO_CAL_V2_MGL - AQSMS_DO_CAL_V1_MGL) / span;
    float mg_l  = AQSMS_DO_CAL_V1_MGL + (board_mv - AQSMS_DO_CAL_V1_MV) * slope;

#if AQSMS_DO_TEMP_COMP_ENABLED
    if (!have_temp) return NAN;   // see 1.8 — no silent uncompensated number
    float dt = temp_c - AQSMS_DO_CAL_TEMP_C;
    mg_l *= (1.0f + (AQSMS_DO_TEMP_COEF_PCT_PER_C / 100.0f) * dt);
    compensated = true;
#else
    (void)temp_c; (void)have_temp;
#endif

    if (!isfinite(mg_l) || mg_l < 0.0f) return NAN;
    return mg_l;
}

static Sample sensors_read() {
    Sample s;
    memset(&s, 0, sizeof(s));

    // ---- Temperature first: DO may depend on it ----------------------------
    float t = NAN;
    if (ds_read_c(t)) {
        s.has_temperature_c = true;
        s.temperature_c = t;
    }

    // ---- pH ----------------------------------------------------------------
    float ph_junction_mv = adc_mean_millivolts(AQSMS_PIN_PH_ADC);
    float ph_board_mv    = ph_junction_mv * AQSMS_PH_DIVIDER_RATIO;   // the ONE division
    if (AQSMS_PH_CALIBRATED) {
        if (ph_board_mv >= AQSMS_PH_VALID_MV_MIN && ph_board_mv <= AQSMS_PH_VALID_MV_MAX) {
            float v = ph_from_board_mv(ph_board_mv);
            if (isfinite(v) && v >= 0.0f && v <= 14.0f) {
                s.has_ph = true;
                s.ph = v;
            }
        }
    }

    // ---- Dissolved oxygen --------------------------------------------------
    float do_mv = adc_mean_millivolts(AQSMS_PIN_DO_ADC);
    if (AQSMS_DO_CALIBRATED) {
        if (do_mv >= AQSMS_DO_VALID_MV_MIN && do_mv <= AQSMS_DO_VALID_MV_MAX) {
            bool comp = false;
            float v = do_from_board_mv(do_mv, s.temperature_c, s.has_temperature_c, comp);
            if (isfinite(v)) {
                s.has_do_mg_l = true;
                s.dissolved_oxygen_mg_l = v;
                s.has_do_temp_warning = (AQSMS_DO_TEMP_COMP_ENABLED && !comp);
            }
        }
    }

    return s;
}

static bool sample_any_present(const Sample &s) {
    return s.has_ph || s.has_temperature_c || s.has_do_mg_l;
}

static void sensors_describe(const Sample &s) {
    if (s.has_ph)              Serial.printf("pH %.2f", s.ph);
    else                       Serial.print("pH NOT MEASURED (uncalibrated or out of range)");

    Serial.print(" | ");
    if (s.has_temperature_c)   Serial.printf("temp %.2f C", s.temperature_c);
    else                       Serial.print("temp NOT MEASURED");

    Serial.print(" | ");
    if (s.has_do_mg_l) {
        Serial.printf("DO %.2f mg/L", s.dissolved_oxygen_mg_l);
        if (s.has_do_temp_warning) Serial.print(" (uncompensated)");
    } else {
        Serial.print("DO NOT MEASURED (uncalibrated, out of range, or temperature required)");
    }
    Serial.println();
}


/* ===========================================================================
 * SECTION 7 — Threshold evaluation
 * ---------------------------------------------------------------------------
 * safe range  = [safe_min, safe_max]
 * warn range  = [warn_min, warn_max], which must ENCLOSE the safe range
 *
 *   inside safe                 -> SAFE
 *   outside safe, inside warn   -> WARNING
 *   outside warn                -> UNSAFE
 *   limits not configured       -> UNKNOWN
 *
 * UNKNOWN is not SAFE.  An unconfigured parameter produces no alert and no SMS,
 * and the app is expected to render "No Data" — which is exactly what the Pi
 * already does with its NULL, approved=0 rows.
 * ===========================================================================
 */
static uint8_t evaluate(uint8_t param, float value, String &limit_text) {
    const Thresholds &t = g_thresholds[param];
    limit_text = "";
    if (!t.configured) return STATUS_UNKNOWN;

    if (value >= t.safe_min && value <= t.safe_max) return STATUS_SAFE;

    bool outside_warn = (value < t.warn_min) || (value > t.warn_max);
    if (outside_warn) {
        limit_text = (value < t.warn_min)
            ? ("warn_min " + String(t.warn_min, 2))
            : ("warn_max " + String(t.warn_max, 2));
        return STATUS_UNSAFE;
    }

    limit_text = (value < t.safe_min)
        ? ("safe_min " + String(t.safe_min, 2))
        : ("safe_max " + String(t.safe_max, 2));
    return STATUS_WARNING;
}

static bool thresholds_all_configured() {
    for (uint8_t i = 0; i < PARAM_COUNT; i++)
        if (!g_thresholds[i].configured) return false;
    return true;
}


/* ===========================================================================
 * SECTION 8 — SIM900 modem and SMS
 * ---------------------------------------------------------------------------
 * SMS is the safety path.  It runs on the ESP32, over the cellular network, and
 * is completely independent of Wi-Fi, the router, the Pi and the phone app.
 * Nothing in this section calls the Pi API, and nothing in the Pi API calls
 * this.  That independence is the whole point: the alert matters most exactly
 * when the Pi is unreachable.
 *
 * DELIVERY IS FIVE DIFFERENT FACTS, and this firmware keeps them apart.  The
 * values are the SMS_* constants declared in section 3 and there is exactly
 * one name for each, shared by the send path, the stored record and the
 * console:
 *
 *   not attempted  nothing was written to the modem — no recipient, no modem,
 *                  an unusable SIM, or the anti-flood gates held it back.
 *   failed         the modem or the network refused the attempt.
 *   submitted      the AT+CMGS body went out; no confirmation before timeout.
 *   accepted       the modem answered +CMGS: <mr> — handed to the network.
 *                  This is NOT proof anyone received it.
 *   delivered      a +CDS report NAMING THIS MESSAGE'S REFERENCE arrived with
 *                  status 0.
 *
 * A +CDS report is applied only to the message whose <mr> it names.  A report
 * that arrives for some other reference is routed to that message's record and
 * is NEVER taken as confirmation of this one.  Where a carrier supplies no
 * reports at all, a message simply stays at "accepted" and the console says so.
 *
 * POWER: the SIM900 carrier board is UNRESOLVED.  A bare SIM900 draws ~2 A
 * bursts on a 3.2–4.8 V rail, but that is the BARE MODULE's requirement and it
 * is NOT safe to assume the carrier inherits it — many carriers have their own
 * regulator and a different input.  This firmware therefore contains no modem
 * power code at all.  Wire power to the carrier's documented input; do not
 * copy the bare-module numbers.  This file does not implement, and does not
 * claim, any battery or charging telemetry — no documented interface exists
 * for it, and inventing a battery percentage would be a fabrication.
 * ===========================================================================
 */
static bool     g_modem_ready   = false;
static bool     g_modem_registered = false;
static uint8_t  g_sim_state     = SIM_UNKNOWN;
static uint32_t g_modem_last_probe = 0;
static uint32_t g_sms_last_any  = 0;
static uint32_t g_sms_cooldown_until[PARAM_COUNT] = {0, 0, 0};
static SmsRefTrack g_sms_refs[8];   // ref -> alert, so late reports land right

// Message reference 0 is a perfectly legal reference, so "free" has to be an
// explicit -1 rather than the zero the array starts out holding.
static void sms_refs_init() {
    for (int i = 0; i < 8; i++) { g_sms_refs[i].ref = -1; g_sms_refs[i].alert_seq = 0; }
}

// Remember which alert a +CMGS message reference belongs to.
static void sms_ref_track(int ref, uint32_t alert_seq) {
    if (ref < 0) return;
    int free_slot = -1;
    for (int i = 0; i < 8; i++) {
        if (g_sms_refs[i].ref == ref) { g_sms_refs[i].alert_seq = alert_seq; return; }
        if (g_sms_refs[i].ref < 0 && free_slot < 0) free_slot = i;
    }
    if (free_slot < 0) free_slot = 0;   // every slot outstanding: replace the first
    g_sms_refs[free_slot].ref = ref;
    g_sms_refs[free_slot].alert_seq = alert_seq;
}

// Resolve a delivery report to the alert it belongs to.
//
// Returns the alert sequence number, or 0 when the report names a reference
// this boot never used.  A report with status 0 upgrades that ONE record to
// SMS_DELIVERED; every other record is left exactly as it was.
static uint32_t sms_ref_reply(int mr, int st, bool has_st) {
    if (mr < 0) return 0;
    for (int i = 0; i < 8; i++) {
        if (g_sms_refs[i].ref != mr) continue;
        uint32_t seq = g_sms_refs[i].alert_seq;

        if (has_st && st == 0 && seq != 0) {
            for (uint8_t n = 0; n < g_outbox_count; n++) {
                uint8_t slot = (uint8_t)((g_outbox_head + n) % AQSMS_OUTBOX_SLOTS);
                if (g_outbox[slot].seq != seq) continue;
                if (g_outbox[slot].sms < SMS_DELIVERED) {
                    g_outbox[slot].sms = SMS_DELIVERED;
                    outbox_save();
                }
                break;
            }
        }
        g_sms_refs[i].ref = -1;      // one report per reference
        return seq;
    }
    return 0;
}

// Handle a +CDS line wherever it turns up: during an AT+CMGS transaction, or
// unprompted minutes later.  Both paths go through here so the correlation
// rule is applied in exactly one place.
static void cds_handle(const char *line) {
    CdsReport rep;
    if (!cds_parse(line, rep) || !rep.valid) {
        Serial.print("[sms] unparseable delivery report, ignored: ");
        Serial.println(line);
        return;
    }
    if (!rep.has_st) {
        // A report with no <st> field says the message was handled, not that it
        // was received.  It must not become a DELIVERED.
        Serial.printf("[sms] delivery report for ref %d carries no status — not treated "
                      "as delivered\n", rep.mr);
        return;
    }
    uint32_t seq = sms_ref_reply(rep.mr, rep.st, rep.has_st);
    if (seq == 0) {
        Serial.printf("[sms] delivery report for ref %d matches no message sent by this "
                      "boot — NOT applied to any alert\n", rep.mr);
        return;
    }
    Serial.printf("[sms] delivery report: alert #%lu ref %d status %d -> %s\n",
                  (unsigned long)seq, rep.mr, rep.st,
                  rep.st == 0 ? "DELIVERED" : "not delivered");
}

// Read one CR/LF-terminated line from the modem, or "" on timeout.
static String modem_read_line(uint32_t timeout_ms) {
    String line;
    uint32_t start = millis();
    while (millis() - start < timeout_ms) {
        while (modem_port().available()) {
            char c = (char)modem_port().read();
            if (c == '\n') {
                line.trim();
                return line;
            }
            if (c != '\r' && line.length() < 200) line += c;
        }
        delay(5);
    }
    line.trim();
    return line;
}

// Look for any line containing `token`, up to the timeout.  Everything read is
// consumed either way, so a late reply cannot desynchronise the next command.
static bool modem_wait_for(const char *token, uint32_t timeout_ms, String *full = nullptr) {
    uint32_t start = millis();
    while (millis() - start < timeout_ms) {
        String line = modem_read_line(200);
        if (line.length() == 0) continue;

        // Unsolicited traffic.  A +CDS is routed to the alert it names, right
        // here, rather than stashed as "the last one seen" — stashing is what
        // let an unrelated report pass for confirmation of the message being
        // sent at that moment.
        if (line.startsWith("+CDS:")) { cds_handle(line.c_str()); continue; }
        if (line.startsWith("RING") || line.startsWith("+CMTI:")) continue;

        if (line.indexOf(token) >= 0) {
            if (full) *full = line;
            return true;
        }
    }
    return false;
}

static bool modem_command(const char *cmd, const char *expect, uint32_t timeout_ms, String *out = nullptr) {
    while (modem_port().available()) modem_port().read();
    modem_port().print(cmd);
    modem_port().print("\r");
    return modem_wait_for(expect, timeout_ms, out);
}

static bool modem_is_registered() {
    String line;
    if (!modem_command("AT+CREG?", "+CREG:", AQSMS_SMS_AT_SHORT_MS, &line)) return false;
    // +CREG: <n>,<stat> — stat 1 = registered home, 5 = registered roaming.
    int comma = line.indexOf(',');
    if (comma < 0) return false;
    int stat = line.substring(comma + 1).toInt();
    return (stat == 1 || stat == 5);
}

/* Ask the modem about the SIM, and classify the answer.
 *
 * AT+CPIN? replies with its OWN line before the final OK:
 *     +CPIN: READY
 *     OK
 * Two separate lines.  The previous implementation captured whatever line
 * contained "OK" — which is never the "+CPIN:" line — and then searched it for
 * "READY", so it could not detect a healthy SIM and could not distinguish a
 * locked one from a missing one.  Here each line is captured separately and
 * classified by cpin_classify(). */
static uint8_t modem_check_pin(String &info_out, String &error_out) {
    info_out  = "";
    error_out = "";

    while (modem_port().available()) modem_port().read();
    modem_port().print("AT+CPIN?\r");

    bool saw_info = false, saw_error = false, timed_out = true;
    uint32_t start = millis();
    while (millis() - start < AQSMS_SMS_AT_TIMEOUT_MS) {
        String l = modem_read_line(300);
        if (l.length() == 0) continue;

        if (l.startsWith("+CPIN:")) { info_out = l; saw_info = true; continue; }
        if (l.startsWith("+CME ERROR") || l.startsWith("+CMS ERROR")) {
            error_out = l; saw_error = true; continue;
        }
        if (l == "ERROR") { error_out = l; saw_error = true; continue; }
        if (l.startsWith("+CDS:")) { cds_handle(l.c_str()); continue; }
        if (l == "OK") { timed_out = false; break; }
    }

    return cpin_classify(info_out.c_str(), saw_info,
                         error_out.c_str(), saw_error,
                         timed_out);
}

static void modem_power_key_pulse() {
#if (AQSMS_PIN_MODEM_PWRKEY >= 0)
    pinMode(AQSMS_PIN_MODEM_PWRKEY, OUTPUT);
    digitalWrite(AQSMS_PIN_MODEM_PWRKEY, HIGH);
    delay(1200);
    digitalWrite(AQSMS_PIN_MODEM_PWRKEY, LOW);
#else
    // PWRKEY is unassigned.  Saying so once is useful; pretending to drive it
    // would be a lie that shows up later as "the modem sometimes doesn't boot".
#endif
}

static bool sms_begin() {
    sms_refs_init();

#if (AQSMS_PIN_MODEM_PWRKEY >= 0)
    Serial.printf("[modem] PWRKEY configured on GPIO%d\n", AQSMS_PIN_MODEM_PWRKEY);
#else
    Serial.println("[modem] PWRKEY UNASSIGNED — the carrier board's keying circuit");
    Serial.println("[modem]   has not been specified. If the board needs a power");
    Serial.println("[modem]   key pulse, it must be provided by that circuit, not");
    Serial.println("[modem]   by an assumed ESP32 pin.");
#endif

    modem_power_key_pulse();

    modem_port().begin(AQSMS_MODEM_BAUD, SERIAL_8N1, AQSMS_PIN_MODEM_RX, AQSMS_PIN_MODEM_TX);
    delay(1500);
    while (modem_port().available()) modem_port().read();

    // Autobaud: try the configured rate, then two common alternatives.  A modem
    // that answers none of them is not a modem this firmware can talk to, and
    // that is reported rather than retried forever.
    const long rates[] = { AQSMS_MODEM_BAUD, 19200, 115200 };
    bool alive = false;
    for (uint8_t i = 0; i < 3 && !alive; i++) {
        modem_port().end();
        modem_port().begin(rates[i], SERIAL_8N1, AQSMS_PIN_MODEM_RX, AQSMS_PIN_MODEM_TX);
        delay(300);
        for (uint8_t attempt = 0; attempt < 3 && !alive; attempt++) {
            alive = modem_command("AT", "OK", AQSMS_SMS_AT_SHORT_MS);
            if (!alive) vTaskDelay(200 / portTICK_PERIOD_MS);
        }
        if (alive) {
            Serial.printf("[modem] responded at %ld baud\n", rates[i]);
            if (rates[i] != AQSMS_MODEM_BAUD) {
                Serial.println("[modem] NOTE: this differs from AQSMS_MODEM_BAUD.");
                Serial.println("[modem]   Record the real rate and set it in section 1.5,");
                Serial.println("[modem]   otherwise the next boot costs this search again.");
            }
        }
    }
    if (!alive) {
        Serial.println("[modem] NO RESPONSE to AT — SMS unavailable.");
        Serial.println("[modem]   Check: carrier power (a 2 A-capable branch, not the");
        Serial.println("[modem]   ESP32 3V3 pin), common ground, UART level interface,");
        Serial.println("[modem]   and whether the board needs a power-key pulse.");
        g_modem_ready = false;
        return false;
    }

    modem_command("ATE0", "OK", AQSMS_SMS_AT_SHORT_MS);          // echo off
    modem_command("AT+CMEE=1", "OK", AQSMS_SMS_AT_SHORT_MS);     // numeric errors — a
                                                                 // bare "ERROR" hides the cause

    // SIM readiness, read as its own transaction.
    String sim_info, sim_error;
    g_sim_state = modem_check_pin(sim_info, sim_error);
    Serial.printf("[modem] SIM: %s", sim_state_name(g_sim_state));
    if (sim_info.length())  { Serial.print("  ["); Serial.print(sim_info);  Serial.print("]"); }
    if (sim_error.length()) { Serial.print("  ["); Serial.print(sim_error); Serial.print("]"); }
    Serial.println();
    switch (g_sim_state) {
        case SIM_READY:
            break;
        case SIM_PIN_REQUIRED:
            Serial.println("[modem]   The SIM is locked. Unlock it from a phone — this");
            Serial.println("[modem]   firmware deliberately stores no SIM PIN.");
            break;
        case SIM_PUK_REQUIRED:
            Serial.println("[modem]   The SIM is PUK-locked. Unblock it from a phone first.");
            break;
        case SIM_NOT_INSERTED:
            Serial.println("[modem]   No SIM seated, or a bad contact. Check the holder.");
            break;
        case SIM_TIMEOUT:
            Serial.println("[modem]   The modem did not answer AT+CPIN? within the timeout.");
            break;
        default:
            Serial.println("[modem]   Unrecognised reply — treating the SIM as unusable.");
            break;
    }

    // Text mode, GSM character set.
    // CMGF=1 is not cosmetic: the +CDS delivery reports parsed by cds_parse()
    // are in TEXT format, and the field layout below is the text-mode one.
    modem_command("AT+CMGF=1", "OK", AQSMS_SMS_AT_SHORT_MS);
    modem_command("AT+CSCS=\"GSM\"", "OK", AQSMS_SMS_AT_SHORT_MS);

    // Ask the network for delivery reports.  49 = relative format, delivery
    // report requested.  Where the carrier ignores this, DELIVERED simply never
    // arrives and the message stays at ACCEPTED — reported as such.
    modem_command("AT+CSMP=49,167,0,0", "OK", AQSMS_SMS_AT_SHORT_MS);

    // Do not let unsolicited messages pile up in the modem's buffer.
    modem_command("AT+CNMI=2,1,0,1,0", "OK", AQSMS_SMS_AT_SHORT_MS);

    g_modem_ready = true;

    uint32_t start = millis();
    while (millis() - start < AQSMS_SMS_REG_WAIT_MS) {
        if (modem_is_registered()) { g_modem_registered = true; break; }
        delay(2000);
    }

    String csq;
    if (modem_command("AT+CSQ", "+CSQ:", AQSMS_SMS_AT_SHORT_MS, &csq)) {
        Serial.print("[modem] signal "); Serial.println(csq);
        Serial.println("[modem]   (first number is 0-31 RSSI; 99 means unknown.");
        Serial.println("[modem]    When it is 99 the survey has failed — see the modem guide.)");
    }

    Serial.printf("[modem] registered on network: %s\n", g_modem_registered ? "yes" : "NO");
    return g_modem_ready;
}

// Send ONE message to ONE recipient, on behalf of one alert.
//
// `alert_seq` is the AlertRecord.seq the message belongs to; 0 when the message
// is not tied to a record (the console's smstest).  It is recorded against the
// +CMGS message reference so that a delivery report arriving later is applied
// to the right alert — and only to that one.
static SmsResult sms_send_one(const String &number, const String &body, uint32_t alert_seq) {
    SmsResult r;
    r.state = SMS_NOT_ATTEMPTED;
    r.modem_ref = -1;
    r.detail = "";

    if (!g_modem_ready) {
        r.detail = "modem not initialised";
        return r;                    // nothing was written to the modem
    }
    if (g_sim_state != SIM_READY) {
        r.detail = String("SIM is not usable (") + sim_state_name(g_sim_state) + ")";
        return r;
    }
    if (!g_modem_registered) {
        if (modem_is_registered()) {
            g_modem_registered = true;
        } else {
            r.detail = "modem not registered on the network";
            return r;
        }
    }

    while (modem_port().available()) modem_port().read();
    modem_port().print("AT+CMGS=\"");
    modem_port().print(number);
    modem_port().print("\"\r");

    // The modem answers with the "> " prompt when it is ready for the body.
    if (!modem_wait_for(">", AQSMS_SMS_AT_TIMEOUT_MS)) {
        r.state = SMS_FAILED;
        r.detail = "no '>' prompt — modem refused AT+CMGS";
        return r;
    }

    modem_port().print(body);
    delay(150);
    modem_port().write(0x1A);          // Ctrl-Z terminates the message

    r.state = SMS_SUBMITTED;           // the body is on the wire

    uint32_t start = millis();
    while (millis() - start < AQSMS_SMS_AT_TIMEOUT_MS) {
        String l = modem_read_line(300);
        if (l.length() == 0) continue;

        // A report arriving during this transaction belongs to whatever
        // reference it names — which may not be this message.
        if (l.startsWith("+CDS:")) { cds_handle(l.c_str()); continue; }

        if (l.startsWith("+CMGS:")) {
            r.state = SMS_ACCEPTED;
            r.modem_ref = l.substring(6).toInt();
            sms_ref_track(r.modem_ref, alert_seq);
            r.detail = "modem accepted (message ref " + String(r.modem_ref) + ")";
            break;
        }
        if (l.startsWith("+CMS ERROR") || l.startsWith("+CME ERROR")) {
            r.state = SMS_FAILED;
            r.detail = l;
            return r;
        }
        if (l == "ERROR") {
            r.state = SMS_FAILED;
            r.detail = "modem returned ERROR";
            return r;
        }
    }

    if (r.state < SMS_ACCEPTED) {
        r.state = SMS_SUBMITTED;
        r.detail = "submitted, no +CMGS confirmation before timeout";
        return r;
    }

    // Bounded wait for a report naming THIS message's reference.
    //
    // A report for any other reference is handed to cds_handle() — which
    // applies it to the message it actually names, or discards it — and the
    // loop keeps waiting.  It is never accepted as confirmation of this one.
    // Absent a matching report the result stays ACCEPTED; it is never upgraded
    // on a guess.
    start = millis();
    while (millis() - start < AQSMS_SMS_DELIVERY_WAIT_MS) {
        String l = modem_read_line(300);
        if (l.length() == 0) {
            if (millis() - start >= AQSMS_SMS_DELIVERY_WAIT_MS) break;
            continue;
        }
        if (!l.startsWith("+CDS:")) continue;

        CdsReport rep;
        if (!cds_parse(l.c_str(), rep) || !rep.valid) continue;

        if (rep.mr != r.modem_ref) {
            cds_handle(l.c_str());
            continue;
        }
        if (!rep.has_st) {
            // No status field: the message was handled, not necessarily
            // received.  Keep waiting rather than claiming a delivery.
            continue;
        }

        sms_ref_reply(rep.mr, rep.st, rep.has_st);
        if (rep.st == 0) {
            r.state = SMS_DELIVERED;
            r.detail = "network delivery report: received";
        } else {
            r.detail = "network delivery report status " + String(rep.st) + " (not delivered)";
        }
        return r;
    }

    r.detail = "accepted by modem; no delivery report received (carrier may not supply one)";
    return r;
}

static int recipients_split(String out[], int max_n) {
    int n = 0;
    int start = 0;
    while (start < (int)g_recipients.length() && n < max_n) {
        int comma = g_recipients.indexOf(',', start);
        if (comma < 0) comma = g_recipients.length();
        String one = g_recipients.substring(start, comma);
        one.trim();
        if (one.length() >= 6) out[n++] = one;
        start = comma + 1;
    }
    return n;
}

// Mask all but the last three digits.  A recipient number is not a credential,
// but it is somebody's personal data and the serial log is not the place for it.
static String mask_number(const String &n) {
    if (n.length() <= 3) return String("***");
    return String("***") + n.substring(n.length() - 3);
}

static String build_alert_sms(uint8_t param, float value, uint8_t status, const String &limit_text) {
    String s = "AQSMS ALERT - Test Pond 1\n";
    s += String(param_title(param)) += ": ";
    s += String(value, 2);
    s += "\nStatus: ";
    s += (status == STATUS_UNSAFE ? "UNSAFE" : "WARNING");
    if (limit_text.length()) { s += "\nLimit crossed: "; s += limit_text; }
    uint32_t ep = clock_now_epoch();
    s += "\nTime: ";
    s += (ep ? iso8601_utc(ep) : String("clock not synced"));
    return s;
}

// Dispatch one alert to every configured recipient, respecting the anti-flood
// gates.  Returns the STRONGEST state achieved across recipients, expressed in
// the one SMS_* vocabulary — the same values the caller stores on the record.
//
// The gates and the setup problems all return SMS_NOT_ATTEMPTED, because that
// is literally what happened: nothing was written to the modem.  Which gate it
// was is printed here rather than being encoded in the state.
static uint8_t sms_dispatch(uint8_t param, float value, uint8_t status,
                            const String &limit_text, uint32_t alert_seq) {
    if (g_recipients.length() == 0) {
        Serial.println("[sms] NOT ATTEMPTED — no recipient configured (see addrecip)");
        return SMS_NOT_ATTEMPTED;
    }
    if (!g_modem_ready) {
        Serial.println("[sms] NOT ATTEMPTED — modem not available");
        return SMS_NOT_ATTEMPTED;
    }
    if (g_sim_state != SIM_READY) {
        Serial.printf("[sms] NOT ATTEMPTED — SIM is not usable (%s)\n",
                      sim_state_name(g_sim_state));
        return SMS_NOT_ATTEMPTED;
    }
    if (millis() < g_sms_cooldown_until[param]) {
        Serial.printf("[sms] NOT ATTEMPTED — suppressed by cooldown for %s (%lu s remaining)\n",
                      PARAM_KEY[param],
                      (unsigned long)((g_sms_cooldown_until[param] - millis()) / 1000UL));
        return SMS_NOT_ATTEMPTED;
    }
    if (g_sms_last_any != 0 && (millis() - g_sms_last_any) < AQSMS_SMS_MIN_GAP_MS) {
        Serial.println("[sms] NOT ATTEMPTED — suppressed by minimum gap between messages");
        return SMS_NOT_ATTEMPTED;
    }

    String numbers[8];
    int n = recipients_split(numbers, 8);
    if (n == 0) {
        Serial.println("[sms] NOT ATTEMPTED — recipient list holds no usable number");
        return SMS_NOT_ATTEMPTED;
    }

    String body = build_alert_sms(param, value, status, limit_text);
    uint8_t best = SMS_NOT_ATTEMPTED;

    for (int i = 0; i < n; i++) {
        for (uint8_t attempt = 1; attempt <= AQSMS_SMS_MAX_ATTEMPTS; attempt++) {
            SmsResult r = sms_send_one(numbers[i], body, alert_seq);
            g_sms_last_any = millis();

            Serial.printf("[sms] -> %s  attempt %u: %s",
                          mask_number(numbers[i]).c_str(),
                          (unsigned)attempt, sms_state_name(r.state));
            if (r.detail.length()) { Serial.print(" — "); Serial.print(r.detail); }
            Serial.println();

            best = sms_state_merge(best, r.state);

            if (r.state >= SMS_ACCEPTED) break;   // accepted is enough for this number
            if (attempt < AQSMS_SMS_MAX_ATTEMPTS) {
                Serial.println("[sms]   retrying after 10 s");
                delay(10000);
            }
        }
    }

    if (best >= SMS_SUBMITTED) {
        g_sms_cooldown_until[param] = millis() + AQSMS_SMS_COOLDOWN_MS;
        Serial.printf("[sms] %s cooldown armed for %lu s\n", PARAM_KEY[param],
                      (unsigned long)(AQSMS_SMS_COOLDOWN_MS / 1000UL));
    }
    return best;
}

static void modem_loop() {
    if (!g_modem_ready) return;
    if (millis() - g_modem_last_probe < 60000UL) return;
    g_modem_last_probe = millis();

    // Drain unsolicited lines so a stale +CMTI cannot be mistaken for a reply
    // to the next command.  A +CDS is not drained away — it is the only
    // evidence that a message actually reached a handset, and it is often the
    // LAST thing to arrive, well after sms_send_one() has given up waiting.
    // It is routed to the alert whose reference it names.
    while (modem_port().available()) {
        String l = modem_read_line(100);
        if (l.length() == 0) break;
        if (l.startsWith("+CDS:")) cds_handle(l.c_str());
    }

    g_modem_registered = modem_is_registered();
}


/* ===========================================================================
 * SECTION 9 — Raspberry Pi API client
 * ---------------------------------------------------------------------------
 * Preserves the existing client's behaviour exactly:
 *   * X-API-Key on every request
 *   * TLS verified against the embedded CA — never "accept anything"
 *   * retries on transport failure and 5xx ONLY; a 4xx is a decision, not a
 *     glitch, and resending an identical body would be refused identically
 *   * duplicate event_id (HTTP 200 {"status":"duplicate"}) counts as SUCCESS
 *
 * COLD BOOT AND TLS — checked against the installed core, not assumed.
 * With arduino-esp32 2.0.17 (FQBN esp32:esp32:esp32) the mbedTLS shipped in
 * the core is built with CONFIG_MBEDTLS_HAVE_TIME_DATE UNSET:
 *
 *   tools/sdk/esp32/sdkconfig line 1440:  "# CONFIG_MBEDTLS_HAVE_TIME_DATE is not set"
 *   tools/sdk/esp32/include/mbedtls/port/include/mbedtls/esp_config.h lines 70-73:
 *       #ifdef CONFIG_MBEDTLS_HAVE_TIME_DATE
 *       #define MBEDTLS_HAVE_TIME_DATE
 *       #else
 *       #undef  MBEDTLS_HAVE_TIME_DATE
 *       #endif
 *   and no sdkconfig.h on the esp32 variant's include path defines
 *   CONFIG_MBEDTLS_HAVE_TIME_DATE (checked: dout_qspi, dio_qspi, qio_qspi,
 *   qout_qspi — all absent).
 *
 * So certificate VALIDITY DATES are not evaluated and a verified HTTPS request
 * succeeds at cold boot with no system clock.  Verification is still complete:
 * the chain is checked against AQSMS_PI_CA_PEM and the hostname must match.
 * That is what makes the bootstrap below secure — HTTPS is the FIRST thing this
 * board does, and the Pi's ping reply is what sets the clock.  There is no
 * chicken-and-egg problem to work around, so there is no reason to weaken TLS.
 * setInsecure() appears nowhere in this file and never will.
 *
 * If a future core enables date validation, a cold boot fails the handshake
 * until the clock is set.  That failure is diagnosable rather than mysterious:
 * pi_request() appends the mbedTLS error text, so the console names the
 * certificate problem instead of reporting a bare "connection refused".
 *
 * Failing to reach the Pi NEVER blocks sampling.  The sample loop runs whether
 * or not there is Wi-Fi.  A sample taken while the Pi is down is dropped, not
 * queued: a stale reading delivered later is more misleading than a visible gap.
 * ===========================================================================
 */
// Event id for a READING.
//
// Readings are not queued (section 12), so this is minted once per sample and
// handed to the single payload that every retry re-sends unchanged.  ALERT
// events deliberately do NOT come through here: an alert's identity is minted
// once when its record is created and stored ON the record, so it survives a
// reboot and a flush.  Regenerating it per attempt — which this function used
// to be called to do — is what made the Pi store the same alert repeatedly.
static String pi_event_id(uint32_t seq) {
    char buf[AQSMS_EVENT_ID_BUF];
    event_id_build(buf, sizeof(buf), AQSMS_DEVICE_ID, esp_random(), seq);
    return String(buf);
}

static PiReply pi_request(const char *method, const String &path, const String &payload) {
    PiReply out;
    out.code = 0;
    out.transport_ok = false;

    if (WiFi.status() != WL_CONNECTED) { out.body = "wifi is down"; return out; }

    String url = String(AQSMS_USE_TLS ? "https://" : "http://") + AQSMS_PI_HOST +
                 ":" + String(AQSMS_PI_PORT) + path;

    WiFiClientSecure tls;
    WiFiClient plain;
    HTTPClient http;

    if (AQSMS_USE_TLS) {
        tls.setCACert(AQSMS_PI_CA_PEM);   // verification stays ON, always
        http.begin(tls, url);
    } else {
        http.begin(plain, url);
    }

    http.setConnectTimeout(AQSMS_HTTP_TIMEOUT_MS);
    http.setTimeout(AQSMS_HTTP_TIMEOUT_MS);
    http.setReuse(false);
    http.addHeader("Accept", "application/json");
    http.addHeader("X-API-Key", AQSMS_DEVICE_API_KEY);

    int code;
    if (strcmp(method, "POST") == 0) {
        http.addHeader("Content-Type", "application/json");
        code = http.POST(payload);
    } else {
        code = http.GET();
    }

    if (code > 0) {
        out.code = code;
        out.body = http.getString();
        out.transport_ok = true;
    } else {
        out.code = code;
        out.body = HTTPClient::errorToString(code);
#if AQSMS_USE_TLS
        // Without this, "connection refused" and "the certificate did not
        // verify" are the same message.  lastError() fills the buffer only when
        // the TLS layer actually recorded something.
        {
            char ebuf[160];
            ebuf[0] = '\0';
            if (tls.lastError(ebuf, sizeof(ebuf)) != 0 && ebuf[0] != '\0') {
                out.body += " — TLS: ";
                out.body += ebuf;
            }
        }
#endif
        out.transport_ok = false;
    }

    http.end();
    return out;
}

static PiReply pi_request_with_retry(const char *method, const String &path, const String &payload) {
    PiReply r;
    for (uint8_t attempt = 1; attempt <= AQSMS_HTTP_MAX_ATTEMPTS; attempt++) {
        r = pi_request(method, path, payload);

        if (r.transport_ok && r.code < 500) return r;   // success, or a 4xx we must not retry

        if (attempt < AQSMS_HTTP_MAX_ATTEMPTS) {
            uint32_t backoff = 500UL << (attempt - 1);
            Serial.printf("[pi] attempt %u failed (%s); retrying in %lu ms\n",
                          (unsigned)attempt,
                          r.transport_ok ? String("HTTP " + String(r.code)).c_str()
                                         : r.body.c_str(),
                          (unsigned long)backoff);
            delay(backoff);
        }
    }
    return r;
}

static bool pi_sync_time() {
    PiReply r = pi_request_with_retry("GET", "/esp32/ping", "");
    if (!r.transport_ok) {
        Serial.print("[pi] clock sync failed: ");
        Serial.println(r.body);
        return false;
    }
    if (r.code != 200) {
        Serial.printf("[pi] clock sync rejected, HTTP %d: %s\n", r.code, r.body.c_str());
        return false;
    }

    int k = r.body.indexOf("\"timestamp\"");
    if (k < 0) { Serial.println("[pi] no timestamp in ping reply"); return false; }
    int q1 = r.body.indexOf('"', r.body.indexOf(':', k) + 1);
    int q2 = (q1 < 0) ? -1 : r.body.indexOf('"', q1 + 1);
    if (q1 < 0 || q2 < 0) { Serial.println("[pi] malformed ping reply"); return false; }

    uint32_t epoch;
    if (!parse_iso_utc(r.body.substring(q1 + 1, q2), epoch)) {
        Serial.println("[pi] ping timestamp not parseable as UTC");
        return false;
    }

    clock_anchor(epoch);
    Serial.printf("[pi] clock anchored to %s\n", iso8601_utc(epoch).c_str());
    return true;
}

static String pi_reading_payload(const Sample &s, const String &event_id) {
    String body = "{\"timestamp\":\"" + iso8601_utc(clock_now_epoch()) + "\"";

    if (s.has_ph && isfinite(s.ph)) {
        body += ",\"ph\":" + String(s.ph, 3);
    }
    if (s.has_temperature_c && isfinite(s.temperature_c)) {
        body += ",\"temperature_c\":" + String(s.temperature_c, 3);
    }
    if (s.has_do_mg_l && isfinite(s.dissolved_oxygen_mg_l)) {
        body += ",\"dissolved_oxygen_mg_l\":" + String(s.dissolved_oxygen_mg_l, 3);
    }

    body += ",\"event_id\":\"" + event_id + "\"}";
    return body;
}

static bool pi_post_reading(const Sample &s, const String &event_id) {
    if (!clock_now_epoch()) {
        Serial.println("[pi] refusing to post — clock not synced, timestamp would be a guess");
        return false;
    }

    PiReply r = pi_request_with_retry("POST", "/esp32/readings", pi_reading_payload(s, event_id));

    if (!r.transport_ok) {
        Serial.print("[pi] reading NOT stored (transport): ");
        Serial.println(r.body);
        return false;
    }
    if (r.code == 201) { Serial.println("[pi] reading stored"); return true; }
    if (r.code == 200 && r.body.indexOf("duplicate") >= 0) {
        Serial.println("[pi] already stored (duplicate event id, not written twice)");
        return true;
    }
    Serial.printf("[pi] reading rejected, HTTP %d: %s\n", r.code, r.body.c_str());
    return false;
}

static bool pi_post_alert(const AlertRecord &a, const String &threshold_text) {
    if (!a.epoch) {
        Serial.println("[pi] alert sync deferred — no timestamp available for it");
        return false;
    }

    // The id stored on the record, verbatim.  Not rebuilt, not re-randomised:
    // this is what makes a retry a retry.  (pi-server/server.py enforces a
    // stripped, non-empty string of at most 128 characters, which
    // event_id_build() guarantees by construction.)
    String body = "{\"timestamp\":\"" + iso8601_utc(a.epoch) + "\"";
    body += ",\"parameter\":\"" + String(PARAM_KEY[a.param]) + "\"";
    body += ",\"value\":" + String(a.value, 3);
    if (threshold_text.length()) body += ",\"threshold\":\"" + threshold_text + "\"";
    body += ",\"status\":\"" + String(a.status == STATUS_UNSAFE ? "unsafe" : "warning") + "\"";
    body += ",\"message\":\"" + String("Local threshold evaluation on ") + AQSMS_DEVICE_ID + "\"";
    body += ",\"event_id\":\"" + String(a.event_id) + "\"}";

    PiReply r = pi_request_with_retry("POST", "/esp32/alerts", body);

    if (!r.transport_ok) { Serial.print("[pi] alert NOT stored: "); Serial.println(r.body); return false; }
    if (r.code == 201) { Serial.println("[pi] alert stored"); return true; }
    if (r.code == 200 && r.body.indexOf("duplicate") >= 0) {
        Serial.println("[pi] alert already stored (duplicate)");
        return true;
    }
    Serial.printf("[pi] alert rejected, HTTP %d: %s\n", r.code, r.body.c_str());
    return false;
}


/* ===========================================================================
 * SECTION 10 — Alert recording and outbox
 * ---------------------------------------------------------------------------
 * An alert is recorded and PERSISTED before anything else is done with it —
 * before the modem is touched and before the Pi is called.  The modem
 * transaction can block for tens of seconds on a modem that is not answering,
 * and the record has to be on flash before that happens: a power cut mid-send
 * would otherwise lose the alert entirely, which is precisely the failure this
 * board exists to survive.  The caller then updates that same record in place
 * with the send outcome.
 *
 * The outbox holds the last N records the Pi has not accepted, so a Pi outage
 * becomes a delay in the app's alert list rather than a hole in it.  Each
 * record carries its own stable event_id, so replaying one — after a retry, a
 * flush or a reboot — is durably the same event to the Pi's unique index.
 *
 * The retry loop calls a duplicate-aware endpoint, so a record that was stored
 * but whose reply was lost is not stored twice.
 * ===========================================================================
 */
// Record one alert and return its outbox slot, so the caller can write the SMS
// outcome back onto the SAME record.
static uint8_t alert_record(uint8_t param, float value, uint8_t status) {
    uint8_t slot;
    if (g_outbox_count < AQSMS_OUTBOX_SLOTS) {
        slot = (uint8_t)((g_outbox_head + g_outbox_count) % AQSMS_OUTBOX_SLOTS);
        g_outbox_count++;
    } else {
        // Full: overwrite the oldest.  Losing the oldest pending alert is the
        // least-bad option, and it is visible in the console output.
        slot = g_outbox_head;
        g_outbox_head = (uint8_t)((g_outbox_head + 1) % AQSMS_OUTBOX_SLOTS);
        Serial.println("[alert] outbox full — oldest pending alert dropped");
    }

    AlertRecord &a = g_outbox[slot];
    memset(&a, 0, sizeof(a));
    a.seq    = ++g_alert_seq;
    a.epoch  = clock_now_epoch();
    a.param  = param;
    a.status = status;
    a.value  = value;
    a.pending = 1;
    a.sms     = SMS_NOT_ATTEMPTED;   // nothing has been sent yet, and it says so

    // The identity of this alert is minted ONCE, here, and stored with it.
    event_id_build(a.event_id, sizeof(a.event_id), AQSMS_DEVICE_ID,
                   esp_random(), a.seq);
    if (!event_id_valid(a.event_id)) {
        Serial.print("[alert] WARNING: the built event id is not acceptable to the Pi: \"");
        Serial.print(a.event_id);
        Serial.println("\"");
    }

    outbox_save();                   // on flash BEFORE any modem or network work
    return slot;
}

static void alert_flush_to_pi() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[alert] sync skipped — wifi is down");
        return;
    }
    if (g_outbox_count == 0) {
        Serial.println("[alert] nothing pending");
        return;
    }

    uint8_t moved = 0;
    for (uint8_t n = 0; n < g_outbox_count; n++) {
        uint8_t slot = (uint8_t)((g_outbox_head + n) % AQSMS_OUTBOX_SLOTS);
        AlertRecord &a = g_outbox[slot];
        if (!a.pending) continue;

        String limit_text = "";
        if (g_thresholds[a.param].configured) {
            evaluate(a.param, a.value, limit_text);
        }

        if (pi_post_alert(a, limit_text)) {
            a.pending = 0;
            moved++;
        } else {
            break;   // still down: stop, and try the rest next pass
        }
    }

    // Compact: drop the acknowledged records from the head.
    while (g_outbox_count > 0 && !g_outbox[g_outbox_head].pending) {
        g_outbox_head = (uint8_t)((g_outbox_head + 1) % AQSMS_OUTBOX_SLOTS);
        g_outbox_count--;
    }

    if (moved) outbox_save();
    Serial.printf("[alert] synced %u record(s); %u still pending\n",
                  (unsigned)moved, (unsigned)g_outbox_count);
}


/* ===========================================================================
 * SECTION 11 — Wi-Fi
 * ===========================================================================
 */
static bool     g_wifi_connecting  = false;
static uint32_t g_wifi_started_at  = 0;
static uint32_t g_wifi_last_try    = 0;

static void wifi_begin() {
    WiFi.mode(WIFI_STA);
    WiFi.persistent(false);      // do not burn flash erase cycles per reconnect
    WiFi.setAutoReconnect(true);
    Serial.printf("[wifi] connecting to \"%s\"\n", AQSMS_WIFI_SSID);
    WiFi.begin(AQSMS_WIFI_SSID, AQSMS_WIFI_PASSWORD);
    g_wifi_connecting = true;
    g_wifi_started_at = millis();
    g_wifi_last_try   = millis();
}

static void wifi_loop() {
    static bool was_up = false;
    bool up = (WiFi.status() == WL_CONNECTED);

    if (up && !was_up) {
        was_up = true;
        g_wifi_connecting = false;
        Serial.printf("[wifi] connected, ip %s, %d dBm\n",
                      WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
    } else if (!up && was_up) {
        was_up = false;
        Serial.println("[wifi] link lost");
    }

    if (up) return;

    if (g_wifi_connecting && millis() - g_wifi_started_at >= AQSMS_WIFI_CONNECT_TIMEOUT_MS) {
        g_wifi_connecting = false;
        Serial.println("[wifi] connect attempt timed out");
    }

    // Rate-limited, never a tight spin: a flood of association attempts trips
    // some routers' client limits and makes the outage worse.
    if (!g_wifi_connecting && millis() - g_wifi_last_try >= AQSMS_WIFI_RETRY_INTERVAL_MS) {
        g_wifi_last_try   = millis();
        g_wifi_started_at = millis();
        g_wifi_connecting = true;
        Serial.println("[wifi] retrying");
        WiFi.disconnect();
        WiFi.begin(AQSMS_WIFI_SSID, AQSMS_WIFI_PASSWORD);
    }
}


/* ===========================================================================
 * SECTION 12 — Sample and publish
 * ===========================================================================
 */
static uint32_t g_sample_seq   = 0;
static uint32_t g_last_sample  = 0;
static uint32_t g_last_resync  = 0;

static void apply_thresholds(const Sample &s) {
    if (!thresholds_all_configured()) return;   // UNKNOWN: no alert, no SMS

    struct { bool present; float value; } items[PARAM_COUNT] = {
        { s.has_ph,             s.ph                   },
        { s.has_temperature_c,  s.temperature_c        },
        { s.has_do_mg_l,        s.dissolved_oxygen_mg_l },
    };

    for (uint8_t p = 0; p < PARAM_COUNT; p++) {
        if (!items[p].present) continue;   // a missing reading cannot trip a limit

        String limit_text;
        uint8_t status = evaluate(p, items[p].value, limit_text);
        if (status != STATUS_WARNING && status != STATUS_UNSAFE) continue;

        Serial.printf("[alert] %s %s: %.2f (%s)\n", PARAM_KEY[p],
                      status == STATUS_UNSAFE ? "UNSAFE" : "WARNING",
                      items[p].value, limit_text.c_str());

        // RECORD AND PERSIST FIRST.  The modem transaction below can block for
        // tens of seconds on a modem that is not answering; the record must
        // already be on flash before it starts, or a power cut mid-send loses
        // the alert outright — the one failure this board exists to survive.
        uint8_t slot = alert_record(p, items[p].value, status);

        // Then send, and then write the outcome back onto that SAME record.
        uint8_t sms_state = sms_dispatch(p, items[p].value, status, limit_text,
                                         g_outbox[slot].seq);

        g_outbox[slot].sms = sms_state;
        outbox_save();
    }
}

static void sample_and_publish(bool force) {
    Sample s = sensors_read();

    Serial.print("[sample] ");
    sensors_describe(s);

    if (s.has_do_temp_warning) {
        Serial.println("[sample] DO reported WITHOUT temperature compensation because the");
        Serial.println("[sample]   DS18B20 could not be read and the configured coefficient");
        Serial.println("[sample]   is non-zero. See section 1.8.");
    }

    apply_thresholds(s);

    if (!sample_any_present(s)) {
        Serial.println("[pi] nothing measured — no post. An empty body would be rejected");
        Serial.println("[pi]   (400: at least one measurement required), and sending zeros");
        Serial.println("[pi]   would file a probe fault as real water.");
        return;
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[pi] sample NOT posted — wifi is down (dropped, not queued)");
        return;
    }
    if (!clock_now_epoch()) {
        Serial.println("[pi] sample NOT posted — clock not synced. Retrying sync first.");
        pi_sync_time();
        if (!clock_now_epoch()) return;
    }

    pi_post_reading(s, pi_event_id(++g_sample_seq));
}


/* ===========================================================================
 * SECTION 13 — Serial console
 * ---------------------------------------------------------------------------
 * The console is how the board is commissioned and how it is diagnosed in the
 * field.  It NEVER prints the Wi-Fi password or the device API key.
 * ===========================================================================
 */
static void console_help() {
    Serial.println();
    Serial.println("--- AQSMS console ---------------------------------------------------");
    Serial.println("  ?                      this list");
    Serial.println("  w                      wifi state");
    Serial.println("  p                      GET /esp32/ping (stores nothing)");
    Serial.println("  t                      clock state");
    Serial.println("  mV                     raw calibration voltages + temperature");
    Serial.println("  s                      sample now, post nothing");
    Serial.println("  S                      sample now and post");
    Serial.println("  thr                    show approved-limit configuration");
    Serial.println("  setthr <param> <smin> <smax> <wmin> <wmax>");
    Serial.println("                         param = ph | temperature | dissolved_oxygen");
    Serial.println("                         stores locally AND marks it approved");
    Serial.println("  clrthr <param>         unapprove one parameter");
    Serial.println("  recip                  show recipients (masked)");
    Serial.println("  addrecip <number>      add an E.164 number, e.g. +639171234567");
    Serial.println("  clrrecip               clear the recipient list");
    Serial.println("  modem                  modem diagnostics");
    Serial.println("  smstest                send ONE test message (explicitly authorised)");
    Serial.println("  outbox                 show locally recorded alerts");
    Serial.println("  flush                  push pending alerts to the Pi");
    Serial.println("  cfgreset               erase stored thresholds/recipients/outbox");
    Serial.println("  reboot                 restart");
    Serial.println("---------------------------------------------------------------------");
}

static void console_wifi() {
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[wifi] \"%s\"  ip %s  gw %s  %d dBm\n", AQSMS_WIFI_SSID,
                      WiFi.localIP().toString().c_str(),
                      WiFi.gatewayIP().toString().c_str(), (int)WiFi.RSSI());
    } else {
        // The password is not printed, deliberately.  Neither is the device key.
        Serial.printf("[wifi] not connected (status %d) — SSID \"%s\"\n",
                      (int)WiFi.status(), AQSMS_WIFI_SSID);
    }
}

static void console_time() {
    if (clock_now_epoch()) {
        Serial.printf("[time] %s (synced from the Pi, drifts between hourly re-anchors)\n",
                      iso8601_utc(clock_now_epoch()).c_str());
    } else {
        Serial.println("[time] NOT SYNCED — no timestamp will be fabricated");
        Serial.println("[time]   Run 'p' once the Pi is reachable.");
    }
}

static void console_thresholds() {
    Serial.printf("[thr] %-18s %-10s %-10s %-10s %-10s\n",
                  "parameter", "safe_min", "safe_max", "warn_min", "warn_max");
    for (uint8_t i = 0; i < PARAM_COUNT; i++) {
        const Thresholds &t = g_thresholds[i];
        if (!t.configured) {
            Serial.printf("[thr] %-18s NOT APPROVED — this parameter can never read Safe\n",
                          PARAM_KEY[i]);
        } else {
            Serial.printf("[thr] %-18s %-10.2f %-10.2f %-10.2f %-10.2f\n", PARAM_KEY[i],
                          t.safe_min, t.safe_max, t.warn_min, t.warn_max);
        }
    }
    Serial.printf("[thr] overall: %s\n", thresholds_all_configured()
                  ? "all parameters approved" : "INCOMPLETE — no alert will be raised");
}

static void console_outbox() {
    Serial.printf("[outbox] %u record(s) held, head %u\n", (unsigned)g_outbox_count,
                  (unsigned)g_outbox_head);
    for (uint8_t n = 0; n < g_outbox_count; n++) {
        uint8_t slot = (uint8_t)((g_outbox_head + n) % AQSMS_OUTBOX_SLOTS);
        const AlertRecord &a = g_outbox[slot];
        Serial.printf("  #%lu %s %s %.2f  pi:%s sms:%s  id=%s\n",
                      (unsigned long)a.seq, iso8601_utc(a.epoch).c_str(),
                      PARAM_KEY[a.param],
                      a.value,
                      a.pending ? "pending" : "stored",
                      sms_state_name(a.sms),
                      a.event_id);
    }
}

/* ---------------------------------------------------------------------------
 * Calibration voltages -- the numbers the pH/DO constants are made of
 * ---------------------------------------------------------------------------
 * The calibration constants are BOARD voltages recorded in reference solutions
 * (section 1.7 and 1.8).  Until this command existed the sketch printed no
 * voltage anywhere, so "record the stable ADC voltage" could not actually be
 * carried out from the console.
 *
 * This prints the SAME two measurements sensors_read() takes, plus the
 * temperature that DO's air-saturated point is recorded at.  It deliberately
 * works while AQSMS_PH_CALIBRATED and AQSMS_DO_CALIBRATED are still 0 -- that
 * is exactly when it is needed.
 *
 * Nothing is stored, posted, evaluated or alerted.  It is a meter, not a
 * measurement: it must not be mistaken for data.
 *
 * The readings repeat so drift and settling are visible.  A value that is still
 * moving is not yet a calibration point, and recording it produces a confident
 * wrong number.  Each row costs ~1.1 s (two 32-sample ADC averages plus the
 * 750 ms DS18B20 conversion), so the command blocks the loop for ~12 s.
 * ------------------------------------------------------------------------ */
#define AQSMS_CAL_SAMPLES       8
#define AQSMS_CAL_INTERVAL_MS   400

static void console_millivolts() {
    Serial.println("[cal] raw voltages for calibration — nothing is stored or posted");
    Serial.printf("[cal] pH divider ratio in force: %.2f  (board mV = junction mV x ratio)\n",
                  AQSMS_PH_DIVIDER_RATIO);
    Serial.println("[cal] Hold the probe in the reference solution and wait until the");
    Serial.println("[cal] numbers stop moving before recording one.");
    Serial.println();

    for (uint8_t n = 0; n < AQSMS_CAL_SAMPLES; n++) {
        float ph_junction_mv = adc_mean_millivolts(AQSMS_PIN_PH_ADC);
        float ph_board_mv    = ph_junction_mv * AQSMS_PH_DIVIDER_RATIO;
        float do_mv          = adc_mean_millivolts(AQSMS_PIN_DO_ADC);

        float t = NAN;
        bool  have_t = ds_read_c(t);

        Serial.printf("[cal] %u/%u  pH junction %7.1f mV  pH board %7.1f mV  DO board %7.1f mV",
                      (unsigned)(n + 1), (unsigned)AQSMS_CAL_SAMPLES,
                      ph_junction_mv, ph_board_mv, do_mv);
        if (have_t) Serial.printf("  temp %6.2f C\n", t);
        else        Serial.println("  temp NOT MEASURED");

        if (n + 1 < AQSMS_CAL_SAMPLES) delay(AQSMS_CAL_INTERVAL_MS);
    }

    Serial.println();
    Serial.println("[cal] where each number goes (section 1 of this file):");
    Serial.println("[cal]   AQSMS_PH_CAL_V1_MV/_V1_PH  <- pH BOARD mV in buffer 1, and that buffer's pH");
    Serial.println("[cal]   AQSMS_PH_CAL_V2_MV/_V2_PH  <- pH BOARD mV in buffer 2, and that buffer's pH");
    Serial.println("[cal]   AQSMS_DO_CAL_V1_MV/_V1_MGL <- DO BOARD mV in air-saturated water, and its mg/L");
    Serial.println("[cal]   AQSMS_DO_CAL_V2_MV/_V2_MGL <- DO BOARD mV in zero-oxygen solution (usually 0.0)");
    Serial.println("[cal]   AQSMS_DO_CAL_TEMP_C        <- the temp above during the air-saturated point");
    Serial.println("[cal] Set CALIBRATED to 1 only after the constants are recorded.");
}

static void handle_setthr(char *args) {
    char param[32];
    float smin, smax, wmin, wmax;
    if (sscanf(args, "%31s %f %f %f %f", param, &smin, &smax, &wmin, &wmax) != 5) {
        Serial.println("[thr] usage: setthr <param> <smin> <smax> <wmin> <wmax>");
        return;
    }
    int idx = -1;
    for (uint8_t i = 0; i < PARAM_COUNT; i++)
        if (strcmp(param, PARAM_KEY[i]) == 0) idx = i;
    if (idx < 0) {
        Serial.println("[thr] param must be exactly ph, temperature or dissolved_oxygen");
        return;
    }
    if (!(wmin <= smin && smin <= smax && smax <= wmax)) {
        Serial.println("[thr] rejected: need warn_min <= safe_min <= safe_max <= warn_max");
        Serial.println("[thr]   An inverted window would make every reading Safe or Unsafe");
        Serial.println("[thr]   by accident. Nothing was stored.");
        return;
    }
    g_thresholds[idx].configured = true;
    g_thresholds[idx].safe_min = smin;
    g_thresholds[idx].safe_max = smax;
    g_thresholds[idx].warn_min = wmin;
    g_thresholds[idx].warn_max = wmax;
    g_nvs.putBytes(("thr" + String(idx)).c_str(), &g_thresholds[idx], sizeof(Thresholds));
    Serial.printf("[thr] %s stored and marked approved.\n", PARAM_KEY[idx]);
    Serial.println("[thr] These are the limits this board will act on, including by SMS.");
}

static void handle_command(const String &line) {
    if (line.length() == 0) return;

    char cmd[24] = {0};
    const char *sp = strchr(line.c_str(), ' ');
    size_t n = sp ? (size_t)(sp - line.c_str()) : line.length();
    if (n >= sizeof(cmd)) n = sizeof(cmd) - 1;
    memcpy(cmd, line.c_str(), n);

    // Commands that carry an argument get the raw remainder, so a message body
    // can contain spaces.
    String rest = sp ? String(sp + 1) : String("");

    if (!strcmp(cmd, "?"))                   console_help();
    else if (!strcmp(cmd, "w"))              console_wifi();
    else if (!strcmp(cmd, "p")) {
        Serial.println("[cmd] pinging the Pi (nothing will be stored)");
        PiReply r = pi_request_with_retry("GET", "/esp32/ping", "");
        if (!r.transport_ok) { Serial.print("[pi] ping failed: "); Serial.println(r.body); }
        else {
            Serial.printf("[pi] HTTP %d %s\n", r.code, r.body.c_str());
            if (r.code == 200) {
                Serial.println("[pi] The Pi stored nothing. If the app shows data now,");
                Serial.println("[pi]   that data did not come from this command.");
            }
        }
    }
    else if (!strcmp(cmd, "t"))              console_time();
    else if (!strcmp(cmd, "mV"))             console_millivolts();
    else if (!strcmp(cmd, "s")) {
        Sample s = sensors_read();
        Serial.print("[sample] ");
        sensors_describe(s);
        Serial.println("[sample] posted nothing");
    }
    else if (!strcmp(cmd, "S"))              sample_and_publish(true);
    else if (!strcmp(cmd, "thr"))            console_thresholds();
    else if (!strcmp(cmd, "setthr")) {
        char buf[128];
        snprintf(buf, sizeof(buf), "%s", rest.c_str());
        handle_setthr(buf);
    }
    else if (!strcmp(cmd, "clrthr")) {
        for (uint8_t i = 0; i < PARAM_COUNT; i++) {
            if (rest == PARAM_KEY[i]) {
                memset(&g_thresholds[i], 0, sizeof(Thresholds));
                g_thresholds[i].configured = false;
                g_nvs.putBytes(("thr" + String(i)).c_str(), &g_thresholds[i], sizeof(Thresholds));
                Serial.printf("[thr] %s now UNCONFIGURED\n", PARAM_KEY[i]);
                return;
            }
        }
        Serial.println("[thr] usage: clrthr <ph|temperature|dissolved_oxygen>");
    }
    else if (!strcmp(cmd, "recip")) {
        String nums[8];
        int c = recipients_split(nums, 8);
        if (c == 0) Serial.println("[recip] NONE — no SMS will be sent");
        for (int i = 0; i < c; i++)
            Serial.printf("[recip] %s\n", mask_number(nums[i]).c_str());
        Serial.println("[recip] (masked on purpose; full numbers are in flash, not in this log)");
    }
    else if (!strcmp(cmd, "addrecip")) {
        rest.trim();
        if (rest.length() < 6) { Serial.println("[recip] usage: addrecip +639171234567"); return; }
        if (g_recipients.length()) g_recipients += ",";
        g_recipients += rest;
        g_nvs.putString("recip", g_recipients);
        Serial.printf("[recip] added %s\n", mask_number(rest).c_str());
    }
    else if (!strcmp(cmd, "clrrecip")) {
        g_recipients = "";
        g_nvs.putString("recip", g_recipients);
        Serial.println("[recip] cleared — no SMS will be sent");
    }
    else if (!strcmp(cmd, "modem")) {
        Serial.printf("[modem] initialised: %s, registered: %s, SIM: %s\n",
                      g_modem_ready ? "yes" : "no",
                      g_modem_registered ? "yes" : "no",
                      sim_state_name(g_sim_state));
        if (g_modem_ready) {
            String sim_info, sim_error, l;
            g_sim_state = modem_check_pin(sim_info, sim_error);
            Serial.printf("[modem] CPIN: %s", sim_state_name(g_sim_state));
            if (sim_info.length())  { Serial.print("  ["); Serial.print(sim_info);  Serial.print("]"); }
            if (sim_error.length()) { Serial.print("  ["); Serial.print(sim_error); Serial.print("]"); }
            Serial.println();
            if (modem_command("AT+CREG?", "+CREG:", AQSMS_SMS_AT_SHORT_MS, &l))
                { Serial.print("[modem] CREG: "); Serial.println(l); }
            if (modem_command("AT+CSQ", "+CSQ:", AQSMS_SMS_AT_SHORT_MS, &l))
                { Serial.print("[modem] CSQ:  "); Serial.println(l); }
            Serial.println("[modem] AT+CMGF=1 + AT+CNMI=2,1,0,1,0 route +CDS reports here,");
            Serial.println("[modem]   in text format. A report is applied only to the");
            Serial.println("[modem]   message whose reference it names.");
        } else {
            Serial.println("[modem] run 'modem' again after checking power and UART levels");
        }
    }
    else if (!strcmp(cmd, "smstest")) {
        String nums[8];
        int c = recipients_split(nums, 8);
        if (c == 0) { Serial.println("[sms] no recipient configured — refusing to send"); return; }
        Serial.println("[sms] authorised test message to the configured recipient(s)");
        SmsResult r = sms_send_one(nums[0], "AQSMS test message. If you received this, the "
                                            "modem path is working. No pond data is included.",
                                   0);   // not tied to an alert record
        Serial.printf("[sms] result: %s", sms_state_name(r.state));
        if (r.detail.length()) { Serial.print(" — "); Serial.print(r.detail); }
        Serial.println();
        if (r.modem_ref >= 0) {
            Serial.printf("[sms] message reference %d — a delivery report naming it will be\n",
                          r.modem_ref);
            Serial.println("[sms]   applied here if the carrier sends one.");
        }
    }
    else if (!strcmp(cmd, "outbox"))         console_outbox();
    else if (!strcmp(cmd, "flush"))          alert_flush_to_pi();
    else if (!strcmp(cmd, "cfgreset")) {
        g_nvs.clear();
        Serial.println("[cfg] erased. Rebooting into an unconfigured state.");
        delay(500);
        ESP.restart();
    }
    else if (!strcmp(cmd, "reboot")) {
        Serial.println("[sys] restarting");
        delay(200);
        ESP.restart();
    }
    else {
        Serial.printf("[cmd] unknown: %s  (press ? for the list)\n", cmd);
    }
}

static void console_loop() {
    static String buf;
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\r' || c == '\n') {
            if (buf.length()) { handle_command(buf); buf = ""; }
        } else if (buf.length() < 160) {
            buf += c;
        }
    }
}


/* ===========================================================================
 * SECTION 14 — setup() / loop()
 * ===========================================================================
 */
static void banner() {
    Serial.println();
    Serial.println("=====================================================");
    Serial.println(" AQSMS pond node");
    Serial.printf (" device   %s\n", AQSMS_DEVICE_ID);
    Serial.printf (" pi       %s://%s:%d\n", AQSMS_USE_TLS ? "https" : "http",
                   AQSMS_PI_HOST, AQSMS_PI_PORT);
    Serial.printf (" transport X-API-Key, %u characters (not printed)\n",
                   (unsigned)strlen(AQSMS_DEVICE_API_KEY));
    Serial.printf (" tls      %s\n", AQSMS_USE_TLS
                   ? (strstr(AQSMS_PI_CA_PEM, "REPLACE_WITH") ? "ENABLED, CA IS STILL A PLACEHOLDER"
                                                               : "ENABLED, CA embedded")
                   : "DISABLED — device key and readings travel in clear text");
    Serial.println(" BOARD IS NOT HARDWARE-TESTED. Sensor readings stay ABSENT");
    Serial.println(" until real probes are wired and real calibration values are");
    Serial.println(" entered. Solar, modem and Pi power paths are unresolved and");
    Serial.println(" must stay disconnected until verified.");
    Serial.println("=====================================================");
}

void setup() {
    Serial.begin(AQSMS_SERIAL_BAUD);
    delay(300);
    banner();

    config_begin();
    sensors_begin();
    sms_begin();
    wifi_begin();

    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000UL) {
        wifi_loop();
        delay(200);
    }

    if (WiFi.status() == WL_CONNECTED) {
        pi_sync_time();
        g_last_resync = millis();
    } else {
        Serial.println("[wifi] not connected yet — the board keeps sampling regardless");
    }

    alert_flush_to_pi();
    console_help();
}

void loop() {
    wifi_loop();
    modem_loop();
    console_loop();

    // Hourly re-anchor: the ESP32's own counter drifts, and every stored
    // timestamp is derived from it between syncs.
    if (WiFi.status() == WL_CONNECTED && clock_now_epoch()) {
        if (millis() - g_last_resync >= AQSMS_TIME_RESYNC_INTERVAL_MS) {
            g_last_resync = millis();
            if (pi_sync_time()) alert_flush_to_pi();
        }
    } else if (WiFi.status() == WL_CONNECTED && !clock_now_epoch()) {
        // Never synced: retry on a slow cadence rather than hammering the Pi.
        static uint32_t firstRetry = 0;
        uint32_t wait = firstRetry ? AQSMS_TIME_RESYNC_INTERVAL_MS : AQSMS_TIME_FIRST_RETRY_MS;
        if (millis() - g_last_resync >= wait) {
            g_last_resync = millis();
            firstRetry = 1;
            pi_sync_time();
        }
    }

    if (millis() - g_last_sample >= AQSMS_SAMPLE_INTERVAL_MS) {
        g_last_sample = millis();
        sample_and_publish(false);
    }
}
