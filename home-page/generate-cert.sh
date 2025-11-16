#!/bin/bash
# Generate self-signed certificate for HTTPS development

CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_FILE="$CERT_DIR/localhost.pem"
KEY_FILE="$CERT_DIR/localhost-key.pem"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
  echo "Certificate files already exist."
  exit 0
fi

echo "Generating self-signed certificate for HTTPS..."
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.local,IP:127.0.0.1,IP:::1"

if [ $? -eq 0 ]; then
  echo "Certificate generated successfully!"
  echo "Cert: $CERT_FILE"
  echo "Key: $KEY_FILE"
else
  echo "Error generating certificate"
  exit 1
fi

