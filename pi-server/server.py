"""AQSMS Pi server.

Flask + SQLite, reached from the farm LAN only. See PHONE_TO_PI_SETUP.md.

Two independent credential systems:

  * A person signs in with a username and password and receives a JWT. There
    are two roles -- the one fixed Owner/Admin, and any number of Caretakers.
    The role is read from the database on every request; it is never taken from
    the request body, and never carried in the token.
  * The ESP32 posts measurements with an X-API-Key. It never holds a person's
    password, a person's token cannot post measurements, and the ESP32 is never
    issued an Owner/Admin token.

Thresholds are stored, never invented. The table is seeded with NULL limits and
approved = 0, and the app may not display "Safe" until an operator has approved
real values.
"""

import datetime
import math
import sqlite3

import dateutil.parser
from flask import Flask, jsonify, request
from flask_cors import CORS

from auth import (
    KNOWN_ROLES,
    ROLE_CARETAKER,
    ROLE_OWNER,
    STATUS_ACTIVE,
    STATUS_DISABLED,
    check_password,
    generate_token,
    hash_password,
    normalize_username,
    role_required,
    token_required,
    validate_password,
    validate_username,
)
from config import PORT
from db import get_db, init_db

PARAMETERS = ('ph', 'temperature', 'dissolved_oxygen')
READING_FIELDS = ('ph', 'temperature_c', 'dissolved_oxygen_mg_l')
POND_NAME = "Test Pond 1"
MAX_EVENT_ID_LENGTH = 128

# Approved registration policy for this release: caretakers register from the
# app, get access immediately, and there is no cap on how many exist. The old
# rule -- one farmer account, after which registration closed forever -- is
# retired. This stays a named constant rather than a hardcoded True so that a
# future policy change has one obvious place to land, and so /health keeps
# reporting registration state truthfully instead of the app assuming it.
PUBLIC_REGISTRATION_OPEN = True

app = Flask(__name__)
CORS(app)

# Initialize DB
with app.app_context():
    init_db()


def _now_utc_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _reading_age_seconds(timestamp_text):
    """Age of a stored reading, in seconds, measured on the Pi's own clock.

    Both ends of the subtraction come from this Pi: the ESP32 stamps each reading
    with the time /esp32/ping handed it, and "now" is read here. So the result is
    a true duration even when the Pi has no internet time source and its clock
    drifts -- which is exactly the situation once the Pi hosts its own Wi-Fi.

    Deliberately SIGNED and NOT clamped to zero. A negative result means the
    stored reading is ahead of the Pi's clock (the clock was moved backwards
    after the row was written), and the app must never read that as fresh.
    Clamping it to 0 would do the opposite: it would make a dead board look
    current. Sub-second jitter from the ESP32's own drift is absorbed by int(),
    which truncates toward zero.

    None when the timestamp is absent or unparseable.
    """
    try:
        then = dateutil.parser.isoparse(timestamp_text)
    except (ValueError, TypeError):
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=datetime.timezone.utc)
    delta = datetime.datetime.now(datetime.timezone.utc) - then
    return int(delta.total_seconds())


def _as_number(value, field):
    """Return (number_or_None, error_message_or_None).

    A missing measurement stays None. It is never coerced to 0, because 0 is a
    real reading that a sensor could produce and a gap in the data must stay
    visible as a gap.
    """
    if value is None:
        return None, None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, "%s must be a number or null" % field
    if math.isnan(value) or math.isinf(value):
        return None, "%s must be a finite number or null" % field
    return float(value), None


def _as_event_id(value):
    """Return (event_id_or_None, error_message_or_None)."""
    if value is None:
        return None, None
    if not isinstance(value, str) or not value.strip():
        return None, "event_id must be a non-empty string"
    value = value.strip()
    if len(value) > MAX_EVENT_ID_LENGTH:
        return None, "event_id must be at most %d characters" % MAX_EVENT_ID_LENGTH
    return value, None


def _registration_open():
    """Whether public caretaker registration is currently permitted.

    Public registration always creates a CARETAKER. It can never create an
    Owner/Admin, whatever the request body claims.
    """
    return PUBLIC_REGISTRATION_OPEN


def _account_public(row):
    """The fields of an account the app is allowed to see. Never the hash."""
    return {
        "username": row['username'],
        "display_name": row['display_name'],
        "role": row['role'],
        "status": row['status'],
        "created_at": row['created_at'],
    }


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": _now_utc_iso(),
        # Lets the app offer or withdraw "Register as Caretaker" based on the
        # Pi's actual policy instead of assuming one. Unauthenticated, and it
        # reveals nothing about the accounts that exist.
        "registration_open": _registration_open(),
    })


@app.route('/auth/register', methods=['POST'])
def register():
    """Create a CARETAKER account. Public, and always available.

    The role is assigned here, on the server. A `role` in the request body is
    ignored: there is no request that turns this endpoint into an owner-creation
    path, and the partial unique index on role='owner' would refuse a second
    owner even if there were.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Expected a JSON object body'}), 400

    if not _registration_open():
        return jsonify({
            'error': 'Registration is closed on this AQSMS.',
            'code': 'registration_closed',
        }), 409

    username = normalize_username(data.get('username'))
    error = validate_username(username)
    if error:
        return jsonify({'error': error}), 400

    error = validate_password(data.get('password'), data.get('confirm_password'))
    if error:
        return jsonify({'error': error}), 400

    raw_display = data.get('display_name')
    if not isinstance(raw_display, str) or not raw_display.strip():
        raw_display = data.get('username')
    display_name = raw_display.strip() if isinstance(raw_display, str) else username

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO accounts "
            "(username, password_hash, display_name, role, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                username,
                hash_password(data['password']),
                display_name,
                ROLE_CARETAKER,
                STATUS_ACTIVE,
                _now_utc_iso(),
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # The UNIQUE constraint on username is the backstop, so two phones
        # registering the same name at the same instant cannot both succeed.
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        return jsonify({
            'error': 'That username is already taken',
            'code': 'username_taken',
        }), 409
    finally:
        conn.close()

    return jsonify({
        'token': generate_token(username),
        'display_name': display_name,
        'role': ROLE_CARETAKER,
        'status': STATUS_ACTIVE,
    }), 201


@app.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing credentials'}), 400

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM accounts WHERE username = ?",
            (normalize_username(data['username']),),
        ).fetchone()
    finally:
        conn.close()

    user = dict(row) if row is not None else None

    if not user or not check_password(data['password'], user['password_hash']):
        # Same message for an unknown user and a wrong password, so the reply
        # does not reveal which usernames exist.
        return jsonify({'error': 'Invalid username or password'}), 401

    # Checked only after the password matched, so a disabled account cannot be
    # discovered by someone who does not already know its password.
    if user['role'] not in KNOWN_ROLES:
        return jsonify({
            'error': 'This account has an unrecognised role',
            'code': 'role_unknown',
        }), 403

    if user['status'] != STATUS_ACTIVE:
        return jsonify({
            'error': 'This account has been disabled by the Owner/Admin',
            'code': 'account_disabled',
        }), 403

    return jsonify({
        'token': generate_token(user['username']),
        'display_name': user['display_name'],
        'role': user['role'],
        'status': user['status'],
    })


@app.route('/auth/me', methods=['GET'])
@token_required
def me(current_account):
    """The authenticated identity, as the Pi currently sees it.

    The app calls this when restoring a saved session: it turns a token that
    merely exists into one that is still valid, still enabled, and still the
    role it was. The role is never inferred from what the phone stored.
    """
    return jsonify(_account_public(current_account))



# ---------------------------------------------------------------------------
# Owner/Admin: caretaker account management
# ---------------------------------------------------------------------------
# Every route below is guarded by role_required(ROLE_OWNER), so a caretaker
# token gets 403 regardless of what the app does or does not show. What is
# deliberately NOT here:
#
#   * no way to create a second owner, and no way to change any role
#   * no way to disable, edit or even list the fixed Owner/Admin account
#   * no account deletion, and no caretaker promotion
#   * no way to read or reset a caretaker's password
#
# Threshold editing and SMS-recipient management are also deliberately absent
# from this release; both stay with the existing local commissioning process.


def _set_caretaker_status(username, status):
    """Disable or re-enable a caretaker. Refuses to touch the Owner/Admin."""
    username = normalize_username(username)
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM accounts WHERE username = ?", (username,)
        ).fetchone()
        if row is None:
            return jsonify({
                'error': 'No account called "%s" on this Pi' % username,
                'code': 'unknown_account',
            }), 404

        if row['role'] != ROLE_CARETAKER:
            # This is the fixed Owner/Admin. It cannot be disabled, re-roled or
            # otherwise managed from the caretaker screen.
            return jsonify({
                'error': 'The Owner/Admin account cannot be changed here',
                'code': 'not_a_caretaker',
            }), 403

        conn.execute(
            "UPDATE accounts SET status = ? WHERE username = ?", (status, username)
        )
        conn.commit()
        updated = _account_public(
            conn.execute(
                "SELECT * FROM accounts WHERE username = ?", (username,)
            ).fetchone()
        )
    finally:
        conn.close()

    return jsonify({"user": updated}), 200


@app.route('/admin/users', methods=['GET'])
@role_required(ROLE_OWNER)
def admin_list_users(current_account):
    """List the caretaker accounts.

    The Owner/Admin is absent by design: this screen must not be able to see or
    act on it.
    """
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM accounts WHERE role = ? ORDER BY username",
            (ROLE_CARETAKER,),
        ).fetchall()
    finally:
        conn.close()
    return jsonify({"users": [_account_public(r) for r in rows]})


@app.route('/admin/users', methods=['POST'])
@role_required(ROLE_OWNER)
def admin_create_user(current_account):
    """Create a caretaker account.

    Admin-created accounts are ordinary caretakers, subject to exactly the same
    username and password rules as public registration. 'role' in the body is
    ignored, so this endpoint cannot mint an owner.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Expected a JSON object body'}), 400

    username = normalize_username(data.get('username'))
    error = validate_username(username)
    if error:
        return jsonify({'error': error}), 400

    error = validate_password(data.get('password'), data.get('confirm_password'))
    if error:
        return jsonify({'error': error}), 400

    raw_display = data.get('display_name')
    if not isinstance(raw_display, str) or not raw_display.strip():
        raw_display = data.get('username')
    display_name = raw_display.strip() if isinstance(raw_display, str) else username

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO accounts "
            "(username, password_hash, display_name, role, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                username,
                hash_password(data['password']),
                display_name,
                ROLE_CARETAKER,
                STATUS_ACTIVE,
                _now_utc_iso(),
            ),
        )
        conn.commit()
        created = _account_public(
            conn.execute(
                "SELECT * FROM accounts WHERE username = ?", (username,)
            ).fetchone()
        )
    except sqlite3.IntegrityError:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        return jsonify({
            'error': 'That username is already taken',
            'code': 'username_taken',
        }), 409
    finally:
        conn.close()

    return jsonify({"user": created}), 201


@app.route('/admin/users/<username>/disable', methods=['POST'])
@role_required(ROLE_OWNER)
def admin_disable_user(current_account, username):
    """Disable a caretaker. Takes effect on its next request, not at expiry."""
    return _set_caretaker_status(username, STATUS_DISABLED)


@app.route('/admin/users/<username>/enable', methods=['POST'])
@role_required(ROLE_OWNER)
def admin_enable_user(current_account, username):
    """Re-enable a previously disabled caretaker."""
    return _set_caretaker_status(username, STATUS_ACTIVE)


@app.route('/readings/latest', methods=['GET'])
@token_required
def get_latest_reading(current_account):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM readings ORDER BY timestamp DESC LIMIT 1")
    row = cursor.fetchone()
    conn.close()

    res = {"pond_name": POND_NAME, "reading": None, "age_seconds": None}
    if row:
        res["reading"] = {
            "timestamp": row['timestamp'],
            "ph": row['ph'],
            "temperature_c": row['temperature_c'],
            "dissolved_oxygen_mg_l": row['dissolved_oxygen_mg_l']
        }
        # Same-clock age of this reading. Present only when there IS a reading:
        # with reading == None the app must show No Data, never Live, and an age
        # would be meaningless.
        res["age_seconds"] = _reading_age_seconds(row['timestamp'])
    return jsonify(res)


@app.route('/readings', methods=['GET'])
@token_required
def get_readings(current_account):
    limit = request.args.get('limit', default=50, type=int)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM readings ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()

    readings = []
    for r in rows:
        readings.append({
            "timestamp": r['timestamp'],
            "ph": r['ph'],
            "temperature_c": r['temperature_c'],
            "dissolved_oxygen_mg_l": r['dissolved_oxygen_mg_l']
        })
    return jsonify({"readings": readings})


@app.route('/alerts', methods=['GET'])
@token_required
def get_alerts(current_account):
    limit = request.args.get('limit', default=50, type=int)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()

    alerts = []
    for r in rows:
        alerts.append({
            "id": str(r['id']),
            "timestamp": r['timestamp'],
            "parameter": r['parameter'],
            "value": r['value'],
            "threshold": r['threshold'],
            "status": r['status'],
            "message": r['message']
        })
    return jsonify({"alerts": alerts})


@app.route('/thresholds', methods=['GET'])
@token_required
def get_thresholds(current_account):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM thresholds")
    rows = cursor.fetchall()
    conn.close()

    res = {"approved": False, "ph": {}, "temperature": {}, "dissolved_oxygen": {}}
    if rows:
        # Every parameter must be approved before the app may show "Safe".
        res["approved"] = all(bool(r['approved']) for r in rows)
        for r in rows:
            res[r['parameter']] = {
                "safe_min": r['safe_min'],
                "safe_max": r['safe_max'],
                "warn_min": r['warn_min'],
                "warn_max": r['warn_max']
            }
    return jsonify(res)


def verify_esp32_key(request):
    api_key = request.headers.get('X-API-Key')
    if not api_key:
        return False

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key_hash FROM esp32_keys")
    rows = cursor.fetchall()
    conn.close()

    for row in rows:
        if check_password(api_key, row['key_hash']):
            return True
    return False


@app.route('/esp32/ping', methods=['GET'])
def esp32_ping():
    """Prove the device can reach the Pi and that its key is accepted.

    Stores nothing. This is the check to run when bringing a board up, so a
    connectivity test never leaves a fake measurement in the pond history.
    """
    if not verify_esp32_key(request):
        return jsonify({"error": "Unauthorized API Key"}), 401

    return jsonify({
        "status": "ok",
        "message": "API key accepted. No data was stored.",
        "timestamp": _now_utc_iso(),
    })


@app.route('/esp32/readings', methods=['POST'])
def esp32_readings():
    if not verify_esp32_key(request):
        return jsonify({"error": "Unauthorized API Key"}), 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object body"}), 400

    if not data.get('timestamp'):
        return jsonify({"error": "Missing timestamp"}), 400

    try:
        dateutil.parser.isoparse(data['timestamp'])
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid timestamp format. Must be ISO-8601"}), 400

    event_id, error = _as_event_id(data.get('event_id'))
    if error:
        return jsonify({"error": error}), 400

    values = {}
    for field in READING_FIELDS:
        number, error = _as_number(data.get(field), field)
        if error:
            return jsonify({"error": error}), 400
        values[field] = number

    if all(values[f] is None for f in READING_FIELDS):
        return jsonify({
            "error": "No measurements supplied. Provide at least one of: "
                     + ", ".join(READING_FIELDS)
        }), 400

    conn = get_db()
    try:
        if event_id is not None:
            existing = conn.execute(
                "SELECT id FROM readings WHERE event_id = ?", (event_id,)
            ).fetchone()
            if existing:
                return jsonify({
                    "status": "duplicate",
                    "message": "Reading already stored",
                }), 200

        conn.execute('''
            INSERT INTO readings (timestamp, ph, temperature_c, dissolved_oxygen_mg_l, event_id)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            data['timestamp'],
            values['ph'],
            values['temperature_c'],
            values['dissolved_oxygen_mg_l'],
            event_id,
        ))
        conn.commit()
    except sqlite3.IntegrityError:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        return jsonify({
            "status": "duplicate",
            "message": "Reading already stored",
        }), 200
    finally:
        conn.close()

    return jsonify({"message": "Reading created"}), 201


@app.route('/esp32/alerts', methods=['POST'])
def esp32_alerts():
    if not verify_esp32_key(request):
        return jsonify({"error": "Unauthorized API Key"}), 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object body"}), 400

    if not data.get('timestamp') or not data.get('parameter') or not data.get('status'):
        return jsonify({"error": "Missing required fields"}), 400

    if data['parameter'] not in PARAMETERS:
        # Validated here rather than by letting the CHECK constraint raise, so
        # the reply does not leak SQLite's internal error text.
        return jsonify({
            "error": "Invalid parameter. Must be one of: " + ", ".join(PARAMETERS)
        }), 400

    if data['status'] not in ('warning', 'unsafe'):
        return jsonify({"error": "Invalid status value"}), 400

    try:
        dateutil.parser.isoparse(data['timestamp'])
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid timestamp format. Must be ISO-8601"}), 400

    event_id, error = _as_event_id(data.get('event_id'))
    if error:
        return jsonify({"error": error}), 400

    value, error = _as_number(data.get('value'), 'value')
    if error:
        return jsonify({"error": error}), 400

    threshold = data.get('threshold')
    if threshold is not None and not isinstance(threshold, str):
        return jsonify({"error": "threshold must be a string or null"}), 400

    message = data.get('message')
    if message is not None and not isinstance(message, str):
        return jsonify({"error": "message must be a string or null"}), 400

    conn = get_db()
    try:
        if event_id is not None:
            existing = conn.execute(
                "SELECT id FROM alerts WHERE event_id = ?", (event_id,)
            ).fetchone()
            if existing:
                return jsonify({
                    "status": "duplicate",
                    "message": "Alert already stored",
                }), 200

        conn.execute('''
            INSERT INTO alerts (timestamp, parameter, value, threshold, status, message, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['timestamp'],
            data['parameter'],
            value,
            threshold,
            data['status'],
            message,
            event_id,
        ))
        conn.commit()
    except sqlite3.IntegrityError:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        return jsonify({
            "status": "duplicate",
            "message": "Alert already stored",
        }), 200
    finally:
        conn.close()

    return jsonify({"message": "Alert created"}), 201


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
