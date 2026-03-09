#!/usr/bin/env python
"""Compile a document's LaTeX code into PDF using XeLaTeX."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import django


def _require_xelatex() -> str:
    xelatex = shutil.which("xelatex")
    if not xelatex:
        raise SystemExit("XeLaTeX not found in PATH. Install TeX Live or MacTeX.")
    return xelatex


def _run_xelatex(xelatex: str, tex_path: Path, output_dir: Path) -> Path:
    command = [
        xelatex,
        "-interaction=nonstopmode",
        "-halt-on-error",
        f"-output-directory={output_dir}",
        str(tex_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or "XeLaTeX failed")
    return output_dir / (tex_path.stem + ".pdf")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile document LaTeX into PDF using XeLaTeX.")
    parser.add_argument("document_id", help="Document UUID")
    parser.add_argument("output", type=Path, nargs="?", help="Output PDF path")
    args = parser.parse_args()

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "drafter.settings")
    django.setup()

    from documents.models import Document

    document = Document.objects.filter(id=args.document_id).first()
    if not document:
        raise SystemExit(f"Document not found: {args.document_id}")
    if not document.is_latex_code or not document.latex_code:
        raise SystemExit("Document does not contain LaTeX code")

    xelatex = _require_xelatex()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        tex_path = tmp_dir_path / "document.tex"
        tex_path.write_text(document.latex_code, encoding="utf-8")
        pdf_path = _run_xelatex(xelatex, tex_path, tmp_dir_path)
        if not pdf_path.exists():
            raise SystemExit("XeLaTeX did not produce a PDF")

        output_path = args.output or Path.cwd() / f"{document.id}.pdf"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(pdf_path.read_bytes())
        print(f"PDF written to {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
