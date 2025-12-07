FROM nginx:alpine

# Install openssl and iproute2 for certificate generation and IP detection
RUN apk add --no-cache openssl iproute2

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy certificate generation script to run before nginx starts
# This runs as part of nginx's default entrypoint process
COPY docker-entrypoint.sh /docker-entrypoint.d/99-generate-ssl-certs.sh
RUN chmod +x /docker-entrypoint.d/99-generate-ssl-certs.sh

# Create directories for SSL and certbot
RUN mkdir -p /etc/nginx/ssl /var/www/certbot

# Expose ports
EXPOSE 80 443

# Use default nginx entrypoint (which will run our script in docker-entrypoint.d first)

