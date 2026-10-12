#pragma once

#include <Arduino.h>

#include "sensors.h"

// The outcome of one API call.
//
// ok is true only for a 2xx reply. body holds the server's response text on
// success, or the transport error on failure -- never a synthesised "success".
struct PiResult {
    bool ok;
    int status;  // HTTP status, or a negative HTTPClient error code
    String body;
};

// GET /esp32/ping.
//
// This is the connectivity test. It proves the board can reach the Pi, that the
// Wi-Fi is up, that the device key is accepted, and (over TLS) that the
// certificate is trusted -- and it stores nothing, so bring-up never leaves a
// fake measurement in the pond history.
PiResult pi_ping();

// Read the Pi's clock and use it as this board's time base. The ESP32 has no
// battery-backed real-time clock, so its own counter is only an interval
// measure, not a date.
void pi_sync_time();

// True once the Pi's clock has been read at least once.
bool pi_time_valid();

// Format the current time as ISO-8601 UTC (the format the Pi expects) into out.
// Returns false when the clock has never been synced. Callers must NOT post
// anything in that case: a guessed timestamp would land a measurement at the
// wrong time, or in the wrong order, in the pond history.
bool pi_time_iso(char *out, size_t outLen);

// Fill out with an identifier unique to one sample, stable across retries of
// that same sample, so a retry after a lost reply is stored once, not twice.
void pi_next_event_id(char *out, size_t outLen);

// POST /esp32/readings. Only parameters with has* set are included; absent
// measurements are omitted rather than sent as zero.
PiResult pi_post_reading(const SensorReadings &r, const char *eventId);

// POST /esp32/alerts. Sends an alert event to the Pi for logging.
//
// This does not decide whether a reading is unsafe. Choosing that requires
// approved limits, and the Pi's thresholds table is deliberately unapproved
// (NULL limits, approved = 0). This firmware ships no threshold constants at
// all, so that a limit can never be invented in two places and drift.
//
// The Pi logs the event. Sending SMS is the board's own separate job -- see
// sms.h -- and is not triggered from here.
PiResult pi_post_alert(const char *parameter,
                       bool hasValue,
                       float value,
                       const char *thresholdText,
                       const char *status,
                       const char *message,
                       const char *eventId);

// Print a human-readable result line to the serial console.
void pi_describe_result(const char *what, const PiResult &res);
