# PRD: Aqua Smart Monitoring System (Android farmer app)

## Original problem statement (summary)
This is an Android Expo/React Native TypeScript app for a capstone prototype. It monitors one freshwater test pond ("Test Pond 1") and shows pH, temperature (°C), and DO (mg/L). Each value has a status (Safe/Warning/Unsafe/No Data) against thresholds. The app also shows reading history and alert history, plus local Raspberry Pi API settings. The Pi will later serve a LAN REST API backed by SQLite.

Constraints:
- No cloud backend, auth, or sync, no push notifications, and no SMS sending (the ESP32 sends SMS independently).
- Demo Mode first. Real API mode uses a configurable LAN base URL, and all endpoints and mapping live in one documented file.

## User choices
- Species not confirmed: use DEMO-ONLY thresholds, labelled "not approved". They are read-only in the app.
- A reading is stale after 10 minutes.
- Pond name: Test Pond 1.

## Architecture
- Screens: `app/sign-in.tsx`, plus `app/(tabs)/` with index (Dashboard), history, alerts, and settings.
- Typed models: `src/models`.
- Status and connection logic: `src/logic`.
- API layer:
  - `src/api/piApiContract.ts`: the only place for endpoints and mapping (PLACEHOLDER).
  - `httpClient.ts`: timeout, LAN-only URL validation, error kinds.
  - `realSource.ts` and `demoSource.ts`, with 6 demo scenarios.
- Auth: `src/auth/adapters.ts`, with a mock adapter (farmer/demo1234) and a Pi adapter stub.
- Android cleartext HTTP is enabled via the `expo-build-properties` plugin.
- Docs: `/app/frontend/AQUA_README.md`.
- The `/app/backend` template is unused.

## Implemented (2026-06)
- Mock sign-in with labelled demo credentials. The session is stored in secure storage, and sign-out works.
- Dashboard:
  - Pond name, connection badge (never "Live" for demo or cached data), and last-reading time.
  - 3 large sensor cards, each with status, safe/unsafe ranges, and a STALE tag.
  - Manual refresh, pull-to-refresh, and auto-refresh every 30 s.
  - Banners for demo, error, cached, stale, and wrong Wi-Fi.
- History: a pH/Temp/DO selector, an SVG trend chart with the safe band shaded, min/avg/max/missing stats, and a list of records.
- Alerts: rows show severity, value, threshold, message, and time. Includes an SMS disclaimer and an empty state.
- Settings:
  - Data mode switch (Demo / Real Pi API).
  - Pi address input with validation (rejects localhost and public IPs), plus Save and Test connection.
  - Wi-Fi explanation and demo scenario picker.
  - Read-only thresholds and account section.
- Testing agent iteration 1 passed most flows. Fixes made afterwards: sign-out navigation, STALE tag overlap, and the web-only Wi-Fi hint.

## Backlog
- P0: Define the Pi API contract, update piApiContract.ts, and complete a field test on a physical Android phone on the pond Wi-Fi. (The project is not complete until this passes.)
- P0: Enter the approved thresholds after written confirmation from Sue.
- P1: Pi-based authentication (AUTH_PROVIDER = "pi").
- P1: Persist the last successful real reading across app restarts, labelled as cached.
- P2: History range selector (6 h / 24 h / 7 d) and CSV export.
