FROM nginx:alpine

# Set UID/GID for nginx user to match n8n
ARG UID=1000
ARG GID=1000

# Install bash (for RUN commands) and create nginx user
RUN apk add --no-cache bash \
 && addgroup -g ${GID} nginxuser \
 && adduser -D -u ${UID} -G nginxuser nginxuser \
 \
 # Create directories
 && mkdir -p /srv/digest \
 && mkdir -p /srv/cache/{client_temp,proxy_temp,fastcgi_temp,uwsgi_temp,scgi_temp} \
 && mkdir -p /srv/run \
 \
 # Ensure nginx can write to them
 && chown -R nginxuser:nginxuser /srv/digest /srv/cache /srv/run

# Copy nginx config files
COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx-digest.conf /etc/nginx/conf.d/default.conf

# Switch to non-root user
USER nginxuser

# Expose HTTP port
EXPOSE 8080

# Start nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
