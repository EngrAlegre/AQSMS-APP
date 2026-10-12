"""Provision the one fixed Owner/Admin account, locally on the Pi.

Run this on the Raspberry Pi, from a shell you already control:

    cd pi-server
    ./venv/bin/python provision_admin.py        # or: python provision_admin.py

The identifier is fixed at `aquasmart@app.com` and cannot be changed here. The
password is typed at a hidden prompt -- never passed as an argument, never read
from a file, never printed -- so it does not reach shell history, `ps` output,
or any log this program writes.

This is the ONLY place the short initial prototype password is accepted.
Everywhere else -- caretaker registration, and admin-created caretakers -- the
full public password rule (at least 8 characters) applies, and it is not
relaxed here to match. See auth.validate_initial_admin_password.

Repeat runs are safe and do nothing: if the account already exists this exits
without prompting and without touching the stored hash. To change a password
afterwards, use the documented reset path:

    python reset_password.py aquasmart@app.com
"""

import getpass
import sqlite3
import sys

from auth import (
    ADMIN_USERNAME,
    ROLE_OWNER,
    STATUS_ACTIVE,
    hash_password,
    validate_initial_admin_password,
)
from db import get_db, init_db

DISPLAY_NAME = "Owner/Admin"

PROTOTYPE_WARNING = """\
=========================================================================
 PROTOTYPE CREDENTIAL
 The password you just set is an initial prototype credential supplied for
 this build. It is short by design and must not be treated as a production
 password. Change it as soon as convenient with:

     python reset_password.py %s

=========================================================================""" % ADMIN_USERNAME


def main():
    init_db()

    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT username, role, status FROM accounts WHERE username = ?",
            (ADMIN_USERNAME,),
        ).fetchone()
        if existing is not None:
            # Deliberately not an update. Re-provisioning must never silently
            # reset a password that may have been changed since.
            print(
                "The Owner/Admin account already exists (%s, role=%s, status=%s).\n"
                "Nothing was changed.\n"
                "\n"
                "To change its password, run:\n"
                "    python reset_password.py %s"
                % (existing['username'], existing['role'], existing['status'], ADMIN_USERNAME)
            )
            return 0

        # A database that already has an owner under some other name. Resolve it
        # explicitly rather than letting the unique index raise an opaque error.
        other_owner = conn.execute(
            "SELECT username FROM accounts WHERE role = ?", (ROLE_OWNER,)
        ).fetchone()
        if other_owner is not None:
            print(
                "Error: this database already has an Owner/Admin account under\n"
                "       the name '%s', and only one may exist.\n"
                "\n"
                "       This tool will not rename or replace it. Decide which\n"
                "       account should be the owner, and if it should be the fixed\n"
                "       one, rename or remove the other row by hand first -- after\n"
                "       taking a backup of aqsms.db."
                % other_owner['username']
            )
            return 1

        password = getpass.getpass("Initial password for %s: " % ADMIN_USERNAME)
        confirm = getpass.getpass("Confirm initial password: ")

        error = validate_initial_admin_password(password, confirm)
        if error:
            print("Error: %s" % error)
            return 1

        try:
            conn.execute(
                "INSERT INTO accounts "
                "(username, password_hash, display_name, role, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (ADMIN_USERNAME, hash_password(password), DISPLAY_NAME, ROLE_OWNER, STATUS_ACTIVE, None),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            print("Error: the account could not be created (%s)." % exc)
            print("       Nothing was changed.")
            return 1
    finally:
        conn.close()

    print("Owner/Admin account '%s' created." % ADMIN_USERNAME)
    print("Only its bcrypt hash is stored; the password itself was not written")
    print("anywhere and cannot be read back.")
    print("")
    print(PROTOTYPE_WARNING)
    return 0


if __name__ == '__main__':
    sys.exit(main())
