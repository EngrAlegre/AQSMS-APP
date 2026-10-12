#pragma once

#include <Arduino.h>

// ---------------------------------------------------------------------------
// SMS is a separate path from the Raspberry Pi, and stays that way.
//
// The Pi logs alert events the board posts. It does not send SMS. The SMS path
// runs on the ESP32 and has to keep working when the Wi-Fi, the router or the
// Pi is down -- which is exactly when an alert matters. Nothing here calls the
// Pi API, and nothing in the Pi API calls this.
//
// THIS IS A STUB. IT DOES NOT SEND ANYTHING.
//
// The SIM900 is not wired, its power supply has not been specified, and no
// wiring or power arrangement should be assumed. See ESP32_TO_PI_SETUP.md,
// section "SIM900: what is not known". sms_send() returns false until a real
// implementation replaces it.
// ---------------------------------------------------------------------------

// Bring up the modem. Returns false while unimplemented.
bool sms_begin();

// True when the modem is ready to accept a message. Always false for now.
bool sms_is_ready();

// Queue a message for the configured recipients. Returns false: unimplemented.
// Callers must treat false as "not sent" and must not treat it as "sent", or a
// failed alert will look delivered.
bool sms_send(const char *message);
