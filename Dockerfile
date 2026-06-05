# ── Build stage: compile the Vite SPA ──────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Vite inlines VITE_* env at BUILD time. These are the PUBLIC Supabase anon
# values (already present in render.yaml) — safe to default so Compose runs out
# of the box. Override via build args / CI for other environments.
ARG VITE_SUPABASE_URL="https://xvkxccqaopbnkvwgyfjv.supabase.co"
ARG VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MjMwMTIsImV4cCI6MjA2MzM5OTAxMn0.z9UkKHDm4RPMs_2IIzEPEYzd3-sbQSF6XpxaQg3vZhU"
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── Runtime stage: serve dist/ + keyless sidecar handshake ─────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
# serve.js + identity.js + a package.json pinning these to CommonJS.
COPY docker/serve.js docker/identity.js docker/package.json ./docker/

ENV PORT=3000
ENV SIDECAR_URL="http://127.0.0.1:8081"
# SUPABASE_JWT_SECRET must be supplied at runtime (K8s Secret / compose env).
# When unset in production the proxy fails closed (503) rather than logging
# unattributed access. Never bake this secret into the image.
USER node
EXPOSE 3000

CMD ["node", "docker/serve.js"]
