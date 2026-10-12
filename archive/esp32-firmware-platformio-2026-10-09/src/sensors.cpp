#include "sensors.h"

// ---------------------------------------------------------------------------
// NO SENSORS ARE WIRED YET.
//
// Every has* flag below stays false, so this firmware sends no readings at all
// until a sensor is physically connected, its conversion is written, and its
// calibration is done. It does not send zeros and it does not send plausible
// placeholder numbers.
//
// PINS ARE DELIBERATELY NOT ASSIGNED HERE. See ESP32_TO_PI_SETUP.md, section
// "What I need before finalising pins". Choosing pins without knowing the board
// revision and the exact sensor modules risks, among other things, driving 5 V
// into a 3.3 V-only GPIO and destroying the board.
//
// What each block needs before it can be enabled:
//
//   pH                 An analog interface. On the ESP32, ADC1 pins (GPIO 32-39)
//                      are the usable ones; ADC2 is shared with Wi-Fi and
//                      misbehaves while the radio is up. The ADC is also not
//                      linear end to end, so a straight "0-4095 means 0-3.3 V"
//                      map is wrong near both rails. Two-point calibration at
//                      known buffer solutions (pH 4.00 and pH 6.86, or whatever
//                      you actually have) is required before any number from it
//                      is trustworthy.
//
//   temperature        Either a DS18B20 on OneWire (needs a 4.7k pull-up to
//                      3.3 V and the OneWire + DallasTemperature libraries), or
//                      an analog probe, which needs the same ADC caveats as pH.
//
//   dissolved oxygen   Almost always an analog interface with its own
//                      temperature compensation: DO depends on water
//                      temperature, so a DO reading without a temperature
//                      reading is not meaningful and can be reported as low or
//                      high purely from a temperature swing.
//
// Until each of those is settled, the honest output is "no measurement".
// ---------------------------------------------------------------------------

void sensors_begin() {
    // Nothing to initialise while no sensor interface is defined.
}

SensorReadings sensors_read() {
    SensorReadings r = {};
    r.has_ph = false;
    r.has_temperature_c = false;
    r.has_dissolved_oxygen_mg_l = false;

    // -----------------------------------------------------------------------
    // Enable one parameter at a time, each with a real conversion. Replace the
    // commented lines with the actual read, and only after calibration.
    // -----------------------------------------------------------------------
    //
    // r.has_ph = true;
    // r.ph = ph_read_calibrated();
    //
    // r.has_temperature_c = true;
    // r.temperature_c = temperature_read_calibrated();
    //
    // r.has_dissolved_oxygen_mg_l = true;
    // r.dissolved_oxygen_mg_l = do_read_calibrated(r.temperature_c);

    return r;
}

bool sensors_any_present(const SensorReadings &r) {
    return r.has_ph || r.has_temperature_c || r.has_dissolved_oxygen_mg_l;
}

void sensors_describe(const SensorReadings &r) {
    Serial.println("Sensor sample:");
    if (r.has_ph) {
        Serial.printf("  ph                    %.2f\n", r.ph);
    } else {
        Serial.println("  ph                    (not measured)");
    }
    if (r.has_temperature_c) {
        Serial.printf("  temperature_c         %.2f\n", r.temperature_c);
    } else {
        Serial.println("  temperature_c         (not measured)");
    }
    if (r.has_dissolved_oxygen_mg_l) {
        Serial.printf("  dissolved_oxygen_mg_l %.2f\n", r.dissolved_oxygen_mg_l);
    } else {
        Serial.println("  dissolved_oxygen_mg_l (not measured)");
    }
}
