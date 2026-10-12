import sqlite3

from config import DB_PATH
from migrations import run as run_migrations

BUSY_TIMEOUT_MS = 5000


def get_db(autocommit=False):
    """Open the database.

    `autocommit=True` leaves transaction control to the caller, which is what
    the registration path needs: it has to take the write lock *before* it
    checks whether an account already exists.
    """
    conn = sqlite3.connect(DB_PATH, timeout=BUSY_TIMEOUT_MS / 1000.0)
    conn.row_factory = sqlite3.Row
    if autocommit:
        conn.isolation_level = None
    # Wait for the writer instead of failing the moment another request holds
    # the lock. Two devices can post readings at the same instant.
    conn.execute("PRAGMA busy_timeout = %d" % BUSY_TIMEOUT_MS)
    return conn


def _columns(cursor, table):
    """Column names present in `table`.

    Needed because CREATE TABLE IF NOT EXISTS is a no-op on an existing table,
    so new columns have to be added by an explicit ALTER TABLE.
    """
    cursor.execute("PRAGMA table_info(%s)" % table)
    return {row[1] for row in cursor.fetchall()}


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # WAL lets the app keep reading while the ESP32 writes, and is a persistent
    # property of the database file, so setting it once here is enough.
    cursor.execute("PRAGMA journal_mode = WAL")

    # accounts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL
        )
    ''')
    if 'role' not in _columns(cursor, 'accounts'):
        # Existing rows become 'farmer', which is correct: an install that
        # already has an account has used its one registration.
        #
        # This column is transitional. The migration in migrations.py rebuilds
        # the table with a checked role/status and maps any legacy 'farmer' row
        # onto 'caretaker'; it runs at the bottom of this function.
        cursor.execute(
            "ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'farmer'"
        )

    # readings
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            ph REAL,
            temperature_c REAL,
            dissolved_oxygen_mg_l REAL
        )
    ''')
    if 'event_id' not in _columns(cursor, 'readings'):
        cursor.execute("ALTER TABLE readings ADD COLUMN event_id TEXT")

    # alerts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            parameter TEXT NOT NULL CHECK(parameter IN ('ph','temperature','dissolved_oxygen')),
            value REAL,
            threshold TEXT,
            status TEXT NOT NULL CHECK(status IN ('warning','unsafe')),
            message TEXT
        )
    ''')
    if 'event_id' not in _columns(cursor, 'alerts'):
        cursor.execute("ALTER TABLE alerts ADD COLUMN event_id TEXT")

    # thresholds
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS thresholds (
            parameter TEXT PRIMARY KEY CHECK(parameter IN ('ph','temperature','dissolved_oxygen')),
            safe_min REAL,
            safe_max REAL,
            warn_min REAL,
            warn_max REAL,
            approved INTEGER NOT NULL DEFAULT 0
        )
    ''')

    # Initialize thresholds if empty
    cursor.execute("SELECT COUNT(*) FROM thresholds")
    if cursor.fetchone()[0] == 0:
        parameters = ['ph', 'temperature', 'dissolved_oxygen']
        for p in parameters:
            cursor.execute('''
                INSERT INTO thresholds (parameter, safe_min, safe_max, warn_min, warn_max, approved)
                VALUES (?, NULL, NULL, NULL, NULL, 0)
            ''', (p,))

    # esp32_keys
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS esp32_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL
        )
    ''')

    # Device-supplied ids make replayed uploads idempotent: the second POST of
    # the same event is rejected by the index instead of storing a duplicate.
    cursor.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_event_id
        ON readings(event_id) WHERE event_id IS NOT NULL
    ''')
    cursor.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_event_id
        ON alerts(event_id) WHERE event_id IS NOT NULL
    ''')

    # The app polls "newest first" on every refresh.
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp)")

    # Bring an older database up to the current schema. Runs last so it sees
    # whatever shape this file was actually in, and records its own version so
    # every later start is a no-op.
    run_migrations(cursor, log=print)

    conn.commit()
    conn.close()


if __name__ == '__main__':
    init_db()
