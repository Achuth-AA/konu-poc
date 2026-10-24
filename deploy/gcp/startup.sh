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

if ! command -v docker >/dev/null; then
  apt-get update && apt-get install -y docker.io git
  systemctl enable --now docker
fi
mkdir -p "$DATA"
if [ -d "$APP/.git" ]; then git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else git clone -q -b "$BRANCH" "$REPO" "$APP"; fi

docker build -q -t konu-crawler "$APP"
docker rm -f konu-crawler >/dev/null 2>&1 || true
docker run -d --name konu-crawler --restart unless-stopped \
  --shm-size=512m \
  -v "$DATA":/app/data \
  -e KONU_GCS_BUCKET="$BUCKET" -e KONU_PROXY="$PROXY" \
  --log-opt max-size=20m --log-opt max-file=5 \
  konu-crawler
