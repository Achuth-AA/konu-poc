# Konu dashboard

Live view of the crawler for a non-technical audience:

* **KPI cards**: listings in the table, new today, websites working, typical sale price per sq ft, typical rent.
* **How the data flows**: an n8n-style whiteboard (drag, pinch / Ctrl+scroll to zoom, full screen).
  Websites on the left send dots along their lines into the crawler → listings / projects / govt
  registers → cleaning → database → your CSV and this dashboard. Green = working, red dashed with ✕ =
  the site refused our server, amber = needs a person (captcha). Click a website for the plain-language reason.
* **Recent crawler runs**: every visit to every website, newest first.
* **Download the table (CSV)**: the 30-column file.

React 18 + Vite + Tailwind CSS + React Flow. It polls the backend every 30 s.

## Deploy on Vercel

1. Vercel → **Add New → Project** → import `Achuth-AA/konu-poc`.
2. **Root Directory: `dashboard`** (framework is detected as Vite).
3. **Environment Variables** (both are printed by `deploy/gcp/create-vm.sh`):
   * `BACKEND_URL` = `http://<VM external IP>:8000`
   * `KONU_API_KEY` = the key set on the VM
4. Deploy. Open the site: the header pill turns green ("Live · crawler last ran …").

The browser only ever talks to Vercel. `api/[...path].js` is a Vercel serverless function
that forwards `/api/*` to the VM with the secret key, so the key never reaches the browser
and the VM can stay on plain HTTP.

Before the backend exists, `https://<your-app>.vercel.app/?demo` shows a saved snapshot
from the 24 Oct test run (marked "Demo snapshot" in the header).

## Run locally

```bash
# backend (from the repo root): store + API
python -m konu_crawlers schedule --once      # or: ingest data/*.jsonl
python -m konu_crawlers serve --port 8000
# dashboard
cd dashboard && npm install && npm run dev  # http://localhost:5173, /api proxied to :8000
```
