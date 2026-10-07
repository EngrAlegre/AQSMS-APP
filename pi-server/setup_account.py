import sys
import argparse
import getpass
import secrets
import datetime
from db import get_db, init_db
from auth import hash_password

def setup_account(username, display_name):
    init_db()
    
    password = getpass.getpass(f"Enter password for {username}: ")
    confirm = getpass.getpass("Confirm password: ")
    
    if password != confirm:
        print("Passwords do not match!")
        sys.exit(1)
        
    hashed = hash_password(password)
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO accounts (username, password_hash, display_name)
            VALUES (?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
            password_hash=excluded.password_hash,
            display_name=excluded.display_name
        ''', (username, hashed, display_name))
        conn.commit()
        print(f"Account '{username}' created/updated successfully.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

def generate_esp32_key(label="Default Key"):
    init_db()
    
    raw_key = secrets.token_urlsafe(32)
    key_hash = hash_password(raw_key)
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO esp32_keys (key_hash, label, created_at)
        VALUES (?, ?, ?)
    ''', (key_hash, label, datetime.datetime.utcnow().isoformat() + 'Z'))
    conn.commit()
    conn.close()
    
    print("\n" + "="*50)
    print("ESP32 API Key Generated!")
    print("="*50)
    print(raw_key)
    print("="*50)
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
