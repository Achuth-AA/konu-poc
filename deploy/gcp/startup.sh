#!/bin/bash
# GCE startup script: installs Docker, builds the crawler image and keeps it running.
# Runs on every boot; safe to re-run.
set -euo pipefail
REPO="${REPO:-https://github.com/Achuth-AA/konu-poc.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/konu-poc
DATA=/var/konu/data
META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
BUCKET=$(curl -fs -H 'Metadata-Flavor: Google' "$META/gcs-bucket" || true)
PROXY=$(curl -fs -H 'Metadata-Flavor: Google' "$META/konu-proxy" || true)
API_KEY=$(curl -fs -H 'Metadata-Flavor: Google' "$META/konu-api-key" || true)
CORS=$(curl -fs -H 'Metadata-Flavor: Google' "$META/konu-cors-origins" || echo '*')

if ! command -v docker >/dev/null; then
  apt-get update && apt-get install -y docker.io git
  systemctl enable --now docker
fi
mkdir -p "$DATA"
if [ -d "$APP/.git" ]; then git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else git clone -q -b "$BRANCH" "$REPO" "$APP"; fi

docker build -q -t konu-crawler "$APP"
docker rm -f konu-crawler konu-api >/dev/null 2>&1 || true
# 1) the scheduler: crawls on its timers and keeps the CSV + database current
docker run -d --name konu-crawler --restart unless-stopped \
  --shm-size=512m \
  -v "$DATA":/app/data \
  -e KONU_GCS_BUCKET="$BUCKET" -e KONU_PROXY="$PROXY" \
  --log-opt max-size=20m --log-opt max-file=5 \
  konu-crawler
# 2) the read-only API the Vercel dashboard calls (port 8000, needs X-API-Key)
docker run -d --name konu-api --restart unless-stopped \
  -p 8000:8000 \
  -v "$DATA":/app/data \
  -e KONU_API_KEY="$API_KEY" -e KONU_CORS_ORIGINS="$CORS" \
  --log-opt max-size=20m --log-opt max-file=5 \
  konu-crawler python -m konu_crawlers serve --port 8000
