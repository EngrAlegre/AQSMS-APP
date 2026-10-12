import datetime
import re
from functools import wraps

import bcrypt
import jwt
from flask import jsonify, request

from config import TOKEN_EXPIRY_HOURS, jwt_secret
from db import get_db

# bcrypt only reads the first 72 bytes of a password. Version 4 truncated the
# rest silently; version 5 raises instead, which would surface to the app as a
# 500 rather than a validation message. Reject over-long passwords up front,
# and treat one arriving at login as simply not matching.
BCRYPT_MAX_BYTES = 72
PASSWORD_MIN_LENGTH = 8

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 32
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")

# ---------------------------------------------------------------------------
# Roles and account state
# ---------------------------------------------------------------------------
# Exactly two roles exist. Anything else found in the database is treated as
# unusable rather than guessed at -- see authenticate() below.
ROLE_OWNER = "owner"
ROLE_CARETAKER = "caretaker"
KNOWN_ROLES = frozenset({ROLE_OWNER, ROLE_CARETAKER})

STATUS_ACTIVE = "active"
STATUS_DISABLED = "disabled"
KNOWN_STATUSES = frozenset({STATUS_ACTIVE, STATUS_DISABLED})

# The one fixed Owner/Admin account. Its password hash is written into the Pi's
# database by `provision_admin.py`, which is run locally on the Pi; the password
# is never embedded in the app, and no endpoint can create a second owner.
ADMIN_USERNAME = "aquasmart@app.com"

# Identifiers the public caretaker registration endpoint must refuse. The
# pattern below already rejects '@', so this is belt and braces: the reserved
# check runs first so the caller gets a reason that matches the actual problem
# instead of a generic "letters only" message.
RESERVED_USERNAMES = frozenset({ADMIN_USERNAME})



def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except (ValueError, TypeError):
        # Malformed stored hash, or a password bcrypt refuses to process.
        # Either way this is not a successful match -- never an exception.
        return False


def normalize_username(raw) -> str:
    """Trim and lower-case, so 'Farmer' and 'farmer' are the same account."""
    return raw.strip().lower() if isinstance(raw, str) else ""


def validate_username(username: str):
    """Return an error message, or None when the username is acceptable."""
    if not username:
        return "Username is required"
    # Checked before the character rule so the reserved identifier is refused
    # for the real reason rather than as an unexplained punctuation error.
    if username in RESERVED_USERNAMES:
        return "That identifier is reserved for the Owner/Admin account"
    if len(username) < USERNAME_MIN_LENGTH:
        return "Username must be at least %d characters" % USERNAME_MIN_LENGTH
    if len(username) > USERNAME_MAX_LENGTH:
        return "Username must be at most %d characters" % USERNAME_MAX_LENGTH
    if not USERNAME_PATTERN.match(username):
        return "Username may only contain letters, numbers, dot, dash and underscore"
    return None


def validate_password(password, confirm=None):
    """Return an error message, or None when the password is acceptable."""
    if not isinstance(password, str) or not password:
        return "Password is required"

    if len(password.encode('utf-8')) > BCRYPT_MAX_BYTES:
        return "Password is too long (maximum %d bytes)" % BCRYPT_MAX_BYTES

    if len(password) < PASSWORD_MIN_LENGTH:
        return "Password must be at least %d characters" % PASSWORD_MIN_LENGTH

    if confirm is not None and password != confirm:
        return "Passwords do not match"

    return None


def validate_initial_admin_password(password, confirm=None):
    """Validation for the FIXED Owner/Admin initial password, and nothing else.

    The public caretaker rule (PASSWORD_MIN_LENGTH) is deliberately not applied
    here. The prototype credentials supplied for this build are shorter than
    that minimum, and weakening the caretaker rule to accommodate them would
    lower the bar for every account anyone can create from the app. Instead the
    short password is confined to this one local, operator-run provisioning
    path, which is the narrow exception the brief allows.

    Still enforced: bcrypt's 72-byte ceiling, and a non-empty password.
    """
    if not isinstance(password, str) or not password:
        return "Password is required"
    if len(password.encode('utf-8')) > BCRYPT_MAX_BYTES:
        return "Password is too long (maximum %d bytes)" % BCRYPT_MAX_BYTES
    if confirm is not None and password != confirm:
        return "Passwords do not match"
    return None


def generate_token(username: str) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        'sub': username,
        'iat': now,
        'exp': now + datetime.timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, jwt_secret(), algorithm='HS256')


def load_account(username):
    """The account row as a plain dict, or None.

    A dict rather than the sqlite3.Row: the connection is closed before the
    caller uses it, and a dict makes that obviously safe.
    """
    if not isinstance(username, str) or not username:
        return None
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM accounts WHERE username = ?", (username,)
        ).fetchone()
    finally:
        conn.close()
    return dict(row) if row is not None else None


def _bearer_token():
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        return header.split(' ', 1)[1].strip() or None
    return None


def authenticate():
    """Resolve the caller to an account: (account, None) or (None, response).

    Two distinct failures, kept distinct on purpose:

      401 -- the caller is not authenticated. No token, a bad one, an expired
             one, an account that has since been deleted, or a role this build
             does not recognise. The app must return to sign-in for all of
             these, so they share a status code.

      403 -- the account is real and the token is good, but the account is
             disabled and may not act at all.

    The role is read from the database on every request. It is not carried in
    the token, so a role change or a disable takes effect immediately rather
    than whenever the token happens to expire.
    """
    token = _bearer_token()
    if not token:
        return None, (jsonify({'error': 'Token is missing', 'code': 'token_missing'}), 401)

    try:
        data = jwt.decode(token, jwt_secret(), algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return None, (jsonify({'error': 'Token has expired', 'code': 'token_expired'}), 401)
    except jwt.InvalidTokenError:
        return None, (jsonify({'error': 'Invalid token', 'code': 'token_invalid'}), 401)

    account = load_account(data.get('sub'))
    if account is None:
        return None, (jsonify({
            'error': 'This account no longer exists',
            'code': 'account_missing',
        }), 401)

    if account['role'] not in KNOWN_ROLES:
        # An unrecognised role is never treated as a weaker role, or as no
        # role, or as anything else: it is a refusal.
        return None, (jsonify({
            'error': 'This account has an unrecognised role',
            'code': 'role_unknown',
        }), 401)

    if account['status'] != STATUS_ACTIVE:
        return None, (jsonify({
            'error': 'This account has been disabled by the Owner/Admin',
            'code': 'account_disabled',
        }), 403)

    return account, None


def token_required(f):
    """Any authenticated, enabled account, whatever its role."""
    @wraps(f)
    def decorated(*args, **kwargs):
        account, error = authenticate()
        if error:
            return error
        return f(account, *args, **kwargs)
    return decorated


def role_required(*allowed_roles):
    """Only the named roles. Enforced here, not by hiding app screens."""
    allowed = frozenset(allowed_roles)

    def wrapper(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            account, error = authenticate()
            if error:
                return error
            if account['role'] not in allowed:
                return jsonify({
                    'error': 'This action requires the Owner/Admin account',
                    'code': 'forbidden_role',
                }), 403
            return f(account, *args, **kwargs)
        return decorated
    return wrapper

