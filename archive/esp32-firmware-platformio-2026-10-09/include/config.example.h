#pragma once

// ---------------------------------------------------------------------------
// Copy this file to include/config.h and fill it in:
//
//     cp include/config.example.h include/config.h
//
// include/config.h is gitignored. Every value below is a placeholder; none of
// them is a real network name, address or credential.
// ---------------------------------------------------------------------------

// ---- Wi-Fi -----------------------------------------------------------------
// The same network the Raspberry Pi is on.
//
// 2.4 GHz only. The ESP32 has no 5 GHz radio, so a 5 GHz-only SSID will not
// appear in a scan and will not connect. If your router publishes one SSID for
// both bands, it is usually fine; if it publishes separate ones, pick the
// 2.4 GHz name.
//
// A guest network is a different network even when it comes from the same
// router: devices on it often cannot reach each other at all.
#define AQSMS_WIFI_SSID "REPLACE_WITH_YOUR_WIFI_NAME"
#define AQSMS_WIFI_PASSWORD "REPLACE_WITH_YOUR_WIFI_PASSWORD"

// ---- Raspberry Pi API ------------------------------------------------------
#define AQSMS_PI_HOST "REPLACE_WITH_PI_ADDRESS"
#define AQSMS_PI_PORT 8443

// 1 = HTTPS, 0 = plain HTTP.
//
// Use 1 once the Pi has a certificate. With 0, the device API key and every
// measurement cross the Wi-Fi as readable text, and anyone on the network can
// read them or post measurements of their own.
//
// This is the DEVICE connection and is independent of how the phone connects;
// they should match, but setting one does not change the other.
#define AQSMS_USE_TLS 1

// The device's own credential. This is NOT the farmer's username/password.
// Mint it on the Pi and keep the printed value:
//
//     cd ~/aqsms/pi-server
//     ./venv/bin/python setup_account.py --add-esp32-key
//
// A farmer login token cannot post measurements, and this key cannot read the
// farmer's data. They are separate systems on purpose.
#define AQSMS_DEVICE_API_KEY "REPLACE_WITH_DEVICE_API_KEY"

// Identifies this board in event ids. Change it if you ever run a second board
// against the same Pi, so the two cannot collide.
#define AQSMS_DEVICE_ID "esp32-pond-1"

// ---- Pi CA certificate -----------------------------------------------------
// Only used when AQSMS_USE_TLS is 1.
//
// Paste the entire contents of pi-server/certs/aqsms-ca.crt on the Pi, BEGIN
// line through END line, between the markers below. Obtain it with:
//
//     cat ~/aqsms/pi-server/certs/aqsms-ca.crt
//
// This is the PUBLIC certificate, so it is safe to keep in config.h. The
// matching private key stays on the Pi and must never be copied here.
//
// If you leave the placeholder text, the TLS handshake fails and no data is
// sent. That is deliberate: failing closed is better than accepting any
// certificate, which would defeat the point of pinning.
#define AQSMS_PI_CA_PEM R"PEM(-----BEGIN CERTIFICATE-----
REPLACE_WITH_THE_CONTENTS_OF_pi-server_certs_aqsms-ca.crt
-----END CERTIFICATE-----
)PEM"

// ---- Timings ---------------------------------------------------------------
// 5 minutes, matching the app's assumptions: its history request asks for 288
// records, which is 24 hours at this interval.
#define AQSMS_SAMPLE_INTERVAL_MS 300000UL

// A request that has not answered in this long is treated as failed. Short
// enough that a powered-off Pi does not stall the board for minutes.
#define AQSMS_HTTP_TIMEOUT_MS 8000L

// Retries per POST, with the same event id each time, so a retry after a
// dropped reply is stored once and not twice.
#define AQSMS_HTTP_MAX_ATTEMPTS 3

#define AQSMS_WIFI_CONNECT_TIMEOUT_MS 20000UL
#define AQSMS_WIFI_RETRY_INTERVAL_MS 15000UL

// How often to re-read the Pi's clock, because the ESP32 has no battery-backed
// real-time clock and its own millisecond counter drifts.
#define AQSMS_TIME_RESYNC_INTERVAL_MS 3600000UL

// How often to retry the initial clock read while it has never succeeded.
#define AQSMS_TIME_FIRST_RETRY_MS 60000UL

#define AQSMS_SERIAL_BAUD 115200
