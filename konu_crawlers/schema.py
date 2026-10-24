"""The flat listing table requested for analysis (one row per listing).

Columns, in order:
URL, YearMonth, Year, Month, Price_INR, Price_Cr, PricePerSqft, BHK,
Area_Sqft, Bathrooms, Balconies, Car_Parking, Floor_Number, Total_Floors,
Property_Age_Years, Age_Group, Locality, Pincode, Society, Furnishing,
Facing, Ownership, Overlooking, Transaction, Construction_Status,
Cement_Price_Rs_per_bag_50kg, Steel_TMT_Price_Rs_per_tonne, Latitude,
Longitude, Full_Address

Cement and steel prices are not on any property site. They come from a
``--materials`` CSV (``YearMonth,cement,steel``) or ``--cement-price`` /
``--steel-price``; otherwise they stay blank.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from .extract import parse_number
from .models import Record

COLUMNS = [
    "URL", "YearMonth", "Year", "Month", "Price_INR", "Price_Cr", "PricePerSqft", "BHK", "Area_Sqft", "Bathrooms",
    "Balconies", "Car_Parking", "Floor_Number", "Total_Floors", "Property_Age_Years", "Age_Group", "Locality", "Pincode",
    "Society", "Furnishing", "Facing", "Ownership", "Overlooking", "Transaction", "Construction_Status",
    "Cement_Price_Rs_per_bag_50kg", "Steel_TMT_Price_Rs_per_tonne", "Latitude", "Longitude", "Full_Address",
]

_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def posted_date(rec: Record) -> dt.date | None:
    """Best date for the listing: when it was posted, else when we crawled it."""
    s = str(rec.posted_at or "")
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-,\s]+(\d{4})", s)  # 17-Sep-2026, 21 Oct, 2026
    if m and m.group(2).lower() in _MONTHS:
        return dt.date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
    m = re.search(r"([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})", s)  # Oct 22, 2026
    if m and m.group(1).lower() in _MONTHS:
        return dt.date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
    try:
        return dt.datetime.fromisoformat(rec.scraped_at).date()
    except (TypeError, ValueError):
        return None


def floor_number(v: Any) -> float | None:
    s = str(v or "").strip().lower()
    if not s:
        return None
    if s.startswith(("ground", "g ")) or s == "g":
        return 0
    if "basement" in s or "lower" in s:
        return -1
    return parse_number(s)


def total_floors(v: Any, floor_text: Any = None) -> float | None:
    n = parse_number(v)
    if n is not None:
        return n
    m = re.search(r"(?:of|out of)\s+(\d+)", str(floor_text or ""), re.I)  # "15th of 28 Floors", "4 out of 4"
    return float(m.group(1)) if m else None


def age_years(v: Any, status: Any = None) -> float | None:
    s = str(v if v is not None else "").strip().lower()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if any(w in s for w in ("new", "under construction")) or "under construction" in str(status or "").lower():
        return 0.0
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)]
    if not nums:
        return None
    if "+" in s or "above" in s or "more" in s:
        return nums[0]
    return sum(nums[:2]) / len(nums[:2])  # "5-10 Years" -> 7.5


def age_group(years: float | None) -> str | None:
    if years is None:
        return None
    if years < 1:
        return "New / Under Construction"
    if years <= 5:
        return "1-5 Years"
    if years <= 10:
        return "6-10 Years"
    if years <= 20:
        return "11-20 Years"
    return "20+ Years"


def car_parking(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v).lower()
    n = parse_number(s)
    if n is not None:
        return n
    if s in ("no", "none", "not available", "nil"):
        return 0
    if any(w in s for w in ("yes", "four", "car", "covered", "open", "both", "available")):
        return 1
    return None


def transaction(rec: Record, d: dict) -> str | None:
    if rec.transaction == "rent":
        return "Rent"
    t = str(d.get("transaction_type") or "").lower()
    if "new" in t or "primary" in t:
        return "New Property"
    if "resale" in t:
        return "Resale"
    if rec.kind == "project":
        return "New Property"
    if rec.url and "resale" in rec.url.lower():
        return "Resale"
    return "Sale" if rec.transaction == "sale" else None


def to_row(rec: Record, d: dict | None = None, materials: dict | None = None) -> dict[str, Any]:
    d = d or {}
    raw = rec.raw or {}
    day = posted_date(rec)
    ym = f"{day.year}-{day.month:02d}" if day else None
    area = rec.area_sqft
    price = rec.price
    floor_txt = d.get("floor") or raw.get("floorD") or raw.get("floorNo")
    status = d.get("status") or rec.status
    years = age_years(d.get("age"), status)
    # search pages give exact coordinates; some detail pages round them
    lat = rec.latitude or d.get("latitude")
    lon = rec.longitude or d.get("longitude")
    mat = (materials or {}).get(ym) or (materials or {}).get("*") or {}
    return {
        "URL": rec.url,
        "YearMonth": ym,
        "Year": day.year if day else None,
        "Month": day.month if day else None,
        "Price_INR": round(price) if price else None,
        "Price_Cr": round(price / 1e7, 4) if price else None,
        "PricePerSqft": round(price / area, 2) if price and area and area > 50 else None,
        "BHK": rec.bedrooms,
        "Area_Sqft": area,
        "Bathrooms": parse_number(d.get("bathrooms")) or rec.bathrooms,
        "Balconies": parse_number(d.get("balconies")),
        "Car_Parking": car_parking(d.get("car_parking")),
        "Floor_Number": floor_number(floor_txt),
        "Total_Floors": total_floors(d.get("total_floors") or raw.get("floors"), floor_txt),
        "Property_Age_Years": years,
        "Age_Group": age_group(years),
        "Locality": rec.locality,
        "Pincode": d.get("pincode"),
        "Society": d.get("society") or rec.project_name,
        "Furnishing": d.get("furnishing") or rec.furnishing,
        "Facing": d.get("facing"),
        "Ownership": d.get("ownership"),
        "Overlooking": d.get("overlooking"),
        "Transaction": transaction(rec, d),
        "Construction_Status": status,
        "Cement_Price_Rs_per_bag_50kg": mat.get("cement"),
        "Steel_TMT_Price_Rs_per_tonne": mat.get("steel"),
        "Latitude": lat,
        "Longitude": lon,
        "Full_Address": d.get("address") or rec.address or ", ".join(x for x in (rec.project_name, rec.locality, (rec.city or "").title()) if x) or None,
    }
