#!/usr/bin/env python
"""Compile a LaTeX file into PDF using XeLaTeX."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


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
    parser = argparse.ArgumentParser(description="Compile LaTeX to PDF using XeLaTeX.")
    parser.add_argument("tex_file", type=Path, help="Path to .tex file")
    parser.add_argument("output", type=Path, nargs="?", help="Output PDF path")
    args = parser.parse_args()

    if not args.tex_file.exists():
        raise SystemExit(f"LaTeX file not found: {args.tex_file}")

    xelatex = _require_xelatex()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        pdf_path = _run_xelatex(xelatex, args.tex_file, tmp_dir_path)
        if not pdf_path.exists():
            raise SystemExit("XeLaTeX did not produce a PDF")

        output_path = args.output or args.tex_file.with_suffix(".pdf")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(pdf_path.read_bytes())
        print(f"PDF written to {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
