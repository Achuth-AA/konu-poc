#!/bin/bash
# Create the crawler VM in Mumbai (asia-south1). Run from Cloud Shell or any machine with gcloud.
#   PROJECT=my-project BUCKET=my-bucket ./deploy/gcp/create-vm.sh
set -euo pipefail
PROJECT="${PROJECT:?set PROJECT}"
ZONE="${ZONE:-asia-south1-a}"            # Mumbai; asia-south2-a is Delhi
NAME="${NAME:-konu-crawler}"
MACHINE="${MACHINE:-e2-medium}"           # 2 vCPU / 4 GB: enough for Chromium (Quikr)
BUCKET="${BUCKET:-}"                      # optional: CSV is copied to gs://$BUCKET after each update
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -n "$BUCKET" ]; then
  gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1 \
    || gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location asia-south1
fi

gcloud compute instances create "$NAME" \
  --project "$PROJECT" --zone "$ZONE" --machine-type "$MACHINE" \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 30GB \
  --scopes storage-rw \
  --metadata "gcs-bucket=$BUCKET" \
  --metadata-from-file startup-script="$HERE/startup.sh"

echo "Created $NAME. Follow progress with:"
echo "  gcloud compute ssh $NAME --zone $ZONE -- sudo docker logs -f konu-crawler"
