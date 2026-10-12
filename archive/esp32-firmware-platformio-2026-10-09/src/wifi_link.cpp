#include "wifi_link.h"

#include <WiFi.h>

#include "config.h"

namespace {
bool s_connecting = false;
uint32_t s_connectStartedAt = 0;
uint32_t s_lastAttemptAt = 0;
}  // namespace

void wifi_link_begin() {
    WiFi.mode(WIFI_STA);

    // Do not write credentials to flash on every connect. The ESP32's flash has
    // a finite number of erase cycles, and a board that reconnects often would
    // burn through them for no benefit.
    WiFi.persistent(false);

    // The Pi is reached by address, so no hostname or mDNS lookup is needed.
    WiFi.setAutoReconnect(true);

    Serial.printf("[wifi] connecting to \"%s\"\n", AQSMS_WIFI_SSID);
    WiFi.begin(AQSMS_WIFI_SSID, AQSMS_WIFI_PASSWORD);
    s_connecting = true;
    s_connectStartedAt = millis();
    s_lastAttemptAt = millis();
}

void wifi_link_loop() {
    if (WiFi.status() == WL_CONNECTED) {
        if (s_connecting) {
            s_connecting = false;
            Serial.printf("[wifi] connected, ip %s, %d dBm\n",
                          WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
        }
        return;
    }

    if (s_connecting && millis() - s_connectStartedAt >= AQSMS_WIFI_CONNECT_TIMEOUT_MS) {
        s_connecting = false;
        Serial.println("[wifi] connect attempt timed out");
    }

    // Rate-limited retry. A tight reconnect loop keeps the radio busy and can
    // trip association limits on some routers, so the board waits between
    // attempts rather than spinning.
    if (!s_connecting && millis() - s_lastAttemptAt >= AQSMS_WIFI_RETRY_INTERVAL_MS) {
        s_lastAttemptAt = millis();
        s_connectStartedAt = millis();
        s_connecting = true;
        Serial.println("[wifi] retrying");
        WiFi.disconnect();
        WiFi.begin(AQSMS_WIFI_SSID, AQSMS_WIFI_PASSWORD);
    }
}

bool wifi_link_up() {
    return WiFi.status() == WL_CONNECTED;
}

void wifi_link_describe() {
    if (wifi_link_up()) {
        Serial.printf("[wifi] connected to \"%s\", ip %s, gateway %s, %d dBm\n",
                      AQSMS_WIFI_SSID,
                      WiFi.localIP().toString().c_str(),
                      WiFi.gatewayIP().toString().c_str(),
                      (int)WiFi.RSSI());
    } else {
        Serial.printf("[wifi] not connected (status %d)\n", (int)WiFi.status());
    }
}
