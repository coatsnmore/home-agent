#!/bin/sh
# Docker entrypoint script for nginx
# Generates SSL certificates if they don't exist
# This script runs as part of nginx's default entrypoint process

CERT_DIR="/etc/nginx/ssl"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

# Create ssl directory if it doesn't exist
mkdir -p "$CERT_DIR"

# Generate certificates if they don't exist
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "SSL certificates not found. Generating self-signed certificates..."
    echo "This certificate is for development only."
    echo "For production, use Let's Encrypt certificates."
    
    # Generate certificate with Subject Alternative Names
    openssl req -x509 -newkey rsa:4096 -nodes \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days 365 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,DNS:*.local,DNS:home.local,DNS:hubitat-agent.local,DNS:hubitat-mcp.local,IP:127.0.0.1,IP:::1" \
        -sha256
    
    if [ $? -eq 0 ]; then
        echo "✓ SSL certificate generated successfully!"
        echo "  Cert: $CERT_FILE"
        echo "  Key: $KEY_FILE"
        chmod 644 "$CERT_FILE"
        chmod 600 "$KEY_FILE"
    else
        echo "✗ Error generating certificate"
        exit 1
    fi
else
    echo "SSL certificates already exist, skipping generation."
fi

# Don't start nginx here - the default nginx entrypoint will do that
# This script just generates certificates before nginx starts

