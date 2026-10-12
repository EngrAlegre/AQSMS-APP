#pragma once

#include <Arduino.h>

// Bring up the station interface and start the first connection attempt.
// Returns immediately; the connection completes in wifi_link_loop().
void wifi_link_begin();

// Drive the connection state machine. Call from loop() every pass. Never
// blocks, and never retries faster than AQSMS_WIFI_RETRY_INTERVAL_MS.
void wifi_link_loop();

bool wifi_link_up();

// Print the current link state to the serial console.
void wifi_link_describe();
