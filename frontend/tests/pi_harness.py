"""Boots the REAL pi-server (Flask + SQLite + bcrypt + JWT) against a scratch
database, for the integration tests in tests/pi_server.test.ts.

This is not a mock: it imports pi-server/server.py unchanged and serves it. Only
the database path is redirected, so no developer's real aqsms.db is touched.

Usage: python tests/pi_harness.py <port> <db_path> [provision]

`provision` defaults to "yes". Pass "no" to start with an empty accounts table,
which is the clearest way to exercise a first registration.
Prints one JSON line on stdout when ready, then serves until killed.
"""
import datetime
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8801
DB_PATH = sys.argv[2] if len(sys.argv) > 2 else "test_aqsms.db"
PROVISION_ACCOUNT = len(sys.argv) < 4 or sys.argv[3].lower() != "no"

# Credentials this harness provisions. Test-only, never shipped. The Owner/Admin
# password here is deliberately NOT the prototype credential shipped with the
# build: no test needs that specific string, and keeping it out of the tree
# means it is not sitting in a file someone might mistake for configuration.
CARETAKER_USERNAME = "testcaretaker"
CARETAKER_DISPLAY_NAME = "Test Caretaker"
CARETAKER_PASSWORD = "integration-test-pw"

ADMIN_USERNAME = "aquasmart@app.com"
ADMIN_DISPLAY_NAME = "Owner/Admin"
ADMIN_PASSWORD = "integration-admin-pw"

HERE = os.path.dirname(os.path.abspath(__file__))
PI_SERVER = os.path.normpath(os.path.join(HERE, "..", "..", "pi-server"))

# config.py reads DB_PATH at import time, so set it before importing anything.
os.environ["DB_PATH"] = os.path.abspath(DB_PATH)
# Forced, not setdefault: this harness owns a scratch database, and the value
# must satisfy config.py's minimum key length regardless of the caller's shell.
os.environ["AQSMS_JWT_SECRET"] = "integration-test-secret-0123456789abcdef"
sys.path.insert(0, PI_SERVER)

for suffix in ("", "-wal", "-shm"):
    stale = DB_PATH + suffix
    if os.path.exists(stale):
        os.remove(stale)

from auth import hash_password  # noqa: E402  (pi-server module)
from db import get_db, init_db  # noqa: E402

init_db()

# One ESP32 ingest key always. Readings, alerts and threshold limits stay
# EMPTY/NULL -- nothing here invents a measurement.
ESP32_KEY = "test-esp32-key-do-not-ship"
conn = get_db()
cur = conn.cursor()
if PROVISION_ACCOUNT:
    # One account of each role, so both sides of the permission boundary can be
    # exercised against the same running server.
    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    cur.execute(
        "INSERT INTO accounts (username, password_hash, display_name, role, status, created_at) "
        "VALUES (?, ?, ?, 'owner', 'active', ?)",
        (ADMIN_USERNAME, hash_password(ADMIN_PASSWORD), ADMIN_DISPLAY_NAME, now),
    )
    cur.execute(
        "INSERT INTO accounts (username, password_hash, display_name, role, status, created_at) "
        "VALUES (?, ?, ?, 'caretaker', 'active', ?)",
        (CARETAKER_USERNAME, hash_password(CARETAKER_PASSWORD), CARETAKER_DISPLAY_NAME, now),
    )
cur.execute(
    "INSERT INTO esp32_keys (key_hash, label, created_at) VALUES (?, ?, ?)",
    (
        hash_password(ESP32_KEY),
        "integration-test",
        datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    ),
)
conn.commit()
conn.close()

from server import app  # noqa: E402  (imports after DB_PATH is set)

print(
    json.dumps(
        {
            "ready": True,
            "port": PORT,
            # `username`/`password` stay the caretaker's credentials: the
            # existing integration tests sign in as the ordinary pond user.
            "username": CARETAKER_USERNAME,
            "displayName": CARETAKER_DISPLAY_NAME,
            "password": CARETAKER_PASSWORD,
            "adminUsername": ADMIN_USERNAME,
            "adminDisplayName": ADMIN_DISPLAY_NAME,
            "adminPassword": ADMIN_PASSWORD,
            "esp32Key": ESP32_KEY,
            "dbPath": os.path.abspath(DB_PATH),
            "provisioned": PROVISION_ACCOUNT,
        }
    ),
    flush=True,
)

app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)
