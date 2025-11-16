# SSL Setup for Docker Containers

This directory contains the nginx reverse proxy configuration for serving all Docker containers over SSL/TLS.

## Quick Start

### 1. Generate SSL Certificates

For **development** (self-signed certificates):

```bash
cd nginx
./generate-ssl-cert.sh
```

This will create self-signed certificates in `nginx/ssl/` that are valid for:
- `localhost`
- `*.local` domains
- `127.0.0.1` and `::1`

**Note**: Your browser will show a security warning for self-signed certificates. This is normal for development.

### 2. Start the Services

```bash
docker compose up -d
```

### 3. Access Your Services

All services are now accessible via HTTPS:

- **Home Page**: `https://localhost/` (or `https://localhost:443/`)
- **Hubitat Agent**: `https://localhost/agent` (or `https://localhost/hubitat-agent`)
- **Hubitat MCP**: `https://localhost/mcp` (or `https://localhost/hubitat-mcp`)

HTTP traffic on port 80 is automatically redirected to HTTPS.

## Production Setup with Let's Encrypt

For production use with real SSL certificates from Let's Encrypt:

### Option 1: Using Certbot (Recommended)

1. **Install certbot** on your host machine:
   ```bash
   # macOS
   brew install certbot
   
   # Ubuntu/Debian
   sudo apt-get install certbot
   ```

2. **Stop nginx temporarily**:
   ```bash
   docker compose stop nginx
   ```

3. **Obtain certificates** (replace with your domain):
   ```bash
   sudo certbot certonly --standalone \
     -d yourdomain.com \
     -d hubitat-agent.yourdomain.com \
     -d hubitat-mcp.yourdomain.com
   ```

4. **Copy certificates to nginx/ssl/**:
   ```bash
   sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
   sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem
   sudo chmod 644 nginx/ssl/cert.pem
   sudo chmod 600 nginx/ssl/key.pem
   ```

5. **Update nginx.conf** to use your domain names (see below)

6. **Start nginx**:
   ```bash
   docker compose up -d nginx
   ```

7. **Set up auto-renewal**:
   ```bash
   # Add to crontab (runs twice daily)
   sudo crontab -e
   # Add:
   0 0,12 * * * certbot renew --quiet && docker compose restart nginx
   ```

### Option 2: Using Docker with Certbot

You can also use a certbot Docker container to manage certificates:

```bash
docker run -it --rm \
  -v "$(pwd)/nginx/certbot:/var/www/certbot" \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d yourdomain.com
```

## Configuration

### Path-Based Routing (Current Setup)

The current configuration uses path-based routing, which works well for localhost:

- `/` → Home Page
- `/agent` or `/hubitat-agent` → Hubitat Agent
- `/mcp` or `/hubitat-mcp` → Hubitat MCP

### Server Name Routing (Alternative)

If you prefer to use different hostnames (e.g., `hubitat-agent.local`), you can:

1. **Add entries to `/etc/hosts`**:
   ```
   127.0.0.1  hubitat-agent.local
   127.0.0.1  hubitat-mcp.local
   127.0.0.1  home.local
   ```

2. **Update `nginx.conf`** to use `server_name` blocks instead of path-based routing.

3. **Update certificates** to include these hostnames:
   ```bash
   # In generate-ssl-cert.sh, add:
   -addext "subjectAltName=DNS:hubitat-agent.local,DNS:hubitat-mcp.local,DNS:home.local,..."
   ```

## Troubleshooting

### Certificate Errors

- **Self-signed certificate warning**: Normal for development. Click "Advanced" → "Proceed to localhost" in your browser.
- **Certificate not found**: Make sure you've run `generate-ssl-cert.sh` before starting nginx.
- **Permission denied**: Ensure certificates are readable:
  ```bash
  chmod 644 nginx/ssl/cert.pem
  chmod 600 nginx/ssl/key.pem
  ```

### Connection Issues

- **502 Bad Gateway**: Check that backend services are running:
  ```bash
  docker compose ps
  ```
- **Connection refused**: Verify services are on the same Docker network (`ollama-network`).
- **Port conflicts**: Ensure ports 80 and 443 are not in use:
  ```bash
  lsof -i :80
  lsof -i :443
  ```

### Viewing Logs

```bash
# Nginx logs
docker compose logs nginx

# Backend service logs
docker compose logs hubitat-agent
docker compose logs hubitat-mcp
docker compose logs home-page
```

## Security Notes

- **Development**: Self-signed certificates are fine for local development.
- **Production**: Always use Let's Encrypt or another trusted CA for production.
- **Firewall**: Consider restricting access to ports 80/443 in production.
- **HTTPS Only**: The configuration redirects all HTTP traffic to HTTPS.

## Files

- `nginx.conf` - Main nginx configuration
- `Dockerfile` - Nginx container definition
- `generate-ssl-cert.sh` - Script to generate self-signed certificates
- `ssl/` - Directory for SSL certificates (gitignored)
- `certbot/` - Directory for Let's Encrypt challenges (gitignored)

