#!/bin/bash
# Generate self-signed SSL certificate for development
# For production, use Let's Encrypt certificates instead

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="$SCRIPT_DIR/ssl"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

# Create ssl directory if it doesn't exist
mkdir -p "$CERT_DIR"

# Check if certificates already exist
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "SSL certificates already exist at:"
    echo "  Cert: $CERT_FILE"
    echo "  Key: $KEY_FILE"
    echo ""
    read -p "Regenerate certificates? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing certificates."
        exit 0
    fi
fi

echo "Generating self-signed SSL certificate..."
echo "This certificate is for development only."
echo "For production, use Let's Encrypt certificates."
echo ""

# Generate certificate with Subject Alternative Names
openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 365 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:*.local,DNS:home.local,DNS:hubitat-agent.local,DNS:hubitat-mcp.local,IP:127.0.0.1,IP:::1" \
    -sha256

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ SSL certificate generated successfully!"
    echo "  Cert: $CERT_FILE"
    echo "  Key: $KEY_FILE"
    echo ""
    echo "Note: This is a self-signed certificate. Your browser will show a security warning."
    echo "For production use, set up Let's Encrypt certificates with certbot."
else
    echo "✗ Error generating certificate"
    exit 1
fi

