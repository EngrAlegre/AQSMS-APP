# Aqua Smart Monitoring System: Mobile App (Phase 1: UI + Demo Mode)

This is an Android farmer app (Expo / React Native / TypeScript) for **one** freshwater test pond.
It shows pH, temperature (°C), and dissolved oxygen (mg/L), plus their status, reading history, and alert history.

> Status: the UI and Demo Mode work. **Hardware and Raspberry Pi integration are NOT done yet.**
> The project is not complete until a physical Android phone connects to the real Pi over the local Wi-Fi.

---

## 1. Architecture

```
app/                       Screens (expo-router, file-based)
  sign-in.tsx              Local sign-in (mock adapter)
  (tabs)/index.tsx         Dashboard
  (tabs)/history.tsx       Reading history + trend chart
  (tabs)/alerts.tsx        Alert history
  (tabs)/settings.tsx      Pi address, Test connection, mode, thresholds (read-only)
src/
  models/                  Typed data models (Reading, AlertRecord, ThresholdSet, ...)
  api/piApiContract.ts     *** ONLY place for Pi endpoint paths + JSON mapping (PLACEHOLDER) ***
  api/httpClient.ts        fetch with timeout, LAN-only URL validation, error classification
  api/realSource.ts        REAL API MODE: calls the Pi
  api/demoSource.ts        DEMO MODE: sample data (+ failure scenarios)
  api/demoData.ts          Demo readings, demo alerts, DEMO thresholds (not approved)
  auth/adapters.ts         AuthAdapter interface, mockAuthAdapter (demo), piAuthAdapter (later)
  logic/status.ts          Safe/Warning/Unsafe/No Data evaluation, stale check, formatting
  logic/connection.ts      Connection state (never "Live" for demo or cached data)
  network/networkCheck.ts  Best-effort "wrong Wi-Fi" hint (phone on Wi-Fi? same subnet?)
  components/              UI components (SensorCard, StatusChip, TrendChart, Banner, ...)
```

The `/app/backend` folder (FastAPI/Mongo template) is **not used** by this app.

### Status rules
- Safe: the value is inside `[safeMin, safeMax]`.
- Warning: the value is outside the safe range but inside `[warnMin, warnMax]`.
- Unsafe: the value is outside the warn limits.
- No Data: the value is missing, or no thresholds are available.
- Stale: the latest reading is older than **10 minutes**.

### How data is labelled
- In Demo Mode, every screen shows a "DEMO MODE · sample data" banner, and the badge says "DEMO DATA", never "LIVE".
- If a refresh fails but older data is still shown, the badge says "NOT LIVE" and a banner shows when the data was received.
- Thresholds are read-only. Demo thresholds are labelled **"Demo thresholds – not approved"**.

---

## 2. Android networking (local Pi over HTTP)

A Pi on the LAN usually serves plain `http://`. Release builds on Android 9+ block cleartext HTTP by default.
`app.json` enables it with the `expo-build-properties` plugin:

```json
["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
```

- This sets `android:usesCleartextTraffic="true"` in the generated AndroidManifest.
- An Android network-security-config cannot whitelist IP ranges, so allowing cleartext globally is the standard approach for a user-entered LAN IP.
- The app itself only accepts **private LAN addresses**: 10.x, 172.16–31.x, 192.168.x, 169.254.x, or a local hostname. It rejects `localhost`/`127.x`, because on a phone those mean the phone itself.
- Permissions are `INTERNET`, `ACCESS_NETWORK_STATE`, and `ACCESS_WIFI_STATE`. The last two are used only for the "wrong Wi-Fi" hint.
- **Do not expose the Pi API to the public internet.** The phone must be on the same Wi-Fi as the Pi.
- Tips:
  - Give the Pi a fixed IP (a DHCP reservation on the router).
  - Some Android phones cannot resolve `.local` hostnames, so a fixed IP is more reliable.
- The web preview (HTTPS) cannot reach an `http://` LAN address. Real API mode can only be tested on the phone.

---

## 3. Testing on a physical Android phone

**Option A: Expo Go (fastest, development only)**
1. Install **Expo Go** from the Play Store.
2. Scan the QR code shown in the Emergent preview panel.
3. Note: Expo Go downloads the app code over the internet. The phone needs internet access **and** must be on the pond Wi-Fi to reach the Pi. If the pond Wi-Fi has no internet, use Option B.

**Option B: Installable APK (recommended for field tests)**
1. Click **Publish** (top right in Emergent). This deploys the app and lets you generate an Android build.
2. Emergent runs the build with Expo EAS, so you don't need your own Expo account.
3. Install the generated build on the phone.

**Field test checklist**
1. Power on the Pi and start its API.
2. Connect the phone to the pond Wi-Fi.
3. Sign in to the app with the demo account: `farmer` / `demo1234`.
4. In Settings, enter the Pi address (for example `192.168.1.50:8000`), tap **Save address**, then tap **Test connection**.
5. Switch the data source to **Real Pi API**.
6. Check the Dashboard, History, and Alerts screens.

---

## 4. What is needed from the Raspberry Pi API

Edit **only** `src/api/piApiContract.ts` once these are known:
1. Base URL format: the port, and any path prefix (for example `/api/v1`).
2. The health/ping endpoint and what it returns.
3. The latest reading: path, JSON shape, field names, units, and timestamp format/timezone.
4. Reading history: path, paging/limit/time-range parameters, sort order, and maximum size.
5. Alerts: path and fields (id, timestamp, parameter names, value, threshold, status values, message). Also whether alerts include the SMS delivery status reported by the ESP32.
6. Thresholds: whether the Pi serves them (path and shape), and how "approved" is indicated.
7. Pond name/id: whether the Pi returns it.
8. Authentication: the login endpoint, the request/response format, the token type and lifetime, and the header name. Then set `AUTH_PROVIDER = "pi"`.
9. How missing sensor values are represented (null, omitted, or a sentinel such as -1).
10. Error format: HTTP codes and the error body.
11. HTTP or HTTPS (self-signed certificates need extra work on Android).
