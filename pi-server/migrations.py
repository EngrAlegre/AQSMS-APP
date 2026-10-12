"""Versioned schema migrations for the AQSMS Pi database.

`db.init_db()` creates the *original* schema (the shape this project shipped
before role-based accounts), then calls `run()` here to bring the file up to the
current version. Doing it in that order means a brand new database and a
database that has been running on the pond for months take the *same* path, so
the migration is exercised on every install instead of only on the one that
matters.

Rules this module follows, because it runs against live pond data:

  * Every step is additive or in place. Nothing is dropped that holds history.
    Readings, alerts, thresholds, their approval flags and the ESP32 key rows
    are never touched by any migration here.
  * `accounts` is rebuilt rather than simply altered, because SQLite cannot add
    a CHECK constraint to an existing column. The rebuild copies every column
    verbatim -- including the bcrypt `password_hash` -- so no credential
    changes.
  * A version is recorded only after its step returned. A step that raises
    leaves the version table untouched, so the next start retries it.
  * Running twice is a no-op: the recorded version short-circuits the second
    run, and the steps also clean up after a partial previous attempt.
"""

import datetime

SCHEMA_VERSION_TABLE = """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
    )
"""


def _now_utc_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _columns(cursor, table):
    cursor.execute("PRAGMA table_info(%s)" % table)
    return {row[1] for row in cursor.fetchall()}


def _table_exists(cursor, table):
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    )
    return cursor.fetchone() is not None


def _current_version(cursor):
    cursor.execute(SCHEMA_VERSION_TABLE)
    row = cursor.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return row[0] if row and row[0] is not None else 0


def _migration_001_roles(cursor):
    """Give accounts real roles, a status and a creation time.

    Before this, the only role was the literal 'farmer' and the partial unique
    index `idx_accounts_primary_farmer` allowed exactly one such row -- the
    whole single-account model. That index is retired here and replaced by a
    single-*owner* rule, so any number of caretakers may exist while there can
    still only ever be one Owner/Admin.

    Legacy handling, deliberately explicit:

      * An existing 'farmer' row becomes a CARETAKER. It is NOT promoted to
        owner. The fixed Owner/Admin is provisioned separately by
        `provision_admin.py`, and silently turning a pre-existing account into
        the owner would hand that operator powers nobody granted them.
      * This is not a downgrade in practice: caretakers keep the dashboard,
        readings, alerts and the read-only thresholds. The only thing behind the
        owner role is account management, which did not exist before.
      * No identifier conflict is possible. Every account this schema could
        previously hold matches `[A-Za-z0-9._-]+`, which cannot contain '@', so
        a legacy row can never collide with the reserved `aquasmart@app.com`.
      * Existing passwords are copied through untouched, so nobody has to
        re-provision a credential because of this migration.
    """
    # Retire the old one-farmer rule.
    cursor.execute("DROP INDEX IF EXISTS idx_accounts_primary_farmer")

    # A database old enough to predate the role column gets it here, so this
    # step is correct even if it is ever run outside db.init_db().
    if 'role' not in _columns(cursor, 'accounts'):
        cursor.execute(
            "ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'farmer'"
        )

    # Left over from an interrupted earlier attempt, if there was one.
    cursor.execute("DROP TABLE IF EXISTS accounts_new")

    cursor.execute('''
        CREATE TABLE accounts_new (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'caretaker'
                 CHECK(role IN ('owner', 'caretaker')),
            status TEXT NOT NULL DEFAULT 'active'
                   CHECK(status IN ('active', 'disabled')),
            created_at TEXT
        )
    ''')
    cursor.execute('''
        INSERT INTO accounts_new
            (id, username, password_hash, display_name, role, status, created_at)
        SELECT id, username, password_hash, display_name,
               CASE WHEN role = 'owner' THEN 'owner' ELSE 'caretaker' END,
               'active',
               NULL
        FROM accounts
    ''')
    cursor.execute("DROP TABLE accounts")
    cursor.execute("ALTER TABLE accounts_new RENAME TO accounts")

    # At most one Owner/Admin, enforced by SQLite itself. This is what stops a
    # second owner -- through any path -- from ever being created.
    cursor.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_owner
        ON accounts(role) WHERE role = 'owner'
    ''')


MIGRATIONS = (
    (1, "roles: owner/caretaker, account status, single-owner rule", _migration_001_roles),
)


def run(cursor, log=None):
    """Apply every migration newer than the recorded version. Returns the version."""
    version = _current_version(cursor)
    for number, description, step in MIGRATIONS:
        if number <= version:
            continue
        if log is not None:
            log("database migration %d: %s" % (number, description))
        step(cursor)
        cursor.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
            (number, _now_utc_iso()),
        )
        version = number
    return version
