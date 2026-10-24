# Deploying on Google Cloud (asia-south1, Mumbai)

The crawler runs as one Docker container on a small Compute Engine VM. It works
through the sources on a schedule, forever, and keeps **one CSV** current:

```
/var/konu/data/hyderabad_listings.csv     ← the table (30 columns + Source)
/var/konu/data/status.json                ← last run of every job
/var/konu/data/konu.db                    ← SQLite store (all records, detail facts, run log)
```

## 1. Create the VM (once)

From [Cloud Shell](https://shell.cloud.google.com) or any machine with `gcloud`:

```bash
git clone https://github.com/Achuth-AA/konu-poc && cd konu-poc
PROJECT=<your-gcp-project> BUCKET=<optional-bucket-name> ./deploy/gcp/create-vm.sh
```

* Region `asia-south1-a` (Mumbai) by default; `ZONE=asia-south2-a` for Delhi.
* `e2-medium` (2 vCPU, 4 GB) by default, roughly US$25–30 a month. Chromium (Quikr) needs the 4 GB.
* With `BUCKET` set, every CSV update is also copied to `gs://BUCKET/hyderabad_listings.csv`
  using the VM's own service account (no keys to manage).

The VM's startup script installs Docker, clones this repo, builds the image and starts
the container with `--restart unless-stopped`. It does the same on every reboot, pulling
the latest `main`, so **to update: push to `main`, then reboot the VM** (or re-run the
startup script with `sudo google_metadata_script_runner startup`).

It also prints `BACKEND_URL` and `KONU_API_KEY` for the dashboard: the VM runs a second
container, `konu-api` (port 8000, needs header `X-API-Key`), that the Vercel dashboard reads.
See [dashboard/README.md](dashboard/README.md) for the Vercel side (Root Directory `dashboard`,
those two environment variables, deploy).

## 2. Check it is working

```bash
gcloud compute ssh konu-crawler --zone asia-south1-a
sudo docker logs -f konu-crawler                       # live log
curl -s -H "X-API-Key: <key>" localhost:8000/api/overview   # what the dashboard sees
cat /var/konu/data/status.json                         # last result of every job
head -3 /var/konu/data/hyderabad_listings.csv
```

Run `doctor` once on the VM to see which sites accept GCP's Indian IPs:

```bash
sudo docker exec konu-crawler python -m konu_crawlers doctor --out /app/data/doctor
# then: gcloud compute scp konu-crawler:/var/konu/data/doctor.zip . --zone asia-south1-a
```

## 3. How the schedule works (`deploy/schedule.json`)

| Jobs | Every | Pages | Hard timeout |
|------|-------|-------|--------------|
| Sale + rent on 13 listing portals | 6 h | 5 | 20 min (Quikr 30) |
| New projects (7 portals) | 24 h | 5 | 30 min |
| Agents / builders | 7 days | 3 | 20 min |
| HMDA, GHMC, IGRS, Bhu Bharati | 7 days | 1–3 | 20 min |

* Each job runs in a child process and is **killed at its timeout**, so one stuck site or
  browser never stalls the rest. Every HTTP request also has its own 45 s timeout and retries
  with back-off on 429/5xx.
* After the due jobs, new listings get their **detail pages** fetched (20 min budget per
  cycle; the rest carry over to the next cycle), then the CSV is rewritten atomically.
* A site that **blocks** the VM is retried after 12 h instead of every cycle.
* Listings are keyed by URL: re-crawls update rows instead of duplicating them. A listing
  not seen for 45 days drops out of the CSV (it stays in `konu.db`).
* Requests go one at a time per site with a 2 s gap (`delay_seconds`), and robots.txt is honoured.

Edit `deploy/schedule.json` (intervals, pages, `"enabled": false` to switch a job off),
push to `main`, reboot the VM.

## 4. Things only you can provide

* **Cement and steel prices.** No property site publishes them. Fill
  `deploy/materials.csv` (`YearMonth,cement,steel`, e.g. `2026-10,380,58000`), or set
  `"cement_price"` / `"steel_price"` in `deploy/schedule.json` for a flat value. Until then
  those two columns stay empty.
* **TS-RERA** is not scheduled: its search needs a person to type a captcha. Run it by hand
  when needed: `sudo docker exec -it konu-crawler python -m konu_crawlers crawl ts_rera --max-pages 20`.
* **Sites that still block GCP.** If `doctor` shows Akamai blocks (99acres, Housing.com,
  OLX, JustDial, CommonFloor), the VM's IP is the problem, not the code. Options are a
  network you are entitled to use set as the proxy (VM metadata `konu-proxy=http://user:pass@host:port`,
  or `"proxy"` in `schedule.json`), or a data agreement with that portal.

## Without Docker

```bash
sudo useradd -r -m konu && sudo git clone https://github.com/Achuth-AA/konu-poc /opt/konu-poc
cd /opt/konu-poc && sudo python3 -m venv .venv && sudo .venv/bin/pip install -r requirements.txt
sudo .venv/bin/python -m playwright install --with-deps chromium
sudo chown -R konu /opt/konu-poc
sudo cp deploy/konu-crawler.service /etc/systemd/system/ && sudo systemctl enable --now konu-crawler
```

## Automatic deploys (GitHub Actions)

`.github/workflows/backend.yml` runs on every change to the backend:

1. **test**: installs `requirements.txt` and runs the test suite.
2. **docker**: builds the same image the VM builds and smoke-tests it.
3. **deploy** (pushes to `main`, or *Actions → backend → Run workflow*): SSHes to the VM,
   re-runs the startup script (pull `main`, rebuild, restart `konu-crawler` and `konu-api`),
   then waits for `http://<VM IP>:8000/api/health`. The SQLite store and CSV on the VM's disk are kept.

The deploy step needs a service account, created once from Cloud Shell:

```bash
PROJECT=<your-project>
gcloud iam service-accounts create konu-deployer --project $PROJECT
for role in roles/compute.instanceAdmin.v1 roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member "serviceAccount:konu-deployer@$PROJECT.iam.gserviceaccount.com" --role $role
done
gcloud iam service-accounts keys create key.json \
  --iam-account konu-deployer@$PROJECT.iam.gserviceaccount.com
```

Then in GitHub → **Settings → Secrets and variables → Actions** add `GCP_SA_KEY` (the whole
contents of `key.json`; delete the file afterwards) and `GCP_PROJECT`. Optional: `GCP_ZONE`
(default `asia-south1-a`) and `GCP_VM` (default `konu-crawler`). Without these secrets the
workflow still tests and builds, and skips the deploy.

`.github/workflows/dashboard.yml` checks that the dashboard builds; Vercel deploys it from `main` itself.
