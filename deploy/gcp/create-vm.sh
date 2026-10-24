#!/bin/bash
# Create the crawler VM in Mumbai (asia-south1). Run from Cloud Shell or any machine with gcloud.
#   PROJECT=my-project BUCKET=my-bucket ./deploy/gcp/create-vm.sh
set -euo pipefail
PROJECT="${PROJECT:?set PROJECT}"
ZONE="${ZONE:-asia-south1-a}"            # Mumbai; asia-south2-a is Delhi
NAME="${NAME:-konu-crawler}"
MACHINE="${MACHINE:-e2-medium}"           # 2 vCPU / 4 GB: enough for Chromium (Quikr)
BUCKET="${BUCKET:-}"                      # optional: CSV is copied to gs://$BUCKET after each update
API_KEY="${API_KEY:-$(openssl rand -hex 24)}"  # the dashboard (Vercel) sends this as X-API-Key
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -n "$BUCKET" ]; then
  gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1 \
    || gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location asia-south1
fi

# Let the dashboard reach the API on port 8000 (requests without the key are refused).
gcloud compute firewall-rules describe konu-api --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create konu-api --project "$PROJECT" \
       --allow tcp:8000 --target-tags konu-api --description "konu dashboard API"

gcloud compute instances create "$NAME" \
  --tags konu-api \
  --project "$PROJECT" --zone "$ZONE" --machine-type "$MACHINE" \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 30GB \
  --scopes storage-rw \
  --metadata "gcs-bucket=$BUCKET,konu-api-key=$API_KEY" \
  --metadata-from-file startup-script="$HERE/startup.sh"

IP=$(gcloud compute instances describe "$NAME" --project "$PROJECT" --zone "$ZONE" --format 'get(networkInterfaces[0].accessConfigs[0].natIP)')
echo
echo "Created $NAME. Put these in Vercel → Settings → Environment Variables:"
echo "  BACKEND_URL=http://$IP:8000"
echo "  KONU_API_KEY=$API_KEY"
echo "(the first crawl and image build take ~10 minutes; then http://$IP:8000/api/health answers)"
echo
echo "Follow progress with:"
echo "  gcloud compute ssh $NAME --zone $ZONE -- sudo docker logs -f konu-crawler"
