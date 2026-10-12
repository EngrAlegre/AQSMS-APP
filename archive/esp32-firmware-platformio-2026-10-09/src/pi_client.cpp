#include "pi_client.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_random.h>
#include <esp_system.h>

#include <math.h>

#include "config.h"
#include "wifi_link.h"

namespace {

// --- Time base --------------------------------------------------------------
//
// The Pi's clock is read once at start-up and used as an origin: current time
// is that origin plus however many milliseconds have elapsed since. The ESP32's
// millisecond counter is a decent interval measure but not a date, so without
// this the board could not produce the ISO-8601 timestamp the API requires.
//
// Two consequences worth knowing:
//   * The board re-syncs hourly, because the millisecond counter drifts.
//   * Between syncs the timestamp is only as good as that counter. For a pond
//     sampled every five minutes this is well inside the noise of the reading
//     itself, but it is not a precision time source.
bool s_timeValid = false;
int64_t s_epochAtSync = 0;
uint32_t s_millisAtSync = 0;

// --- Event ids --------------------------------------------------------------
uint32_t s_eventSeq = 0;
char s_bootId[9] = {0};

// --- Civil date arithmetic --------------------------------------------------
//
// Days since 1970-01-01 for a civil date, and the inverse. Howard Hinnant's
// algorithms. Written out rather than calling timegm()/gmtime_r() so the
// firmware does not depend on which libc the core was built against.
int64_t days_from_civil(int y, unsigned m, unsigned d) {
    y -= (m <= 2);
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = (unsigned)(y - era * 400);
    const unsigned doy = (153u * (m + (m > 2 ? -3u : 9u)) + 2u) / 5u + d - 1u;
    const unsigned doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
    return era * 146097 + (int64_t)doe - 719468;
}

void civil_from_days(int64_t z, int *y, unsigned *m, unsigned *d) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = (unsigned)(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460u + doe / 36524u - doe / 146096u) / 365u;
    const int64_t yr = (int64_t)yoe + era * 400;
    const unsigned doy = doe - (365u * yoe + yoe / 4u - yoe / 100u);
    const unsigned mp = (5u * doy + 2u) / 153u;
    const unsigned dd = doy - (153u * mp + 2u) / 5u + 1u;
    const unsigned mm = mp + (mp < 10u ? 3u : (unsigned)-9);
    *y = (int)(yr + (mm <= 2));
    *m = mm;
    *d = dd;
}

bool parse_iso_utc(const char *s, int64_t *outEpoch) {
    if (s == nullptr) {
        return false;
    }
    int y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0;
    if (sscanf(s, "%4d-%2d-%2dT%2d:%2d:%2d", &y, &mo, &d, &h, &mi, &sec) != 6) {
        return false;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60) {
        return false;
    }
    // The Pi sends UTC with a trailing Z. A numeric offset is refused rather
    // than misread: treating "+08:00" as UTC would shift every stored timestamp
    // by eight hours, and a quietly wrong time is worse than no sync at all.
    const size_t len = strlen(s);
    if (len > 19 && s[19] != 'Z' && s[19] != 'z') {
        return false;
    }
    *outEpoch = days_from_civil(y, (unsigned)mo, (unsigned)d) * 86400
              + (int64_t)h * 3600 + (int64_t)mi * 60 + sec;
    return true;
}

// --- JSON helpers -----------------------------------------------------------

// Escape a string for embedding in JSON. The values passed here are our own
// constants and device id, so this is belt and braces rather than a parser, but
// an unescaped quote would produce a body the Pi rejects.
void append_json_string(String &out, const char *value) {
    out += '"';
    for (const char *p = value; p != nullptr && *p != '\0'; ++p) {
        const unsigned char c = (unsigned char)*p;
        if (c == '"' || c == '\\') {
            out += '\\';
            out += (char)c;
        } else if (c >= 0x20) {
            out += (char)c;
        }
        // Control characters are dropped rather than escaped; none is valid in
        // a measurement, a parameter name or a message.
    }
    out += '"';
}

// Append "key":value for a measurement that was actually taken.
//
// A parameter that was not measured is left out entirely -- not written as 0,
// and not written as null. A zero would be indistinguishable from a real
// measurement of zero, which would let a disconnected probe read as perfect
// water. A non-finite value is a sensor fault, not a reading, so it is left out
// too and reported on the console.
void append_measurement(String &out, const char *key, bool present, float value) {
    if (!present) {
        return;
    }
    if (!isfinite(value)) {
        Serial.printf("[pi] %s was not a finite number; omitted from the payload\n", key);
        return;
    }
    out += ",\"";
    out += key;
    out += "\":";
    out += String(value, 2);
}

// Pull "key":"value" out of a small JSON reply without a JSON library. The
// replies read this way are the Pi's own, with a fixed shape.
bool extract_string(const String &body, const char *key, char *out, size_t outLen) {
    const String needle = String("\"") + key + "\"";
    const int k = body.indexOf(needle);
    if (k < 0) {
        return false;
    }
    const int colon = body.indexOf(':', k + (int)needle.length());
    if (colon < 0) {
        return false;
    }
    const int q1 = body.indexOf('"', colon + 1);
    if (q1 < 0) {
        return false;
    }
    const int q2 = body.indexOf('"', q1 + 1);
    if (q2 < 0) {
        return false;
    }
    const size_t len = (size_t)(q2 - q1 - 1);
    if (len + 1 > outLen) {
        return false;
    }
    body.substring(q1 + 1, q2).toCharArray(out, outLen);
    return true;
}

// --- HTTP -------------------------------------------------------------------

PiResult request(const char *path, const String *payload) {
    PiResult res;
    res.ok = false;
    res.status = 0;

    if (!wifi_link_up()) {
        res.body = F("wifi is down");
        return res;
    }

    const String url = String(AQSMS_USE_TLS ? "https://" : "http://")
                     + AQSMS_PI_HOST + ":" + String(AQSMS_PI_PORT) + path;

    WiFiClient plain;
    WiFiClientSecure tls;
    HTTPClient http;

    // Both timeouts matter: connect covers reaching the Pi at all, and the
    // read timeout covers a Pi that accepts the connection and then stalls.
    http.setConnectTimeout(AQSMS_HTTP_TIMEOUT_MS);
    http.setTimeout(AQSMS_HTTP_TIMEOUT_MS);
    http.setReuse(false);

    bool begun;
    if (AQSMS_USE_TLS) {
        // Pins the Pi's CA. If AQSMS_PI_CA_PEM is still the placeholder the
        // handshake fails and nothing is sent -- failing closed is the point.
        tls.setCACert(AQSMS_PI_CA_PEM);
        begun = http.begin(tls, url);
    } else {
        begun = http.begin(plain, url);
    }
    if (!begun) {
        res.body = F("could not open the connection");
        return res;
    }

    http.addHeader("Accept", "application/json");
    http.addHeader("X-API-Key", AQSMS_DEVICE_API_KEY);

    int status;
    if (payload != nullptr) {
        http.addHeader("Content-Type", "application/json");
        status = http.POST((uint8_t *)payload->c_str(), payload->length());
    } else {
        status = http.GET();
    }

    res.status = status;
    if (status > 0) {
        res.ok = (status >= 200 && status < 300);
        res.body = http.getString();
    } else {
        // Transport-level failure. HTTPClient's own wording is more useful than
        // a bare negative number, and distinguishes "could not connect" from
        // "the certificate was not trusted".
        res.body = HTTPClient::errorToString(status);
    }
    http.end();
    return res;
}

// Retry with backoff. Only transport failures and 5xx are retried: a 4xx means
// the server refused this exact request, and sending the identical body again
// will be refused identically.
//
// Note that this blocks the main loop for up to (attempts x timeout). With the
// defaults above that is under half a minute, once every five minutes at worst,
// which is acceptable for a pond monitor; it is not acceptable if this firmware
// later grows a job that must run on time.
PiResult request_with_retry(const char *path, const String *payload) {
    PiResult res = request(path, payload);
    for (int attempt = 2; res.status <= 0 || (res.status >= 500 && res.status < 600);
         ++attempt) {
        if (attempt > AQSMS_HTTP_MAX_ATTEMPTS) {
            break;
        }
        const uint32_t backoff = 500UL << (attempt - 2);
        Serial.printf("[pi] %s failed (%s); attempt %d of %d in %lu ms\n", path,
                      res.body.c_str(), attempt, (int)AQSMS_HTTP_MAX_ATTEMPTS,
                      (unsigned long)backoff);
        delay(backoff);
        res = request(path, payload);
    }
    return res;
}

}  // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

PiResult pi_ping() {
    return request_with_retry("/esp32/ping", nullptr);
}

void pi_sync_time() {
    const PiResult res = pi_ping();
    if (!res.ok) {
        Serial.printf("[pi] clock sync failed: %s\n", res.body.c_str());
        return;
    }

    char stamp[32];
    if (!extract_string(res.body, "timestamp", stamp, sizeof(stamp))) {
        Serial.println("[pi] reply had no timestamp; clock not set");
        return;
    }

    int64_t epoch = 0;
    if (!parse_iso_utc(stamp, &epoch)) {
        Serial.printf("[pi] could not read timestamp \"%s\"; clock not set\n", stamp);
        return;
    }

    s_epochAtSync = epoch;
    s_millisAtSync = millis();
    s_timeValid = true;
    Serial.printf("[pi] clock set from the Pi: %s\n", stamp);
}

bool pi_time_valid() {
    return s_timeValid;
}

bool pi_time_iso(char *out, size_t outLen) {
    if (out == nullptr || outLen == 0) {
        return false;
    }
    if (!s_timeValid) {
        out[0] = '\0';
        return false;
    }

    const int64_t now = s_epochAtSync + (int64_t)((millis() - s_millisAtSync) / 1000UL);
    int y = 0;
    unsigned mo = 0, d = 0;
    civil_from_days(now / 86400, &y, &mo, &d);
    int64_t rem = now % 86400;
    if (rem < 0) {
        rem += 86400;
    }
    const int h = (int)(rem / 3600);
    const int mi = (int)((rem % 3600) / 60);
    const int sec = (int)(rem % 60);

    const int written = snprintf(out, outLen, "%04d-%02u-%02uT%02d:%02d:%02dZ", y, mo, d, h, mi, sec);
    return written > 0 && (size_t)written < outLen;
}

void pi_next_event_id(char *out, size_t outLen) {
    if (out == nullptr || outLen == 0) {
        return;
    }
    if (s_bootId[0] == '\0') {
        // A per-boot random prefix needs no flash storage and no clock, and
        // keeps ids from a rebooted board distinct from the previous run's.
        snprintf(s_bootId, sizeof(s_bootId), "%08lx", (unsigned long)esp_random());
    }
    snprintf(out, outLen, "%s-%s-%lu", AQSMS_DEVICE_ID, s_bootId,
             (unsigned long)++s_eventSeq);
}

PiResult pi_post_reading(const SensorReadings &r, const char *eventId) {
    PiResult res;
    res.ok = false;
    res.status = 0;

    char timestamp[24];
    if (!pi_time_iso(timestamp, sizeof(timestamp))) {
        res.body = F("clock not synced");
        Serial.println("[pi] refusing to post a reading with a guessed timestamp");
        return res;
    }
    if (eventId == nullptr || eventId[0] == '\0') {
        res.body = F("missing event id");
        return res;
    }

    String body = "{";
    body += "\"timestamp\":";
    append_json_string(body, timestamp);
    append_measurement(body, "ph", r.has_ph, r.ph);
    append_measurement(body, "temperature_c", r.has_temperature_c, r.temperature_c);
    append_measurement(body, "dissolved_oxygen_mg_l", r.has_dissolved_oxygen_mg_l,
                       r.dissolved_oxygen_mg_l);
    body += ",\"event_id\":";
    append_json_string(body, eventId);
    body += "}";

    return request_with_retry("/esp32/readings", &body);
}

PiResult pi_post_alert(const char *parameter,
                       bool hasValue,
                       float value,
                       const char *thresholdText,
                       const char *status,
                       const char *message,
                       const char *eventId) {
    PiResult res;
    res.ok = false;
    res.status = 0;

    char timestamp[24];
    if (!pi_time_iso(timestamp, sizeof(timestamp))) {
        res.body = F("clock not synced");
        return res;
    }
    if (eventId == nullptr || eventId[0] == '\0') {
        res.body = F("missing event id");
        return res;
    }

    String body = "{";
    body += "\"timestamp\":";
    append_json_string(body, timestamp);
    body += ",\"parameter\":";
    append_json_string(body, parameter);
    if (hasValue && isfinite(value)) {
        body += ",\"value\":";
        body += String(value, 2);
    }
    if (thresholdText != nullptr) {
        body += ",\"threshold\":";
        append_json_string(body, thresholdText);
    }
    body += ",\"status\":";
    append_json_string(body, status);
    if (message != nullptr) {
        body += ",\"message\":";
        append_json_string(body, message);
    }
    body += ",\"event_id\":";
    append_json_string(body, eventId);
    body += "}";

    return request_with_retry("/esp32/alerts", &body);
}

void pi_describe_result(const char *what, const PiResult &res) {
    if (res.ok) {
        // A 200 saying "duplicate" means this exact event id was already stored
        // -- usually a reply that was lost and then retried. It is a success,
        // and it is worth seeing, because a run of them means the network is
        // dropping replies.
        if (res.body.indexOf("duplicate") >= 0) {
            Serial.printf("[pi] %s already stored (duplicate event id, not written twice)\n", what);
        } else {
            Serial.printf("[pi] %s accepted: %s\n", what, res.body.c_str());
        }
        return;
    }
    if (res.status > 0) {
        Serial.printf("[pi] %s rejected, HTTP %d: %s\n", what, res.status, res.body.c_str());
    } else {
        Serial.printf("[pi] %s failed: %s\n", what, res.body.c_str());
    }
}
