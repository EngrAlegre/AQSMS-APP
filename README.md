# AQSMS — Aqua Smart Monitoring System

Pond water-quality monitoring for a single farm. An ESP32 with probes reads pH,
water temperature and dissolved oxygen; a Raspberry Pi on the farm LAN stores and
serves the data; an Android app shows it to the farmer. No cloud.

**Start here: [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md)** — what the system is,
where the current code lives, how to set it up on another PC, and how to deploy
it.

Then, depending on what you are doing:

| | |
|---|---|
| Setting up the Pi | [PHONE_TO_PI_SETUP.md](PHONE_TO_PI_SETUP.md) |
| Flashing the ESP32 | [ESP32_TO_PI_SETUP.md](ESP32_TO_PI_SETUP.md) |
| Wiring and pins | [AQSMS-Full-System-Wiring-Guide.md](AQSMS-Full-System-Wiring-Guide.md) |
| The API | [pi-server/API_CONTRACT.md](pi-server/API_CONTRACT.md) |
| Building the APK | [frontend/BUILD_ANDROID.md](frontend/BUILD_ANDROID.md) |
| App internals | [frontend/AQUA_README.md](frontend/AQUA_README.md) |
| Product decisions | [memory/PRD.md](memory/PRD.md) |

Two things that are easy to get wrong:

- The SMS alert path is **independent** of the Pi, of Wi-Fi and of the app. Once
  approved config is on the board, critical alerts go out over the SIM900 with
  nothing else running. Do not make alerts depend on a logged-in user, and do not
  add a second SMS sender.
- Thresholds are **unapproved by default**, so parameters read **No Data** rather
  than a green **Safe**. That is deliberate — do not seed demo readings, alerts,
  or threshold values.

`main` is the current app. (The branch `current-app` points at the same tree and
is now redundant — safe to delete on GitHub.)
