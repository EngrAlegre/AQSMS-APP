#pragma once

#include <Arduino.h>

// A set of measurements from one sample.
//
// A parameter that is not being measured is ABSENT, and absence is represented
// by the has* flag being false. It is never represented by the value 0.
//
// That distinction is the whole point of this struct. A zero in the pond
// history is indistinguishable from a real measurement of zero: a disconnected
// pH probe would read as perfectly neutral water, and a failed temperature
// sensor as freezing. Missing data must stay visibly missing.
struct SensorReadings {
    bool has_ph;
    float ph;

    bool has_temperature_c;
    float temperature_c;

    bool has_dissolved_oxygen_mg_l;
    float dissolved_oxygen_mg_l;
};

// Bring up the sensor interfaces. Safe to call when nothing is wired.
void sensors_begin();

// Take one sample. With no sensors connected, every has* flag is false.
SensorReadings sensors_read();

// True when at least one parameter was actually measured.
bool sensors_any_present(const SensorReadings &r);

// Human-readable summary for the serial console.
void sensors_describe(const SensorReadings &r);
