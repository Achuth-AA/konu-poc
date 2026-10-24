"""Dashboard API over a small scheduler store."""

import json

import pytest
from fastapi.testclient import TestClient

from konu_crawlers import api
from konu_crawlers import scheduler as S


@pytest.fixture
def client(tmp_path, monkeypatch):
    cfg = {"data_dir": str(tmp_path), "csv": str(tmp_path / "o.csv"), "jobs": [
        {"source": "realestateindia", "type": "rent", "every_hours": 6}, {"source": "99acres", "type": "sale", "every_hours": 6}]}
    (tmp_path / "cfg.json").write_text(json.dumps(cfg))
    st = S.Store(tmp_path / "konu.db")
    base = {"source": "realestateindia", "kind": "listing", "transaction": "rent", "city": "hyderabad"}
    st.upsert([{**base, "source_id": str(i), "url": f"https://x/{i}", "title": f"{i} BHK Flat for Rent in Miyapur", "price": 20000.0 + i * 1000,
                "area_sqft": 1000.0, "bedrooms": float(i), "locality": "Miyapur"} for i in range(1, 4)])
    st.upsert([{"source": "hmda", "kind": "layout", "source_id": "LO/1", "url": "https://hmda/LO.aspx"}])
    st.log_run("realestateindia:rent", S.now(), "OK", 3, "[realestateindia] 3 records – ok")
    st.log_run("99acres:sale", S.now(), "BLOCKED", 0, "[99acres] 0 records – BLOCKED: HTTP 403 – Akamai 'Access Denied'")
    monkeypatch.setenv("KONU_API_KEY", "secret")
    return TestClient(api.create_app(str(tmp_path / "cfg.json")))


H = {"X-API-Key": "secret"}


def test_key_required_except_health(client):
    assert client.get("/api/health").json()["ok"]
    assert client.get("/api/overview").status_code == 401
    assert client.get("/api/overview", headers=H).status_code == 200


def test_overview_and_sources_in_plain_words(client):
    o = client.get("/api/overview", headers=H).json()
    assert o["listings"] == 3 and o["median_rent"] == 22000 and o["government_records"] == 1
    src = {s["name"]: s for s in client.get("/api/sources", headers=H).json()["sources"]}
    assert len(src) == 20
    assert src["realestateindia"]["state"] == "live"
    assert src["99acres"]["state"] == "blocked" and "Akamai" in src["99acres"]["reason"]
    assert src["ts_rera"]["state"] == "manual"


def test_listings_filter_sort_and_csv(client):
    r = client.get("/api/listings", headers=H, params={"sort": "Price_INR", "order": "asc", "limit": 2}).json()
    assert r["total"] == 3 and [x["Price_INR"] for x in r["rows"]] == [21000, 22000]
    assert client.get("/api/listings", headers=H, params={"q": "3 bhk"}).json()["total"] == 1
    csv_text = client.get("/api/export.csv", headers=H).text
    assert csv_text.splitlines()[0].startswith("URL,YearMonth,Year,Month,Price_INR") and len(csv_text.splitlines()) == 4
    loc = client.get("/api/localities", headers=H, params={"transaction": "rent"}).json()["rows"]
    assert loc == [{"locality": "Miyapur", "median": 22000, "listings": 3}]
