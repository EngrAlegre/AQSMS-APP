#!/usr/bin/env bash
#
# Create the AQSMS Pi's TLS certificate for LAN-only HTTPS.
#
# Run this ON THE RASPBERRY PI, once. It creates a private local certificate
# authority and a server certificate signed by it. The CA certificate -- and
# only the CA certificate -- is copied into the phone app, so the phone trusts
# exactly this Pi and nothing else. No public internet, no domain name and no
# port forwarding are involved.
#
# Usage:
#   ./make-cert.sh                    # auto-detect this Pi's LAN address
#   ./make-cert.sh 192.168.1.50       # state the address explicitly (safer)
#   ./make-cert.sh 192.168.1.50 aquapi.local   # plus extra names to cover
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$DIR/certs"
CA_KEY="$CERT_DIR/aqsms-ca.key"
CA_CRT="$CERT_DIR/aqsms-ca.crt"
SRV_KEY="$CERT_DIR/pi-server.key"
SRV_CRT="$CERT_DIR/pi-server.crt"

# The server certificate stays under the validity limit Android applies to
# CA-issued certificates. The CA is long-lived and never leaves the Pi.
CA_DAYS=3650
SRV_DAYS=825

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is not installed. On Raspberry Pi OS run:" >&2
  echo "  sudo apt update && sudo apt install -y openssl" >&2
  exit 1
fi

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

# ---- 1. Work out which addresses the certificate has to cover ---------------
PRIMARY="${1:-}"
if [ -z "$PRIMARY" ]; then
  PRIMARY="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$PRIMARY" ]; then
  echo "Could not detect a LAN address. Run it again stating the address:" >&2
  echo "  ./make-cert.sh 192.168.1.50" >&2
  exit 1
fi

SHORT="$(hostname -s 2>/dev/null || echo raspberrypi)"

# The address appears TWICE -- as an IP: entry and as a DNS: entry. The DNS:
# copy is NOT redundant and must not be tidied away.
#
# The ESP32 board does not use OpenSSL. It uses mbedTLS 2.28.7 as patched by
# ESP-IDF (arduino-esp32 core 2.0.17), and that x509 code has no handling for
# iPAddress SAN entries at all -- it knows only dNSName and emailAddress, and
# prints IP: entries as "<unsupported>". The board connects by raw address and
# so hands mbedTLS the STRING "10.42.0.1"; mbedTLS compares that string against
# the dNSName entries, finds nothing, and fails the handshake with CN_MISMATCH
# -- while the chain itself verifies perfectly against the CA baked into the
# sketch. The error reads like a trust failure and is not one.
#
# Android DOES match IP: entries. So without the DNS: copy the certificate
# works on the phone and fails on the board. Found on hardware: the board's own
# SAN dump showed two "<unsupported>" lines where the IP: entries should be.
#
# (Loopback needs no twin -- nothing connects to it by name. The extras loop
# below keeps the two forms in step for any further address.)
SAN="IP:${PRIMARY},IP:127.0.0.1,DNS:${PRIMARY},DNS:localhost,DNS:${SHORT},DNS:${SHORT}.local"

# Any extra arguments become additional names. A bare dotted-quad is treated as
# an IP address, anything else as a hostname. An extra address gets a DNS: twin
# for the same reason PRIMARY does.
shift || true
for extra in "$@"; do
  [ -n "$extra" ] || continue
  case "$extra" in
    *[!0-9.]*) SAN="${SAN},DNS:${extra}" ;;
    *)         SAN="${SAN},IP:${extra},DNS:${extra}" ;;
  esac
done

# ---- 2. The local CA (created once, then reused) ---------------------------
if [ -f "$CA_KEY" ] && [ -f "$CA_CRT" ]; then
  echo "Reusing the existing certificate authority: $CA_CRT"
else
  echo "Creating the AQSMS local certificate authority..."
  openssl req -x509 -newkey rsa:4096 -sha256 -days "$CA_DAYS" -nodes \
    -keyout "$CA_KEY" -out "$CA_CRT" \
    -subj "/CN=AQSMS Local CA/O=AQSMS" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 "$CA_KEY"
fi

# ---- 3. The server certificate --------------------------------------------
echo "Creating a server certificate covering:"
echo "    $SAN"

EXT_FILE="$(mktemp)"
trap 'rm -f "$EXT_FILE"' EXIT
cat > "$EXT_FILE" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${SAN}
EOF

CSR_FILE="$(mktemp)"
openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$SRV_KEY" -out "$CSR_FILE" \
  -subj "/CN=${PRIMARY}/O=AQSMS"

openssl x509 -req -in "$CSR_FILE" \
  -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$SRV_CRT" -days "$SRV_DAYS" -sha256 -extfile "$EXT_FILE"

# The key is unencrypted so the service can start unattended after a reboot.
# It is readable only by its owner and never leaves the Pi.
chmod 600 "$SRV_KEY"

# ---- 4. Confirm the certificate actually verifies against the CA -----------
openssl verify -CAfile "$CA_CRT" "$SRV_CRT"

cat <<EOF

Done.

  CA certificate   $CA_CRT
  Server cert      $SRV_CRT
  Server key       $SRV_KEY   (private -- never copy this off the Pi)

Next:

  1. Start the API over HTTPS:
         ./serve.sh

  2. Enter this address in the app:
         https://${PRIMARY}:8443

If step 2 above said "Reusing", the app already trusts this CA and an address
change alone needs NO rebuild -- just re-enter the address. Only if the CA was
newly created do you need to copy it over and rebuild:

         scp <pi-user>@${PRIMARY}:${CA_CRT} frontend/certs/aqsms-ca.crt

The certificate names the exact address it was issued for, so if the Pi's
address ever changes again, re-run this script with the new address. Give the Pi
a fixed address if you can (see PHONE_TO_PI_SETUP.md) so that never happens.
The certificate expires $SRV_DAYS days from now.
EOF
