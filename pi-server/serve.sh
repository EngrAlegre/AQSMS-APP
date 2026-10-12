#!/usr/bin/env bash
#
# Run the AQSMS Pi API.
#
# Serves HTTPS when a certificate exists (see ./make-cert.sh), and otherwise
# falls back to plain HTTP with a loud warning -- because plain HTTP sends the
# farmer's password and session token across the Wi-Fi in the clear.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -x "$DIR/venv/bin/python" ]; then
  echo "No virtualenv at $DIR/venv. Create it first:" >&2
  echo "  python3 -m venv venv && ./venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

PORT="${AQSMS_PORT:-8443}"
WORKERS="${AQSMS_WORKERS:-1}"
THREADS="${AQSMS_THREADS:-4}"

CERT="$DIR/certs/pi-server.crt"
KEY="$DIR/certs/pi-server.key"

# One worker process with several threads. SQLite allows only a single writer,
# so extra processes would add lock contention without adding throughput on a
# Pi; threads are enough for a single farm's phone and one ESP32.
COMMON=(--bind "0.0.0.0:${PORT}" --workers "$WORKERS" --threads "$THREADS" --timeout 30 --access-logfile -)

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "Serving AQSMS over HTTPS on port ${PORT}."
  [ -n "$LAN_IP" ] && echo "Enter this in the app:  https://${LAN_IP}:${PORT}"
  exec "$DIR/venv/bin/gunicorn" "${COMMON[@]}" \
    --certfile "$CERT" --keyfile "$KEY" server:app
fi

cat >&2 <<'EOF'
WARNING: no certificate found, serving over plain HTTP.

  Passwords and session tokens will cross the Wi-Fi unencrypted, and anyone on
  the same network can read or alter them. This is fine for a first bench test
  on a trusted network, and not fine for a working pond.

  Create a certificate, then restart:
      ./make-cert.sh
EOF
exec "$DIR/venv/bin/gunicorn" "${COMMON[@]}" server:app
