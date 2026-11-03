# syntax=docker/dockerfile:1.10
#
# The `web` container of fleet-server's docker-compose.prod.yml: the built site
# served by unprivileged nginx (uid 101, port 8080, no capabilities). The edge
# container in front of it handles TLS, /api and /webhook.
#
# Build keys arrive as BuildKit secrets, never build args, so they stay out of
# the image history. They still end up in the bundle, as they do today: the
# browser needs them, and they are restricted by referrer in their consoles.
#
#   docker build \
#     --secret id=VITE_GOOGLE_MAPS_API_KEY,env=VITE_GOOGLE_MAPS_API_KEY \
#     --secret id=VITE_MYTOMTOM_API_KEY,env=VITE_MYTOMTOM_API_KEY \
#     -t <account>.dkr.ecr.af-south-1.amazonaws.com/ghala:raitrack-<sha> .
ARG NODE_IMAGE=node:24.18.0-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.28.0-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The context has no .git, so vite.config.js gets the short commit the
# sidebar shows from APP_COMMIT instead of `git rev-parse`.
ARG GIT_SHA=unknown
RUN --mount=type=secret,id=VITE_GOOGLE_MAPS_API_KEY,env=VITE_GOOGLE_MAPS_API_KEY \
    --mount=type=secret,id=VITE_MYTOMTOM_API_KEY,env=VITE_MYTOMTOM_API_KEY \
    test -n "${VITE_GOOGLE_MAPS_API_KEY}" \
 && if [ "${GIT_SHA}" != unknown ]; then export APP_COMMIT="$(printf %s "${GIT_SHA}" | cut -c1-7)"; fi \
 && npm run build \
 && grep -rqF "${VITE_GOOGLE_MAPS_API_KEY}" build/assets \
 && test -f build/index.html
# Same stamp the rsync deploy writes; the deploy workflow reads it back to
# prove which build is being served.
RUN printf '%s OGC-Ltd/raitrack v%s\n' "${GIT_SHA}" "$(node -p "require('./package.json').version")" > build/DEPLOYED_COMMIT

FROM ${NGINX_IMAGE} AS runtime
# Only what serving static files needs, then Alpine's security updates: the
# pinned base trails them, and the scan in CI refuses fixable HIGH/CRITICAL
# findings (49 on 2026-11-03: openssl, curl, brotli, c-ares, then libexpat).
#   - The four dynamic modules are installed but never loaded (no load_module
#     anywhere); removing them purges 47 packages: gd, fontconfig, libexpat,
#     libxml2, libxslt, image libraries...  `nginx -t` passes without them.
#   - curl: nothing uses it (the healthcheck is busybox wget).
# ARG APK_REFRESH changes every CI run, so this layer is never reused from
# cache and each image gets the updates published up to its build.
USER root
ARG APK_REFRESH=manual
RUN echo "apk refresh: ${APK_REFRESH}" \
 && apk del --no-cache nginx-module-image-filter nginx-module-xslt nginx-module-geoip nginx-module-njs curl \
 && apk upgrade --no-cache \
 && nginx -t \
 && rm -rf /var/cache/apk/* /usr/share/nginx/html/*
# (The base image's own pages go too: the site below is the whole web root.)
USER 101
COPY --chmod=644 deploy/web.conf /etc/nginx/conf.d/default.conf
# Files owned by root and read-only to nginx (uid 101): the server cannot alter the site.
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/index.html || exit 1
