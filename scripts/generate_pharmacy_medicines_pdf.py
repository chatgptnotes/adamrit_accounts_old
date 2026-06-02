"""Generate a PDF of active pharmacy medicines with prices and stock.

Fetches medicine_master (Hope Multi-Specialty Hospital) and joins
medicine_batch_inventory on medicine_id to compute, per medicine:
  - Stock  = sum(current_stock) over active batches
  - MRP / Selling price = from the most recent active batch
Renders the result to scripts/pharmacy_medicines.pdf.
"""
import json
import urllib.parse
import urllib.request
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
)

SUPABASE_URL = "https://xvkxccqaopbnkvwgyfjv.supabase.co/rest/v1"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ 9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6"
    "ImFub24iLCJpYXQiOjE3NDc4MjMwMTIsImV4cCI6MjA2MzM5OTAxMn0."
    "z9UkKHDm4RPMs_2IIzEPEYzd3-sbQSF6XpxaQg3vZhU"
).replace(" ", "")
HOSPITAL = "Hope Multi-Specialty Hospital"
OUT_PATH = "scripts/pharmacy_medicines.pdf"


def _get(table, params):
    """Page through a Supabase table, returning all matching rows."""
    rows = []
    page_size = 1000
    offset = 0
    while True:
        req = urllib.request.Request(f"{SUPABASE_URL}/{table}?{params}")
        req.add_header("apikey", ANON_KEY)
        req.add_header("Authorization", f"Bearer {ANON_KEY}")
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{offset}-{offset + page_size - 1}")
        with urllib.request.urlopen(req) as resp:
            batch = json.loads(resp.read().decode())
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def fetch_medicines():
    params = (
        "select=id,medicine_name,generic_name,type"
        "&is_deleted=eq.false"
        f"&hospital_name=eq.{urllib.parse.quote(HOSPITAL)}"
        "&order=medicine_name.asc"
    )
    return _get("medicine_master", params)


def fetch_batches():
    params = (
        "select=medicine_id,current_stock,selling_price,mrp,is_active,created_at"
        "&is_active=eq.true"
    )
    return _get("medicine_batch_inventory", params)


def aggregate_batches(batches):
    """Per medicine_id: total active stock + latest batch's mrp/selling price."""
    agg = {}
    for b in batches:
        mid = b.get("medicine_id")
        if not mid:
            continue
        entry = agg.setdefault(mid, {"stock": 0, "mrp": None, "sell": None, "ts": ""})
        entry["stock"] += b.get("current_stock") or 0
        ts = b.get("created_at") or ""
        if ts >= entry["ts"]:  # most recent batch wins for pricing
            entry["ts"] = ts
            entry["mrp"] = b.get("mrp")
            entry["sell"] = b.get("selling_price")
    return agg


def clean(value):
    return (value or "").strip()


def money(value):
    if value is None:
        return "-"
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return "-"


def build_pdf(rows, agg):
    doc = SimpleDocTemplate(
        OUT_PATH, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title="Pharmacy Medicines - Price & Stock", author="Adamrit",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitleC", parent=styles["Title"], fontSize=18, spaceAfter=2)
    sub_style = ParagraphStyle(
        "Sub", parent=styles["Normal"], fontSize=9,
        textColor=colors.HexColor("#555555"), spaceAfter=10,
    )
    cell = ParagraphStyle("Cell", parent=styles["Normal"], fontSize=8, leading=10)
    cell_r = ParagraphStyle("CellR", parent=cell, alignment=2)  # right align
    head = ParagraphStyle(
        "Head", parent=styles["Normal"], fontSize=9, leading=11,
        textColor=colors.white, fontName="Helvetica-Bold",
    )
    head_r = ParagraphStyle("HeadR", parent=head, alignment=2)

    in_stock = sum(1 for r in rows if agg.get(r["id"], {}).get("stock", 0) > 0)

    elements = [
        Paragraph("Pharmacy Medicines &mdash; Price &amp; Stock", title_style),
        Paragraph(
            f"{HOSPITAL} &nbsp;|&nbsp; {len(rows)} active medicines "
            f"({in_stock} in stock) &nbsp;|&nbsp; "
            f"Generated {datetime.now():%d %b %Y %H:%M}",
            sub_style,
        ),
    ]

    data = [[
        Paragraph("#", head),
        Paragraph("Medicine Name", head),
        Paragraph("Generic Name", head),
        Paragraph("Type", head),
        Paragraph("MRP", head_r),
        Paragraph("Sell Price", head_r),
        Paragraph("Stock", head_r),
    ]]
    for i, r in enumerate(rows, 1):
        a = agg.get(r["id"], {})
        data.append([
            Paragraph(str(i), cell),
            Paragraph(clean(r.get("medicine_name")), cell),
            Paragraph(clean(r.get("generic_name")), cell),
            Paragraph(clean(r.get("type")), cell),
            Paragraph(money(a.get("mrp")), cell_r),
            Paragraph(money(a.get("sell")), cell_r),
            Paragraph(str(a.get("stock", 0)), cell_r),
        ])

    table = Table(
        data,
        colWidths=[10 * mm, 56 * mm, 42 * mm, 20 * mm, 21 * mm, 21 * mm, 16 * mm],
        repeatRows=1,
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f6feb")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f2f6fc")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(table)
    doc.build(elements)


if __name__ == "__main__":
    meds = fetch_medicines()
    print(f"Fetched {len(meds)} medicines")
    batches = fetch_batches()
    print(f"Fetched {len(batches)} active batches")
    agg = aggregate_batches(batches)
    build_pdf(meds, agg)
    print(f"Wrote {OUT_PATH}")
