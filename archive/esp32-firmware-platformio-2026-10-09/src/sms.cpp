#include "sms.h"

// ---------------------------------------------------------------------------
// Unimplemented on purpose. See sms.h.
//
// A SIM900 draws current peaks in the region of 2 A while transmitting, and
// browns out or resets if it is powered from the ESP32 board's regulator or
// from a USB port. Its TX line also drives 2.8-3.0 V logic, which the ESP32
// generally reads correctly, while its RX input expects a level the ESP32's
// 3.3 V output may over-drive depending on the module.
//
// None of that can be settled by guessing. Until the module, its power supply
// and the level shifting are known and written down, sending nothing is the
// correct behaviour -- a message that silently never arrives is worse than one
// that is known not to have been attempted.
//
// When it is implemented, the shape is:
//
//   sms_begin()   power/enable sequencing, wait for the modem to register on
//                 the network, report signal quality
//   sms_is_ready() registration state
//   sms_send()    AT+CMGF=1 (text mode), AT+CMGS="<number>", body, Ctrl-Z,
//                 then wait for the +CMGS confirmation rather than assuming
//                 success from the write
// ---------------------------------------------------------------------------

bool sms_begin() {
    Serial.println("[sms] not implemented -- no SIM900 is wired, nothing will be sent");
    return false;
}

bool sms_is_ready() {
    return false;
}

bool sms_send(const char *message) {
    (void)message;
    return false;
}
