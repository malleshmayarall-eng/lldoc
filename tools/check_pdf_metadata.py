#!/usr/bin/env python
"""Print raw PDF metadata keys/values."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


def _iter_metadata_items(reader: PdfReader) -> Iterable[tuple[str, str]]:
    metadata = reader.metadata or {}
    for key, value in metadata.items():
        yield str(key), "" if value is None else str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Print raw PDF metadata.")
    parser.add_argument("pdf_path", type=Path, help="Path to the PDF file")
    args = parser.parse_args()

    if not args.pdf_path.exists():
        raise SystemExit(f"PDF not found: {args.pdf_path}")

    reader = PdfReader(str(args.pdf_path))
    for key, value in _iter_metadata_items(reader):
        print(f"{key}: {value}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
