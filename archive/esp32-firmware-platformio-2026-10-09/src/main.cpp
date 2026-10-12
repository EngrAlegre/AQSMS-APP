// AQSMS ESP32 firmware -- board sketch.
//
// Target board: ESP32 DevKitC (WROOM-32). See ESP32_TO_PI_SETUP.md.
//
// What this firmware does today:
//   * joins the same Wi-Fi as the Raspberry Pi
//   * reads the Pi's clock and uses it as a time base
//   * takes a sample every five minutes and posts it, when a sensor provides
//     one -- with no sensors wired, nothing is posted
//   * answers serial commands so the link can be tested without any sensor
//
// What it deliberately does NOT do:
//   * invent a measurement, a threshold, or a timestamp
//   * send SMS -- see sms.h; the SIM900 is not wired and is not guessed at

#include <Arduino.h>

#include "config.h"
#include "pi_client.h"
#include "sensors.h"
#include "sms.h"
#include "wifi_link.h"

namespace {

uint32_t s_lastSampleAt = 0;
uint32_t s_lastTimeAttemptAt = 0;

void print_help() {
    Serial.println();
    Serial.println("Commands:");
    Serial.println("  w  Wi-Fi link state");
    Serial.println("  p  Ping the Pi. Proves the link and the device key, stores nothing.");
    Serial.println("  s  Take a sensor sample and print it (posts nothing).");
    Serial.println("  t  Show this board's current time and whether it is synced.");
    Serial.println("  ?  This list.");
    Serial.println();
}

void describe_time() {
    Serial.printf("[time] synced: %s\n", pi_time_valid() ? "yes" : "no");
    char stamp[24];
    if (pi_time_iso(stamp, sizeof(stamp))) {
        Serial.printf("[time] now:    %s\n", stamp);
    } else {
        Serial.println("[time] now:    unknown -- the Pi's clock has not been read,"
                       " so readings will not be posted");
    }
}

// Read the sensors and publish, if there is anything to publish.
void sample_and_publish() {
    const SensorReadings readings = sensors_read();
    sensors_describe(readings);

    if (!sensors_any_present(readings)) {
        // Either nothing is wired, or every probe failed. Nothing is sent: an
        // all-null reading is refused by the Pi, and sending zeros would put
        // fabricated measurements into the pond history.
        Serial.println("[loop] no measurements available; nothing posted");
        return;
    }

    if (!wifi_link_up()) {
        Serial.println("[loop] no Wi-Fi; this sample is dropped rather than queued.");
        return;
    }

    if (!pi_time_valid()) {
        // Without a synced clock there is no honest timestamp available, and a
        // guessed one would file the measurement at the wrong time.
        Serial.println("[loop] clock not synced; not posting a reading with a guessed timestamp");
        return;
    }

    char eventId[96];
    pi_next_event_id(eventId, sizeof(eventId));

    const PiResult res = pi_post_reading(readings, eventId);
    pi_describe_result("reading", res);
}

void handle_serial_commands() {
    if (!Serial.available()) {
        return;
    }
    const char c = (char)Serial.read();
    switch (c) {
        case 'w':
            wifi_link_describe();
            break;
        case 'p': {
            // The connectivity test. Stores nothing on the Pi, so it can be run
            // as often as you like during bring-up.
            Serial.println("[cmd] pinging the Pi (nothing will be stored)");
            const PiResult res = pi_ping();
            pi_describe_result("ping", res);
            break;
        }
        case 's': {
            const SensorReadings readings = sensors_read();
            sensors_describe(readings);
            if (!sensors_any_present(readings)) {
                Serial.println("[cmd] nothing to report -- no sensor is providing a measurement");
            }
            break;
        }
        case 't':
            describe_time();
            break;
        case '?':
        case '\r':
        case '\n':
            print_help();
            break;
        default:
            Serial.printf("[cmd] \"%c\" is not a command. Press '?' for the list.\n", c);
            break;
    }
}

}  // namespace

void setup() {
    Serial.begin(AQSMS_SERIAL_BAUD);
    delay(300);

    Serial.println();
    Serial.println("AQSMS ESP32 -> Raspberry Pi");
    Serial.printf("  device id : %s\n", AQSMS_DEVICE_ID);
    Serial.printf("  pi        : %s://%s:%d\n", AQSMS_USE_TLS ? "https" : "http",
                  AQSMS_PI_HOST, (int)AQSMS_PI_PORT);
    if (AQSMS_USE_TLS == 0) {
        Serial.println("  NOTE: plain HTTP. The device key and every measurement"
                       " are sent unencrypted.");
    }
    Serial.printf("  sampling  : every %lu s\n", (unsigned long)(AQSMS_SAMPLE_INTERVAL_MS / 1000UL));
    print_help();

    sensors_begin();
    sms_begin();
    wifi_link_begin();

    // The first sample needs two things the board cannot supply on its own: a
    // connection, and a clock. Give the Wi-Fi a moment to associate.
    for (int i = 0; i < 100 && !wifi_link_up(); ++i) {
        wifi_link_loop();
        delay(100);
    }
    if (wifi_link_up()) {
        pi_sync_time();
    } else {
        Serial.println("[setup] Wi-Fi not up yet; the clock will be read once it connects");
    }

    s_lastSampleAt = millis();
    s_lastTimeAttemptAt = millis();
}

void loop() {
    wifi_link_loop();

    // Keep the clock correct. The ESP32 has no battery-backed real-time clock,
    // so its counter drifts and has to be re-anchored to the Pi's time.
    if (!pi_time_valid()) {
        if (millis() - s_lastTimeAttemptAt >= AQSMS_TIME_FIRST_RETRY_MS) {
            s_lastTimeAttemptAt = millis();
            Serial.println("[time] retrying the initial clock read");
            pi_sync_time();
        }
    } else if (millis() - s_lastTimeAttemptAt >= AQSMS_TIME_RESYNC_INTERVAL_MS) {
        s_lastTimeAttemptAt = millis();
        pi_sync_time();
    }

    if (millis() - s_lastSampleAt >= AQSMS_SAMPLE_INTERVAL_MS) {
        s_lastSampleAt = millis();
        sample_and_publish();
    }

    handle_serial_commands();
    delay(20);
}
