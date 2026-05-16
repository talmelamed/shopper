# Playwright's official image already has Chromium + all OS deps wired up.
# Pinned to the same version as the npm `playwright` package.
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

# Xvfb (virtual display), x11vnc (VNC server), websockify (TCP <-> WS bridge),
# noVNC (browser-based VNC client), and a window manager so Chromium has chrome.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      websockify \
      novnc \
      openbox \
      fluxbox \
      tini \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest of the source.
COPY tsconfig.json ./
COPY src ./src

# Copy corporate CA cert so Node.js and the system trust Cato's SSL inspection.
COPY cato-ca.pem /usr/local/share/ca-certificates/cato-ca.crt
RUN update-ca-certificates

# Runtime config
ENV DISPLAY=:99 \
    SCREEN_GEOMETRY=1280x900x24 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080 \
    NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/cato-ca.crt

# Persistent state lives in mounted volumes.
RUN mkdir -p /app/auth /app/state /app/traces && \
    chmod 700 /app/auth /app/state

# Start script: Xvfb, fluxbox, x11vnc, websockify, then the bot.
COPY <<'EOF' /entrypoint.sh
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  kill -TERM 0 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM EXIT

# Clear stale lock files from previous runs
rm -f /tmp/.X${DISPLAY#:}-lock /tmp/.X11-unix/X${DISPLAY#:} 2>/dev/null || true
rm -f /app/auth/SingletonLock /app/auth/SingletonCookie /app/auth/SingletonSocket 2>/dev/null || true

Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" &
sleep 0.5

fluxbox >/dev/null 2>&1 &

VNC_ARGS=(-display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -nopw -bg -o /tmp/x11vnc.log)
if [[ -n "${NOVNC_PASSWORD:-}" ]]; then
  mkdir -p ~/.vnc
  x11vnc -storepasswd "$NOVNC_PASSWORD" ~/.vnc/passwd
  VNC_ARGS=(-display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -rfbauth ~/.vnc/passwd -bg -o /tmp/x11vnc.log)
fi
x11vnc "${VNC_ARGS[@]}"

websockify --web=/usr/share/novnc "$NOVNC_PORT" "localhost:$VNC_PORT" &

exec npx tsx src/index.ts
EOF
RUN chmod +x /entrypoint.sh

EXPOSE 6080

# tini gives us clean signal forwarding & PID-1 reaping.
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
