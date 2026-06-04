# Minimal, non-root sidecar image.
FROM node:20-alpine

# Run as the built-in unprivileged "node" user.
WORKDIR /app
COPY package.json ./
# No third-party deps (stdlib only) → keep the install step for cache/lockfile parity.
RUN npm install --omit=dev --no-audit --no-fund || true
COPY server.js ./

ENV SIDECAR_PORT=8081
USER node

# Container-level health check hits loopback only.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SIDECAR_PORT||8081)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
