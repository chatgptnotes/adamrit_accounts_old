#!/usr/bin/env python3
"""
Always save the generated PDF to the Desktop.

Usage:
  python3 scripts/save_pdf_to_desktop.py                     # default: /tmp/pmjay_jv_note.html
  python3 scripts/save_pdf_to_desktop.py path/to/input.html  # any HTML file
  python3 scripts/save_pdf_to_desktop.py input.html out.pdf  # custom output filename

The output directory is ALWAYS ~/Desktop, regardless of where this script is run from.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Lazy import so we can print a friendly message if weasyprint is missing.
def _import_weasyprint():
    try:
        from weasyprint import HTML  # type: ignore
        return HTML
    except ImportError:
        print(
            "ERROR: weasyprint is not installed.\n"
            "Install it with:  pip install weasyprint\n"
            "(macOS may also require:  brew install pango)",
            file=sys.stderr,
        )
        sys.exit(1)


# ALWAYS use the Desktop as the destination directory.
DESKTOP_DIR = Path(os.path.expanduser("~/Desktop"))


def main(argv: list[str]) -> int:
    if len(argv) > 3:
        print(__doc__, file=sys.stderr)
        return 2

    # Source HTML file (default = the currently-open PMJAY JV note).
    src = Path(argv[1]).expanduser().resolve() if len(argv) > 1 else Path("/tmp/pmjay_jv_note.html")

    if not src.exists():
        print(f"ERROR: source HTML not found: {src}", file=sys.stderr)
        return 1

    # Output filename (always under ~/Desktop).
    out_name = argv[2] if len(argv) > 2 else f"{src.stem}.pdf"
    if not out_name.lower().endswith(".pdf"):
        out_name += ".pdf"

    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
    dest = DESKTOP_DIR / out_name

    HTML = _import_weasyprint()
    print(f"Generating PDF from: {src}")
    print(f"Saving PDF to:        {dest}  (always ~/Desktop)")
    HTML(filename=str(src)).write_pdf(str(dest))

    if dest.exists():
        print(f"OK: {dest} ({dest.stat().st_size:,} bytes)")
        return 0
    print("ERROR: PDF was not written.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))