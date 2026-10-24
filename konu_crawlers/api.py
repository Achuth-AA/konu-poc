"""Read-only HTTP API for the dashboard: ``python -m konu_crawlers serve``.

Everything is read from the scheduler's SQLite store (``data/konu.db``), so
the API can run in its own process/container next to the scheduler.

Auth: when ``KONU_API_KEY`` is set every ``/api/*`` call (except
``/api/health``) needs header ``X-API-Key``. CORS origins come from
``KONU_CORS_ORIGINS`` (comma separated; default ``*``).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import re
import sqlite3
import statistics
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .base import REGISTRY
from .export import load_materials
from .models import Record
from .scheduler import load_config
from .schema import COLUMNS, to_row

# Plain-language description of every source, for people who don't know the sites.
SOURCE_INFO: dict[str, dict[str, str]] = {
    "ts_rera": {"group": "Government", "what": "Registered projects, promoters and agents (Telangana RERA)", "site": "rera.telangana.gov.in"},
    "hmda": {"group": "Government", "what": "Approved layouts and building permissions (HMDA)", "site": "hmda.gov.in"},
    "ghmc": {"group": "Government", "what": "Building permissions inside city limits (GHMC)", "site": "ghmc.gov.in"},
    "igrs": {"group": "Government", "what": "Government market values and registrations (IGRS)", "site": "registration.telangana.gov.in"},
    "bhubharati": {"group": "Government", "what": "Land records (Bhu Bharati, formerly Dharani)", "site": "bhubharati.telangana.gov.in"},
    "nobroker": {"group": "Listing portal", "what": "Owner listings, buy and rent", "site": "nobroker.in"},
    "magicbricks": {"group": "Listing portal", "what": "Buy, rent and new projects", "site": "magicbricks.com"},
    "99acres": {"group": "Listing portal", "what": "Buy, rent, projects and agents", "site": "99acres.com"},
    "housing": {"group": "Listing portal", "what": "Buy, rent and new projects", "site": "housing.com"},
    "squareyards": {"group": "Listing portal", "what": "Resale, rentals and new projects", "site": "squareyards.com"},
    "makaan": {"group": "Listing portal", "what": "Buy and rent (now redirects to Housing.com)", "site": "makaan.com"},
    "proptiger": {"group": "Listing portal", "what": "New projects from builders", "site": "proptiger.com"},
    "roofandfloor": {"group": "Listing portal", "what": "Buy, rent and projects (South India)", "site": "roofandfloor.com"},
    "indiaproperty": {"group": "Listing portal", "what": "Buy and rent", "site": "indiaproperty.com"},
    "commonfloor": {"group": "Listing portal", "what": "Buy and rent", "site": "commonfloor.com"},
    "realestateindia": {"group": "Listing portal", "what": "Buy, rent, projects and agents", "site": "realestateindia.com"},
    "olx": {"group": "Classifieds", "what": "Houses and apartments for sale and rent", "site": "olx.in"},
    "quikr": {"group": "Classifieds", "what": "Quikr Homes, buy and rent", "site": "quikr.com/homes"},
    "sulekha": {"group": "Classifieds", "what": "Property ads and agents", "site": "property.sulekha.com"},
    "justdial": {"group": "Classifieds", "what": "Real-estate agents and builders", "site": "justdial.com"},
}


def explain(status: str | None, detail: str | None) -> str:
    """Turn a run status + technical message into one plain sentence."""
    d = (detail or "").lower()
    if status is None:
        return "Waiting for its first scheduled run."
    if status.startswith("OK") or status.startswith("PARTIAL"):
        return "Working: collected listings on the last run."
    if status == "CAPTCHA":
        return "Needs a person to type a captcha before each search, so it is run by hand."
    if status == "TIMEOUT":
        return "The site was too slow and the run was stopped; it will retry automatically."
    if "akamai" in d or "security alert" in d or "access denied" in d:
        return "The site's bot protection (Akamai) refused our server."
    if "country=" in d or "geo" in d:
        return "The site only serves visitors from inside India."
    if "maintenance" in d:
        return "The site showed a 'back soon' page to our server (usually region-based)."
    if "reset" in d or "refused" in d or "remotedisconnected" in d:
        return "The site dropped the connection (often blocks servers outside India)."
    if "f5" in d or "waf" in d or "rejected" in d:
        return "The site's firewall rejected our server."
    if "cloudfront" in d:
        return "The site's CDN (CloudFront) blocked our server's region."
    if "robots" in d:
        return "The site asks robots not to read this page, so we skip it."
    if status == "BLOCKED":
        return "The site refused our server."
    return "The last run failed; it will retry on schedule."


def state_of(status: str | None) -> str:
    if status is None:
        return "pending"
    if status.startswith("OK") or status.startswith("PARTIAL"):
        return "live"
    if status == "CAPTCHA":
        return "manual"
    if status in ("TIMEOUT", "ERROR"):
        return "error"
    return "blocked"


class Data:
    def __init__(self, config: str | None) -> None:
        self.cfg = load_config(config)
        self.db_path = Path(self.cfg["data_dir"]) / "konu.db"

    def conn(self) -> sqlite3.Connection:
        if not self.db_path.exists():
            raise HTTPException(503, "No data yet: the scheduler has not completed a run.")
        c = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def listing_rows(self) -> list[dict]:
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=self.cfg["drop_unseen_after_days"])).isoformat(timespec="seconds")
        materials = load_materials(self.cfg.get("materials_csv") if self.cfg.get("materials_csv") and Path(self.cfg["materials_csv"]).exists() else None,
                                   self.cfg.get("cement_price"), self.cfg.get("steel_price"))
        with self.conn() as c:
            rows = c.execute(
                """SELECT r.json, d.json AS dj, r.first_seen, r.last_seen FROM records r LEFT JOIN details d ON d.key = r.key
                   WHERE r.kind='listing' AND r.transaction_type IN ('sale','rent') AND r.last_seen >= ?""",
                (cutoff,),
            ).fetchall()
        out = []
        for r in rows:
            rec = json.loads(r["json"])
            row = to_row(Record(**rec), json.loads(r["dj"]) if r["dj"] else {}, materials)
            row["Source"] = rec["source"]
            row["Title"] = rec.get("title")
            row["First_Seen"] = r["first_seen"]
            out.append(row)
        return out


def create_app(config: str | None = None) -> FastAPI:
    data = Data(config or os.environ.get("KONU_CONFIG", "deploy/schedule.json"))
    api_key = os.environ.get("KONU_API_KEY")
    app = FastAPI(title="konu crawler API", version="1.0")
    origins = [o.strip() for o in os.environ.get("KONU_CORS_ORIGINS", "*").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"], allow_headers=["*"])

    def auth(x_api_key: str | None = Header(default=None)) -> None:
        if api_key and x_api_key != api_key:
            raise HTTPException(401, "Missing or wrong X-API-Key")

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "db": data.db_path.exists(), "time": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}

    @app.get("/api/sources", dependencies=[Depends(auth)])
    def sources() -> dict:
        jobs = [j for j in data.cfg["jobs"]]
        with data.conn() as c:
            latest = {row["job"]: row for row in c.execute(
                "SELECT job, started, finished, status, records, detail FROM runs r1 WHERE started = (SELECT MAX(started) FROM runs r2 WHERE r2.job = r1.job)")}
            totals = {row["source"]: row["n"] for row in c.execute("SELECT source, COUNT(*) AS n FROM records GROUP BY source")}
            new24 = {row["source"]: row["n"] for row in c.execute(
                "SELECT source, COUNT(*) AS n FROM records WHERE first_seen >= ? GROUP BY source",
                ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)).isoformat(timespec="seconds"),))}
        out = []
        for name in sorted(REGISTRY, key=lambda n: (list(SOURCE_INFO).index(n) if n in SOURCE_INFO else 99)):
            cls = REGISTRY[name]
            types = []
            for t in cls.transactions:
                j = next((j for j in jobs if j["source"] == name and j["type"] == t), None)
                run = latest.get(f"{name}:{t}")
                status = run["status"] if run else ("CAPTCHA" if cls.interactive and name == "ts_rera" else None)
                types.append({
                    "type": t, "scheduled": bool(j and j.get("enabled", True)), "every_hours": j["every_hours"] if j else None,
                    "state": state_of(status), "status": status, "last_run": run["finished"] if run else None,
                    "records": run["records"] if run else 0, "reason": explain(status, run["detail"] if run else None),
                })
            states = [t["state"] for t in types if t["scheduled"]] or [t["state"] for t in types]
            overall = "live" if "live" in states else "manual" if "manual" in states else "blocked" if "blocked" in states else "error" if "error" in states else "pending"
            best = next((t for t in types if t["state"] == overall), types[0])
            last_runs = [t["last_run"] for t in types if t["last_run"]]
            out.append({
                "name": name, "title": cls.title, **SOURCE_INFO.get(name, {"group": "Other", "what": "", "site": ""}),
                "state": overall, "reason": best["reason"], "types": types,
                "live_types": sum(1 for t in types if t["state"] == "live"), "total_records": totals.get(name, 0),
                "new_24h": new24.get(name, 0), "last_run": max(last_runs) if last_runs else None,
            })
        return {"sources": out}

    @app.get("/api/overview", dependencies=[Depends(auth)])
    def overview() -> dict:
        src = sources()["sources"]
        rows = data.listing_rows()
        sale_psf = [r["PricePerSqft"] for r in rows if r["Transaction"] != "Rent" and r["PricePerSqft"] and 500 < r["PricePerSqft"] < 100000]
        rents = [r["Price_INR"] for r in rows if r["Transaction"] == "Rent" and r["Price_INR"] and r["Price_INR"] < 2_000_000]
        with data.conn() as c:
            total_records = c.execute("SELECT COUNT(*) FROM records").fetchone()[0]
            enriched = c.execute("SELECT COUNT(*) FROM details WHERE status='ok'").fetchone()[0]
            pending_details = c.execute(
                "SELECT COUNT(*) FROM records r LEFT JOIN details d ON d.key=r.key WHERE r.kind='listing' AND d.key IS NULL").fetchone()[0]
            last = c.execute("SELECT MAX(finished) FROM runs").fetchone()[0]
            runs24 = c.execute("SELECT COUNT(*) FROM runs WHERE started >= ?",
                               ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)).isoformat(timespec="seconds"),)).fetchone()[0]
            gov = c.execute("SELECT COUNT(*) FROM records WHERE source IN ('hmda','ghmc','igrs','bhubharati','ts_rera')").fetchone()[0]
            projects = c.execute("SELECT COUNT(*) FROM records WHERE kind='project'").fetchone()[0]
        with data.conn() as c:
            new24 = c.execute("SELECT COUNT(*) FROM records WHERE kind='listing' AND first_seen >= ?",
                              ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)).isoformat(timespec="seconds"),)).fetchone()[0]
        return {
            "listings": len(rows), "new_24h": new24, "total_records": total_records, "projects": projects, "government_records": gov,
            "sources_total": len(src),
            "sources_live": sum(1 for s in src if s["state"] == "live"),
            "sources_blocked": sum(1 for s in src if s["state"] in ("blocked", "error")),
            "sources_manual": sum(1 for s in src if s["state"] == "manual"),
            "sources_pending": sum(1 for s in src if s["state"] == "pending"),
            "median_sale_psf": round(statistics.median(sale_psf)) if sale_psf else None,
            "median_rent": round(statistics.median(rents)) if rents else None,
            "last_run": last, "runs_24h": runs24,
            "pipeline": {"crawled": total_records, "enriched": enriched, "pending_details": pending_details, "in_csv": len(rows)},
        }

    @app.get("/api/listings", dependencies=[Depends(auth)])
    def listings(
        q: str | None = None, source: str | None = None, transaction: str | None = Query(None, pattern="^(sale|rent)$"),
        bhk: float | None = None, sort: str = "First_Seen", order: str = Query("desc", pattern="^(asc|desc)$"),
        limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
    ) -> dict:
        rows = data.listing_rows()
        if q:
            ql = q.lower()
            rows = [r for r in rows if ql in " ".join(str(r.get(k) or "") for k in ("Title", "Locality", "Society", "Full_Address")).lower()]
        if source:
            rows = [r for r in rows if r["Source"] == source]
        if transaction:
            rows = [r for r in rows if (r["Transaction"] == "Rent") == (transaction == "rent")]
        if bhk is not None:
            rows = [r for r in rows if r["BHK"] == bhk]
        key = sort if rows and sort in rows[0] else "First_Seen"
        rows.sort(key=lambda r: (r.get(key) is None, r.get(key) if not isinstance(r.get(key), str) else r.get(key).lower()), reverse=(order == "desc"))
        if order == "desc":  # keep blanks last either way
            rows = [r for r in rows if r.get(key) is not None] + [r for r in rows if r.get(key) is None]
        return {"total": len(rows), "rows": rows[offset: offset + limit], "columns": COLUMNS}

    @app.get("/api/localities", dependencies=[Depends(auth)])
    def localities(transaction: str = Query("sale", pattern="^(sale|rent)$"), min_listings: int = 2, limit: int = 15) -> dict:
        groups: dict[str, list] = {}
        for r in data.listing_rows():
            if not r["Locality"] or (r["Transaction"] == "Rent") != (transaction == "rent"):
                continue
            v = r["PricePerSqft"] if transaction == "sale" else r["Price_INR"]
            if v:
                groups.setdefault(re.sub(r"\s+", " ", str(r["Locality"])).strip().title(), []).append(v)
        out = [{"locality": k, "median": round(statistics.median(v)), "listings": len(v)} for k, v in groups.items() if len(v) >= min_listings]
        out.sort(key=lambda x: -x["listings"])
        return {"transaction": transaction, "metric": "price_per_sqft" if transaction == "sale" else "monthly_rent", "rows": out[:limit]}

    @app.get("/api/activity", dependencies=[Depends(auth)])
    def activity(limit: int = Query(30, le=200)) -> dict:
        with data.conn() as c:
            rows = c.execute("SELECT job, started, finished, status, records, detail FROM runs ORDER BY started DESC LIMIT ?", (limit,)).fetchall()
        return {"runs": [{**dict(r), "state": state_of(r["status"]), "reason": explain(r["status"], r["detail"])} for r in rows]}

    @app.get("/api/trend", dependencies=[Depends(auth)])
    def trend(days: int = Query(14, le=90)) -> dict:
        since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat(timespec="seconds")
        with data.conn() as c:
            rows = c.execute(
                "SELECT substr(first_seen,1,10) AS day, COUNT(*) AS n FROM records WHERE kind='listing' AND first_seen >= ? GROUP BY day ORDER BY day",
                (since,)).fetchall()
        return {"days": [dict(r) for r in rows]}

    @app.get("/api/export.csv", dependencies=[Depends(auth)])
    def export_csv() -> StreamingResponse:
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=COLUMNS + ["Source"], extrasaction="ignore")
        w.writeheader()
        w.writerows(data.listing_rows())
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": 'attachment; filename="hyderabad_listings.csv"'})

    return app


def serve(config: str | None, host: str, port: int) -> int:
    import uvicorn

    uvicorn.run(create_app(config), host=host, port=port, proxy_headers=True)
    return 0
