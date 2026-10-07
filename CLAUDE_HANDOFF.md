# CLAUDE_HANDOFF.md — Aqua Smart Monitoring System (AQSMS) Handoff

> **Purpose**: This document provides an exhaustive, verified handoff for Claude Code CLI to seamlessly take over the project without missing context or re-diagnosing existing findings.

---

## 1. Repository Structure & App Location

The repository root is located at: `d:\Client\Sue\AQSMS-APP-main`

```
AQSMS-APP-main/
├── frontend/                  # <--- THE EXPO / REACT NATIVE ANDROID APP
│   ├── app/                   # Expo Router file-based routing
│   │   ├── (tabs)/            # Tab navigator screens
│   │   │   ├── _layout.tsx    # Tabs layout & auth redirect guard
│   │   │   ├── index.tsx      # Dashboard screen (sensor cards, connection badge)
│   │   │   ├── history.tsx    # Trends & historical reading log
│   │   │   ├── alerts.tsx     # Alert history log
│   │   │   └── settings.tsx   # Connection setup, thresholds, account
│   │   ├── _layout.tsx        # App root layout, fonts, ErrorBoundary, Providers
│   │   ├── index.tsx          # App entry redirect (/sign-in vs /(tabs))
│   │   ├── sign-in.tsx        # Farmer sign-in & Pi address setup
│   │   └── +html.tsx          # Web root template
│   ├── src/
│   │   ├── api/               # API clients, contract mappers, error handling
│   │   │   ├── piApiContract.ts # REST endpoint paths & response mappers
│   │   │   ├── dataSource.ts    # Data source interface & factory
│   │   │   ├── realSource.ts    # Real HTTP calls to Raspberry Pi
│   │   │   ├── httpClient.ts    # Fetch wrapper, timeout, LAN URL validation
│   │   │   ├── errors.ts        # ApiError and MalformedResponseError classes
│   │   │   ├── demoData.ts      # [MOCK] Synthetic data generator (MUST MOVE TO TESTS)
│   │   │   └── demoSource.ts    # [MOCK] Simulated data source (MUST BE DELETED)
│   │   ├── auth/              # Auth context & adapters
│   │   │   ├── AuthContext.tsx  # React context for user session
│   │   │   └── adapters.ts      # Pi auth adapter
│   │   ├── components/        # UI components (SensorCard, ConnectionBadge, Banner, etc.)
│   │   ├── hooks/             # usePondData (React Query), useNow
│   │   ├── logic/             # Pure business logic (connection.ts, status.ts)
│   │   ├── models/            # TypeScript interfaces (types.ts, parameters.ts)
│   │   ├── network/           # Wi-Fi / LAN IP diagnostic check (networkCheck.ts)
│   │   ├── settings/          # SettingsContext.tsx, scenarios.ts [MOCK]
│   │   ├── theme.ts           # Dark aquatic design tokens & fonts
│   │   └── utils/storage/     # AsyncStorage & SecureStore wrapper
│   ├── tests/
│   │   ├── logic.test.ts      # Node/tsx unit & integration test runner
│   │   └── mock_pi_server.py  # Standalone Python mock server for tests
│   ├── app.json               # Expo configuration (package, permissions, cleartext HTTP)
│   ├── package.json           # Dependencies (Expo 57, RN 0.86.3, React 19.2.3)
│   └── tsconfig.json          # TypeScript config (strict: true, path alias @/*)
├── pi-server/                 # Standalone Raspberry Pi local server (SQLite + Flask)
│   ├── server.py              # Flask REST API endpoints
│   ├── db.py                  # SQLite schema initialization (EMPTY tables)
│   ├── auth.py                # JWT authentication & bcrypt password hashing
│   ├── config.py              # Configuration constants & env vars
│   ├── setup_account.py       # CLI tool to create farmer account / ESP32 keys
│   ├── requirements.txt       # Python dependencies (flask, flask-cors, pyjwt, bcrypt, etc.)
│   └── API_CONTRACT.md        # Definitive REST API contract documentation
├── backend/                   # UNUSED legacy FastAPI/MongoDB template from Emergent (DO NOT USE)
├── memory/                    # Project PRD (memory/PRD.md)
└── test_reports/              # Historical test logs
```

---

## 2. What Currently Works, What is Demo-Only, and What Has NOT Been Verified

### What Currently Works (Verified in Baseline)
1. **Toolchain & Dependencies**: Node v24.16.0, Yarn 1.22.22, EAS CLI installed, Python 3.12.9. `yarn install` succeeded in `frontend/`.
2. **ESLint**: `yarn lint` passed with 0 errors across all files.
3. **Expo Doctor**: `npx expo-doctor` passed 20/20 checks.
4. **Existing Unit Tests**: `npx tsx tests/logic.test.ts` passed 12/12 test cases.
5. **Metro Bundler / Hermes Export**: `npx expo export` successfully compiled all JS bundles without error (Android Hermes `.hbc` 11MB, iOS 11MB, Web 8.4MB).
6. **Pi Server Codebase**: `pi-server/` Python scripts syntax-checked with `python -m py_compile` and passed.

### Current Transition State & Broken Compilation
Edits were in-flight during Checkpoint 2 when this handoff was created. Specifically:
- `src/models/types.ts`, `src/api/piApiContract.ts`, `src/api/dataSource.ts`, `src/auth/adapters.ts`, `src/auth/AuthContext.tsx`, `src/settings/SettingsContext.tsx`, `src/hooks/usePondData.ts`, `src/logic/connection.ts`, `src/logic/status.ts`, and `app/sign-in.tsx` were updated to remove `DataMode`, `DemoScenario`, and mock sign-in.
- **However**, the tab screen files (`app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx`, `app/(tabs)/alerts.tsx`, `app/(tabs)/history.tsx`), `ConnectionBadge.tsx`, and `tests/logic.test.ts` have NOT been updated yet.
- Running `npx tsc --noEmit` currently reports **15 TypeScript errors** due to this partial state (see Section 5 for the exact error log).

### What is Demo-Only (Must be Removed from Shipping Runtime App)
- `frontend/src/api/demoData.ts` (synthetic reading generator) — must be moved to `tests/fixtures/demoData.ts` for automated test use only.
- `frontend/src/api/demoSource.ts` — mock source returning scripted aeration failures and pH spikes.
- `frontend/src/settings/scenarios.ts` — demo scenario list ("Normal", "Stale", "Missing", etc.).
- Demo banners, Demo/Real mode switch, and Scenario selector inside `app/(tabs)/settings.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/alerts.tsx`, and `app/(tabs)/history.tsx`.

### What Has NOT Been Verified
- ❌ **Physical Android Device**: The app has NEVER been run or verified on a physical Android phone or Android emulator.
- ❌ **Physical Raspberry Pi**: The app has NEVER been tested against a real Raspberry Pi hardware board or actual sensor probes.
- ❌ **Android APK Build**: An installable `.apk` file has NOT been built yet. No `eas.json` existed in the repository.
- ❌ **ESP32 Firmware**: The ESP32 cellular SMS module is NOT connected or implemented; it is an external device that will later submit HTTP requests to the Pi.

---

## 3. Exact Commands & Execution Results

### Commands Actually Run by Assistant

| Category | Exact Command | Execution Result / Notes |
|---|---|---|
| **Preinstall Fix** | *(Edited `package.json` line 6)* | Changed `"preinstall": "./scripts/cmd-guard.js --preinstall"` to `"node ./scripts/cmd-guard.js --preinstall"`. On Windows, running `./scripts/cmd-guard.js` directly caused `Access is denied` (error code 1). |
| **Install Dependencies** | `cd frontend && yarn install` | **Passed** (exited code 0 in 261s). Produced unmet peer dependency warnings for `@babel/core` from transitive Expo plugins (normal for Expo SDK 57). |
| **Baseline Typecheck** | `cd frontend && npx tsc --noEmit` | **Passed** with 0 errors on clean baseline. |
| **Current Typecheck** | `cd frontend && npx tsc --noEmit` | **Failed with 15 errors** due to in-flight Checkpoint 2 edits (see Section 5). |
| **Lint** | `cd frontend && yarn lint` | **Passed** with 0 errors (78s). |
| **Unit Tests** | `cd frontend && npx tsx tests/logic.test.ts` | **Passed** (12/12 tests passed). |
| **Expo Doctor** | `cd frontend && npx expo-doctor` | **Passed** (20/20 checks passed). |
| **Metro Export Check** | `cd frontend && npx expo export` | **Passed** (Android, iOS, Web bundles built into `dist/`). |
| **Pi Server Syntax** | `python -m py_compile pi-server/*.py` | **Passed** with 0 syntax errors. |

### Commands Recommended for Claude Code CLI to Run

```bash
# 1. Inspect TypeScript errors after finishing screen cleanup
cd frontend
npx tsc --noEmit

# 2. Run linter
yarn lint

# 3. Run logic tests
npx tsx tests/logic.test.ts

# 4. Start Expo development server (for Android emulator or local web)
npx expo start

# 5. Set up Python virtual environment for Pi server
cd ../pi-server
python -m venv venv
.\venv\Scripts\activate    # On Windows
pip install -r requirements.txt
python db.py               # Initializes empty SQLite tables in aqsms.db
python server.py           # Starts Flask on 0.0.0.0:8000

# 6. Build Android APK using EAS (once eas.json is created)
cd ../frontend
eas build -p android --profile preview --local
# OR cloud build:
eas build -p android --profile preview
```

---

## 4. Key Files Directory

| Responsibility | File Path | Current Status / Role |
|---|---|---|
| **API Contract & Mappers** | `frontend/src/api/piApiContract.ts` | Updated: `AUTH_PROVIDER = "pi"`, rejects unknown alert statuses, maps JSON to typed models. |
| **Data Source Abstraction** | `frontend/src/api/dataSource.ts` | Updated: Always routes to `createRealSource`. |
| **Real API Fetcher** | `frontend/src/api/realSource.ts` | Makes HTTP calls to Pi endpoints; implements `testPiConnection`. |
| **HTTP Client & LAN Guard** | `frontend/src/api/httpClient.ts` | Enforces private LAN IP validation (10.x, 172.16-31.x, 192.168.x, 169.254.x). |
| **Auth Adapter** | `frontend/src/auth/adapters.ts` | Updated: Removed `mockAuthAdapter` and `DEMO_ACCOUNT`; uses `piAuthAdapter`. |
| **Auth State Context** | `frontend/src/auth/AuthContext.tsx` | Updated: Handles Pi JWT token in SecureStore; removed "mock" provider. |
| **Sign-In Screen** | `frontend/app/sign-in.tsx` | Updated: Added Pi address setup & Test Connection *before* sign-in form; removed demo credentials button. |
| **Settings Context** | `frontend/src/settings/SettingsContext.tsx` | Updated: Stores only `baseUrl`; removed `mode` and `demoScenario`. |
| **Query Hook** | `frontend/src/hooks/usePondData.ts` | Updated: Query disabled if Pi not configured; surfaces `notConfiguredError`. |
| **Connection State Logic** | `frontend/src/logic/connection.ts` | Updated: Removed "simulated" state; handles "not_configured", "live", "stale", "cached". |
| **Status Evaluation** | `frontend/src/logic/status.ts` | Updated: `statusFor` returns `"no_data"` when thresholds are unapproved (`approved: false`). |
| **Android Manifest & Config** | `frontend/app.json` | Package `com.emergent.aquasmartmobile.zi51we`, `usesCleartextTraffic: true`, Wi-Fi permissions. |
| **Pi Server Entrypoint** | `pi-server/server.py` | Complete: Endpoints `/health`, `/auth/login`, `/readings/latest`, `/readings`, `/alerts`, `/thresholds`, `/esp32/readings`, `/esp32/alerts`. |
| **Pi Database Schema** | `pi-server/db.py` | SQLite schema: `accounts`, `readings`, `alerts`, `thresholds`, `esp32_keys`. Starts EMPTY. |
| **Pi Account Setup CLI** | `pi-server/setup_account.py` | Interactive CLI to create farmer bcrypt credentials or generate ESP32 keys. |
| **Pi Contract Doc** | `pi-server/API_CONTRACT.md` | Formal specification of payloads, units, headers, error codes. |

---

## 5. Prioritized List of Findings in the Current Code

### [P0 - CRITICAL] Current TypeScript Compilation Breakage (In-Flight Edits)
- **Status**: **CONFIRMED IN CODE**.
- **Details**: Running `npx tsc --noEmit` in `frontend/` yields 15 errors because context/models were stripped of demo modes, but UI tabs and mock files still reference them:
  1. `app/(tabs)/alerts.tsx(25,11)`: `Property 'mode' does not exist on type 'SettingsValue'`
  2. `app/(tabs)/history.tsx(31,11)`: `Property 'mode' does not exist on type 'SettingsValue'`
  3. `app/(tabs)/index.tsx(32,11)`: `Property 'mode' does not exist on type 'SettingsValue'`
  4. `app/(tabs)/index.tsx(32,26)`: `Property 'demoScenario' does not exist on type 'SettingsValue'`
  5. `app/(tabs)/index.tsx(41,35)`: `'mode' does not exist in type 'Input'` (in `deriveConnection`)
  6. `app/(tabs)/settings.tsx(20,32)`: `Module '"@/src/models/types"' has no exported member 'DataMode'`
  7. `app/(tabs)/settings.tsx(39,11)`: `Property 'mode' does not exist on type 'SettingsValue'`
  8. `app/(tabs)/settings.tsx(39,17)`: `Property 'setMode' does not exist on type 'SettingsValue'`
  9. `app/(tabs)/settings.tsx(39,47)`: `Property 'demoScenario' does not exist on type 'SettingsValue'`
  10. `app/(tabs)/settings.tsx(39,61)`: `Property 'setDemoScenario' does not exist on type 'SettingsValue'`
  11. `app/(tabs)/settings.tsx(256,14)`: Type comparison `"pi"` vs `"mock"`
  12. `src/api/demoData.ts(11,10)`: `Module '"@/src/models/types"' has no exported member 'DemoScenario'`
  13. `src/api/demoSource.ts(2,10)`: `Module '"@/src/models/types"' has no exported member 'DemoScenario'`
  14. `src/components/ConnectionBadge.tsx(10,10)`: `Type '"simulated"' is not comparable to type 'ConnectionState'`
  15. `src/settings/scenarios.ts(1,10)`: `Module '"@/src/models/types"' has no exported member 'DemoScenario'`
- **Fix Required**: Update `app/(tabs)/index.tsx`, `settings.tsx`, `alerts.tsx`, `history.tsx`, and `ConnectionBadge.tsx` to remove mode references; remove `demoSource.ts` and `scenarios.ts`; move `demoData.ts` to `tests/fixtures/`.

### [P0 - CRITICAL] Null Reading Displaying "Live" Connection State
- **Status**: **CONFIRMED IN CODE**.
- **Details**: In `app/(tabs)/index.tsx`:
  ```tsx
  const reading = latest.data?.reading ?? null;
  const conn = deriveConnection({ hasData: !!latest.data, isLoading: latest.isLoading, error: latest.error, stale });
  ```
  When the Pi responds with `{ "pond_name": "Test Pond 1", "reading": null }` (an empty database), `latest.data` is an object, so `!!latest.data` evaluates to `true`! `deriveConnection` therefore returned `"live"` even though there was **no reading**.
- **Fix Required**: Pass `hasData: !!latest.data?.reading` so that `deriveConnection` only claims "Live" when a real sensor reading actually exists. If `reading === null`, the badge must show "Not set up" or "No Data" / empty state, NEVER "Live".

### [P0 - CRITICAL] Unapproved Thresholds Displaying "Safe"
- **Status**: **PARTIALLY ADDRESSED IN status.ts; NEEDS VERIFICATION IN ALL SCREENS**.
- **Details**: In baseline code, `evaluateStatus` only compared numbers against `safeMin`/`safeMax`. Even if thresholds had `approved: false` (or placeholder limits), values falling inside the numbers were labelled green "Safe".
- **Current Code**: `statusFor` in `src/logic/status.ts` was updated with:
  ```ts
  if (raw === "safe" && thresholds && !thresholds.approved) return "no_data" as StatusKind;
  ```
  Ensure all UI components (SensorCard, History table, TrendChart, Alerts) consume `statusFor` (or that `evaluateStatus` itself guards against unapproved thresholds) so that green "Safe" is strictly impossible without `approved === true`.

### [P1 - HIGH] Hostname Validation on Local Wi-Fi
- **Status**: **CONFIRMED IN CODE**.
- **Details**: `normalizeBaseUrl` in `frontend/src/api/httpClient.ts` correctly blocks `localhost`, `127.0.0.1`, and public internet IPs. It permits private IPs (e.g. `192.168.1.50`) and hostname patterns.
- **Caveat**: On physical Android devices, mDNS domain names like `aquapi.local` often fail to resolve without Android NSD (Network Service Discovery). The documentation and UI help text must strongly instruct the farmer to use the Pi's LAN IP address (e.g. `192.168.1.50:8000`). Cleartext HTTP traffic is already enabled via `expo-build-properties` in `app.json`.

### [P1 - HIGH] Mock Sign-In Bypass
- **Status**: **CONFIRMED IN CODE (HALF-FIXED)**.
- **Details**: `app/sign-in.tsx` previously had hardcoded credentials `farmer` / `demo1234` and an auto-fill button. This has been removed from `app/sign-in.tsx` and replaced with Pi address configuration. However, `adapters.ts` and the Pi server must enforce real bcrypt authentication against the Pi SQLite `accounts` table.

---

## 6. Agreed Architecture

1. **Scope**: One freshwater test pond (`Test Pond 1`), one primary farmer account.
2. **Connectivity**: Direct REST over local Wi-Fi LAN (`http://<pi-ip>:<port>`). No internet required, no cellular connection needed by the phone, no cloud relays, no public port forwarding.
3. **Database**: Local SQLite database (`aqsms.db`) running directly on the Raspberry Pi.
4. **Alerts & SMS Separation**:
   - The Android app **NEVER** sends SMS alerts and does **NOT** connect to cellular modules.
   - The pond's hardware ESP32 unit has its own SIM/cellular module and sends emergency SMS messages autonomously.
   - The Android app only fetches recorded alert logs from the Pi (`GET /alerts`).
5. **No Cloud Services**: MongoDB, Firebase, AWS, and Supabase are strictly disallowed.

---

## 7. Requested Next Work for Claude Code CLI

Claude Code CLI should execute the remaining tasks in this exact order:

1. **Resolve Tab Screen Compilation Errors**:
   - Update `frontend/app/(tabs)/index.tsx`: Remove `mode` and `demoScenario`; update `hasData: !!latest.data?.reading`; show empty state when `reading === null`.
   - Update `frontend/app/(tabs)/settings.tsx`: Remove Data Mode segment and Demo Scenarios block; keep Pi address config, Test Connection, read-only Thresholds card, and Sign Out button.
   - Update `frontend/app/(tabs)/alerts.tsx` & `history.tsx`: Remove Demo Mode banners.
   - Update `frontend/src/components/ConnectionBadge.tsx`: Remove `"simulated"` case.
   - Move `frontend/src/api/demoData.ts` to `frontend/tests/fixtures/demoData.ts`.
   - Delete `frontend/src/api/demoSource.ts` and `frontend/src/settings/scenarios.ts`.
   - Update `frontend/tests/logic.test.ts` to import `demoData` from `tests/fixtures/demoData.ts`.
   - Verify `npx tsc --noEmit` exits with **0 errors**.

2. **Test App Against Local SQLite Pi Server**:
   - Run `python pi-server/db.py` to ensure `aqsms.db` is initialized with EMPTY tables.
   - Run `python pi-server/setup_account.py testfarmer "Test Farmer"` to create real test credentials.
   - Run `python pi-server/server.py` on port 8000.
   - Verify all endpoints with empty DB (`GET /readings/latest` returns `reading: null`, `GET /readings` returns `[]`, `GET /alerts` returns `[]`, `GET /thresholds` returns `approved: false`).
   - Run automated frontend tests against this real SQLite server to verify the app renders "No Data" / empty states.

3. **Configure & Build Installable Android APK**:
   - Create `frontend/eas.json` with a preview APK profile:
     ```json
     {
       "cli": { "version": ">= 15.0.0" },
       "build": {
         "preview": {
           "distribution": "internal",
           "android": {
             "buildType": "apk"
           }
         }
       }
     }
     ```
   - Trigger the build using `eas build -p android --profile preview` (or `--local` if Android SDK and Java are installed locally).
   - Verify the `.apk` file is generated and provide the direct artifact path/link.

---

## 8. Final Required Deliverable: Android APK

- **Artifact Required**: An actual standalone `.apk` file (Android Application Package) installable via Android Package Installer or `adb install app.apk`.
- **Not Acceptable**: An Expo Go link, web preview, or an `.aab` (Android App Bundle) which cannot be side-loaded directly onto an Android device without Google Play.

---

## 9. Checkpoint-by-Checkpoint Implementation Plan

### Checkpoint 1: Baseline Build & Toolchain
- **Status**: **COMPLETE**.
- **Validation Commands**:
  - `cd frontend && yarn install` (Pass)
  - `npx expo-doctor` (Pass, 20/20)
  - `npx expo export` (Pass, Android Hermes bundle generated)

### Checkpoint 2: Remove Runtime Mocks & Fix UI
- **Goal**: Zero mock data, demo banners, or simulated credentials in the runtime app.
- **Actions**:
  1. Fix `app/(tabs)/index.tsx`, `settings.tsx`, `alerts.tsx`, `history.tsx`.
  2. Fix `src/components/ConnectionBadge.tsx`.
  3. Move `demoData.ts` to `tests/fixtures/demoData.ts`.
  4. Delete `demoSource.ts` and `scenarios.ts`.
  5. Update `tests/logic.test.ts`.
- **Stopping Point & Validation**:
  - Run `npx tsc --noEmit` -> Must return code 0 (zero errors).
  - Run `yarn lint` -> Must return code 0.

### Checkpoint 3: Pi Server & Harmonized Contract
- **Goal**: Real SQLite-backed LAN API running locally with zero seed data.
- **Actions**:
  1. `pi-server/` is already implemented. Verify `pip install -r pi-server/requirements.txt`.
  2. Run `python pi-server/setup_account.py <username> <display_name>` to test interactive password hashing.
  3. Start `python pi-server/server.py`.
- **Stopping Point & Validation**:
  - Verify with curl:
    - `curl http://127.0.0.1:8000/health` -> `{"status":"ok","timestamp":"..."}`
    - `curl -X POST http://127.0.0.1:8000/auth/login -H "Content-Type: application/json" -d "{\"username\":\"...\",\"password\":\"...\"}"` -> Returns JWT token.
    - `curl http://127.0.0.1:8000/readings/latest -H "Authorization: Bearer <token>"` -> `{"pond_name":"Test Pond 1","reading":null}`.

### Checkpoint 4: Automated Verification & Integration
- **Goal**: Full automated verification with test fixtures for all edge cases against the real SQLite API.
- **Actions**:
  1. Add tests in `tests/logic.test.ts` for:
     - Pi not configured (`baseUrl === ""`).
     - Empty database (`reading: null`, empty alerts array).
     - Missing sensor readings (`ph: null`, `dissolvedOxygen: null`).
     - Stale readings (> 10 minutes old).
     - Unapproved thresholds (`approved: false`) ensuring status is NEVER "Safe".
     - Rejected invalid alert status strings.
     - Wrong login credentials.
- **Stopping Point & Validation**:
  - Run `npx tsx tests/logic.test.ts` -> All test cases pass.

### Final Checkpoint: Build Installable Android APK
- **Goal**: Produce installable `.apk` file.
- **Actions**:
  1. Create `frontend/eas.json` with `buildType: "apk"`.
  2. Run `eas build -p android --profile preview --local` (or EAS cloud).
  3. Confirm the `.apk` file exists.
- **Stopping Point & Validation**:
  - File exists on disk or download URL verified.
  - Provide physical Android device testing checklist.

---

## 10. Open Questions & Hardware Details

1. **Sue's Approved Thresholds**:
   - Fish species and threshold limits are **NOT** confirmed.
   - **DO NOT INVENT VALUES**. The database initializes with `NULL` limits and `approved = 0`.
   - Thresholds must remain unapproved until Sue provides written confirmation.
2. **Physical Raspberry Pi IP & Wi-Fi**:
   - The farm Wi-Fi SSID and Pi static IP are unknown at this stage. The app dynamic configuration field in Settings / Sign-in accommodates any valid private LAN IPv4 address (e.g. `192.168.1.xxx:8000`).
3. **ESP32 Firmware Token**:
   - The Pi server implements `POST /esp32/readings` and `POST /esp32/alerts` guarded by `X-API-Key`.
   - Generating a key is done via `python pi-server/setup_account.py --add-esp32-key`. Firmware developers will need this key when programming the ESP32.
