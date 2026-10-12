"""Runtime configuration for the AQSMS Pi server.

Secrets come from the environment first, then from a file sitting next to this
module. Nothing secret has a usable default: if the JWT secret is missing the
server refuses to sign or verify a token, rather than quietly falling back to a
value that is published in the source tree.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _read_secret(env_name, file_name):
    """Environment variable first, then a file beside this module."""
    value = os.environ.get(env_name)
    if value and value.strip():
        return value.strip()

    path = os.path.join(BASE_DIR, file_name)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip() or None
    except OSError:
        return None


# Absolute path, so the server reaches the same database file no matter what
# working directory it is started from. A relative default meant `python
# server.py` and a systemd unit with a different WorkingDirectory would each
# open (and initialise) a *different*, empty database.
DB_PATH = os.environ.get("DB_PATH") or os.path.join(BASE_DIR, "aqsms.db")

TOKEN_EXPIRY_HOURS = int(os.environ.get("AQSMS_TOKEN_EXPIRY_HOURS", "24"))
PORT = int(os.environ.get("AQSMS_PORT", "8000"))

_JWT_SECRET = _read_secret("AQSMS_JWT_SECRET", "jwt_secret.txt")

_MISSING_SECRET_HELP = (
    "AQSMS_JWT_SECRET is not set, so the server will not start.\n"
    "\n"
    "The token signing key must not be a value that ships in the source tree:\n"
    "anyone holding it can forge a login token for this Pi without knowing the\n"
    "password. Generate one and keep it on the Pi:\n"
    "\n"
    '    python -c "import secrets; print(secrets.token_urlsafe(48))"\n'
    "\n"
    "Save it to pi-server/jwt_secret.txt (chmod 600, never committed), or export\n"
    "it as AQSMS_JWT_SECRET.\n"
)


# RFC 7518 section 3.2 sets 32 bytes as the minimum for an HMAC-SHA256 key.
# Below that the key is short enough to brute-force offline from a single
# captured token, which would let anyone forge a login.
JWT_SECRET_MIN_BYTES = 32


def jwt_secret():
    """The HS256 signing key, or raise if it was never configured."""
    if not _JWT_SECRET:
        raise RuntimeError(_MISSING_SECRET_HELP)

    length = len(_JWT_SECRET.encode("utf-8"))
    if length < JWT_SECRET_MIN_BYTES:
        raise RuntimeError(
            "AQSMS_JWT_SECRET is only %d bytes; at least %d are required.\n"
            "\n"
            "A short HS256 key can be brute-forced offline from one captured\n"
            "token, which would let anyone forge a login. Generate a longer one:\n"
            "\n"
            '    python -c "import secrets; print(secrets.token_urlsafe(48))"\n'
            % (length, JWT_SECRET_MIN_BYTES)
        )
    return _JWT_SECRET
