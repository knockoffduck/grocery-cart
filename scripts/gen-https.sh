#!/usr/bin/env bash
# Generate a self-signed TLS cert that covers the homelab LAN IP and localhost.
# Mobile browsers accept self-signed certs after you trust them in Settings
# (iOS: install profile + General > About > Certificate Trust Settings;
# Android: Settings > Security > Encryption & credentials > Install a certificate).
#
# For a public cert instead, use Caddy with a real domain (revotracker.dvcklab.com
# is already set up; aldi.dvcklab.com or similar would work too).

set -euo pipefail

CERT_DIR="${CERT_DIR:-./certs}"
mkdir -p "$CERT_DIR"
CERT="$CERT_DIR/cert.pem"
KEY="$CERT_DIR/key.pem"

if [[ -f "$CERT" && -f "$KEY" ]]; then
  echo "[gen-https] existing cert found at $CERT_DIR; skipping generation."
  echo "[gen-https] Delete it and re-run if it has expired."
  exit 0
fi

# Detect the LAN IP (best effort)
LAN_IP="$(ip -4 addr show 2>/dev/null | awk '/inet / && !/127.0.0.1/ {print $2; exit}' | cut -d/ -f1)"
LAN_IP="${LAN_IP:-192.168.68.55}"

# Build a SAN list that covers localhost, the LAN IP, and common variants
SAN="DNS:localhost,DNS:aldi-cart.local,IP:127.0.0.1,IP:${LAN_IP}"

# Some openssl versions want -addext, others -extensions
OPENSSL_VERSION="$(openssl version | awk '{print $2}' | cut -d. -f1)"
if [[ "$OPENSSL_VERSION" -ge 3 ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout "$KEY" -out "$CERT" \
    -subj "/C=AU/ST=WA/L=Perth/O=homelab/CN=aldi-cart" \
    -addext "subjectAltName=$SAN" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
else
  cat > /tmp/openssl-san.cnf <<EOF
[req]
distinguished_name = req
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = AU
ST = WA
L = Perth
O = homelab
CN = aldi-cart

[v3_req]
subjectAltName = $SAN
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout "$KEY" -out "$CERT" \
    -config /tmp/openssl-san.cnf
  rm /tmp/openssl-san.cnf
fi

echo "[gen-https] wrote $CERT and $KEY (valid 365 days)"
echo "[gen-https] on iOS: AirDrop these files to the phone, install the profile, then enable it in Settings > General > About > Certificate Trust Settings"
echo "[gen-https] on Android: open the cert file or send to phone, install via Settings > Security > Encryption & credentials > Install a certificate"
