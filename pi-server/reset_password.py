"""Local password recovery for an AQSMS account.

This is the documented way back in when the password is forgotten. It runs on
the Pi from a shell, so it needs physical or SSH access to the device.

There is deliberately no network endpoint that resets a password. Anything
reachable from the LAN by someone who does not already know the password would
be a way in, not a way back.

It works for every account, including the fixed Owner/Admin. The full password
rule applies here even to the Owner/Admin -- the same check every other account
goes through (auth.validate_password: at least 8 characters, and within bcrypt's
72-byte limit). This is the path that moves the Owner/Admin OFF its short
initial prototype password, so it is the last place that should accept another
one.

    python reset_password.py                # prompts for the username
    python reset_password.py <username>
    python reset_password.py aquasmart@app.com
"""

import argparse
import getpass
import sys

from auth import hash_password, normalize_username, validate_password
from db import get_db, init_db


def main():
    parser = argparse.ArgumentParser(description="Reset a local AQSMS password")
    parser.add_argument("username", nargs="?", help="Account to update")
    args = parser.parse_args()

    init_db()

    username = normalize_username(args.username) if args.username else ""
    if not username:
        username = normalize_username(input("Username: "))

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM accounts WHERE username = ?", (username,)
        ).fetchone()

        if not row:
            listed = ", ".join(
                r['username'] for r in conn.execute("SELECT username FROM accounts")
            ) or "(none)"
            print("Error: no account called '%s' on this Pi." % username)
            print("       Accounts that do exist: %s" % listed)
            sys.exit(1)

        password = getpass.getpass("New password for %s: " % username)
        confirm = getpass.getpass("Confirm new password: ")
        error = validate_password(password, confirm)
        if error:
            print("Error: %s" % error)
            sys.exit(1)

        conn.execute(
            "UPDATE accounts SET password_hash = ? WHERE username = ?",
            (hash_password(password), username),
        )
        conn.commit()
    finally:
        conn.close()

    print("Password for '%s' updated." % username)
    print("Note: any sign-in token already issued stays valid until it expires "
          "(%s hours)." % __import__("config").TOKEN_EXPIRY_HOURS)


if __name__ == '__main__':
    main()
