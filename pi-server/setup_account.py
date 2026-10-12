"""Operator CLI for the AQSMS Pi.

Two jobs:

  * create a caretaker account, or overwrite its password
  * mint an ESP32 API key

Run it on the Pi itself. Passwords are typed at a hidden prompt and are never
taken as command-line arguments, so they do not end up in shell history or in
`ps` output.

Ordinary setup does not need this: the app's "Register as Caretaker" screen
creates caretaker accounts over the LAN, and the Owner/Admin account is created
by `provision_admin.py`. This CLI covers the case where an account has to be
created without a phone to hand.

This tool only ever creates CARETAKERS. It cannot create an Owner/Admin, and it
cannot promote anyone: there is exactly one owner, provisioned by
provision_admin.py, and no path in the system changes a role.
"""

import argparse
import datetime
import getpass
import secrets
import sys

from auth import (
    ROLE_CARETAKER,
    STATUS_ACTIVE,
    hash_password,
    normalize_username,
    validate_password,
    validate_username,
)
from db import get_db, init_db


def _prompt_new_password(username):
    password = getpass.getpass("Enter password for %s: " % username)
    confirm = getpass.getpass("Confirm password: ")
    error = validate_password(password, confirm)
    if error:
        print("Error: %s" % error)
        sys.exit(1)
    return password


def setup_account(username, display_name):
    init_db()

    username = normalize_username(username)
    error = validate_username(username)
    if error:
        print("Error: %s" % error)
        sys.exit(1)

    display_name = (display_name or "").strip() or username
    password = _prompt_new_password(username)

    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM accounts WHERE username = ?", (username,)
        ).fetchone()

        if existing:
            # Not an overwrite: resetting a password is a different, deliberate
            # action with its own command, so this cannot silently change a
            # caretaker's credentials.
            print(
                "Error: an account called '%s' already exists.\n"
                "       To change its password, run:\n"
                "           python reset_password.py %s" % (username, username)
            )
            sys.exit(1)

        conn.execute('''
            INSERT INTO accounts
                (username, password_hash, display_name, role, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            username,
            hash_password(password),
            display_name,
            ROLE_CARETAKER,
            STATUS_ACTIVE,
            datetime.datetime.now(datetime.timezone.utc)
                .isoformat().replace('+00:00', 'Z'),
        ))
        conn.commit()
        print("Caretaker account '%s' created." % username)
    finally:
        conn.close()


def generate_esp32_key(label="Default Key"):
    init_db()

    raw_key = secrets.token_urlsafe(32)
    key_hash = hash_password(raw_key)

    conn = get_db()
    try:
        conn.execute('''
            INSERT INTO esp32_keys (key_hash, label, created_at)
            VALUES (?, ?, ?)
        ''', (
            key_hash,
            label,
            datetime.datetime.now(datetime.timezone.utc)
                .isoformat().replace('+00:00', 'Z'),
        ))
        conn.commit()
    finally:
        conn.close()

    print("\n" + "=" * 50)
    print("ESP32 API Key Generated!")
    print("=" * 50)
    print(raw_key)
    print("=" * 50)
    print("COPY THIS KEY NOW. You will not be able to see it again.")
    print("Use this as the X-API-Key header in ESP32 requests.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="AQSMS Account Setup")
    parser.add_argument("username", nargs="?", help="Username for the account")
    parser.add_argument("display_name", nargs="?", help="Display name for the account")
    parser.add_argument("--add-esp32-key", action="store_true", help="Generate a new ESP32 API Key")

    args = parser.parse_args()

    if args.add_esp32_key:
        generate_esp32_key()
    elif args.username and args.display_name:
        setup_account(args.username, args.display_name)
    else:
        parser.print_help()
